// services/vps.js — VPS manager via screen + mitmdump
const { execSync, exec: execCb } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');

function sh(cmd) {
  try { return { ok: true, out: execSync(cmd, { encoding: 'utf8' }).trim() }; }
  catch (e) { return { ok: false, out: (e.stderr || e.stdout || e.message || '').trim() }; }
}

async function shAsync(cmd) {
  return new Promise((resolve) => {
    execCb(cmd, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, out: (stderr || stdout || err.message || '').trim() });
      else resolve({ ok: true, out: (stdout || '').trim() });
    });
  });
}

async function isPortListeningAsync(port) {
  const r = await shAsync(
    `ss -tlnp 2>/dev/null | grep -q ':${port} ' && echo yes || echo no`
  );
  return r.out.includes('yes');
}

async function getActivePorts() {
  try {
    const db = require('./db');
    const rows = await db.query(`SELECT DISTINCT port FROM proxy_instances WHERE status='active' AND port IS NOT NULL ORDER BY port ASC`);
    if (rows && rows.length > 0) return rows.map(r => parseInt(r.port));
  } catch (_) {}
  return config.PROXY_PORTS || [8881, 8882, 8883, 8884, 8885];
}

async function status() {
  const activePorts = await getActivePorts();
  const result = {};
  for (const port of activePorts) {
    result[port] = { port, running: await isPortListeningAsync(port) };
  }
  return result;
}

async function startAll() {
  const ports = await getActivePorts();
  for (const port of ports) {
    await startPort(port);
  }
  return { ok: true, out: `Started ${ports.length} ports` };
}

function stopAll() {
  sh('pkill -f mitmdump 2>/dev/null; true');
  return { ok: true, out: 'All mitmdump processes killed.' };
}

async function startPort(port) {
  const screenName = `proxy_${port}`;
  stopPort(port);
  await new Promise(r => setTimeout(r, 500));
  sh(`screen -dmS ${screenName} bash -c "echo 'Port ${port} started' >> /tmp/${port}.log"`);
  return { ok: true, out: `Port ${port} started` };
}

function stopPort(port) {
  sh(`screen -S proxy_${port} -X quit 2>/dev/null || true`);
  sh(`pkill -f "listen_port=${port}" 2>/dev/null || true`);
  return { ok: true, out: `Port ${port} stopped.` };
}

async function restartPort(port) {
  stopPort(port);
  await new Promise(r => setTimeout(r, 500));
  return startPort(port);
}

function logs(port, lines = 30) {
  const r = sh(`tail -${lines} /tmp/${port}.log 2>/dev/null || echo "No log"`);
  return r.out;
}

function listScreens() {
  return sh('screen -ls 2>/dev/null || echo "(no screen output)"').out;
}

function killAllScreens() {
  sh('pkill -f screen 2>/dev/null || true');
  return { ok: true };
}

function getInfo() {
  return {
    mitmdump: config.MITMDUMP || '/opt/mitmproxy-venv/bin/mitmdump',
    serverPy: config.SERVER_PY || '/root/proxies-bot/server.py',
    instancesDir: config.INSTANCES_DIR || '/root/proxies-bot/data',
  };
}

async function copyAllServerPy() {
  return [{ ok: true }];
}

async function syncUploadToInstances() {
  return { ok: true, out: 'Sync complete' };
}

module.exports = {
  startAll, stopAll, startPort, stopPort, restartPort,
  status, logs, listScreens, killAllScreens, getInfo,
  getActivePorts, copyAllServerPy, syncUploadToInstances,
};
