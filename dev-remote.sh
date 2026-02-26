#!/bin/zsh
# dev-remote.sh — 连接远端 Pinix Server 的开发模式
# 用法: bash dev-remote.sh
# 将 PINIX_SERVER_URL 指向远端节点，在本地启动 Electron
cd "$(dirname "$0")"
export PINIX_SERVER_URL="http://100.66.47.40:9875"
pnpm build && npx electron dist/main.js
