#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  start_proxies.sh — Proxies Bot: Start all mitmproxy instances
# ═══════════════════════════════════════════════════════════════════════════════

set -u

SCRIPT_REAL="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_REAL")" && pwd)"

if [ -n "${BOT_DIR:-}" ]; then
    BOT_DIR="$BOT_DIR"
elif [ -f "${SCRIPT_DIR}/server.py" ] && [ -f "${SCRIPT_DIR}/bot.js" ]; then
    BOT_DIR="$SCRIPT_DIR"
elif [ -f "/root/proxies-bot/server.py" ]; then
    BOT_DIR="/root/proxies-bot"
else
    BOT_DIR="${SCRIPT_DIR}"
fi

DOTENV="${DOTENV:-${BOT_DIR}/.env}"

find "$BOT_DIR" -maxdepth 1 -name "*.sh" -exec chmod +x {} \; 2>/dev/null || true
chmod +x "$SCRIPT_REAL" 2>/dev/null || true

parse_env_value() {
    local KEY="$1"
    local FILE="$2"
    local VAL
    VAL=$(grep -m1 "^${KEY}=" "$FILE" 2>/dev/null | \
          tr -d '\r' | \
          sed "s/^${KEY}=//" | \
          sed 's/^["'"'"']//' | \
          sed 's/["'"'"']$//' | \
          sed 's/[[:space:]]*$//')
    echo "$VAL"
}

load_env() {
    local FILE="$1"
    if [ ! -f "$FILE" ]; then
        echo "⚠️  .env not found: $FILE"
        return 1
    fi
    while IFS= read -r line; do
        line="${line%$'\r'}"
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$line" ]] && continue
        if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            local KEY="${BASH_REMATCH[1]}"
            local VAL="${BASH_REMATCH[2]}"
            VAL="${VAL%\"}"  ; VAL="${VAL#\"}"
            VAL="${VAL%\'}"  ; VAL="${VAL#\'}"
            VAL="${VAL%$'\r'}"
            VAL="${VAL%[[:space:]]}"
            export "$KEY=$VAL"
        fi
    done < "$FILE"
    echo "📄 Loaded .env: $FILE"
}

load_env "$DOTENV"

if [ -n "${PROXY_PORTS:-}" ]; then
    IFS=',' read -ra PORTS <<< "$PROXY_PORTS"
else
    PORTS=(8881 8882 8883 8884 8885 8886 8887 8888 8889 8890)
fi

if [ -n "${SERVER_PY:-}" ] && [ -f "${SERVER_PY}" ]; then
    : 
elif [ -f "${BOT_DIR}/server.py" ]; then
    SERVER_PY="${BOT_DIR}/server.py"
elif [ -f "/root/proxies-bot/server.py" ]; then
    SERVER_PY="/root/proxies-bot/server.py"
elif [ -f "/root/server.py" ]; then
    SERVER_PY="/root/server.py"
else
    FOUND_PY="$(find /root -maxdepth 4 -name 'server.py' -not -path '*/instance_*' 2>/dev/null | head -1)"
    SERVER_PY="${FOUND_PY:-}"
fi

if [ -n "${INSTANCES_DIR:-}" ] && [ -d "${INSTANCES_DIR}" ]; then
    : 
elif [ -n "${INSTANCES_DIR:-}" ]; then
    : 
elif [ -d "${BOT_DIR}/data/instance_8881" ] || [ -d "${BOT_DIR}/data" ]; then
    INSTANCES_DIR="${BOT_DIR}/data"
elif [ -n "${INSTANCES_BASE:-}" ]; then
    INSTANCES_DIR="$INSTANCES_BASE"
else
    INSTANCES_DIR="${BOT_DIR}/data"
fi

find_mitmdump() {
    [ -n "${MITMDUMP:-}" ] && [ -x "${MITMDUMP}" ] && { echo "${MITMDUMP}"; return 0; }
    local CANDIDATES=(
        "/opt/mitmproxy-venv/bin/mitmdump"
        "/root/mitmproxy-venv/bin/mitmdump"
        "/root/.local/bin/mitmdump"
        "/usr/local/bin/mitmdump"
        "/usr/bin/mitmdump"
    )
    for p in "${CANDIDATES[@]}"; do
        [ -x "$p" ] && { echo "$p"; return 0; }
    done
    command -v mitmdump 2>/dev/null || true
    find /opt /root /usr /home -name "mitmdump" -type f 2>/dev/null | head -1 || true
}
MITMDUMP_BIN="$(find_mitmdump)"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       Proxies Bot — Starting Proxy Instances          ║"
echo "╠══════════════════════════════════════════════════════╣"
printf  "║  BOT_DIR   : %-38s║\n" "${BOT_DIR}"
printf  "║  SERVER_PY : %-38s║\n" "${SERVER_PY:-NOT SET}"
printf  "║  INSTANCES : %-38s║\n" "${INSTANCES_DIR}"
printf  "║  MITMDUMP  : %-38s║\n" "${MITMDUMP_BIN:-NOT FOUND}"
printf  "║  PORTS     : %-38s║\n" "${PORTS[*]}"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

ABORT=0

if [ -z "${MITMDUMP_BIN:-}" ] || [ ! -x "${MITMDUMP_BIN}" ]; then
    echo "❌  mitmdump not found or not executable!"
    echo "    Install: python3 -m venv /opt/mitmproxy-venv"
    echo "             /opt/mitmproxy-venv/bin/pip install mitmproxy pymysql"
    echo "    Or set MITMDUMP=/path/to/mitmdump in .env"
    ABORT=1
fi

if [ -z "${SERVER_PY:-}" ] || [ ! -f "${SERVER_PY}" ]; then
    echo "❌  server.py NOT found!"
    echo "    Tried: ${SERVER_PY:-<not set>}"
    echo "    Fix:   Set SERVER_PY=/root/proxies-bot/server.py in .env"
    echo "    Check: ls /root/proxies-bot/server.py"
    ABORT=1
fi

[ "$ABORT" -eq 1 ] && exit 1

echo "⏹  Stopping existing sessions..."
for PORT in "${PORTS[@]}"; do
    screen -S "proxy_${PORT}" -X quit 2>/dev/null || true
done
screen -S "proxies_all" -X quit 2>/dev/null || true
pkill -f mitmdump 2>/dev/null || true
sleep 1

for PORT in "${PORTS[@]}"; do
    fuser -k "${PORT}/tcp" 2>/dev/null || true
    lsof -ti:"${PORT}" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
done
sleep 0.5
echo "✅  Old sessions cleared."
echo ""

echo "📋 Copying server.py to all instance folders..."
echo "   Source : ${SERVER_PY}"
echo "   Target : ${INSTANCES_DIR}/instance_PORT/server.py"
echo ""

COPY_OK=0
COPY_FAIL=0

for PORT in "${PORTS[@]}"; do
    INST_DIR="${INSTANCES_DIR}/instance_${PORT}"

    if ! mkdir -p "${INST_DIR}" 2>/tmp/proxies_mkdir_err; then
        ERR="$(cat /tmp/proxies_mkdir_err 2>/dev/null)"
        echo "  ❌  Port ${PORT}: cannot create ${INST_DIR}"
        echo "      Error: ${ERR}"
        COPY_FAIL=$((COPY_FAIL + 1))
        continue
    fi

    if [ -f "${INST_DIR}/server.py" ]; then
        rm -f "${INST_DIR}/server.py" 2>/dev/null
        echo "  🗑  Port ${PORT}: removed old server.py"
    fi

    if cp "${SERVER_PY}" "${INST_DIR}/server.py" 2>/tmp/proxies_cp_err; then
        FILE_COUNT=$(find "${INST_DIR}" -maxdepth 1 -type f \
            ! -name "*.py" ! -name "*.pyc" ! -name "*.log" 2>/dev/null | wc -l)
        echo "  ✅  Port ${PORT} → ${INST_DIR}/server.py  [${FILE_COUNT} inject file(s)]"
        COPY_OK=$((COPY_OK + 1))
    else
        ERR="$(cat /tmp/proxies_cp_err 2>/dev/null)"
        echo "  ❌  Port ${PORT}: copy FAILED → ${INST_DIR}/server.py"
        echo "      Error: ${ERR}"
        COPY_FAIL=$((COPY_FAIL + 1))
    fi
done

echo ""
if [ "$COPY_OK" -eq 0 ]; then
    echo "❌  server.py copy FAILED for all ports!"
    echo "    Check permissions on ${INSTANCES_DIR}"
    echo "    Try: mkdir -p ${INSTANCES_DIR}/instance_8881 && cp ${SERVER_PY} ${INSTANCES_DIR}/instance_8881/server.py"
    exit 1
fi
echo "✅  server.py copied: ${COPY_OK} OK, ${COPY_FAIL} failed."
echo ""

wait_for_port() {
    local PORT="$1"
    local MAX=12
    local i
    for (( i=0; i<MAX; i++ )); do
        if ss -tlnp 2>/dev/null | grep -q ":${PORT} " || \
           netstat -tlnp 2>/dev/null | grep -q ":${PORT} "; then
            return 0
        fi
        sleep 0.5
    done
    return 1
}

STARTED=()
FAILED=()

for PORT in "${PORTS[@]}"; do
    INST_DIR="${INSTANCES_DIR}/instance_${PORT}"
    INST_SERVER_PY="${INST_DIR}/server.py"
    SCREEN_NAME="proxy_${PORT}"
    LOG_FILE="/tmp/${PORT}.log"

    if [ ! -f "${INST_SERVER_PY}" ]; then
        echo "  🔴  Port ${PORT} — SKIP: server.py missing in ${INST_DIR}"
        FAILED+=("${PORT}")
        continue
    fi

    : > "${LOG_FILE}"

    screen -dmS "${SCREEN_NAME}" bash -c "
        export PROXY_PORT=${PORT}
        export INSTANCES_DIR='${INSTANCES_DIR}'
        export DOTENV_PATH='${DOTENV}'
        '${MITMDUMP_BIN}' \
          -s '${INST_SERVER_PY}' \
          --set listen_port=${PORT} \
          --set block_global=false \
          --set keep_host_header=true \
          --set http2=false \
          --set ssl_insecure=true \
        >> '${LOG_FILE}' 2>&1
    "

    if wait_for_port "${PORT}"; then
        echo "  🟢  Port ${PORT} — OK"
        STARTED+=("${PORT}")
    else
        echo "  🔴  Port ${PORT} — FAILED (not listening after 6s)"
        echo "      Log: tail -10 ${LOG_FILE}"
        tail -5 "${LOG_FILE}" 2>/dev/null | sed 's/^/           /'
        FAILED+=("${PORT}")
    fi
done

echo ""
echo "══════════════════════════════════════════════════════"
echo "  Done!  🟢 ${#STARTED[@]} started   🔴 ${#FAILED[@]} failed"
[ "${#STARTED[@]}" -gt 0 ] && echo "  Started: ${STARTED[*]}"
[ "${#FAILED[@]}"  -gt 0 ] && echo "  Failed : ${FAILED[*]}"
echo ""
echo "  Useful commands:"
echo "    screen -ls                  → list all sessions"
echo "    screen -r proxy_8881        → attach to port 8881"
echo "    tail -f /tmp/8881.log       → live log port 8881"
echo "    bash ${SCRIPT_REAL}         → restart all"
echo "══════════════════════════════════════════════════════"

[ "${#FAILED[@]}" -eq 0 ] && exit 0 || exit 1
