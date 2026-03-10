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
import { detectEnvironment, discoverClips, generateBookmark, startBoxLite, startPinix } from "./environment.js";

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

  // Console/Error 监听
  consoleMessages.set(win.id, []);
  jsErrors.set(win.id, []);
  win.webContents.on("console-message", (_ev, level, message) => {
    const levelMap: Record<number, ConsoleMessage['level']> = { 0: 'log', 1: 'info', 2: 'warn', 3: 'error' };
    const msgs = consoleMessages.get(win.id);
    if (msgs) msgs.push({ level: levelMap[level] ?? 'log', message, timestamp: Date.now() });
    if (level === 3) {
      const errs = jsErrors.get(win.id);
      if (errs) errs.push({ message, timestamp: Date.now() });
    }
  });
  win.webContents.on("render-process-gone", (_ev, details) => {
    const errs = jsErrors.get(win.id);
    if (errs) errs.push({ message: `render process gone: ${details.reason}`, timestamp: Date.now() });
  });

  // cleanup after native window is destroyed
  win.on("closed", () => {
    clipRegistry.delete(id);
    snapshotRefs.delete(win.id);
    consoleMessages.delete(win.id);
    jsErrors.delete(win.id);
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
    title: "agents, assembled.",
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

// Ref 系统：snapshot 时构建 refs 映射，click/fill/hover 通过 ref 寻址
interface RefInfo {
  xpath: string;
  role: string;
  name: string;
  tagName: string;
}
const snapshotRefs = new Map<number, Record<string, RefInfo>>();

// Console & Error 收集
interface ConsoleMessage {
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: number;
}
interface JSError {
  message: string;
  timestamp: number;
  source?: string;
}
const consoleMessages = new Map<number, ConsoleMessage[]>();
const jsErrors = new Map<number, JSError[]>();

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
      if (!win && p !== "/windows" && p !== "/open-clip") return fail(404, "no window");

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
        const interactive = parsed.searchParams.get("interactive") === "true";
        const raw = await win!.webContents.executeJavaScript(`(function(){
          function getXPath(el){
            if(el.id) return '//*[@id="'+el.id+'"]';
            const parts=[];
            while(el&&el.nodeType===1){
              let idx=1,sib=el.previousSibling;
              while(sib){if(sib.nodeType===1&&sib.tagName===el.tagName)idx++;sib=sib.previousSibling;}
              parts.unshift(el.tagName.toLowerCase()+'['+idx+']');
              el=el.parentElement;
            }
            return '/'+parts.join('/');
          }
          function isInteractive(el){
            const tag=el.tagName.toLowerCase();
            const role=el.getAttribute('role')||'';
            return ['a','button','input','select','textarea'].includes(tag)
              ||['button','link','checkbox','radio','combobox','textbox','menuitem','tab','option'].includes(role)
              ||el.getAttribute('tabindex')==='0';
          }
          function getRole(el){
            const tag=el.tagName.toLowerCase();
            const role=el.getAttribute('role');
            if(role) return role;
            if(tag==='button') return 'button';
            if(tag==='a') return 'link';
            const type=(el.getAttribute('type')||'').toLowerCase();
            if(tag==='input'){
              if(['text','email','password','search','url','tel','number'].includes(type)||!type) return 'textbox';
              if(type==='checkbox') return 'checkbox';
              if(type==='radio') return 'radio';
              return type;
            }
            if(tag==='select') return 'combobox';
            if(tag==='textarea') return 'textbox';
            return tag;
          }
          function getName(el){
            return el.getAttribute('aria-label')
              ||el.getAttribute('title')
              ||el.getAttribute('placeholder')
              ||el.getAttribute('alt')
              ||el.getAttribute('value')
              ||(el.innerText||'').trim().slice(0,60)
              ||'';
          }
          let refIdx=0;
          const refs={};
          function walk(el){
            const tag=el.tagName?el.tagName.toLowerCase():'';
            if(!tag) return null;
            const role=getRole(el);
            const text=(el.innerText||el.textContent||'').trim().slice(0,80);
            const inter=isInteractive(el);
            const node={tag,role,text,interactive:inter};
            if(inter){
              const ref=refIdx++;
              const name=getName(el);
              node.ref=ref;
              node.name=name;
              refs[String(ref)]={xpath:getXPath(el),role:role,name:name,tagName:tag};
            }
            const children=[];
            for(const child of el.children||[]){
              const c=walk(child);
              if(c) children.push(c);
            }
            if(children.length) node.children=children;
            return node;
          }
          const tree=walk(document.body);
          // 生成紧凑文本
          const lines=[];
          for(const[r,info]of Object.entries(refs)){
            lines.push('- '+info.role+' "'+info.name+'" [ref='+r+']');
          }
          return JSON.stringify({tree,refs,interactive:lines.join('\\n')});
        })()`);
        const result = JSON.parse(raw);
        // 存储 refs 映射
        snapshotRefs.set(win!.id, result.refs);
        if (interactive) {
          return ok(result.interactive, "text/plain");
        }
        return ok(result);
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
        const body = safeJsonParse(raw);
        if (!body.ok) return fail(400, body.error);
        const ref = body.value.ref;
        const selector = body.value.selector;

        if (ref != null) {
          const refs = snapshotRefs.get(win!.id) ?? {};
          const refInfo = refs[String(ref)];
          if (!refInfo) return fail(404, `ref ${ref} not found, please run /snapshot first`);
          const result = await win!.webContents.executeJavaScript(
            `(function(){const el=document.evaluate(${JSON.stringify(refInfo.xpath)},document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue;if(!el)return "element not found";el.click();return "ok";})()`
          );
          return ok({ result, ref, role: refInfo.role, name: refInfo.name });
        } else if (selector && typeof selector === "string") {
          const result = await win!.webContents.executeJavaScript(
            `(function(){const el=document.querySelector(${JSON.stringify(selector)});if(el){el.click();return "ok";}return "not found";})()`
          );
          return ok({ result });
        } else {
          return fail(400, "missing ref or selector");
        }
      }

      if (p === "/fill") {
        let raw: string;
        try { raw = await readBody(req); } catch { return fail(400, "failed to read request body"); }
        const body = safeJsonParse(raw);
        if (!body.ok) return fail(400, body.error);
        const ref = body.value.ref;
        const selector = body.value.selector;
        const value = body.value.value;
        if (value == null) return fail(400, "missing value");

        const fillScript = (locator: string) =>
          `(function(){const el=${locator};if(!el)return "not found";el.focus();el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));return "ok";})()`;

        if (ref != null) {
          const refs = snapshotRefs.get(win!.id) ?? {};
          const refInfo = refs[String(ref)];
          if (!refInfo) return fail(404, `ref ${ref} not found, please run /snapshot first`);
          const result = await win!.webContents.executeJavaScript(
            fillScript(`document.evaluate(${JSON.stringify(refInfo.xpath)},document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue`)
          );
          return ok({ result, ref, role: refInfo.role, name: refInfo.name });
        } else if (selector && typeof selector === "string") {
          const result = await win!.webContents.executeJavaScript(
            fillScript(`document.querySelector(${JSON.stringify(selector)})`)
          );
          return ok({ result });
        } else {
          return fail(400, "missing ref or selector");
        }
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

      // POST /hover — ref 或 selector 寻址
      if (p === "/hover") {
        let raw: string;
        try { raw = await readBody(req); } catch { return fail(400, "failed to read request body"); }
        const body = safeJsonParse(raw);
        if (!body.ok) return fail(400, body.error);
        const ref = body.value.ref;
        const selector = body.value.selector;

        const hoverScript = (locator: string) =>
          `(function(){const el=${locator};if(!el)return "not found";el.dispatchEvent(new MouseEvent("mouseenter",{bubbles:true}));el.dispatchEvent(new MouseEvent("mouseover",{bubbles:true}));return "ok";})()`;

        if (ref != null) {
          const refs = snapshotRefs.get(win!.id) ?? {};
          const refInfo = refs[String(ref)];
          if (!refInfo) return fail(404, `ref ${ref} not found, please run /snapshot first`);
          const result = await win!.webContents.executeJavaScript(
            hoverScript(`document.evaluate(${JSON.stringify(refInfo.xpath)},document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue`)
          );
          return ok({ result, ref, role: refInfo.role, name: refInfo.name });
        } else if (selector && typeof selector === "string") {
          const result = await win!.webContents.executeJavaScript(
            hoverScript(`document.querySelector(${JSON.stringify(selector)})`)
          );
          return ok({ result });
        } else {
          return fail(400, "missing ref or selector");
        }
      }

      // POST /press — 键盘按键
      if (p === "/press") {
        let raw: string;
        try { raw = await readBody(req); } catch { return fail(400, "failed to read request body"); }
        const body = safeJsonParse(raw);
        if (!body.ok) return fail(400, body.error);
        const key = body.value.key;
        if (!key || typeof key !== "string") return fail(400, "missing key");
        const modifiers = Array.isArray(body.value.modifiers) ? body.value.modifiers as string[] : [];

        const keyCodeMap: Record<string, string> = {
          Enter: "\r", Tab: "\t", Escape: "\u001B", Space: " ", Backspace: "\b",
          Delete: "\u007F",
          ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
        };

        const keyCode = keyCodeMap[key] ?? key;
        const mods = modifiers.map((m: string) => m.toLowerCase()) as Electron.InputEvent["modifiers"];

        // Electron sendInputEvent で keyDown + keyUp
        const event: Electron.KeyboardInputEvent = {
          type: "keyDown" as const,
          keyCode,
          modifiers: mods,
        };
        win!.webContents.sendInputEvent(event);
        win!.webContents.sendInputEvent({ ...event, type: "keyUp" as const });

        return ok({ result: "ok", key, modifiers });
      }

      // GET /console — console 消息收集
      if (p === "/console") {
        const clear = parsed.searchParams.get("clear") === "true";
        const msgs = consoleMessages.get(win!.id) ?? [];
        const result = [...msgs];
        if (clear) consoleMessages.set(win!.id, []);
        return ok({ messages: result, count: result.length });
      }

      // GET /errors — JS 错误收集
      if (p === "/errors") {
        const clear = parsed.searchParams.get("clear") === "true";
        const errs = jsErrors.get(win!.id) ?? [];
        const result = [...errs];
        if (clear) jsErrors.set(win!.id, []);
        return ok({ errors: result, count: result.length });
      }

      // POST /open-clip — 打开 Clip 窗口
      if (req.method === "POST" && p === "/open-clip") {
        let raw: string;
        try { raw = await readBody(req); } catch { return fail(400, "failed to read request body"); }
        const body = safeJsonParse(raw);
        if (!body.ok) return fail(400, body.error);
        if (!isClipBookmark(body.value)) return fail(400, "invalid ClipBookmark: need name, server_url, token");

        const config = body.value as ClipBookmark;
        const existing = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() === config.name);
        if (existing) {
          existing.focus();
          return ok({ windowId: existing.id, title: existing.getTitle(), existing: true });
        }
        const saved = readClips().find(c => c.name === config.name);
        const merged: ClipBookmark = saved ? { ...config, windowState: saved.windowState } : config;
        const newWin = openClipWindow(merged);
        return ok({ windowId: newWin.id, title: config.name, existing: false });
      }

      // GET /reload — 重载窗口
      if (p === "/reload") {
        win!.webContents.reload();
        return ok({ ok: true });
      }

      fail(404, "unknown endpoint");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "internal server error";
      if (!res.headersSent) fail(500, msg);
    }
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.warn("[debug] port 9876 in use, debug server disabled");
    } else {
      console.error("[debug] server error:", err);
    }
  });
  server.listen(9876, "127.0.0.1", () => console.log("[debug] http://localhost:9876"));
}

// Single instance lock — second instance focuses the existing window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const wins = BrowserWindow.getAllWindows();
    const launcher = wins.find(w => w.getTitle() === "agents, assembled.");
    if (launcher) {
      if (launcher.isMinimized()) launcher.restore();
      launcher.focus();
    }
  });
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
  // invoke 方法现在消费 server_streaming InvokeChunk，收集后一次性返回
  ipcMain.handle(
    "pinix:invoke",
    async (event, action: string, payload: unknown) => {
      const entry = clipRegistry.get(event.sender.id);
      if (!entry) {
        return { stderr: "unknown clip", exitCode: -1 };
      }

      try {
        const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
        const payloadArgs = p.args;
        const payloadStdin = p.stdin;
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

        // 收集 streaming InvokeChunk → 组装兼容的 {stdout, stderr, exitCode}
        const decoder = new TextDecoder();
        const stdoutParts: string[] = [];
        const stderrParts: string[] = [];
        let exitCode = 0;

        for await (const chunk of entry.client.invoke(req)) {
          switch (chunk.payload.case) {
            case "stdout":
              stdoutParts.push(decoder.decode(chunk.payload.value, { stream: true }));
              break;
            case "stderr":
              stderrParts.push(decoder.decode(chunk.payload.value, { stream: true }));
              break;
            case "exitCode":
              exitCode = chunk.payload.value;
              break;
          }
        }

        return {
          stdout: stdoutParts.join(""),
          stderr: stderrParts.join(""),
          exitCode,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        return { stderr: message, exitCode: -1 };
      }
    }
  );

  // invokeStream — 流式 IPC，每个 chunk 实时发送到 renderer
  // renderer 通过 streamId 区分并发流
  ipcMain.on(
    "pinix:invoke-stream",
    (event, streamId: string, action: string, payload: unknown) => {
      const entry = clipRegistry.get(event.sender.id);
      if (!entry) {
        event.sender.send("pinix:stream-done", streamId, -1, "unknown clip");
        return;
      }

      const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
      const args = Array.isArray(p.args) ? p.args as string[] : [];
      const stdin = typeof p.stdin === "string" ? p.stdin : "";

      const req = create(InvokeRequestSchema, {
        name: action,
        args,
        stdin,
      });

      const decoder = new TextDecoder();

      (async () => {
        let doneEmitted = false;
        try {
          for await (const chunk of entry.client.invoke(req)) {
            if (event.sender.isDestroyed()) return;
            switch (chunk.payload.case) {
              case "stdout":
                event.sender.send(
                  "pinix:stream-chunk",
                  streamId,
                  decoder.decode(chunk.payload.value, { stream: true }),
                  "stdout"
                );
                break;
              case "stderr":
                event.sender.send(
                  "pinix:stream-chunk",
                  streamId,
                  decoder.decode(chunk.payload.value, { stream: true }),
                  "stderr"
                );
                break;
              case "exitCode":
                doneEmitted = true;
                event.sender.send("pinix:stream-done", streamId, chunk.payload.value);
                break;
            }
          }
          // Fallback: guarantee stream-done even if exitCode chunk was missing
          if (!doneEmitted && !event.sender.isDestroyed()) {
            event.sender.send("pinix:stream-done", streamId, 0);
          }
        } catch (err) {
          if (!doneEmitted && !event.sender.isDestroyed()) {
            const message = err instanceof Error ? err.message : "unknown error";
            event.sender.send("pinix:stream-done", streamId, -1, message);
          }
        }
      })();
    }
  );

  // --- Environment detection IPC ---
  ipcMain.handle("launcher:detect-env", async (_event, serverUrl?: string) => {
    return detectEnvironment(serverUrl || undefined);
  });

  ipcMain.handle("launcher:discover-clips", async (_event, serverUrl: string, superToken: string) => {
    return discoverClips(serverUrl, superToken);
  });

  ipcMain.handle("launcher:start-boxlite", async (_event, binaryPath: string) => {
    return startBoxLite(binaryPath);
  });

  ipcMain.handle("launcher:start-pinix", async (_event, binaryPath: string) => {
    return startPinix(binaryPath);
  });

  ipcMain.handle("launcher:add-bookmark", async (_event, serverUrl: string, superToken: string, clipId: string) => {
    const bookmark = await generateBookmark(serverUrl, superToken, clipId);
    const clips = readClips();
    // Don't add duplicates
    if (!clips.some(c => c.name === bookmark.name && c.server_url === bookmark.server_url)) {
      clips.push(bookmark);
      writeClips(clips);
    }
    return bookmark;
  });

  // 启动 Launcher
  createLauncherWindow();
  if (process.env.PINIX_DEBUG === "1" || process.env.NODE_ENV !== "production") {
    startDebugServer();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
