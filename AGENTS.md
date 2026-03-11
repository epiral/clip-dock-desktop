# AGENTS.md — Clip Dock Desktop

Electron 桌面端，管理和运行 Pinix Clips。TypeScript + Electron main process + React renderer。

## Build & Dev

```bash
pnpm install
pnpm dev          # generate + build + launch
pnpm build        # tsc only
pnpm run pack     # electron-builder → DMG
buf generate      # 重新生成 proto TS bindings（需要先 pnpm install）
```

## 架构

| 文件 | 职责 |
|------|------|
| `src/main.ts` | Electron main process：窗口管理、IPC handler、gRPC 调用 |
| `src/preload.ts` | Clip 窗口 Bridge（暴露 invoke/invokeStream 给 renderer） |
| `src/launcherPreload.ts` | Launcher 窗口 preload |
| `src/environment.ts` | 检测 Pinix/BoxLite 环境、发现 Clips、启动服务 |
| `src/bridge.ts` | Bridge 类型定义 |
| `src/clipsStore.ts` | Clip bookmark 持久化 |
| `src/loader.ts` | Clip WebView loader |
| `src/types.ts` | 共享类型 |
| `src/gen/` | buf generate 产物（不手动编辑） |
| `launcher/` | Launcher UI（独立 Vite + React 子项目） |

## 关键约束

### Preload 必须是 CJS

**`preload.ts` 和 `launcherPreload.ts` 必须使用 `require()` 而非 ES `import`。**

Electron sandbox 模式下，preload 脚本以 CJS 执行。使用 `import` 会导致：
```
SyntaxError: Cannot use import statement outside a module
```

正确写法：
```typescript
const { contextBridge, ipcRenderer } = require("electron");
```

错误写法：
```typescript
import { contextBridge, ipcRenderer } from "electron";  // ❌ 会崩
```

### Proto 同步

Proto 定义来自 `../pinix/proto/pinix/v1/pinix.proto`。更新流程：
1. 复制最新 proto 到 `proto/pinix/v1/pinix.proto`
2. `PATH="./node_modules/.bin:$PATH" buf generate`
3. 更新引用代码（字段名变更等）

### TextDecoder 流式处理

gRPC streaming 返回的 `stdout`/`stderr` 是 `Uint8Array`，需要 `TextDecoder` 解码：
- stdout 和 stderr 必须用**独立的** TextDecoder（不共享）
- 流结束时必须 `decoder.decode()` flush 残留字节（多字节 UTF-8 跨 chunk）

### IPC 安全

- renderer → main 的 IPC 参数必须做类型验证（不信任 renderer 输入）
- 路径参数禁止绝对路径、`..`、null bytes
