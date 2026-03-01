# pinix-desktop 调试指南

## 调试 HTTP Server

Electron 启动后，自动在 `http://127.0.0.1:9876` 开放调试接口。所有接口支持 `?alias=<窗口标题>` 参数定向到具体窗口（不传则取第一个窗口）。

### 接口清单

| 路径 | 方法 | 说明 |
|------|------|------|
| `/windows` | GET | 列出所有 BrowserWindow（id + title） |
| `/screenshot` | GET | 截取窗口截图（PNG） |
| `/dom` | GET | 获取完整 HTML |
| `/snapshot` | GET | 获取可交互元素树（含 ref） |
| `/eval` | POST | 执行任意 JS，返回结果 |
| `/click` | POST | 点击指定 CSS selector 的元素 |
| `/fill` | POST | 填写输入框 |
| `/scroll` | POST | 滚动页面 |

### 常用命令

```bash
# 列出所有窗口
curl http://127.0.0.1:9876/windows

# 读页面结构（找 ref / selector）
curl "http://127.0.0.1:9876/snapshot?alias=Notes"

# 截图 → gemini 看效果
curl -s "http://127.0.0.1:9876/screenshot?alias=Notes" -o /tmp/shot.png \
  && gemini-vision /tmp/shot.png "描述界面效果"

# 执行任意 JS
curl -s -X POST "http://127.0.0.1:9876/eval?alias=Notes" \
  -d '{"script":"document.title"}'

# 点击元素（CSS selector）
curl -s -X POST "http://127.0.0.1:9876/click?alias=Notes" \
  -d '{"selector":"button.btn-save"}'

# 填写输入框
curl -s -X POST "http://127.0.0.1:9876/fill?alias=Notes" \
  -d '{"selector":"#title","value":"hello"}'

# 滚动（direction: up/down/left/right，amount 默认 300px）
curl -s -X POST "http://127.0.0.1:9876/scroll?alias=Notes" \
  -d '{"direction":"down"}'
```

## 启动应用

```bash
cd repos/pinix-desktop

# 生产模式（加载 launcher/dist）
npx electron .

# 开发模式（Launcher UI 热重载）
cd launcher && pnpm dev --port 5174
# 另开终端：cd .. && npx electron .
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
│   ├── main.ts       # 入口：Launcher/Clip 窗口、IPC、调试 Server (9876)
│   ├── bridge.ts     # pinix-web/pinix-data Scheme Handler + Connect-RPC 客户端
│   ├── loader.ts     # Clip 页面加载逻辑
│   ├── preload.ts    # Clip 窗口 preload（注入 window.Bridge）
│   └── launcherPreload.ts  # Launcher preload（注入 window.LauncherBridge）
├── launcher/         # Launcher UI（React + Vite + Tailwind v4 + shadcn/ui）
│   └── src/App.tsx   # Clip 列表管理界面
└── dist/             # 编译产物（gitignored）
```
