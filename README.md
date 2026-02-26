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

## 开发

```bash
pnpm install
pnpm generate   # proto → TypeScript
pnpm build      # tsc 编译
pnpm dev        # generate + build + 启动 electron
```

## 设计原则

- WebView 永远不直接 fetch localhost，所有请求通过 scheme 拦截
- `Bridge.invoke` 是唯一的写操作入口
- ReadFile streaming：每个 chunk 携带 offset, mime_type, total_size
- Connect 协议 + HTTP/2
