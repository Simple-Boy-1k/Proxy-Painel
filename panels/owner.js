// panels/owner.js — Owner Panel (full system control)
const { Markup } = require('telegraf');
const db = require('../services/db');
const auth = require('../services/auth');
const vps = require('../services/vps');
const { render, esc } = require('../utils/render');
const { pe } = require('../utils/emoji');
const { getLang, STRINGS } = require('../services/lang');

function ownerKeyboard(d) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 Full Stats', 'own_full_stats'), Markup.button.callback('📡 Port Status', 'own_port_status')],
    [Markup.button.callback('▶️ Start ALL', 'own_start_all_prx'), Markup.button.callback('⏹ Stop ALL', 'own_stop_all_prx')],
    [Markup.button.callback('📢 Broadcast', 'own_broadcast'), Markup.button.callback('💬 Edit Messages', 'own_messages')],
    [Markup.button.callback('📤 Upload File', 'own_upload_file'), Markup.button.callback('👥 Manage Users', 'nav_sellers_panel')],
    [Markup.button.callback('🔌 Port Manager', 'nav_proxy_panel'), Markup.button.callback('⚙️ Settings', 'own_settings')],
    [Markup.button.callback('🧹 Cleanup Expired', 'own_clean_expired'), Markup.button.callback('🚫 Blacklist IP', 'own_blacklist')],
    [Markup.button.callback('🔙 Main Menu', 'nav_main_menu')],
  ]);
}

const pending = new Map();

async function runBroadcast(telegram, ownerId, messageText) {
  const users = await db.query(`SELECT telegram_id FROM bot_users WHERE bot_id='main' ORDER BY id ASC`);
  const ids = users.map(u => String(u.telegram_id));
  let sent = 0, failed = 0;
  for (const id of ids) {
    try {
      await telegram.sendMessage(id, messageText, { parse_mode: 'HTML' });
      sent++;
    } catch (_) { failed++; }
    await new Promise(r => setTimeout(r, 35));
  }
  await telegram.sendMessage(ownerId, `📢 <b>Broadcast complete!</b>\n\n✅ Sent: ${sent}\n❌ Failed: ${failed}`, { parse_mode: 'HTML' });
}

function register(bot) {
  bot.action('nav_owner_panel', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔ No access'); return; }
    const lang = await getLang(ctx.from.id);
    const d = STRINGS[lang] || STRINGS['en'];
    await render(ctx, `${pe('crown','👑')} <b>Owner Panel</b>\n\nFull system control:`, { parse_mode: 'HTML', ...ownerKeyboard(d) });
    await ctx.answerCbQuery();
  });

  bot.action('own_full_stats', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const d = await getLang(ctx.from.id);
    const now = Math.floor(Date.now() / 1000);
    const totalKeys = (await db.queryOne('SELECT COUNT(*) c FROM proxy_keys')).c;
    const avail = (await db.queryOne('SELECT COUNT(*) c FROM proxy_keys WHERE used_count < max_uids')).c;
    const totalUids = (await db.queryOne('SELECT COUNT(*) c FROM proxy_uids')).c;
    const activeUids = (await db.queryOne(`SELECT COUNT(*) c FROM proxy_uids WHERE status='active' AND (expires_at=0 OR expires_at>${now})`)).c;
    const expUids = (await db.queryOne(`SELECT COUNT(*) c FROM proxy_uids WHERE expires_at>0 AND expires_at<=${now}`)).c;
    const blockedUids = (await db.queryOne(`SELECT COUNT(*) c FROM proxy_uids WHERE status='blocked'`)).c;
    const sellers = (await db.queryOne(`SELECT COUNT(*) c FROM admin_users WHERE role='seller'`)).c;
    const admins = (await db.queryOne(`SELECT COUNT(*) c FROM admin_users WHERE role='admin'`)).c;

    await render(ctx,
      `📊 <b>Full System Stats</b>\n\n🔑 Keys: <b>${totalKeys}</b> total | ${avail} available\n\n👥 IPs: <b>${totalUids}</b> total\n🟢 ${activeUids} active | ⏰ ${expUids} expired | 🚫 ${blockedUids} blocked\n\n👤 Sellers: ${sellers} | 🛡 Admins: ${admins}`,
      { parse_mode: 'HTML', ...ownerKeyboard(d) }
    );
    await ctx.answerCbQuery();
  });

  bot.action('own_port_status', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    try { await ctx.answerCbQuery('📊 Checking…'); } catch (_) {}
    const d = await getLang(ctx.from.id);
    const map = await vps.status();
    const ports = Object.values(map);
    const running = ports.filter(p => p.running).length;

    let msg = `📡 <b>Port Status</b>  —  🟢 ${running}/${ports.length} running\n\n`;
    for (const p of ports) {
      msg += `${p.running ? '🟢' : '🔴'} <code>${p.port}</code> — ${p.running ? 'online' : 'offline'}\n`;
    }
    await render(ctx, msg, { parse_mode: 'HTML', ...ownerKeyboard(d) });
  });

  bot.action('own_start_all_prx', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    try { await ctx.answerCbQuery('⏳ Starting…'); } catch (_) {}
    const d = await getLang(ctx.from.id);
    await ctx.editMessageText('⏳ <b>Starting all proxies…</b>\n\n<i>Bot stays responsive.</i>', { parse_mode: 'HTML' });
    const r = await vps.startAll();
    await render(ctx, r.ok ? `✅ <b>All proxies started!</b>` : `❌ <b>Start failed:</b>`, { parse_mode: 'HTML', ...ownerKeyboard(d) });
  });

  bot.action('own_stop_all_prx', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const d = await getLang(ctx.from.id);
    vps.stopAll();
    await ctx.editMessageText(`⏹ <b>All mitmdump processes killed.</b>`, { parse_mode: 'HTML', ...ownerKeyboard(d) });
    await ctx.answerCbQuery();
  });

  bot.action('own_broadcast', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'broadcast' });
    const count = (await db.queryOne(`SELECT COUNT(*) c FROM bot_users WHERE bot_id='main'`)).c;
    await render(ctx, `📢 <b>Broadcast</b>\n\n<b>${count}</b> users will receive this message.\n\nSend your message now:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('own_messages', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const msgs = await db.query('SELECT msg_key, content FROM proxy_messages ORDER BY id');
    const rows = msgs.map(m => [Markup.button.callback(`💬 ${m.msg_key}`, `own_msg_edit:${m.msg_key}`)]);
    rows.push([Markup.button.callback('🔙 Back', 'nav_owner_panel')]);
    await render(ctx, `💬 <b>Proxy Messages</b>\n\nEdit messages shown on login:`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
    await ctx.answerCbQuery();
  });

  bot.action(/^own_msg_edit:(.+)$/, async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const msgKey = ctx.match[1];
    const row = await db.queryOne('SELECT content FROM proxy_messages WHERE msg_key=?', [msgKey]);
    const current = (row?.content || '').trim();
    pending.set(ctx.from.id, { action: 'edit_message', msgKey });
    await render(ctx, `💬 <b>Edit: <code>${esc(msgKey)}</code></b>\n\n📄 Current:\n<code>${esc(current || '(empty)')}</code>\n\nSend new content:`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'own_messages')]]) });
    await ctx.answerCbQuery();
  });

  bot.action('own_upload_file', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    await render(ctx, `📤 <b>Upload File</b>\n\nSend a file to upload to all instances:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('own_settings', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    await render(ctx, `⚙️ <b>Settings</b>\n\nReply: <code>set KEY value</code>`, { parse_mode: 'HTML', ...ownerKeyboard(await getLang(ctx.from.id)) });
    await ctx.answerCbQuery();
  });

  bot.action('own_clean_expired', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const d = await getLang(ctx.from.id);
    const now = Math.floor(Date.now() / 1000);
    const deleted = await db.exec(`DELETE FROM proxy_uids WHERE expires_at > 0 AND expires_at <= ?`, [now]);
    await render(ctx, `🧹 <b>Cleanup Done!</b>\n\n🗑 Rows deleted: <b>${deleted.affectedRows}</b>`, { parse_mode: 'HTML', ...ownerKeyboard(d) });
    await ctx.answerCbQuery();
  });

  bot.action('own_blacklist', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'blacklist_ip' });
    await render(ctx, `🚫 <b>Blacklist IP</b>\n\nEnter the IP address to block:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.on('text', async (ctx, next) => {
    const uid = ctx.from.id;
    const state = pending.get(uid);
    if (!state) return next();
    if (!(await auth.isOwner(ctx))) return next();

    const text = ctx.message.text.trim();

    if (state.action === 'broadcast') {
      pending.delete(uid);
      await ctx.reply(`📢 Broadcast started...`, { parse_mode: 'HTML', ...ownerKeyboard(await getLang(uid)) });
      runBroadcast(ctx.telegram, uid, text).catch(err => console.error('Broadcast error:', err));
      return;
    }

    if (state.action === 'edit_message') {
      pending.delete(uid);
      const { msgKey } = state;
      await db.exec('UPDATE proxy_messages SET content=? WHERE msg_key=?', [text, msgKey]);
      await ctx.reply(`✅ <b><code>${esc(msgKey)}</code> updated!</b>`, { parse_mode: 'HTML', ...ownerKeyboard(await getLang(uid)) });
      return;
    }

    if (state.action === 'blacklist_ip') {
      pending.delete(uid);
      const ip = text;
      await db.exec(`UPDATE proxy_uids SET status='blocked' WHERE ip=?`, [ip]);
      await ctx.reply(`🚫 IP <code>${esc(ip)}</code> blocked.`, { parse_mode: 'HTML', ...ownerKeyboard(await getLang(uid)) });
      return;
    }

    if (state.action === 'edit_setting') {
      pending.delete(uid);
      if (!text.startsWith('set ')) return next();
      const parts = text.slice(4).split(' ');
      const key = parts[0];
      const val = parts.slice(1).join(' ');
      await db.exec('INSERT INTO proxy_settings (setting_key, setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=?', [key, val, val]);
      await ctx.reply(`✅ <code>${esc(key)}</code> = <code>${esc(val)}</code>`, { parse_mode: 'HTML', ...ownerKeyboard(await getLang(uid)) });
      return;
    }

    return next();
  });
}

module.exports = { register };
