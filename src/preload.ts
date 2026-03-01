// preload.ts — Bridge 暴露给 renderer
// Electron preload 必须是 CJS 格式
const { contextBridge, ipcRenderer } = require("electron");

// streamId 自增计数器，用于区分并发流
let streamIdCounter = 0;

const Bridge = Object.freeze({
  invoke: (action: string, payload: unknown) =>
    ipcRenderer.invoke("pinix:invoke", action, payload),
  clearCache: () => ipcRenderer.invoke("pinix:clear-cache"),

  // 流式 invoke — 每个 stdout chunk 实时回调
  invokeStream: (
    command: string,
    opts: { args?: string[]; stdin?: string },
    onChunk: (text: string) => void,
    onDone: (exitCode: number) => void
  ) => {
    const streamId = `s${++streamIdCounter}`;

    const onStreamChunk = (_e: any, id: string, text: string, stream: string) => {
      if (id !== streamId) return;
      if (stream === "stdout") onChunk(text);
    };

    const onStreamDone = (_e: any, id: string, exitCode: number) => {
      if (id !== streamId) return;
      // 清理监听器
      ipcRenderer.removeListener("pinix:stream-chunk", onStreamChunk);
      ipcRenderer.removeListener("pinix:stream-done", onStreamDone);
      onDone(exitCode);
    };

    ipcRenderer.on("pinix:stream-chunk", onStreamChunk);
    ipcRenderer.on("pinix:stream-done", onStreamDone);
    ipcRenderer.send("pinix:invoke-stream", streamId, command, {
      args: opts.args ?? [],
      stdin: opts.stdin ?? "",
    });
  },
});

contextBridge.exposeInMainWorld("Bridge", Bridge);

// AgentBridge — Clip 数据操作接口
// readFile 通过 pinix-data:// scheme handler 获取（走 ReadFile RPC streaming）
// 写操作通过 pinix:invoke IPC 走 ClipService.Invoke RPC
const AgentBridge = Object.freeze({
  readFile: async (path: string): Promise<string> => {
    const res = await fetch(`pinix-data://local/data/${path}`);
    if (!res.ok) throw new Error(`readFile failed (${res.status}): ${path}`);
    return await res.text();
  },
  writeFile: async (path: string, content: string): Promise<void> => {
    const r = await ipcRenderer.invoke("pinix:invoke", "writeFile", {
      args: [path],
      stdin: content,
    });
    if (r.exitCode !== 0) throw new Error(r.stderr || "writeFile failed");
  },
  writeBinaryFile: async (path: string, base64: string): Promise<void> => {
    const r = await ipcRenderer.invoke("pinix:invoke", "writeBinaryFile", {
      args: [path],
      stdin: base64,
    });
    if (r.exitCode !== 0) throw new Error(r.stderr || "writeBinaryFile failed");
  },
  listFiles: async (path: string): Promise<string[]> => {
    const r = await ipcRenderer.invoke("pinix:invoke", "listFiles", {
      args: [path],
    });
    if (r.exitCode !== 0) throw new Error(r.stderr || "listFiles failed");
    return r.stdout ? r.stdout.split("\n").filter(Boolean) : [];
  },
  deleteFile: async (path: string): Promise<void> => {
    const r = await ipcRenderer.invoke("pinix:invoke", "deleteFile", {
      args: [path],
    });
    if (r.exitCode !== 0) throw new Error(r.stderr || "deleteFile failed");
  },
});

contextBridge.exposeInMainWorld("AgentBridge", AgentBridge);
