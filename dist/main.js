// main.ts — Electron 入口
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { create } from "@bufbuild/protobuf";
import { ClipService, InvokeRequestSchema, } from "./gen/pinix/v1/pinix_pb.js";
import { registerSchemes, registerSchemeHandlers } from "./bridge.js";
import { loadClip } from "./loader.js";
// 必须在 app.ready 之前注册
registerSchemes();
// RPC transport（复用 bridge 同一个 daemon）
const TOKEN = readFileSync(path.join(homedir(), ".config/pinix/secrets/super-token"), "utf-8").trim();
const authInterceptor = (next) => (req) => {
    req.header.set("Authorization", `Bearer ${TOKEN}`);
    return next(req);
};
const transport = createConnectTransport({
    baseUrl: "http://localhost:9875",
    httpVersion: "2",
    interceptors: [authInterceptor],
});
const clipClient = createClient(ClipService, transport);
function createWindow() {
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
    ipcMain.handle("pinix:invoke", async (_event, action, payload) => {
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
            const res = await clipClient.invoke(req);
            return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "unknown error";
            return { stderr: message, exitCode: -1 };
        }
    });
    // 创建窗口并加载默认 clip
    const win = createWindow();
    const clipId = process.argv[2] || "default";
    loadClip(win, clipId);
});
app.on("window-all-closed", () => {
    app.quit();
});
