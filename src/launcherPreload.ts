// launcherPreload.ts — Launcher 窗口的 preload
import type { ClipBookmark } from "./types.js";
const _electron = require("electron");

function isClipBookmark(v: unknown): v is ClipBookmark {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.name === "string" && obj.name.length > 0 &&
    typeof obj.server_url === "string" && obj.server_url.length > 0 &&
    typeof obj.token === "string"
  );
}

const LauncherBridge = Object.freeze({
  getClips: () => _electron.ipcRenderer.invoke("launcher:get-clips"),
  openClip: (config: unknown) => {
    if (!isClipBookmark(config)) return Promise.reject(new Error("invalid ClipBookmark"));
    return _electron.ipcRenderer.invoke("launcher:open-clip", config);
  },
  saveClips: (clips: unknown) => {
    if (!Array.isArray(clips) || !clips.every(isClipBookmark)) {
      return Promise.reject(new Error("invalid clips array"));
    }
    return _electron.ipcRenderer.invoke("launcher:save-clips", clips);
  },
  clearCache: (name: string) => {
    if (typeof name !== "string" || name.length === 0) {
      return Promise.reject(new Error("invalid name"));
    }
    return _electron.ipcRenderer.invoke("pinix:clear-cache", name);
  },
});

_electron.contextBridge.exposeInMainWorld("LauncherBridge", LauncherBridge);
