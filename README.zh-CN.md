# Clip Dock

**agents, assembled.**

[Pinix](https://github.com/epiral/pinix) 生态的桌面客户端 — 发现、连接和使用来自任意 Pinix Server 的 Clips。

[![Release](https://img.shields.io/github/v/release/epiral/clip-dock-desktop?color=blue)](https://github.com/epiral/clip-dock-desktop/releases)

[English](README.md) | [中文](README.zh-CN.md)

## 安装

从 [GitHub Releases](https://github.com/epiral/clip-dock-desktop/releases) 下载 DMG。

DMG 内置了 Pinix Server + BoxLite + rootfs。首次启动时点击 **"Install from bundle"** 即可自动安装运行时。

## 功能

### 环境检测

自动检测 BoxLite 和 Pinix Server 的运行状态：

- **运行中** — 绿色指示灯
- **已安装未运行** — 黄色指示灯 + Start 按钮
- **未安装** — 红色指示灯 + 从 bundle 安装

### Clip 发现

连接任意 Pinix Server 并发现可用 Clips：

- **本地 Server** — 自动从 `~/.config/pinix/config.yaml` 读取 super token
- **远程 Server** — 手动输入 Server URL + Super Token

一键生成 Clip Token 并添加为 Bookmark。

### 多窗口

每个 Clip 在独立窗口中打开，拥有隔离的 session。Clip 通过 `commands/`（Invoke RPC）通信，通过 `web/`（ReadFile RPC）提供 UI。

## 架构

```
┌─────────────────────────────────────────┐
│  Electron 主进程                         │
│                                          │
│  main.ts          bridge.ts              │
│  ├─ Launcher UI   ├─ pinix-web://       │
│  ├─ IPC 处理      ├─ pinix-data://      │
│  ├─ 环境检测      └─ Connect-RPC        │
│  └─ Clip 窗口          │                │
│                         ▼                │
│                  Pinix Server :9875      │
│                  ├─ ClipService.Invoke   │
│                  └─ ClipService.ReadFile │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  渲染进程（每个 Clip 独立）               │
│                                          │
│  加载 pinix-web://{clip}/index.html     │
│  通过 Bridge.invoke() 执行写操作         │
│  所有读请求通过 scheme 拦截              │
└─────────────────────────────────────────┘
```

## 开发

```bash
pnpm install
cd launcher && pnpm install && cd ..

pnpm dev              # 开发模式
pnpm run pack         # 构建 DMG（已签名）
bash dev.sh           # Watch 模式
```

## 打包

```bash
# 准备 vendor/（二进制 + rootfs）
mkdir -p vendor
cp ~/bin/pinix ~/bin/boxlite ~/bin/boxlite-shim vendor/
cp <boxlite-guest-path> vendor/boxlite-guest
cp <libkrunfw-path> vendor/libkrunfw.5.dylib
gzip -9 -c ~/.boxlite/rootfs/*.ext4 > vendor/rootfs.ext4.gz

# 构建
pnpm run pack
# 产出: dist/Clip Dock-1.0.0-arm64.dmg
```
