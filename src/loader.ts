// loader.ts — 加载 Clip 的 Web 界面
import type { BrowserWindow } from "electron";

export function loadClip(win: BrowserWindow, clipId: string): void {
  win.loadURL(`pinix-web://${clipId}/index.html`);
}
