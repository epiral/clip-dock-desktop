// types.ts — 共享类型定义

export interface ClipConfig {
  alias: string;   // 显示名，如 "Notes"
  host: string;    // 如 "100.66.47.40"
  port: number;    // 如 9875
  token: string;   // Clip 鉴权 token
  windowState?: { width: number; height: number; x?: number; y?: number };
}
