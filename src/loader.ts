// loader.ts — 加载 Clip 的 Web 界面
import type { BrowserWindow } from "electron";
import type { ClipConfig } from "./types.js";

export function loadClip(win: BrowserWindow, config: ClipConfig): void {
  const safeAlias = encodeURIComponent(config.alias);
  win.loadURL(`pinix-web://${safeAlias}/index.html`);
}
