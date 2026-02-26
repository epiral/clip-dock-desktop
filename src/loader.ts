// loader.ts — 加载 Clip 的 Web 界面
import type { BrowserWindow } from "electron";
import type { ClipConfig } from "./types.js";

const LOAD_TIMEOUT_MS = 5000;

const errorPageHtml = (alias: string, reason: string) => `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Load Error</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.box{text-align:center;max-width:400px}h2{color:#ff6b6b}code{background:#333;padding:2px 6px;border-radius:3px}</style>
</head><body><div class="box"><h2>Failed to load clip</h2><p><code>${alias}</code></p><p>${reason}</p></div></body></html>`;

// fixed: loadClip — 5 秒超时 + 超时后注入错误提示 HTML
export async function loadClip(win: BrowserWindow, config: ClipConfig): Promise<void> {
  const safeAlias = encodeURIComponent(config.alias);
  const url = `pinix-web://${safeAlias}/index.html`;

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
        `data:text/html;charset=utf-8,${encodeURIComponent(errorPageHtml(config.alias, reason))}`
      );
    }
    throw err;
  }
}
