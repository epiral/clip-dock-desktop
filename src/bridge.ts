// bridge.ts — 协议拦截 + RPC 转发
// pinix-web:// 和 pinix-data:// 的 scheme handler

import { protocol } from "electron";
import { createClient } from "@connectrpc/connect";
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
  baseUrl: "http://localhost:9875",
  httpVersion: "2",
  interceptors: [authInterceptor],
});

const clipClient = createClient(ClipService, transport);

// 解析 Range header → { offset, length }
function parseRange(
  rangeHeader: string | undefined,
  totalSize: bigint
): { offset: bigint; length: bigint } | null {
  if (!rangeHeader) return null;
  const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return null;
  const start = BigInt(match[1]);
  const end = match[2] ? BigInt(match[2]) : totalSize - 1n;
  return { offset: start, length: end - start + 1n };
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

    // 首先发一个无 Range 的探测请求获取 totalSize 和 mimeType
    // 或直接带 Range 请求（服务端都会返回 totalSize）
    const range = rangeHeader
      ? parseRange(rangeHeader, 0n) // 先解析，totalSize 后面从 chunk 获取
      : null;

    const readReq = create(ReadFileRequestSchema, {
      path: filePath,
      offset: range?.offset ?? 0n,
      length: range?.length ?? 0n,
    });

    // 收集所有 chunks
    const chunks: Uint8Array[] = [];
    let mimeType = "application/octet-stream";
    let totalSize = 0n;
    let dataOffset = 0n;

    for await (const chunk of clipClient.readFile(readReq)) {
      chunks.push(chunk.data);
      mimeType = chunk.mimeType;
      totalSize = chunk.totalSize;
      if (chunks.length === 1) {
        dataOffset = chunk.offset;
      }
    }

    // 合并 chunks
    const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const body = new Uint8Array(totalLength);
    let pos = 0;
    for (const c of chunks) {
      body.set(c, pos);
      pos += c.byteLength;
    }

    // 构建 response headers
    const headers: Record<string, string> = {
      "Content-Type": mimeType,
      "Content-Length": String(body.byteLength),
      "Accept-Ranges": "bytes",
    };

    // 有 Range → 206 Partial Content
    if (rangeHeader && range) {
      // 用实际 totalSize 重新计算 end
      const actualEnd = dataOffset + BigInt(body.byteLength) - 1n;
      headers["Content-Range"] =
        `bytes ${dataOffset}-${actualEnd}/${totalSize}`;
      return new Response(body, { status: 206, headers });
    }

    // 无 Range → 200 OK
    return new Response(body, { status: 200, headers });
  });
}
