# clip-dock-desktop 调试指南

## Debug HTTP Server

Electron 启动后，自动在 `http://127.0.0.1:9876` 开放调试接口。所有接口支持 `?alias=<窗口标题>` 参数定向到具体窗口（不传则取第一个窗口）。

---

## 接口清单

### 窗口管理

| 路径 | 方法 | 说明 |
|------|------|------|
| `/windows` | GET | 列出所有窗口（id + title + bounds） |
| `/open-clip` | POST | 打开 Clip 窗口（或 focus 已存在的） |
| `/close` | POST | 关闭窗口 |
| `/reload` | GET | 重载窗口页面 |
| `/resize` | POST | 调整窗口大小（支持预设） |

### 页面信息

| 路径 | 方法 | 说明 |
|------|------|------|
| `/screenshot` | GET | 截取窗口截图（PNG） |
| `/dom` | GET | 获取完整 HTML |
| `/snapshot` | GET | 获取语义树 + refs 映射（支持 interactive 模式） |

### 元素交互（Ref-based）

| 路径 | 方法 | 说明 |
|------|------|------|
| `/click` | POST | 点击元素（ref 或 selector） |
| `/fill` | POST | 填写输入框（ref 或 selector） |
| `/hover` | POST | 鼠标悬停（ref 或 selector） |
| `/press` | POST | 发送键盘按键 |
| `/scroll` | POST | 滚动页面 |

### 调试监控

| 路径 | 方法 | 说明 |
|------|------|------|
| `/console` | GET | 获取 console 消息 |
| `/errors` | GET | 获取 JS 错误 |
| `/eval` | POST | 执行任意 JS |

---

## 接口详情

### GET /windows

列出所有 BrowserWindow。

```bash
curl http://127.0.0.1:9876/windows
```

响应：
```json
[{"id": 1, "title": "Todo", "bounds": {"x": 0, "y": 0, "width": 1200, "height": 800}}]
```

### GET /snapshot

获取页面语义树 + refs 映射。**核心接口，所有 ref-based 交互的前置步骤。**

参数：
- `?alias=<窗口标题>` — 目标窗口
- `?interactive=true` — 只返回可交互元素的紧凑文本

```bash
# 完整语义树 + refs（JSON）
curl "http://127.0.0.1:9876/snapshot?alias=Todo"

# 只看可交互元素（纯文本，适合 Agent 消费）
curl "http://127.0.0.1:9876/snapshot?alias=Todo&interactive=true"
```

interactive=true 响应（text/plain）：
```
- button "提交" [ref=0]
- textbox "搜索" [ref=1]
- link "首页" [ref=2]
```

完整响应（JSON）：
```json
{
  "tree": { "tag": "body", "role": "body", "children": [...] },
  "refs": {
    "0": { "xpath": "/html[1]/body[1]/div[1]/button[1]", "role": "button", "name": "提交", "tagName": "button" },
    "1": { "xpath": "/html[1]/body[1]/div[1]/input[1]", "role": "textbox", "name": "搜索", "tagName": "input" }
  },
  "interactive": "- button \"提交\" [ref=0]\n- textbox \"搜索\" [ref=1]"
}
```

### POST /click

点击元素。支持 ref（推荐）或 CSS selector（向后兼容）。

```bash
# ref 方式（推荐）— 先 /snapshot 获取 ref
curl -s -X POST "http://127.0.0.1:9876/click?alias=Todo" \
  -d '{"ref": 0}'

# selector 方式（向后兼容）
curl -s -X POST "http://127.0.0.1:9876/click?alias=Todo" \
  -d '{"selector": "button.btn-save"}'
```

ref 响应：
```json
{"result": "ok", "ref": 0, "role": "button", "name": "提交"}
```

### POST /fill

填写输入框。支持 ref 或 selector。

```bash
# ref 方式
curl -s -X POST "http://127.0.0.1:9876/fill?alias=Todo" \
  -d '{"ref": 1, "value": "hello world"}'

# selector 方式
curl -s -X POST "http://127.0.0.1:9876/fill?alias=Todo" \
  -d '{"selector": "#title", "value": "hello"}'
```

ref 响应：
```json
{"result": "ok", "ref": 1, "role": "textbox", "name": "搜索"}
```

### POST /hover

鼠标悬停（触发 mouseenter + mouseover 事件）。支持 ref 或 selector。

```bash
curl -s -X POST "http://127.0.0.1:9876/hover?alias=Todo" \
  -d '{"ref": 3}'
```

响应：
```json
{"result": "ok", "ref": 3, "role": "button", "name": "删除"}
```

### POST /press

发送键盘按键。

参数：
- `key`（必填）：Enter, Tab, Escape, Space, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, F1-F12, 或单个字符
- `modifiers`（可选）：`["ctrl", "shift", "alt", "meta"]`

```bash
# 按 Enter
curl -s -X POST "http://127.0.0.1:9876/press?alias=Todo" \
  -d '{"key": "Enter"}'

# Ctrl+A 全选
curl -s -X POST "http://127.0.0.1:9876/press?alias=Todo" \
  -d '{"key": "a", "modifiers": ["ctrl"]}'
```

响应：
```json
{"result": "ok", "key": "Enter", "modifiers": []}
```

### POST /scroll

滚动页面。

```bash
curl -s -X POST "http://127.0.0.1:9876/scroll?alias=Todo" \
  -d '{"direction": "down", "amount": 300}'
```

### GET /screenshot

截取窗口截图（PNG）。

```bash
curl -s "http://127.0.0.1:9876/screenshot?alias=Todo" -o /tmp/shot.png
```

### GET /dom

获取完整 HTML。

```bash
curl "http://127.0.0.1:9876/dom?alias=Todo"
```

### POST /eval

执行任意 JavaScript。

```bash
curl -s -X POST "http://127.0.0.1:9876/eval?alias=Todo" \
  -d '{"script": "document.title"}'
```

响应：
```json
{"result": "Todo App"}
```

### GET /console

获取 console 消息（log/info/warn/error）。

参数：
- `?clear=true` — 获取后清空消息列表

```bash
curl "http://127.0.0.1:9876/console?alias=Todo"
curl "http://127.0.0.1:9876/console?alias=Todo&clear=true"
```

响应：
```json
{
  "messages": [
    {"level": "log", "message": "App loaded", "timestamp": 1709280000000},
    {"level": "error", "message": "fetch failed", "timestamp": 1709280001000}
  ],
  "count": 2
}
```

### GET /errors

获取 JS 错误（console.error + render process gone）。

参数：
- `?clear=true` — 获取后清空错误列表

```bash
curl "http://127.0.0.1:9876/errors?alias=Todo"
```

响应：
```json
{
  "errors": [
    {"message": "TypeError: Cannot read property 'x' of undefined", "timestamp": 1709280001000}
  ],
  "count": 1
}
```

### POST /open-clip

打开 Clip 窗口。若已存在同名窗口则 focus 并返回现有信息。

```bash
curl -s -X POST "http://127.0.0.1:9876/open-clip" \
  -d '{"name": "Todo", "server_url": "http://localhost:8080", "token": "xxx"}'
```

响应：
```json
{"windowId": 2, "title": "Todo", "existing": false}
```

### GET /reload

重载窗口页面。

```bash
curl "http://127.0.0.1:9876/reload?alias=Todo"
```

响应：
```json
{"ok": true}
```

### POST /resize

调整窗口大小。支持预设（iphone15/ipad/desktop）或自定义尺寸。

```bash
# 预设
curl -s -X POST "http://127.0.0.1:9876/resize" \
  -d '{"alias": "Todo", "preset": "iphone15"}'

# 自定义
curl -s -X POST "http://127.0.0.1:9876/resize" \
  -d '{"alias": "Todo", "width": 800, "height": 600}'
```

### POST /close

关闭窗口。

```bash
curl -s -X POST "http://127.0.0.1:9876/close" \
  -d '{"alias": "Todo"}'
```

---

## Ref-based 交互工作流

**核心理念：snapshot → ref → click/fill/hover，Agent 不需要构造 CSS selector。**

### 步骤

1. **GET /windows** — 确认窗口列表，获取目标窗口 alias
2. **GET /snapshot?alias=xxx&interactive=true** — 获取可交互元素列表和 refs
3. **阅读 interactive 文本** — 找到目标元素的 ref 编号
4. **POST /click {ref: N}** 或 **POST /fill {ref: N, value: "..."}** — 操作元素
5. **GET /screenshot?alias=xxx** — 截图验证结果（配合 gemini-vision）

### 示例

```bash
# 1. 确认窗口
curl http://127.0.0.1:9876/windows
# → [{"id":1,"title":"Todo","bounds":{...}}]

# 2. 获取可交互元素
curl "http://127.0.0.1:9876/snapshot?alias=Todo&interactive=true"
# → - textbox "新增待办" [ref=0]
#   - button "添加" [ref=1]
#   - checkbox "买菜" [ref=2]
#   - button "删除" [ref=3]

# 3. 填写输入框（ref=0）
curl -s -X POST "http://127.0.0.1:9876/fill?alias=Todo" \
  -d '{"ref": 0, "value": "写文档"}'
# → {"result":"ok","ref":0,"role":"textbox","name":"新增待办"}

# 4. 点击添加按钮（ref=1）
curl -s -X POST "http://127.0.0.1:9876/click?alias=Todo" \
  -d '{"ref": 1}'
# → {"result":"ok","ref":1,"role":"button","name":"添加"}

# 5. 截图验证
curl -s "http://127.0.0.1:9876/screenshot?alias=Todo" -o /tmp/shot.png \
  && gemini-vision /tmp/shot.png "确认'写文档'已添加到列表"
```

---

## 端到端 Clip 开发 SOP（5步闭环）

Agent 开发 Clip UI 的标准流程：

```
1. 修改代码 → 保存文件
2. GET /reload?alias=xxx → 重载页面
3. GET /snapshot?alias=xxx&interactive=true → 获取 refs
4. POST /click, /fill, /press → 操作交互元素
5. GET /screenshot + gemini-vision → 视觉验证
   └─ 若有问题 → GET /errors + GET /console → 定位 bug → 回到步骤1
```

---

## 启动应用

```bash
cd repos/clip-dock-desktop

# 生产模式
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
clip-dock-desktop/
├── src/              # Electron 主进程（TypeScript）
│   ├── main.ts       # 入口：Launcher/Clip 窗口、IPC、Debug Server (9876)
│   ├── bridge.ts     # pinix-web/pinix-data Scheme Handler + Connect-RPC 客户端
│   ├── loader.ts     # Clip 页面加载逻辑
│   ├── preload.ts    # Clip 窗口 preload（注入 window.Bridge）
│   └── launcherPreload.ts  # Launcher preload（注入 window.LauncherBridge）
├── launcher/         # Launcher UI（React + Vite + Tailwind v4 + shadcn/ui）
│   └── src/App.tsx   # Clip 列表管理界面
└── dist/             # 编译产物（gitignored）
```
