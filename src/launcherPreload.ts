// launcherPreload.ts — Launcher 窗口的 preload
// Electron preload 必须是 CJS 格式，不能有 import/export
const _electron = require("electron");

interface ClipBookmark {
  name: string;
  server_url: string;
  token: string;
}

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

  // --- Environment detection ---
  detectEnvironment: (serverUrl?: string) =>
    _electron.ipcRenderer.invoke("launcher:detect-env", serverUrl),

  discoverClips: (serverUrl: string, superToken: string) =>
    _electron.ipcRenderer.invoke("launcher:discover-clips", serverUrl, superToken),

  addClipBookmark: (serverUrl: string, superToken: string, clipId: string) =>
    _electron.ipcRenderer.invoke("launcher:add-bookmark", serverUrl, superToken, clipId),

  startBoxLite: (binaryPath: string) =>
    _electron.ipcRenderer.invoke("launcher:start-boxlite", binaryPath),

  startPinix: (binaryPath: string) =>
    _electron.ipcRenderer.invoke("launcher:start-pinix", binaryPath),

  installBundle: () =>
    _electron.ipcRenderer.invoke("launcher:install-bundle"),

  hasBundle: () =>
    _electron.ipcRenderer.invoke("launcher:has-bundle"),
});

_electron.contextBridge.exposeInMainWorld("LauncherBridge", LauncherBridge);
