// services/subbot.manager.js — Dynamic Sub Bot Process Manager
const { spawn } = require('child_process');
const path = require('path');
const db = require('./db');

const ROOT_DIR = path.join(__dirname, '..');
const BOT_SCRIPT = path.join(ROOT_DIR, 'subbot.js');
const _running = new Map();

function launchSubBot(b, autoRestart = true) {
  if (_running.has(b.bot_id)) return false;
  if (!b.bot_token || !b.bot_token.includes(':')) return false;

  const env = { ...process.env, SUBBOT_TOKEN: b.bot_token, SUBBOT_ADMIN_ID: String(b.admin_tg_id || ''), SUBBOT_BOT_ID: b.bot_id };
  const proc = spawn('node', [BOT_SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const entry = { process: proc, pid: proc.pid, label: b.label || b.bot_id, startedAt: Date.now(), botId: b.bot_id };
  _running.set(b.bot_id, entry);

  proc.stdout.on('data', (d) => console.log(`[${b.bot_id}] ${d.toString().trim()}`));
  proc.stderr.on('data', (d) => console.error(`[${b.bot_id}] ERR: ${d.toString().trim()}`));
  proc.on('exit', (code, signal) => {
    _running.delete(b.bot_id);
    console.log(`[${b.bot_id}] Exited (code=${code} signal=${signal})`);
  });
  console.log(`✅ SubBot ${b.bot_id} launched — PID ${proc.pid}`);
  return true;
}

function stopSubBot(botId) {
  const entry = _running.get(botId);
  if (!entry) return false;
  _running.delete(botId);
  try { entry.process.kill('SIGTERM'); return true; }
  catch (_) { return false; }
}

function isRunning(botId) { return _running.has(botId); }
function runningCount() { return _running.size; }
function listRunning() { return [..._running.keys()]; }

async function launchAllFromDB() {
  try {
    const bots = await db.query(`SELECT * FROM sub_bots WHERE status='active' ORDER BY id ASC`);
    for (const b of bots) launchSubBot(b);
    console.log(`✅ Auto-launched ${bots.length} sub bot(s)`);
  } catch (_) {}
}

function stopAll() { for (const botId of [..._running.keys()]) stopSubBot(botId); }

module.exports = { launchSubBot, stopSubBot, isRunning, runningCount, listRunning, launchAllFromDB, stopAll };
