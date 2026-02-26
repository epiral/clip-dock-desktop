// bridge.ts — 协议拦截 + RPC 转发
// pinix-web:// 和 pinix-data:// 的 scheme handler

import { protocol } from "electron";
import type { Session } from "electron";
import { ConnectError, Code, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { create } from "@bufbuild/protobuf";
import {
  ClipService,
  ReadFileRequestSchema,
} from "./gen/pinix/v1/pinix_pb.js";
import type { Interceptor } from "@connectrpc/connect";
import type { ClipConfig } from "./types.js";

// 解析 Range header → { offset, length }
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

// 注册自定义 scheme 为 privileged（必须在 app.ready 之前调用）
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

// 为指定 ClipConfig 创建 RPC 客户端
export function createClipClient(config: ClipConfig) {
  const authInterceptor: Interceptor = (next) => (req) => {
    req.header.set("Authorization", `Bearer ${config.token}`);
    return next(req);
  };
  const transport = createConnectTransport({
    baseUrl: `http://${config.host}:${config.port}`,
    httpVersion: "2",
    interceptors: [authInterceptor],
  });
  return createClient(ClipService, transport);
}

// fixed: 先 unregister 旧 handler 再注册新的，避免 alias 改名后残留
export function registerClipSchemeHandlers(
  ses: Session,
  config: ClipConfig
) {
  const client = createClipClient(config);
  for (const scheme of ["pinix-web", "pinix-data"] as const) {
    if (ses.protocol.isProtocolHandled(scheme)) {
      ses.protocol.unhandle(scheme);
    }
    const base = scheme === "pinix-web" ? "web" : "data";
    ses.protocol.handle(scheme, createSchemeHandler(client, base));
  }
  return client;
}

// 创建 scheme handler（参数化 client 和 base 路径）
function createSchemeHandler(
  clipClient: ReturnType<typeof createClipClient>,
  base: string
) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    // url.hostname = alias, url.pathname = /index.html (web) or /data/xxx.md (data)
    const relPath = url.pathname.slice(1); // strip leading /
    const filePath =
      relPath.startsWith(base + "/") || relPath === base
        ? relPath // pathname already includes base (pinix-data)
        : `${base}/${relPath}`; // prepend base (pinix-web)
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

      const firstChunk = first.value;
      const mimeType = firstChunk.mimeType || "application/octet-stream";
      const totalSize = firstChunk.totalSize;
      const dataOffset = firstChunk.offset;
      let contentLength: bigint | null = null;

      if (rangeHeader && range) {
        if (range.openEnded) {
          contentLength = totalSize > dataOffset ? totalSize - dataOffset : 0n;
        } else {
          contentLength = range.length;
        }
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
          (async () => {
            try {
              for (;;) {
                const next = await iterator.next();
                if (next.done) break;
                controller.enqueue(next.value.data);
              }
              controller.close();
            } catch (err) {
              controller.error(err);
            }
          })();
        },
      });

      return new Response(stream, { status, headers });
    } catch (err) {
      return mapRpcError(err);
    }
  };
}
