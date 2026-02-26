// main.ts — Electron 入口
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { create } from "@bufbuild/protobuf";
import {
  ClipService,
  InvokeRequestSchema,
} from "./gen/pinix/v1/pinix_pb.js";
import { registerSchemes, registerSchemeHandlers } from "./bridge.js";
import { loadClip } from "./loader.js";

// 必须在 app.ready 之前注册
registerSchemes();

// RPC transport（复用 bridge 同一个 daemon）
const transport = createConnectTransport({
  baseUrl: "http://100.66.47.40:5005",
  httpVersion: "2",
});
const clipClient = createClient(ClipService, transport);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  return win;
}

app.whenReady().then(() => {
  // 注册 scheme handlers（必须在 app.ready 之后）
  registerSchemeHandlers();

  // 注册 IPC handler：唯一的写操作入口
  ipcMain.handle(
    "pinix:invoke",
    async (_event, action: string, payload: unknown) => {
      const args =
        Array.isArray(payload) ? payload.map(String) : payload ? [String(payload)] : [];
      const req = create(InvokeRequestSchema, {
        name: action,
        args,
        stdin: "",
      });
      const res = await clipClient.invoke(req);
      return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
    }
  );

  // 创建窗口并加载默认 clip
  const win = createWindow();
  const clipId = process.argv[2] || "default";
  loadClip(win, clipId);
});

app.on("window-all-closed", () => {
  app.quit();
});
