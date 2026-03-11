// launcherPreload.ts — Launcher 窗口的 preload
// Electron preload 必须是 CJS 格式，不能有 import/export
const _electron = require("electron");

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isWindowState(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { width?: unknown; height?: unknown; x?: unknown; y?: unknown };
  return (
    typeof candidate.width === "number" && Number.isFinite(candidate.width) &&
    typeof candidate.height === "number" && Number.isFinite(candidate.height) &&
    isOptionalFiniteNumber(candidate.x) &&
    isOptionalFiniteNumber(candidate.y)
  );
}

function isClipBookmark(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    name?: unknown;
    server_url?: unknown;
    token?: unknown;
    windowState?: unknown;
  };
  return (
    isNonEmptyString(candidate.name) &&
    isNonEmptyString(candidate.server_url) &&
    typeof candidate.token === "string" &&
    (candidate.windowState === undefined || isWindowState(candidate.windowState))
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
  clearCache: (name: unknown) => {
    if (!isNonEmptyString(name)) {
      return Promise.reject(new Error("invalid name"));
    }
    return _electron.ipcRenderer.invoke("pinix:clear-cache", name);
  },
  detectEnvironment: (serverUrl: unknown) => {
    if (serverUrl !== undefined && !isNonEmptyString(serverUrl)) {
      return Promise.reject(new Error("invalid serverUrl"));
    }
    return _electron.ipcRenderer.invoke("launcher:detect-env", serverUrl);
  },
  discoverClips: (serverUrl: unknown, superToken: unknown) => {
    if (!isNonEmptyString(serverUrl) || !isNonEmptyString(superToken)) {
      return Promise.reject(new Error("invalid discovery params"));
    }
    return _electron.ipcRenderer.invoke("launcher:discover-clips", serverUrl, superToken);
  },
  addClipBookmark: (serverUrl: unknown, superToken: unknown, clipId: unknown) => {
    if (!isNonEmptyString(serverUrl) || !isNonEmptyString(superToken) || !isNonEmptyString(clipId)) {
      return Promise.reject(new Error("invalid bookmark params"));
    }
    return _electron.ipcRenderer.invoke("launcher:add-bookmark", serverUrl, superToken, clipId);
  },
  startBoxLite: (binaryPath: unknown) => {
    if (!isNonEmptyString(binaryPath)) {
      return Promise.reject(new Error("invalid binaryPath"));
    }
    return _electron.ipcRenderer.invoke("launcher:start-boxlite", binaryPath);
  },
  startPinix: (binaryPath: unknown) => {
    if (!isNonEmptyString(binaryPath)) {
      return Promise.reject(new Error("invalid binaryPath"));
    }
    return _electron.ipcRenderer.invoke("launcher:start-pinix", binaryPath);
  },
  installBundle: () => _electron.ipcRenderer.invoke("launcher:install-bundle"),
  hasBundle: () => _electron.ipcRenderer.invoke("launcher:has-bundle"),
});

_electron.contextBridge.exposeInMainWorld("LauncherBridge", LauncherBridge);
