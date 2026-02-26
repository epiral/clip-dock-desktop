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

import { URL as NodeURL } from "node:url";

function getWin(alias: string | null): import("electron").BrowserWindow | undefined {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const wins = require("electron").BrowserWindow.getAllWindows() as import("electron").BrowserWindow[];
  if (!alias) return wins[0];
  return wins.find((w: import("electron").BrowserWindow) => w.getTitle() === alias) ?? wins[0];
}

async function readBody(req: import("http").IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString(); });
    req.on("end", () => resolve(body));
  });
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

    if (!win && p !== "/windows") return fail(404, "no window");

    if (p === "/windows") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const all = require("electron").BrowserWindow.getAllWindows() as import("electron").BrowserWindow[];
      return ok(all.map((w: import("electron").BrowserWindow) => ({ id: w.id, title: w.getTitle() })));
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
      const body = await readBody(req);
      const { script } = JSON.parse(body || "{}");
      if (!script) return fail(400, "missing script");
      try {
        const result = await win!.webContents.executeJavaScript(script);
        return ok({ result });
      } catch (e: unknown) { return ok({ error: String(e) }); }
    }

    if (p === "/click") {
      const body = await readBody(req);
      const { selector } = JSON.parse(body || "{}");
      if (!selector) return fail(400, "missing selector");
      const result = await win!.webContents.executeJavaScript(
        `(function(){const el=document.querySelector(${JSON.stringify(selector)});if(el){el.click();return "ok";}return "not found";})()`
      );
      return ok({ result });
    }

    if (p === "/fill") {
      const body = await readBody(req);
      const { selector, value } = JSON.parse(body || "{}");
      if (!selector || value == null) return fail(400, "missing selector or value");
      const result = await win!.webContents.executeJavaScript(
        `(function(){const el=document.querySelector(${JSON.stringify(selector)});if(!el)return "not found";el.focus();el.value=${JSON.stringify(value)};el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));return "ok";})()`
      );
      return ok({ result });
    }

    if (p === "/scroll") {
      const body = await readBody(req);
      const { direction = "down", amount = 300 } = JSON.parse(body || "{}");
      const dy = direction === "up" ? -amount : direction === "down" ? amount : 0;
      const dx = direction === "left" ? -amount : direction === "right" ? amount : 0;
      await win!.webContents.executeJavaScript(`window.scrollBy(${dx},${dy})`);
      return ok({ result: "ok" });
    }

    fail(404, "unknown endpoint");
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
