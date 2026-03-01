// types.ts — 共享类型定义

export interface ClipBookmark {
  name: string;        // 显示名，如 "hello-world"
  server_url: string;  // e.g. "http://100.66.47.40:9875"
  token: string;       // Clip Token
  windowState?: { width: number; height: number; x?: number; y?: number };
}
