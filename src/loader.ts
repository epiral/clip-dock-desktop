// loader.ts — 加载 Clip 的 Web 界面
import type { BrowserWindow } from "electron";
import type { ClipBookmark } from "./types.js";

const LOAD_TIMEOUT_MS = 30000;

const errorPageHtml = (name: string, reason: string) => `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Load Error</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.box{text-align:center;max-width:400px}h2{color:#ff6b6b}code{background:#333;padding:2px 6px;border-radius:3px}</style>
</head><body><div class="box"><h2>Failed to load clip</h2><p><code>${name}</code></p><p>${reason}</p></div></body></html>`;

export async function loadClip(win: BrowserWindow, config: ClipBookmark): Promise<void> {
  const safeName = encodeURIComponent(config.name);
  const url = `pinix-web://${safeName}/index.html`;

  const loadPromise = win.loadURL(url);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("load timeout")), LOAD_TIMEOUT_MS)
  );

  try {
    await Promise.race([loadPromise, timeoutPromise]);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    if (!win.isDestroyed()) {
      win.webContents.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(errorPageHtml(config.name, reason))}`
      );
    }
    throw err;
  }
}
