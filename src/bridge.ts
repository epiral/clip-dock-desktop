// bridge.ts — 协议拦截 + RPC 转发 + 分治缓存
// pinix-web:// → 磁盘强缓存（不过期，手动清除）
// pinix-data:// → 内存 ETag 协商缓存

import { protocol } from "electron";
import type { Session } from "electron";
import fs from "node:fs";
import nodePath from "node:path";
import { ConnectError, Code, createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { create } from "@bufbuild/protobuf";
import {
  ClipService,
  ReadFileRequestSchema,
} from "./gen/pinix/v1/pinix_pb.js";
import type { ReadFileChunk } from "./gen/pinix/v1/pinix_pb.js";
import type { Interceptor } from "@connectrpc/connect";
import type { ClipBookmark } from "./types.js";

type ParsedRange = {
  offset: bigint;
  length: bigint;
  openEnded: boolean;
};

type CacheableSchemePathPrefix = "web" | "data";

function parseRange(
  rangeHeader: string | undefined
): { ok: true; value: ParsedRange } | { ok: false } {
  if (!rangeHeader) return { ok: false };
  const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return { ok: false };
  const start = BigInt(match[1]);
  if (!match[2]) {
    return { ok: true, value: { offset: start, length: 0n, openEnded: true } };
  }
  const end = BigInt(match[2]);
  if (end < start) return { ok: false };
  return {
    ok: true,
    value: { offset: start, length: end - start + 1n, openEnded: false },
  };
}

const MIME_MAP: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webp": "image/webp", ".avif": "image/avif",
  ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".mp4": "video/mp4", ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".xml": "application/xml", ".txt": "text/plain", ".md": "text/markdown",
};

function mimeFromPath(filePath: string): string {
  return MIME_MAP[nodePath.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function mapRpcError(err: unknown): Response {
  if (err instanceof ConnectError) {
    if (err.code === Code.NotFound) {
      return new Response("Not Found", { status: 404 });
    }
    if (err.code === Code.PermissionDenied) {
      return new Response("Forbidden", { status: 403 });
    }
    if (err.code === Code.Unavailable) {
      return new Response("Service Unavailable", { status: 503 });
    }
    return new Response(err.message, { status: 500 });
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return new Response(message, { status: 500 });
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.byteLength;
  }
  return result;
}

function isSafeRelativePath(filePath: string): boolean {
  if (filePath.length === 0 || filePath.includes("\0")) return false;
  if (nodePath.isAbsolute(filePath)) return false;
  const segments = filePath.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function normalizeClipPath(url: URL, prefix: CacheableSchemePathPrefix): string | null {
  const decodedPath = decodeURIComponent(url.pathname);
  const relPath = decodedPath.replace(/^\/+/, "");
  const filePath = relPath.startsWith(`${prefix}/`) || relPath === prefix
    ? relPath
    : `${prefix}/${relPath}`;
  return isSafeRelativePath(filePath) ? filePath : null;
}

async function closeIterator(iterator: AsyncIterator<ReadFileChunk>): Promise<void> {
  if (typeof iterator.return === "function") {
    try {
      await iterator.return();
    } catch {
      // ignore cleanup errors
    }
  }
}

export function registerSchemes(): void {
  const opts = {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
  };
  protocol.registerSchemesAsPrivileged([
    { scheme: "pinix-web", privileges: opts },
    { scheme: "pinix-data", privileges: opts },
  ]);
}

export function createClipClient(config: ClipBookmark) {
  const authInterceptor: Interceptor = (next) => (req) => {
    req.header.set("Authorization", `Bearer ${config.token}`);
    return next(req);
  };
  const transport = createGrpcTransport({
    baseUrl: config.server_url,
    interceptors: [authInterceptor],
  });
  return createClient(ClipService, transport);
}

type ETagCacheEntry = {
  etag: string;
  data: Uint8Array;
  mimeType: string;
  totalSize: bigint;
};

const ETAG_CACHE_MAX = 256;
const etagCache = new Map<string, ETagCacheEntry>();

export function clearClipCache(name: string, cacheDir: string): void {
  const webCacheDir = nodePath.join(cacheDir, name, "web");
  fs.rmSync(webCacheDir, { recursive: true, force: true });
  const prefix = `${name}:`;
  for (const key of etagCache.keys()) {
    if (key.startsWith(prefix)) etagCache.delete(key);
  }
}

export function registerClipSchemeHandlers(
  ses: Session,
  config: ClipBookmark,
  cacheDir: string
) {
  const client = createClipClient(config);
  for (const scheme of ["pinix-web", "pinix-data"] as const) {
    if (ses.protocol.isProtocolHandled(scheme)) {
      try {
        ses.protocol.unhandle(scheme);
      } catch (err) {
        console.warn(`[bridge] failed to unhandle :`, err);
      }
    }
  }
  ses.protocol.handle(
    "pinix-web",
    createWebSchemeHandler(client, config.name, cacheDir)
  );
  ses.protocol.handle(
    "pinix-data",
    createDataSchemeHandler(client, config.name)
  );
  return client;
}

function buildStreamResponse(
  firstChunk: ReadFileChunk,
  iterator: AsyncIterator<ReadFileChunk>,
  rangeHeader: string | undefined,
  range: ParsedRange | null
): Response {
  const mimeType = firstChunk.mimeType || "application/octet-stream";
  const totalSize = firstChunk.totalSize;
  const dataOffset = firstChunk.offset;
  const contentLength = rangeHeader && range
    ? (range.openEnded ? (totalSize > dataOffset ? totalSize - dataOffset : 0n) : range.length)
    : totalSize;

  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Content-Length": String(contentLength),
    "Accept-Ranges": "bytes",
  };

  if (rangeHeader && range) {
    const end = contentLength > 0n ? dataOffset + contentLength - 1n : dataOffset;
    headers["Content-Range"] = `bytes ${dataOffset}-${end}/${totalSize}`;
  }

  let finished = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (firstChunk.data.byteLength > 0) {
          controller.enqueue(firstChunk.data);
        }
        while (true) {
          const next = await iterator.next();
          if (next.done) {
            finished = true;
            controller.close();
            return;
          }
          controller.enqueue(next.value.data);
        }
      } catch (err) {
        controller.error(err);
      } finally {
        if (!finished) {
          await closeIterator(iterator);
        }
      }
    },
    async cancel() {
      await closeIterator(iterator);
    },
  });

  return new Response(stream, {
    status: rangeHeader ? 206 : 200,
    headers,
  });
}

function createWebSchemeHandler(
  clipClient: ReturnType<typeof createClipClient>,
  alias: string,
  cacheDir: string
) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const filePath = normalizeClipPath(url, "web");
    if (!filePath) {
      return new Response("Bad Request", { status: 400 });
    }

    const cachePath = nodePath.join(cacheDir, alias, filePath);
    try {
      const cached = fs.readFileSync(cachePath);
      return new Response(cached, {
        status: 200,
        headers: {
          "Content-Type": mimeFromPath(cachePath),
          "Content-Length": String(cached.byteLength),
          "Accept-Ranges": "bytes",
        },
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[bridge] failed to read web cache:", err);
      }
    }

    const rangeHeader = req.headers.get("Range") ?? undefined;
    const parsedRange = rangeHeader ? parseRange(rangeHeader) : null;
    if (rangeHeader && (!parsedRange || !parsedRange.ok)) {
      return new Response(null, {
        status: 416,
        headers: { "Accept-Ranges": "bytes" },
      });
    }
    const range = parsedRange?.ok ? parsedRange.value : null;

    const readReq = create(ReadFileRequestSchema, {
      path: filePath,
      offset: range?.offset ?? 0n,
      length: range?.length ?? 0n,
    });

    let iterator: AsyncIterator<ReadFileChunk> | null = null;
    try {
      iterator = clipClient.readFile(readReq)[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.done) {
        await closeIterator(iterator);
        return new Response(new Uint8Array(), {
          status: rangeHeader ? 206 : 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": "0",
            "Accept-Ranges": "bytes",
          },
        });
      }

      if (!rangeHeader) {
        const chunks: Uint8Array[] = [first.value.data];
        try {
          while (true) {
            const next = await iterator.next();
            if (next.done) break;
            chunks.push(next.value.data);
          }
        } finally {
          await closeIterator(iterator);
        }

        const fullData = concatUint8Arrays(chunks);
        const mimeType = first.value.mimeType || "application/octet-stream";

        try {
          fs.mkdirSync(nodePath.dirname(cachePath), { recursive: true });
          const tmpPath = `${cachePath}.tmp.${process.pid}`;
          fs.writeFileSync(tmpPath, fullData);
          fs.renameSync(tmpPath, cachePath);
        } catch (err) {
          console.warn("[bridge] failed to write web cache:", err);
        }

        return new Response(Buffer.from(fullData), {
          status: 200,
          headers: {
            "Content-Type": mimeType,
            "Content-Length": String(fullData.byteLength),
            "Accept-Ranges": "bytes",
          },
        });
      }

      return buildStreamResponse(first.value, iterator, rangeHeader, range);
    } catch (err) {
      if (iterator) {
        await closeIterator(iterator);
      }
      return mapRpcError(err);
    }
  };
}

function createDataSchemeHandler(
  clipClient: ReturnType<typeof createClipClient>,
  alias: string
) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const filePath = normalizeClipPath(url, "data");
    if (!filePath) {
      return new Response("Bad Request", { status: 400 });
    }

    const cacheKey = `${alias}:${filePath}`;
    const cached = etagCache.get(cacheKey);

    const rangeHeader = req.headers.get("Range") ?? undefined;
    const parsedRange = rangeHeader ? parseRange(rangeHeader) : null;
    if (rangeHeader && (!parsedRange || !parsedRange.ok)) {
      return new Response(null, {
        status: 416,
        headers: { "Accept-Ranges": "bytes" },
      });
    }
    const range = parsedRange?.ok ? parsedRange.value : null;

    const readReq = create(ReadFileRequestSchema, {
      path: filePath,
      offset: range?.offset ?? 0n,
      length: range?.length ?? 0n,
      ifNoneMatch: cached?.etag ?? "",
    });

    let iterator: AsyncIterator<ReadFileChunk> | null = null;
    try {
      iterator = clipClient.readFile(readReq)[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.done) {
        await closeIterator(iterator);
        return new Response(new Uint8Array(), {
          status: rangeHeader ? 206 : 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": "0",
            "Accept-Ranges": "bytes",
          },
        });
      }

      if (first.value.notModified && cached) {
        await closeIterator(iterator);
        if (rangeHeader && range) {
          if (range.offset >= cached.totalSize) {
            return new Response(null, {
              status: 416,
              headers: {
                "Accept-Ranges": "bytes",
                "Content-Range": `bytes */${cached.totalSize}`,
              },
            });
          }
          const start = Number(range.offset);
          const total = Number(cached.totalSize);
          const exclusiveEnd = range.openEnded
            ? total
            : Math.min(start + Number(range.length), total);
          const slice = cached.data.slice(start, exclusiveEnd);
          return new Response(Buffer.from(slice), {
            status: 206,
            headers: {
              "Content-Type": cached.mimeType,
              "Content-Length": String(slice.byteLength),
              "Content-Range": `bytes ${start}-${exclusiveEnd - 1}/${total}`,
              "Accept-Ranges": "bytes",
            },
          });
        }
        return new Response(Buffer.from(cached.data), {
          status: 200,
          headers: {
            "Content-Type": cached.mimeType,
            "Content-Length": String(cached.data.byteLength),
            "Accept-Ranges": "bytes",
          },
        });
      }

      if (!rangeHeader) {
        const chunks: Uint8Array[] = [first.value.data];
        try {
          while (true) {
            const next = await iterator.next();
            if (next.done) break;
            chunks.push(next.value.data);
          }
        } finally {
          await closeIterator(iterator);
        }

        const fullData = concatUint8Arrays(chunks);
        const mimeType = first.value.mimeType || "application/octet-stream";
        const etag = first.value.etag;
        const totalSize = first.value.totalSize;

        if (etag) {
          if (etagCache.size >= ETAG_CACHE_MAX) {
            const oldestKey = etagCache.keys().next().value;
            if (oldestKey) {
              etagCache.delete(oldestKey);
            }
          }
          etagCache.set(cacheKey, { etag, data: fullData, mimeType, totalSize });
        }

        return new Response(Buffer.from(fullData), {
          status: 200,
          headers: {
            "Content-Type": mimeType,
            "Content-Length": String(fullData.byteLength),
            "Accept-Ranges": "bytes",
          },
        });
      }

      return buildStreamResponse(first.value, iterator, rangeHeader, range);
    } catch (err) {
      if (iterator) {
        await closeIterator(iterator);
      }
      return mapRpcError(err);
    }
  };
}
