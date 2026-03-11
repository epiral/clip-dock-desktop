import { contextBridge, ipcRenderer } from "electron";

const STREAM_CHANNELS = {
  chunk: "pinix:stream-chunk",
  done: "pinix:stream-done",
} as const;

let streamIdCounter = 0;

function sanitizeBridgePath(inputPath: string): string {
  if (!inputPath || inputPath.includes("\0")) {
    throw new Error("invalid path");
  }
  if (inputPath.startsWith("/") || inputPath.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(inputPath)) {
    throw new Error("absolute paths are not allowed");
  }

  const normalized = inputPath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error("parent path segments are not allowed");
  }

  return segments.filter(Boolean).join("/");
}

const Bridge = Object.freeze({
  invoke: (action: string, payload: unknown) =>
    ipcRenderer.invoke("pinix:invoke", action, payload),
  clearCache: () => ipcRenderer.invoke("pinix:clear-cache"),
  invokeStream: (
    command: string,
    opts: { args?: string[]; stdin?: string },
    onChunk: (text: string) => void,
    onDone: (exitCode: number) => void
  ): (() => void) => {
    const streamId = `s${++streamIdCounter}`;
    let cancelled = false;

    const cleanup = () => {
      ipcRenderer.removeListener(STREAM_CHANNELS.chunk, onStreamChunk);
      ipcRenderer.removeListener(STREAM_CHANNELS.done, onStreamDone);
    };

    const onStreamChunk = (_event: Electron.IpcRendererEvent, id: string, text: string, stream: string) => {
      if (id !== streamId) return;
      if (stream === "stdout") onChunk(text);
    };

    const onStreamDone = (_event: Electron.IpcRendererEvent, id: string, exitCode: number) => {
      if (id !== streamId) return;
      cleanup();
      if (!cancelled) onDone(exitCode);
    };

    ipcRenderer.on(STREAM_CHANNELS.chunk, onStreamChunk);
    ipcRenderer.on(STREAM_CHANNELS.done, onStreamDone);
    ipcRenderer.send("pinix:invoke-stream", streamId, command, {
      args: opts.args ?? [],
      stdin: opts.stdin ?? "",
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  },
});

contextBridge.exposeInMainWorld("Bridge", Bridge);

const AgentBridge = Object.freeze({
  readFile: async (path: string): Promise<string> => {
    const sanitizedPath = sanitizeBridgePath(path);
    const res = await fetch(`pinix-data://local/data/${encodeURI(sanitizedPath)}`);
    if (!res.ok) throw new Error(`readFile failed (${res.status}): ${sanitizedPath}`);
    return await res.text();
  },
  writeFile: async (path: string, content: string): Promise<void> => {
    const r = await ipcRenderer.invoke("pinix:invoke", "writeFile", {
      args: [sanitizeBridgePath(path)],
      stdin: content,
    });
    if (r.exitCode !== 0) throw new Error(r.stderr || "writeFile failed");
  },
  writeBinaryFile: async (path: string, base64: string): Promise<void> => {
    const r = await ipcRenderer.invoke("pinix:invoke", "writeBinaryFile", {
      args: [sanitizeBridgePath(path)],
      stdin: base64,
    });
    if (r.exitCode !== 0) throw new Error(r.stderr || "writeBinaryFile failed");
  },
  listFiles: async (path: string): Promise<string[]> => {
    const r = await ipcRenderer.invoke("pinix:invoke", "listFiles", {
      args: [sanitizeBridgePath(path)],
    });
    if (r.exitCode !== 0) throw new Error(r.stderr || "listFiles failed");
    return r.stdout ? r.stdout.split("\n").filter(Boolean) : [];
  },
  deleteFile: async (path: string): Promise<void> => {
    const r = await ipcRenderer.invoke("pinix:invoke", "deleteFile", {
      args: [sanitizeBridgePath(path)],
    });
    if (r.exitCode !== 0) throw new Error(r.stderr || "deleteFile failed");
  },
});

contextBridge.exposeInMainWorld("AgentBridge", AgentBridge);
