// launcherPreload.ts — Launcher 窗口的 preload
// Electron preload 必须是 CJS 格式
// 使用 _electron 避免与 preload.ts 变量名冲突（两文件均为 script 模式）
const _electron = require("electron");

const LauncherBridge = Object.freeze({
  getClips: () => _electron.ipcRenderer.invoke("launcher:get-clips"),
  openClip: (config: any) =>
    _electron.ipcRenderer.invoke("launcher:open-clip", config),
  saveClips: (clips: any[]) =>
    _electron.ipcRenderer.invoke("launcher:save-clips", clips),
});

_electron.contextBridge.exposeInMainWorld("LauncherBridge", LauncherBridge);
