// launcherPreload.ts — Launcher 窗口的 preload
// Electron preload 必须是 CJS 格式
// 使用 _electron 避免与 preload.ts 变量名冲突（两文件均为 script 模式）
const _electron = require("electron");

// fixed: 运行时类型校验 — 消灭 any，非法输入拒绝写入
interface LauncherClipConfig {
  alias: string;
  host: string;
  port: number;
  token: string;
}

function isClipConfig(v: unknown): v is LauncherClipConfig {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.alias === "string" && obj.alias.length > 0 &&
    typeof obj.host === "string" && obj.host.length > 0 &&
    typeof obj.port === "number" && Number.isInteger(obj.port) && obj.port > 0 && obj.port <= 65535 &&
    typeof obj.token === "string"
  );
}

const LauncherBridge = Object.freeze({
  getClips: () => _electron.ipcRenderer.invoke("launcher:get-clips"),
  openClip: (config: unknown) => {
    if (!isClipConfig(config)) return Promise.reject(new Error("invalid ClipConfig"));
    return _electron.ipcRenderer.invoke("launcher:open-clip", config);
  },
  saveClips: (clips: unknown) => {
    if (!Array.isArray(clips) || !clips.every(isClipConfig)) {
      return Promise.reject(new Error("invalid clips array"));
    }
    return _electron.ipcRenderer.invoke("launcher:save-clips", clips);
  },
});

_electron.contextBridge.exposeInMainWorld("LauncherBridge", LauncherBridge);
