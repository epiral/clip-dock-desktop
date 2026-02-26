# pinix-desktop

Electron shell for Pinix — 通过 Connect-RPC 桥接 pinix daemon。

## 架构

```
┌─────────────────────────────────────────────┐
│  Electron Main Process                       │
│                                              │
│  ┌──────────┐  ┌───────────────────────────┐ │
│  │ main.ts  │  │ bridge.ts                 │ │
│  │ IPC      │  │ pinix-web:// → ReadFile   │ │
│  │ handler  │  │ pinix-data:// → ReadFile  │ │
│  └──────────┘  └───────────────────────────┘ │
│       │              │                        │
│       │   Connect-RPC (HTTP/2)               │
│       └──────────┬───┘                        │
│                  ▼                            │
│         pinix daemon :5005                   │
│         ClipService.Invoke                   │
│         ClipService.ReadFile (streaming)     │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Renderer (WebView)                          │
│                                              │
│  - 加载 pinix-web://{clipId}/index.html     │
│  - 通过 Bridge.invoke() 执行写操作          │
│  - 所有读请求通过 scheme 拦截                │
└─────────────────────────────────────────────┘
```

## 目录结构

| 路径 | 说明 |
|------|------|
| `src/` | 主进程 TypeScript 源码（main.ts、bridge.ts、loader.ts 等） |
| `launcher/` | Launcher React UI 子项目（Vite + React） |
| `dist/` | `pnpm build` 的编译产物（已 gitignore） |
| `src/launcher.html` | **已废弃** — 旧版 Launcher，新版在 `launcher/` 子项目 |

## 开发

```bash
pnpm install
pnpm generate   # proto → TypeScript
pnpm build      # tsc 编译
pnpm dev        # generate + build + 启动 electron
bash dev.sh     # 开发模式（watch + 自动重启）
bash dev-remote.sh  # 连接远端 Pinix Server 的开发模式
```

## 设计原则

- WebView 永远不直接 fetch localhost，所有请求通过 scheme 拦截
- `Bridge.invoke` 是唯一的写操作入口
- ReadFile streaming：每个 chunk 携带 offset, mime_type, total_size
- Connect 协议 + HTTP/2
