// bridge.ts — 协议拦截 + RPC 转发 + 分治缓存
// pinix-web:// → 磁盘强缓存（不过期，手动清除）
// pinix-data:// → 内存 ETag 协商缓存

import { protocol } from "electron";
import type { Session } from "electron";
import fs from "node:fs";
import nodePath from "node:path";
import { ConnectError, Code, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { create } from "@bufbuild/protobuf";
import {
  ClipService,
  ReadFileRequestSchema,
} from "./gen/pinix/v1/pinix_pb.js";
import type { ReadFileChunk } from "./gen/pinix/v1/pinix_pb.js";
import type { Interceptor } from "@connectrpc/connect";
import type { ClipBookmark } from "./types.js";

// ── Range 解析 ──

type ParsedRange = {
  offset: bigint;
  length: bigint;
  openEnded: boolean;
};

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

// ── MIME 映射（磁盘缓存命中时用） ──

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

// ── RPC 错误映射 ──

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

// ── 工具函数 ──

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.byteLength;
  }
  return result;
}

// ── Scheme 注册（app.ready 前调用） ──

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

// ── RPC 客户端 ──

export function createClipClient(config: ClipBookmark) {
  const authInterceptor: Interceptor = (next) => (req) => {
    req.header.set("Authorization", `Bearer ${config.token}`);
    return next(req);
  };
  const transport = createConnectTransport({
    baseUrl: config.server_url,
    httpVersion: "2",
    interceptors: [authInterceptor],
  });
  return createClient(ClipService, transport);
}

// ── ETag 内存缓存 ──

type ETagCacheEntry = {
  etag: string;
  data: Uint8Array;
  mimeType: string;
  totalSize: bigint;
};

const etagCache = new Map<string, ETagCacheEntry>();

// ── 缓存清理（磁盘 + 内存） ──

export function clearClipCache(name: string, cacheDir: string): void {
  const webCacheDir = nodePath.join(cacheDir, name, "web");
  fs.rmSync(webCacheDir, { recursive: true, force: true });
  const prefix = `${name}:`;
  for (const key of etagCache.keys()) {
    if (key.startsWith(prefix)) etagCache.delete(key);
  }
}

// ── Scheme handler 注册 ──

export function registerClipSchemeHandlers(
  ses: Session,
  config: ClipBookmark,
  cacheDir: string
) {
  const client = createClipClient(config);
  for (const scheme of ["pinix-web", "pinix-data"] as const) {
    if (ses.protocol.isProtocolHandled(scheme)) {
      ses.protocol.unhandle(scheme);
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

// ── 流式 Response 构建（Range 支持，共用） ──

function buildStreamResponse(
  firstChunk: ReadFileChunk,
  iterator: AsyncIterator<ReadFileChunk>,
  rangeHeader: string | undefined,
  range: ParsedRange | null
): Response {
  const mimeType = firstChunk.mimeType || "application/octet-stream";
  const totalSize = firstChunk.totalSize;
  const dataOffset = firstChunk.offset;
  let contentLength: bigint | null = null;

  if (rangeHeader && range) {
    contentLength = range.openEnded
      ? (totalSize > dataOffset ? totalSize - dataOffset : 0n)
      : range.length;
  } else {
    contentLength = totalSize;
  }

  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Accept-Ranges": "bytes",
  };
  if (contentLength !== null) {
    headers["Content-Length"] = contentLength.toString();
  }

  let status = 200;
  if (rangeHeader && range) {
    status = 206;
    if (totalSize > 0n && contentLength !== null) {
      const actualEnd = dataOffset + contentLength - 1n;
      headers["Content-Range"] =
        `bytes ${dataOffset}-${actualEnd}/${totalSize}`;
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(firstChunk.data);
    },
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
        } else {
          controller.enqueue(next.value.data);
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, { status, headers });
}

// ── pinix-web:// 磁盘强缓存 handler ──

function createWebSchemeHandler(
  clipClient: ReturnType<typeof createClipClient>,
  alias: string,
  cacheDir: string
) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const relPath = url.pathname.slice(1);
    const filePath =
      relPath.startsWith("web/") || relPath === "web"
        ? relPath
        : `web/${relPath}`;

    // 磁盘缓存命中 → 直接返回，不调 RPC
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
    } catch {
      // 缓存未命中，走 RPC
    }

    // Range 解析
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

    try {
      const iterator = clipClient.readFile(readReq)[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.done) {
        return new Response(new Uint8Array(), {
          status: rangeHeader ? 206 : 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": "0",
            "Accept-Ranges": "bytes",
          },
        });
      }

      // 非 Range → 收集完整数据，原子写入磁盘缓存
      if (!rangeHeader) {
        const chunks: Uint8Array[] = [first.value.data];
        let next = await iterator.next();
        while (!next.done) {
          chunks.push(next.value.data);
          next = await iterator.next();
        }
        const fullData = concatUint8Arrays(chunks);
        const mimeType = first.value.mimeType || "application/octet-stream";

        // 原子写入：先写 tmp 再 rename
        try {
          fs.mkdirSync(nodePath.dirname(cachePath), { recursive: true });
          const tmpPath = `${cachePath}.tmp.${process.pid}`;
          fs.writeFileSync(tmpPath, fullData);
          fs.renameSync(tmpPath, cachePath);
        } catch {
          // 缓存写入失败不影响响应
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

      // Range 请求 → 流式返回（不缓存部分数据）
      return buildStreamResponse(first.value, iterator, rangeHeader, range);
    } catch (err) {
      return mapRpcError(err);
    }
  };
}

// ── pinix-data:// ETag 内存协商缓存 handler ──

function createDataSchemeHandler(
  clipClient: ReturnType<typeof createClipClient>,
  alias: string
) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const relPath = url.pathname.slice(1);
    const filePath =
      relPath.startsWith("data/") || relPath === "data"
        ? relPath
        : `data/${relPath}`;

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

    try {
      const iterator = clipClient.readFile(readReq)[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.done) {
        return new Response(new Uint8Array(), {
          status: rangeHeader ? 206 : 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": "0",
            "Accept-Ranges": "bytes",
          },
        });
      }

      // ETag 未变 → 直接从内存缓存返回
      if (first.value.notModified && cached) {
        if (rangeHeader && range) {
          const start = Number(range.offset);
          const total = Number(cached.totalSize);
          const end = range.openEnded
            ? total
            : Math.min(start + Number(range.length), total);
          const slice = cached.data.slice(start, end);
          return new Response(Buffer.from(slice), {
            status: 206,
            headers: {
              "Content-Type": cached.mimeType,
              "Content-Length": String(slice.byteLength),
              "Content-Range": `bytes ${start}-${end - 1}/${total}`,
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

      // 非 Range → 收集数据，更新 ETag 缓存
      if (!rangeHeader) {
        const chunks: Uint8Array[] = [first.value.data];
        let next = await iterator.next();
        while (!next.done) {
          chunks.push(next.value.data);
          next = await iterator.next();
        }
        const fullData = concatUint8Arrays(chunks);
        const mimeType = first.value.mimeType || "application/octet-stream";
        const etag = first.value.etag;
        const totalSize = first.value.totalSize;

        if (etag) {
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

      // Range 请求 + 缓存 stale → 流式返回
      return buildStreamResponse(first.value, iterator, rangeHeader, range);
    } catch (err) {
      return mapRpcError(err);
    }
  };
}
