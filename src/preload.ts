// preload.ts — Bridge 暴露给 renderer
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("Bridge", {
  invoke: (action: string, payload: unknown) =>
    ipcRenderer.invoke("pinix:invoke", action, payload),
});
