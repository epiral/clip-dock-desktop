// main.ts — Electron 入口（多 Clip 支持）
import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { create } from "@bufbuild/protobuf";
import { InvokeRequestSchema } from "./gen/pinix/v1/pinix_pb.js";
import { registerSchemes, registerClipSchemeHandlers } from "./bridge.js";
import { loadClip } from "./loader.js";
import { readClips, writeClips } from "./clipsStore.js";
// 必须在 app.ready 之前注册
registerSchemes();
const clipRegistry = new Map();
// 为指定 ClipConfig 创建独立窗口
function openClipWindow(config) {
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
function createLauncherWindow() {
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
    win.loadFile(path.join(__dirname, "../src/launcher.html"));
    return win;
}
app.whenReady().then(() => {
    // Launcher IPC handlers
    ipcMain.handle("launcher:get-clips", () => readClips());
    ipcMain.handle("launcher:open-clip", (_event, config) => {
        openClipWindow(config);
    });
    ipcMain.handle("launcher:save-clips", (_event, clips) => {
        writeClips(clips);
    });
    // Clip 写操作 IPC — 通过 sender.id 查找对应 Clip
    ipcMain.handle("pinix:invoke", async (event, action, payload) => {
        const entry = clipRegistry.get(event.sender.id);
        if (!entry) {
            return { stderr: "unknown clip", exitCode: -1 };
        }
        try {
            const payloadArgs = payload?.args;
            const payloadStdin = payload?.stdin;
            const args = Array.isArray(payloadArgs) ? payloadArgs : [];
            const stdin = typeof payloadStdin === "string" ? payloadStdin : "";
            const invalidArgs = args.some((arg) => typeof arg !== "string");
            const invalidPayload = payloadArgs !== undefined && !Array.isArray(payloadArgs);
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "unknown error";
            return { stderr: message, exitCode: -1 };
        }
    });
    // 启动 Launcher
    createLauncherWindow();
});
app.on("window-all-closed", () => {
    app.quit();
});
