"use strict";
// preload.ts — Bridge 暴露给 renderer
// Electron preload 必须是 CJS 格式
const { contextBridge, ipcRenderer } = require("electron");
const Bridge = Object.freeze({
    invoke: (action, payload) => ipcRenderer.invoke("pinix:invoke", action, payload),
});
contextBridge.exposeInMainWorld("Bridge", Bridge);
