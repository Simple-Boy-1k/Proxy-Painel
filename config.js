// config.js — Proxies Bot Configuration
// Loads from .env — all paths must be absolute.
require('dotenv').config();
const path = require('path');

module.exports = {
  // ── Telegram ───────────────────────────────────────────────────────────────
  BOT_TOKEN:      process.env.BOT_TOKEN      || '',
  SUPER_ADMIN_ID: String(process.env.SUPER_ADMIN_ID || ''),

  // ── MySQL ──────────────────────────────────────────────────────────────────
  DB: {
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME || 'proxy',
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
  },

  // ── VPS / Proxy paths ──────────────────────────────────────────────────────
  START_SCRIPT: process.env.START_SCRIPT
    ? path.resolve(process.env.START_SCRIPT)
    : path.join(__dirname, 'start_proxies.sh'),

  SERVER_PY: process.env.SERVER_PY
    ? path.resolve(process.env.SERVER_PY)
    : path.join(__dirname, 'server.py'),

  MITMDUMP: process.env.MITMDUMP || '/opt/mitmproxy-venv/bin/mitmdump',

  INSTANCES_DIR: process.env.INSTANCES_DIR
    ? path.resolve(process.env.INSTANCES_DIR)
    : path.join(__dirname, 'data'),

  // ── Ports ──────────────────────────────────────────────────────────────────
  PROXY_PORTS: (process.env.PROXY_PORTS || '')
    .split(',').map(s => Number(s.trim())).filter(Boolean),

  // ── Proxy webhook / cache invalidation ────────────────────────────────────
  PROXY_TOKEN:       process.env.PROXY_TOKEN       || 'tokenapi',
  WEBHOOK_BASE_PORT: parseInt(process.env.WEBHOOK_BASE_PORT || '9900'),
  PROXY_HOST:        process.env.PROXY_HOST        || '127.0.0.1',

  // ── WebApp / URLs ──────────────────────────────────────────────────────────
  IP_DETECT_URL:     process.env.IP_DETECT_URL     || '',
  PROXIES_URL:       process.env.PROXIES_URL       || '',
  CERT_DOWNLOAD_URL: process.env.CERT_DOWNLOAD_URL || '',

  // ── File uploads ──────────────────────────────────────────────────────────
  UPLOAD_DIR: process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(__dirname, 'data'),
};
