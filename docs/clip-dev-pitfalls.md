# Clip 开发通用避坑手册

> 适用于**所有** Pinix Clip 的开发。
> 特定 Clip 的业务逻辑/约定不放这里，放各 Clip 自己的 workspace AGENTS.md 中。
>
> 受众：开发 Clip 的 Agent 或人类工程师。
> 基于 voice-inbox / notes / todo 等 Clip 的实战积累。

---

## 一、Web 层（前端通用）

### 1. URL 格式：hostname 不能省

`pinix-data://` 和 `pinix-web://` 的 URL 必须有占位符 hostname，否则文件名被解析为 hostname，pathname 为空，Handler 返回 500。

```ts
// ❌ config.json 被当作 hostname，pathname 为空 → 500
fetch("pinix-data://config.json")

// ✅ clip 作为占位符 hostname，pathname = /config.json
fetch("pinix-data://clip/config.json")
```

### 2. `data/` 前缀：Handler 自动补，前端不要重复加

`pinix-data://` Handler 会自动在 pathname 前加 `data/` 前缀。

```ts
// ❌ 实际访问 workdir/data/data/config.json → 404
fetch("pinix-data://clip/data/config.json")

// ✅ 实际访问 workdir/data/config.json
fetch("pinix-data://clip/config.json")
```

### 3. iOS 安全区适配

```css
.header { padding-top: env(safe-area-inset-top); }
.footer { padding-bottom: env(safe-area-inset-bottom); }
```

### 4. 前端枚举/选项禁止硬编码，必须从命令动态加载

可变值（如分类标签、项目列表等）不能在前端写死。数据层变了前端不认识，分组/过滤失效。

```tsx
// ❌ 硬编码
const CATEGORIES = ['@dev', '@mobile', '@pi']

// ✅ 动态加载
const [categories, setCategories] = useState<string[]>([])
useEffect(() => {
  Bridge.invoke('category-list', '{}').then(r => setCategories(JSON.parse(r)))
}, [])
```

### 5. 字体必须用 @fontsource 包，禁止 Google Fonts

国内环境 Google Fonts 无法访问，字体加载失败或超时。

```bash
pnpm add @fontsource/inter @fontsource/playfair-display
```

```css
/* ✅ 本地包，Vite 打包时自动内联 */
@import '@fontsource/inter/400.css';

/* ❌ 禁止 */
@import url('https://fonts.googleapis.com/...');
```

### 6. 必须同时生成 light + dark 两套 token

Gemini CLI 有时只生成单一模式。prompt 里要明确写：

```
所有颜色改动必须同时提供 light 和 dark 两套值。
```

```css
/* ✅ 默认 light */
@theme {
  --color-background: oklch(0.98 0.004 90);
}

/* ✅ dark 覆盖 */
@media (prefers-color-scheme: dark) {
  :root {
    --color-background: oklch(0.12 0 0);
  }
}
```

### 7. 视觉元素先定义语义再写 CSS

避免先写颜色再改语义导致多轮返工。正确顺序：
1. 明确语义（这个竖条代表什么？优先级？类别？状态？）
2. 定义色表
3. 写 CSS

---

## 二、Data 层

### 8. 配置字段名必须与 TypeScript 接口严格一致

`config.json` 字段名和代码接口不一致 → fetch 成功但字段读到 `undefined` → 保存时空值覆盖数据。

规范：**以 TypeScript 接口字段名为准**。迁移旧配置加 `normalizeConfig()` 做映射并给默认值。

### 9. 配置加载顺序

```
优先级：data/config.json  >  localStorage  >  默认值
```

启动时尝试读文件，失败回退 localStorage，都没有用默认值。保存时双写（文件 + localStorage）。

### 10. manifest 路径字段含 `data/` 前缀

manifest.json 里的文件路径代表 `workdir/data/` 下的文件，字段值**本身含 `data/` 前缀**。不与第 2 条矛盾（那条说的是 fetch URL）。

### 11. 日期字段名统一

一个 Clip 内只用一个日期字段名，推荐 `created_at`，格式 ISO 8601（`2026-02-27T10:00:00+08:00`）。混用 `timestamp` / `created_at` 会导致排序乱序。

---

## 三、Command 层

### 12. Bridge.invoke action 只填命令名

```ts
// ❌ 找不到名为 "ClipService.Invoke" 的命令文件
Bridge.invoke("ClipService.Invoke", { ... })

// ✅ 填 commands/ 目录下的文件名
Bridge.invoke("tts", { args: [], stdin: JSON.stringify(payload) })
```

### 13. 命令脚本必须 chmod +x

Server 直接 exec 脚本文件，没有执行权限会报错。

### 14. 脚本内相对路径以 workdir 为根

Server 执行时 `cmd.Dir = clip.Workdir`。

### 15. stdin JSON 布尔值用标准格式

Python 的 `json.load` 要求 `true/false` 小写。永远用 `JSON.stringify` 传参，不要手动拼字符串。

### 16. Python 命令 json.dumps 加 ensure_ascii=False

默认 `ensure_ascii=True` 把中文转义为 `\uXXXX`，Bridge 返回后前端显示乱码。

```python
# ✅
print(json.dumps(result, ensure_ascii=False))
```

---

## 四、调试与部署

### 17. Launcher 改动需重启 Electron，不能 reload

普通 Clip 可以 `/eval` 触发 `location.reload()`。Launcher 必须重启 Electron 进程。

```bash
pkill -f Electron 2>/dev/null; sleep 2
cd ~/Developer/epiral/repos/pinix-desktop
nohup node_modules/.bin/electron . > /tmp/pinix-desktop.log 2>&1 &
```

---

*最后更新：2026-02-27，基于 voice-inbox / notes / todo 实战积累*
