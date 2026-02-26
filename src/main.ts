// main.ts — Electron 入口（多 Clip 支持）
import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { create } from "@bufbuild/protobuf";
import { InvokeRequestSchema } from "./gen/pinix/v1/pinix_pb.js";
import { registerSchemes, registerClipSchemeHandlers, createClipClient } from "./bridge.js";
import { loadClip } from "./loader.js";
import { readClips, writeClips } from "./clipsStore.js";
import type { ClipConfig } from "./types.js";

// 必须在 app.ready 之前注册
registerSchemes();

// webContentsId → { config, client } 映射
type ClipEntry = {
  config: ClipConfig;
  client: ReturnType<typeof createClipClient>;
};
const clipRegistry = new Map<number, ClipEntry>();

// 为指定 ClipConfig 创建独立窗口
function openClipWindow(config: ClipConfig): BrowserWindow {
  const ses = session.fromPartition(`clip-${config.alias}`);
  const client = registerClipSchemeHandlers(ses, config);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: config.alias,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      session: ses,
    },
  });

  const id = win.webContents.id;
  clipRegistry.set(id, { config, client });

  win.on("closed", () => {
    clipRegistry.delete(id);
  });

  loadClip(win, config);
  return win;
}

// 创建 Launcher 窗口
function createLauncherWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 600,
    title: "Pinix Launcher",
    webPreferences: {
      preload: path.join(__dirname, "launcherPreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "../launcher/dist/index.html"));
  return win;
}


// ── Debug HTTP Server (port 9876) ──────────────────────────────
import http from "node:http";

function startDebugServer() {
  const server = http.createServer(async (req, res) => {
    const wins = (await import("electron")).BrowserWindow.getAllWindows();
    if (req.url === "/screenshot") {
      if (!wins.length) { res.writeHead(404); res.end("no window"); return; }
      const img = await wins[0].webContents.capturePage();
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(img.toPNG());
    } else if (req.url === "/windows") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(wins.map(w => ({ id: w.id, title: w.getTitle() }))));
    } else if (req.url === "/dom") {
      if (!wins.length) { res.writeHead(404); res.end("no window"); return; }
      const html = await wins[0].webContents.executeJavaScript("document.documentElement.outerHTML");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } else {
      res.writeHead(404); res.end();
    }
  });
  server.listen(9876, "127.0.0.1", () => console.log("[debug] http://localhost:9876"));
}

app.whenReady().then(() => {
  // Launcher IPC handlers
  ipcMain.handle("launcher:get-clips", () => readClips());

  ipcMain.handle("launcher:open-clip", (_event, config: ClipConfig) => {
    openClipWindow(config);
  });

  ipcMain.handle("launcher:save-clips", (_event, clips: ClipConfig[]) => {
    writeClips(clips);
  });

  // Clip 写操作 IPC — 通过 sender.id 查找对应 Clip
  ipcMain.handle(
    "pinix:invoke",
    async (event, action: string, payload: any) => {
      const entry = clipRegistry.get(event.sender.id);
      if (!entry) {
        return { stderr: "unknown clip", exitCode: -1 };
      }

      try {
        const payloadArgs = payload?.args;
        const payloadStdin = payload?.stdin;
        const args = Array.isArray(payloadArgs) ? payloadArgs : [];
        const stdin = typeof payloadStdin === "string" ? payloadStdin : "";

        const invalidArgs = args.some((arg: unknown) => typeof arg !== "string");
        const invalidPayload =
          payloadArgs !== undefined && !Array.isArray(payloadArgs);

        if (invalidArgs || invalidPayload || typeof stdin !== "string") {
          return { stderr: "invalid payload", exitCode: 1 };
        }

        const req = create(InvokeRequestSchema, {
          name: action,
          args,
          stdin,
        });
        const res = await entry.client.invoke(req);
        return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        return { stderr: message, exitCode: -1 };
      }
    }
  );

  // 启动 Launcher
  createLauncherWindow();
  startDebugServer();
});

app.on("window-all-closed", () => {
  app.quit();
});
