# pinix-desktop 调试指南

## 调试 HTTP Server

Electron 启动后，自动在 `http://localhost:9876` 开放调试接口。

### 接口清单

| 路径 | 方法 | 说明 |
|------|------|------|
| `/windows` | GET | 列出所有 BrowserWindow（id + title） |
| `/screenshot` | GET | 截取第一个窗口的当前截图（PNG） |
| `/dom` | GET | 获取第一个窗口的 document.documentElement.outerHTML |

### 常用命令

```bash
# 查看所有窗口
curl http://localhost:9876/windows

# 截图保存
curl -s http://localhost:9876/screenshot -o /tmp/snapshot.png

# 查看 DOM 内容
curl -s http://localhost:9876/dom | head -100
```

## 启动应用

```bash
cd repos/pinix-desktop

# 生产模式（加载 launcher/dist）
npx electron .

# 开发模式（Launcher UI 热重载）
cd launcher && pnpm dev --port 5174
# 然后另开终端：cd .. && npx electron .
```

## 构建

```bash
# 构建 Launcher UI
cd launcher && pnpm build

# 构建 Electron 主进程
cd .. && pnpm build
```

## 架构说明

```
pinix-desktop/
├── src/              # Electron 主进程（TypeScript）
│   ├── main.ts       # 入口：Launcher 窗口、Clip 窗口、IPC 处理、调试 Server
│   ├── bridge.ts     # pinix-web/pinix-data Scheme Handler + Connect-RPC 客户端
│   ├── loader.ts     # Clip 页面加载逻辑
│   ├── preload.ts    # Clip 窗口 preload（注入 window.Bridge）
│   └── launcherPreload.ts  # Launcher preload（注入 window.LauncherBridge）
├── launcher/         # Launcher UI（React + Vite + Tailwind v4 + shadcn/ui）
│   └── src/App.tsx   # Clip 列表管理界面
└── dist/             # 编译产物（gitignored）
```
