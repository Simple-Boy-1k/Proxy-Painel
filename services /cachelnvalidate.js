// services/cacheInvalidate.js — Clears in-memory IP cache on server.py instances
const http = require('http');
const { PROXY_PORTS, PROXY_TOKEN, PROXY_HOST, WEBHOOK_BASE_PORT } = require('../config');

function _hitWebhook(host, port, token) {
  return new Promise((resolve) => {
    const body = Buffer.from('{}');
    const options = {
      hostname: host, port: port, path: '/',
      method: 'POST', timeout: 3000,
      headers: { 'X-Proxy-Token': token, 'Content-Type': 'application/json', 'Content-Length': body.length },
    };
    const req = http.request(options, (res) => { res.resume(); resolve(); });
    req.on('error', () => resolve());
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

async function clearProxyCache(specificIp = null) {
  const host = PROXY_HOST || '127.0.0.1';
  const token = PROXY_TOKEN || 'tokenapi';
  const base = WEBHOOK_BASE_PORT || 9900;
  const ports = PROXY_PORTS || [];
  console.log(`[cache-clear] Clearing cache ${specificIp ? `for IP ${specificIp}` : '(all)'}`);
  await Promise.all(ports.map(p => _hitWebhook(host, base + (p % 100), token)));
}

module.exports = { clearProxyCache };
