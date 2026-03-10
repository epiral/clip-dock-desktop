# Clip Dock

**agents, assembled.**

The desktop client for [Pinix](https://github.com/epiral/pinix) — discover, connect, and use Clips from any Pinix Server.

[![Release](https://img.shields.io/github/v/release/epiral/clip-dock-desktop?color=blue)](https://github.com/epiral/clip-dock-desktop/releases)

## Install

Download the DMG from [GitHub Releases](https://github.com/epiral/clip-dock-desktop/releases).

The DMG bundles Pinix Server + BoxLite + rootfs. On first launch, click **"Install from bundle"** to set up the runtime automatically.

## Features

### Environment Detection

Automatically detects BoxLite and Pinix Server status:

- **Running** — green indicator
- **Installed but not running** — yellow indicator + Start button
- **Not installed** — red indicator + Install from bundle

### Clip Discovery

Connect to any Pinix Server and discover available Clips:

- **Local server** — auto-reads super token from `~/.config/pinix/config.yaml`
- **Remote server** — enter Server URL + Super Token manually

One-click to generate a Clip Token and add as a Bookmark.

### Multi-Window

Each Clip opens in its own window with isolated session. Clips communicate via `commands/` (Invoke RPC) and serve UI via `web/` (ReadFile RPC).

## Architecture

```
┌─────────────────────────────────────────┐
│  Electron Main Process                   │
│                                          │
│  main.ts          bridge.ts              │
│  ├─ Launcher UI   ├─ pinix-web://       │
│  ├─ IPC handlers  ├─ pinix-data://      │
│  ├─ Env detection └─ Connect-RPC        │
│  └─ Clip windows       │                │
│                         ▼                │
│                  Pinix Server :9875      │
│                  ├─ ClipService.Invoke   │
│                  └─ ClipService.ReadFile │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  Renderer (per Clip)                     │
│                                          │
│  Loads pinix-web://{clip}/index.html    │
│  Calls Bridge.invoke() for mutations   │
│  All reads via scheme interception      │
└─────────────────────────────────────────┘
```

## Directory Structure

| Path | Description |
|------|-------------|
| `src/` | Main process (main.ts, bridge.ts, environment.ts, loader.ts) |
| `launcher/` | Launcher React UI (Vite + React + shadcn) |
| `build/` | Packaging config (entitlements) |
| `vendor/` | Bundled binaries (gitignored) |
| `dist/` | Build output (gitignored) |

## Development

```bash
pnpm install
cd launcher && pnpm install && cd ..

# Dev mode
pnpm dev

# Build + Package DMG
pnpm run pack

# Watch mode (auto-restart on changes)
bash dev.sh
```

## Packaging

```bash
# Prepare vendor/ (binaries + rootfs)
mkdir -p vendor
cp ~/bin/pinix ~/bin/boxlite ~/bin/boxlite-shim vendor/
cp ~/Developer/epiral/repos/boxlite/target/aarch64-unknown-linux-musl/release/boxlite-guest vendor/
cp ~/Developer/epiral/repos/boxlite/target/release/build/*/out/runtime/libkrunfw.5.dylib vendor/
gzip -9 -c ~/.boxlite/rootfs/*.ext4 > vendor/rootfs.ext4.gz

# Build DMG (signed with Developer ID Application)
pnpm run pack
# Output: dist/Clip Dock-1.0.0-arm64.dmg
```

## Debug Server

In dev mode, a debug HTTP server runs on `localhost:9876`:

| Endpoint | Description |
|----------|-------------|
| `GET /windows` | List all windows |
| `GET /screenshot` | Capture window as PNG |
| `GET /snapshot` | Semantic DOM tree with refs |
| `POST /click` | Click element by ref |
| `POST /fill` | Fill input by ref |
| `POST /eval` | Execute JavaScript |
| `POST /scroll` | Scroll page |
| `POST /resize` | Resize window |

Use `?alias=<title>` to target a specific window.
