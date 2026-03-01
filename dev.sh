#!/bin/bash
# dev.sh — clip-dock-desktop 开发调试脚本
# 用法：bash dev.sh
# 日志：tail -f /tmp/clip-dock-desktop.log

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="/tmp/clip-dock-desktop.log"
PID_FILE="/tmp/clip-dock-desktop.pid"

cd "$REPO_DIR"

log() {
  echo "[dev.sh $(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

kill_electron() {
  if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
      log "kill Electron PID=$OLD_PID"
      kill "$OLD_PID" 2>/dev/null || true
      sleep 0.8
    fi
    rm -f "$PID_FILE"
  fi
  pkill -f "electron dist/main" 2>/dev/null || true
}

start_electron() {
  log "启动 Electron..."
  PINIX_SERVER_URL="${PINIX_SERVER_URL:-http://localhost:9875}" \
    npx electron dist/main.js >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  log "Electron PID=$(cat $PID_FILE)"
}

do_build() {
  log "=== BUILD START ==="
  if pnpm build >> "$LOG_FILE" 2>&1; then
    log "=== BUILD OK ==="
    return 0
  else
    log "=== BUILD FAILED ==="
    return 1
  fi
}

cleanup() {
  log "退出，清理..."
  kill_electron
  kill $TSC_PID 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

echo "" > "$LOG_FILE"
log "clip-dock-desktop dev 启动 | repo=$REPO_DIR"

do_build
kill_electron
start_electron

log "启动 tsc --watch..."
pnpm exec tsc --watch --preserveWatchOutput 2>&1 | while read -r line; do
  echo "$line" >> "$LOG_FILE"
  if echo "$line" | grep -q "Found 0 errors"; then
    log "编译成功，重启 Electron..."
    kill_electron
    start_electron
  fi
done &
TSC_PID=$!

log "就绪。修改 src/ 下文件会自动重启。"
log "查看日志: tail -f $LOG_FILE"

wait $TSC_PID
