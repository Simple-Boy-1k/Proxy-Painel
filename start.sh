#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  start.sh — One-command launcher for the full Proxies Bot system
#
#  Usage:
#    bash start.sh          → start bot + all proxies
#    bash start.sh bot      → start/restart bot only (pm2)
#    bash start.sh proxies  → start/restart proxy ports only
#    bash start.sh stop     → stop everything
#    bash start.sh status   → show status of bot + all ports
#    bash start.sh logs     → tail all proxy logs
#    bash start.sh install  → first-time setup (npm install, pm2, etc.)
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$SCRIPT_DIR"
DOTENV="${BOT_DIR}/.env"
START_PROXIES="${BOT_DIR}/start_proxies.sh"
PM2_APP="proxies-bot"

# ── Auto-fix permissions for .sh files (runs every time, harmless) ────────────
find "$BOT_DIR" -maxdepth 1 -name "*.sh" -exec chmod +x {} \; 2>/dev/null || true

# ── Colors ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅  $*${NC}"; }
err()  { echo -e "${RED}❌  $*${NC}"; }
info() { echo -e "${CYAN}ℹ️   $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $*${NC}"; }
hdr()  { echo -e "\n${BOLD}${CYAN}── $* ──${NC}"; }

# ── Load .env ─────────────────────────────────────────────────────────────────
if [ -f "$DOTENV" ]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -v '^\s*#' "$DOTENV" | grep '=')
  set +a
else
  warn ".env not found at $DOTENV"
fi

PROXY_PORTS_STR="${PROXY_PORTS:-8881,8882,8883,8884,8885,8886,8887,8888,8889,8890}"
IFS=',' read -ra ALL_PORTS <<< "$PROXY_PORTS_STR"

# ── Helpers ────────────────────────────────────────────────────────────────────
port_listening() {
  ss -tlnp 2>/dev/null | grep -q ":$1 " \
  || netstat -tlnp 2>/dev/null | grep -q ":$1 "
}

check_root() {
  if [ "$(id -u)" -ne 0 ]; then
    warn "Not running as root — some operations (fuser, pkill) may fail."
  fi
}

# ── Actions ────────────────────────────────────────────────────────────────────

start_bot() {
  hdr "Starting Bot (pm2)"
  cd "$BOT_DIR"

  if ! command -v pm2 &>/dev/null; then
    err "pm2 not found.  Run:  npm install -g pm2"
    exit 1
  fi

  if pm2 describe "$PM2_APP" &>/dev/null; then
    pm2 restart "$PM2_APP" --update-env
    ok "Bot restarted via pm2"
  else
    pm2 start ecosystem.config.js
    ok "Bot started via pm2"
  fi
  pm2 save --force &>/dev/null || true
}

start_proxies() {
  hdr "Starting Proxy Ports"
  check_root
  if [ ! -f "$START_PROXIES" ]; then
    err "start_proxies.sh not found: $START_PROXIES"
    exit 1
  fi
  BOT_DIR="$BOT_DIR" bash "$START_PROXIES"
}

stop_all() {
  hdr "Stopping Everything"
  if command -v pm2 &>/dev/null && pm2 describe "$PM2_APP" &>/dev/null; then
    pm2 stop "$PM2_APP" 2>/dev/null && ok "Bot stopped (pm2)" || warn "Bot stop failed"
  fi
  pkill -f mitmdump 2>/dev/null && ok "All mitmdump processes killed" || true
  for PORT in "${ALL_PORTS[@]}"; do
    screen -S "proxy_${PORT}" -X quit 2>/dev/null || true
  done
  screen -S "proxies_all" -X quit 2>/dev/null || true
  ok "All proxy screen sessions closed"
}

show_status() {
  hdr "System Status"

  echo -e "\n${BOLD}Bot:${NC}"
  if command -v pm2 &>/dev/null; then
    if pm2 describe "$PM2_APP" 2>/dev/null | grep -q "online"; then
      ok "Bot is RUNNING (pm2: $PM2_APP)"
    else
      err "Bot is STOPPED"
    fi
  else
    warn "pm2 not installed — cannot check bot status"
  fi

  echo -e "\n${BOLD}Proxy Ports:${NC}"
  RUNNING=0; STOPPED=0
  for PORT in "${ALL_PORTS[@]}"; do
    if port_listening "$PORT"; then
      echo -e "  ${GREEN}🟢 Port ${PORT}${NC} — listening"
      RUNNING=$((RUNNING+1))
    else
      echo -e "  ${RED}🔴 Port ${PORT}${NC} — offline"
      STOPPED=$((STOPPED+1))
    fi
  done
  echo ""
  echo -e "  Total: ${GREEN}${RUNNING} running${NC}  /  ${RED}${STOPPED} stopped${NC}"

  echo -e "\n${BOLD}Screen Sessions:${NC}"
  screen -ls 2>/dev/null | grep -E "proxy_|proxies_all" | sed 's/^/  /' || echo "  (none)"
}

show_logs() {
  hdr "Tailing All Proxy Logs (Ctrl+C to exit)"
  LOG_FILES=()
  for PORT in "${ALL_PORTS[@]}"; do
    [ -f "/tmp/${PORT}.log" ] && LOG_FILES+=("/tmp/${PORT}.log")
  done
  if [ ${#LOG_FILES[@]} -eq 0 ]; then
    warn "No log files found in /tmp/"
    exit 0
  fi
  tail -f "${LOG_FILES[@]}"
}

install_deps() {
  hdr "First-Time Setup"
  cd "$BOT_DIR"

  info "Setting execute permissions on all .sh scripts..."
  find "$BOT_DIR" -maxdepth 1 -name "*.sh" -exec chmod +x {} \;
  ok "chmod +x applied to all .sh files in $BOT_DIR"

  info "Installing Node.js dependencies..."
  npm install
  ok "npm install done"

  if ! command -v pm2 &>/dev/null; then
    info "Installing pm2 globally..."
    npm install -g pm2
    pm2 startup systemd -u root --hp /root 2>/dev/null || true
    ok "pm2 installed"
  else
    ok "pm2 already installed"
  fi

  if ! command -v mitmdump &>/dev/null && [ ! -f "/opt/mitmproxy-venv/bin/mitmdump" ]; then
    warn "mitmdump not found. Install:"
    echo "  python3 -m venv /opt/mitmproxy-venv"
    echo "  /opt/mitmproxy-venv/bin/pip install mitmproxy pymysql"
  else
    ok "mitmdump found"
  fi

  if [ ! -f "$DOTENV" ]; then
    warn ".env not found — copy from .env.example and fill in your values:"
    echo "  cp ${BOT_DIR}/.env.example ${BOT_DIR}/.env"
    echo "  nano ${BOT_DIR}/.env"
  else
    ok ".env found"
  fi

  info "Setup done. Run:  bash start.sh"
}

# ── Main ───────────────────────────────────────────────────────────────────────
CMD="${1:-all}"

case "$CMD" in
  all)
    echo -e "\n${BOLD}${CYAN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${CYAN}║     Proxies Bot — Full System Start       ║${NC}"
    echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════╝${NC}"
    start_bot
    sleep 2
    start_proxies
    echo ""
    show_status
    ;;
  bot)
    start_bot
    ;;
  proxies|proxy)
    start_proxies
    ;;
  stop)
    stop_all
    ;;
  status|st)
    show_status
    ;;
  logs|log)
    show_logs
    ;;
  install|setup)
    install_deps
    ;;
  restart)
    stop_all
    sleep 2
    start_bot
    sleep 2
    start_proxies
    show_status
    ;;
  *)
    echo -e "\n${BOLD}Usage:${NC}  bash start.sh [command]"
    echo ""
    echo "  (no arg)   → start bot + all proxy ports"
    echo "  bot        → start/restart bot only"
    echo "  proxies    → start/restart proxy ports only"
    echo "  stop       → stop everything"
    echo "  restart    → stop then start everything"
    echo "  status     → show bot + port status"
    echo "  logs       → tail all proxy logs"
    echo "  install    → first-time npm install + pm2 setup"
    echo ""
    ;;
esac
