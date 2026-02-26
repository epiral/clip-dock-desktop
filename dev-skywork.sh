#!/bin/zsh
# skywork 本地启动脚本，连接 home 节点 Pinix Server
cd "$(dirname "$0")"
export PINIX_SERVER_URL="http://100.66.47.40:9875"
pnpm build && npx electron dist/main.js
