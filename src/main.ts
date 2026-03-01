// main.ts — Electron 入口（多 Clip 支持）
import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { create } from "@bufbuild/protobuf";
import { InvokeRequestSchema, GetInfoRequestSchema } from "./gen/pinix/v1/pinix_pb.js";
import { registerSchemes, registerClipSchemeHandlers, createClipClient, clearClipCache } from "./bridge.js";
import { loadClip } from "./loader.js";
import { readClips, writeClips } from "./clipsStore.js";
import type { ClipBookmark } from "./types.js";

function isClipBookmark(v: unknown): v is ClipBookmark {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.name === "string" && obj.name.length > 0 &&
    typeof obj.server_url === "string" && obj.server_url.length > 0 &&
    typeof obj.token === "string"
  );
}

// 必须在 app.ready 之前注册
registerSchemes();

// webContentsId → { config, client } 映射
type ClipEntry = {
  config: ClipBookmark;
  client: ReturnType<typeof createClipClient>;
};
const clipRegistry = new Map<number, ClipEntry>();

// 为指定 ClipBookmark 创建独立窗口
function openClipWindow(config: ClipBookmark): BrowserWindow {
  const cacheDir = path.join(app.getPath("userData"), "clips");
  const ses = session.fromPartition(`clip-${config.name}`);
  const client = registerClipSchemeHandlers(ses, config, cacheDir);

  const ws = config.windowState;
  const win = new BrowserWindow({
    width: ws?.width ?? 1200,
    height: ws?.height ?? 800,
    ...(ws?.x != null && ws?.y != null ? { x: ws.x, y: ws.y } : {}),
    title: config.name,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      session: ses,
    },
  });

  const id = win.webContents.id;
  clipRegistry.set(id, { config, client });

  // GetInfo — 用返回的 name 更新窗口标题
  client.getInfo(create(GetInfoRequestSchema, {})).then((info) => {
    if (info.name && !win.isDestroyed()) {
      win.setTitle(info.name);
    }
  }).catch((err) => {
    console.warn(`[GetInfo] ${config.name}: ${err instanceof Error ? err.message : err}`);
  });

  // persist windowState before native window is destroyed
  win.on("close", () => {
    try {
      if (win.isDestroyed()) return;
      const bounds = win.getBounds();
      const clips = readClips();
      const idx = clips.findIndex(c => c.name === config.name);
      if (idx !== -1) {
        clips[idx].windowState = { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y };
        writeClips(clips);
      }
    } catch (err) {
      console.error(`[windowState] persist failed for ${config.name}:`, err);
    }
  });

  // cleanup after native window is destroyed
  win.on("closed", () => {
    clipRegistry.delete(id);
    win.webContents.removeAllListeners();
    ses.clearCache().catch(() => {});
  });

  // Cmd+R / Ctrl+R → 清缓存并重载 Clip
  win.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      (input.meta || input.control) &&
      input.key.toLowerCase() === "r" &&
      !input.shift
    ) {
      event.preventDefault();
      clearClipCache(config.name, cacheDir);
      win.webContents.reload();
    }
  });

  loadClip(win, config).catch((err) => {
    console.error(`[loadClip] ${config.name}: ${err instanceof Error ? err.message : err}`);
  });
  return win;
}

// 创建 Launcher 窗口
function createLauncherWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 600,
    title: "Clip Dock",
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

import { URL as NodeURL } from "node:url";

function getWin(alias: string | null): BrowserWindow | undefined {
  const wins = BrowserWindow.getAllWindows();
  if (!alias) return wins[0];
  return wins.find((w) => w.getTitle() === alias) ?? wins[0];
}

async function readBody(req: import("http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString(); });
    req.on("end", () => resolve(body));
    req.on("error", (err) => reject(err));
  });
}

function safeJsonParse(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (typeof parsed !== "object" || parsed === null) return { ok: false, error: "body is not an object" };
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invalid JSON" };
  }
}

function startDebugServer() {
  const server = http.createServer(async (req, res) => {
    const parsed = new NodeURL(req.url ?? "/", "http://localhost:9876");
    const p = parsed.pathname;
    const alias = parsed.searchParams.get("alias");
    const win = getWin(alias);

    const ok = (data: unknown, ct = "application/json") => {
      const body = typeof data === "string" ? data : JSON.stringify(data);
      res.writeHead(200, { "Content-Type": ct, "Access-Control-Allow-Origin": "*" });
      res.end(body);
    };
    const fail = (code: number, msg: string) => { res.writeHead(code); res.end(msg); };

    try {
      if (!win && p !== "/windows") return fail(404, "no window");

      if (p === "/windows") {
        const all = BrowserWindow.getAllWindows();
        return ok(all.map((w) => ({ id: w.id, title: w.getTitle(), bounds: w.getBounds() })));
      }

      if (p === "/screenshot") {
        const img = await win!.webContents.capturePage();
        res.writeHead(200, { "Content-Type": "image/png" });
        return res.end(img.toPNG());
      }

      if (p === "/dom") {
        const html = await win!.webContents.executeJavaScript("document.documentElement.outerHTML");
        return ok(html, "text/html");
      }

      if (p === "/snapshot") {
        const tree = await win!.webContents.executeJavaScript(`(function(){
          let idx=0;
          function walk(el){
            const tag=el.tagName?el.tagName.toLowerCase():"";
            const role=el.getAttribute?el.getAttribute("role"):"";
            const text=(el.innerText||el.textContent||"").trim().slice(0,80);
            const interactive=["a","button","input","select","textarea"].includes(tag)||!!role;
            const node={ref:String(idx++),tag,role:role||tag,text,interactive};
            const children=Array.from(el.children||[]).map(walk);
            return children.length?Object.assign(node,{children}):node;
          }
          return JSON.stringify(walk(document.body));
        })()`);
        return ok(JSON.parse(tree));
      }

      if (p === "/eval") {
        let raw: string;
        try { raw = await readBody(req); } catch { return fail(400, "failed to read request body"); }
        const parsed = safeJsonParse(raw);
        if (!parsed.ok) return fail(400, parsed.error);
        const script = parsed.value.script;
        if (!script || typeof script !== "string") return fail(400, "missing script");
        try {
          const result = await win!.webContents.executeJavaScript(script);
          return ok({ result });
        } catch (e: unknown) { return ok({ error: String(e) }); }
      }

      if (p === "/click") {
        let raw: string;
        try { raw = await readBody(req); } catch { return fail(400, "failed to read request body"); }
        const parsed = safeJsonParse(raw);
        if (!parsed.ok) return fail(400, parsed.error);
        const selector = parsed.value.selector;
        if (!selector || typeof selector !== "string") return fail(400, "missing selector");
        const result = await win!.webContents.executeJavaScript(
          `(function(){const el=document.querySelector(${JSON.stringify(selector)});if(el){el.click();return "ok";}return "not found";})()`
        );
        return ok({ result });
      }

      if (p === "/fill") {
        let raw: string;
        try { raw = await readBody(req); } catch { return fail(400, "failed to read request body"); }
        const parsed = safeJsonParse(raw);
        if (!parsed.ok) return fail(400, parsed.error);
        const selector = parsed.value.selector;
        const value = parsed.value.value;
        if (!selector || typeof selector !== "string" || value == null) return fail(400, "missing selector or value");
        const result = await win!.webContents.executeJavaScript(
          `(function(){const el=document.querySelector(${JSON.stringify(selector as string)});if(!el)return "not found";el.focus();el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));return "ok";})()`
        );
        return ok({ result });
      }

      if (p === "/scroll") {
        let raw: string;
        try { raw = await readBody(req); } catch { return fail(400, "failed to read request body"); }
        const parsed = safeJsonParse(raw);
        if (!parsed.ok) return fail(400, parsed.error);
        const direction = typeof parsed.value.direction === "string" ? parsed.value.direction : "down";
        const amount = typeof parsed.value.amount === "number" ? parsed.value.amount : 300;
        const dy = direction === "up" ? -amount : direction === "down" ? amount : 0;
        const dx = direction === "left" ? -amount : direction === "right" ? amount : 0;
        await win!.webContents.executeJavaScript(`window.scrollBy(${dx},${dy})`);
        return ok({ result: "ok" });
      }

      if (p === "/resize") {
        let raw: string;
        try { raw = await readBody(req); } catch { return fail(400, "failed to read request body"); }
        const parsed = safeJsonParse(raw);
        if (!parsed.ok) return fail(400, parsed.error);

        let targetWin: BrowserWindow | undefined;
        if (typeof parsed.value.alias === "string" && parsed.value.alias) {
          targetWin = BrowserWindow.getAllWindows().find(w => w.getTitle() === parsed.value.alias);
        } else if (typeof parsed.value.windowId === "number") {
          targetWin = BrowserWindow.fromId(parsed.value.windowId) ?? undefined;
        } else {
          targetWin = win;
        }
        if (!targetWin) return fail(404, "window not found");

        const PRESETS: Record<string, { width: number; height: number }> = {
          "iphone15": { width: 393,  height: 852  },
          "ipad":     { width: 820,  height: 1180 },
          "desktop":  { width: 1280, height: 800  },
        };
        let width: number;
        let height: number;
        const preset = parsed.value.preset;
        if (typeof preset === "string" && PRESETS[preset]) {
          ({ width, height } = PRESETS[preset]);
        } else {
          width  = typeof parsed.value.width  === "number" ? parsed.value.width  : 0;
          height = typeof parsed.value.height === "number" ? parsed.value.height : 0;
          if (!width || !height) return fail(400, "missing width/height or unknown preset");
        }
        targetWin.setSize(width, height, false);
        const bounds = targetWin.getBounds();
        return ok({ ok: true, bounds });
      }

      if (req.method === "POST" && p === "/close") {
        let raw: string;
        try { raw = await readBody(req); } catch { return fail(400, "failed to read request body"); }
        const parsed = safeJsonParse(raw);
        if (!parsed.ok) return fail(400, parsed.error);

        let targetWin: BrowserWindow | undefined;
        if (typeof parsed.value.alias === "string" && parsed.value.alias) {
          targetWin = BrowserWindow.getAllWindows().find(w => w.getTitle() === parsed.value.alias);
        } else if (typeof parsed.value.windowId === "number") {
          targetWin = BrowserWindow.fromId(parsed.value.windowId) ?? undefined;
        }
        if (!targetWin) return fail(404, "window not found");

        const force = parsed.value.force === true;
        if (force) {
          targetWin.destroy();
          return ok({ ok: true, destroyed: true });
        } else {
          targetWin.close();
          return ok({ ok: true, destroyed: false });
        }
      }

            fail(404, "unknown endpoint");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "internal server error";
      if (!res.headersSent) fail(500, msg);
    }
  });
  server.listen(9876, "127.0.0.1", () => console.log("[debug] http://localhost:9876"));
}

app.whenReady().then(() => {
  // Launcher IPC handlers
  ipcMain.handle("launcher:get-clips", () => readClips());

  ipcMain.handle("launcher:open-clip", (_event, config: unknown) => {
    if (!isClipBookmark(config)) throw new Error("invalid ClipBookmark");
    try {
      const existing = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() === config.name);
      if (existing) {
        existing.focus();
        return;
      }
      const saved = readClips().find(c => c.name === config.name);
      const merged: ClipBookmark = saved ? { ...config, windowState: saved.windowState } : config;
      openClipWindow(merged);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "failed to open clip";
      throw new Error(msg);
    }
  });

  ipcMain.handle("launcher:save-clips", (_event, clips: unknown) => {
    if (!Array.isArray(clips) || !clips.every(isClipBookmark)) {
      throw new Error("invalid clips array");
    }
    writeClips(clips);
  });

  // 清缓存 + 重载 IPC — 参数 name 可选，缺省从 sender 推断
  ipcMain.handle("pinix:clear-cache", (event, clipName?: string) => {
    const cacheDir = path.join(app.getPath("userData"), "clips");
    const resolvedName =
      clipName ?? clipRegistry.get(event.sender.id)?.config.name;
    if (!resolvedName) throw new Error("unknown clip");
    clearClipCache(resolvedName, cacheDir);
    for (const [wcId, entry] of clipRegistry) {
      if (entry.config.name === resolvedName) {
        const win = BrowserWindow.getAllWindows().find(
          (w) => w.webContents.id === wcId
        );
        if (win && !win.isDestroyed()) win.webContents.reload();
      }
    }
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
  if (process.env.PINIX_DEBUG === "1" || process.env.NODE_ENV !== "production") {
    startDebugServer();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
