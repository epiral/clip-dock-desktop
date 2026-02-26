// bridge.ts — 协议拦截 + RPC 转发
// pinix-web:// 和 pinix-data:// 的 scheme handler

import { protocol } from "electron";
import { ConnectError, Code, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { create } from "@bufbuild/protobuf";
import {
  ClipService,
  ReadFileRequestSchema,
} from "./gen/pinix/v1/pinix_pb.js";

// 连接 pinix daemon（Tailscale IP + gRPC 端口）
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Interceptor } from "@connectrpc/connect";

const TOKEN = readFileSync(
  path.join(homedir(), ".config/pinix/secrets/super-token"),
  "utf-8"
).trim();

const authInterceptor: Interceptor = (next) => (req) => {
  req.header.set("Authorization", `Bearer ${TOKEN}`);
  return next(req);
};

const transport = createConnectTransport({
  baseUrl: process.env.PINIX_SERVER_URL ?? "http://localhost:9875",
  httpVersion: "2",
  interceptors: [authInterceptor],
});

const clipClient = createClient(ClipService, transport);

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

// 注册 scheme handler，将请求转发到 ReadFile RPC
export function registerSchemeHandlers(): void {
  registerScheme("pinix-web", "web");
  registerScheme("pinix-data", "data");
}

function registerScheme(scheme: string, base: string): void {
  protocol.handle(scheme, async (req) => {
    const url = new URL(req.url);
    // url.hostname = clipId, url.pathname = /index.html (web) or /data/xxx.md (data)
    const relPath = url.pathname.slice(1); // strip leading /
    const filePath = relPath.startsWith(base + "/") || relPath === base
      ? relPath                 // pathname already includes base (pinix-data)
      : `${base}/${relPath}`;  // prepend base (pinix-web)
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
  });
}
