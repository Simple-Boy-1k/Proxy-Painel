// panels/uids.js — IP Management Panel
const { Markup } = require('telegraf');
const db = require('../services/db');
const auth = require('../services/auth');
const { render, esc, fmtUnix } = require('../utils/render');
const { pe } = require('../utils/emoji');

function isValidIp(ip) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(n => parseInt(n) >= 0 && parseInt(n) <= 255);
}

function uidsKeyboard(isAdm) {
  const rows = [
    [Markup.button.callback('📋 List IPs', 'uid_list'), Markup.button.callback('🔍 Find IP', 'uid_find')],
    [Markup.button.callback('🚀 Activate IP', 'uid_activate'), Markup.button.callback('♻️ Change IP', 'uid_change_ip')],
  ];
  if (isAdm) {
    rows.push([Markup.button.callback('🚫 Block IP', 'uid_block'), Markup.button.callback('✅ Unblock IP', 'uid_unblock')]);
    rows.push([Markup.button.callback('🗑 Delete IP', 'uid_delete'), Markup.button.callback('⏰ Extend IP', 'uid_extend')]);
    rows.push([Markup.button.callback('📊 IP Stats', 'uid_stats')]);
  }
  rows.push([Markup.button.callback('🔙 Main Menu', 'nav_main_menu')]);
  return Markup.inlineKeyboard(rows);
}

const pending = new Map();

function register(bot, authOverride) {
  const auth = authOverride || require('../services/auth');

  bot.action('nav_uids_panel', async (ctx) => {
    const isAdm = await auth.isAdmin(ctx);
    if (!(await auth.isSeller(ctx))) { await ctx.answerCbQuery('⛔ No access'); return; }
    await render(ctx, `${pe('people','👥')} <b>IP Management</b>\n\nAccess is granted by <b>IP address</b>.`, { parse_mode: 'HTML', ...uidsKeyboard(isAdm) });
    await ctx.answerCbQuery();
  });

  bot.action('uid_stats', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const now = Math.floor(Date.now() / 1000);
    const total = (await db.queryOne('SELECT COUNT(*) c FROM proxy_uids')).c;
    const active = (await db.queryOne(`SELECT COUNT(*) c FROM proxy_uids WHERE status='active' AND (expires_at=0 OR expires_at>${now})`)).c;
    const expired = (await db.queryOne(`SELECT COUNT(*) c FROM proxy_uids WHERE expires_at>0 AND expires_at<=${now}`)).c;
    const blocked = (await db.queryOne(`SELECT COUNT(*) c FROM proxy_uids WHERE status='blocked'`)).c;
    await render(ctx, `📊 <b>IP Statistics</b>\n\n📌 Total: <b>${total}</b>\n🟢 Active: ${active}\n⏰ Expired: ${expired}\n🚫 Blocked: ${blocked}`, { parse_mode: 'HTML', ...uidsKeyboard(true) });
    await ctx.answerCbQuery();
  });

  bot.action('uid_list', async (ctx) => {
    const isAdm = await auth.isAdmin(ctx);
    if (!(await auth.isSeller(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const now = Math.floor(Date.now() / 1000);
    const u = await auth.getUser(ctx);
    const isOwn = await auth.isOwner(ctx);

    let rows;
    if (isOwn || isAdm) {
      rows = await db.query(`SELECT u.ip, u.status, u.expires_at, k.key_code FROM proxy_uids u LEFT JOIN proxy_keys k ON u.key_id=k.id ORDER BY u.id DESC LIMIT 40`);
    } else {
      rows = await db.query(`SELECT u.ip, u.status, u.expires_at, k.key_code FROM proxy_uids u LEFT JOIN proxy_keys k ON u.key_id=k.id WHERE k.owner_id=? ORDER BY u.id DESC LIMIT 40`, [u ? u.id : 0]);
    }

    if (!rows.length) {
      await render(ctx, 'ℹ️ No IPs registered yet.', { ...uidsKeyboard(isAdm) });
      await ctx.answerCbQuery(); return;
    }

    let msg = `👥 <b>Registered IPs (${rows.length})</b>\n\n`;
    for (const r of rows) {
      const st = r.status === 'blocked' ? '🚫' : (r.expires_at && r.expires_at < now ? '⏰' : '🟢');
      msg += `${st} <code>${esc(r.ip)}</code>\n🔑 ${esc(r.key_code || '—')} | 📅 ${fmtUnix(r.expires_at)}\n`;
    }
    await render(ctx, msg, { parse_mode: 'HTML', ...uidsKeyboard(isAdm) });
    await ctx.answerCbQuery();
  });

  bot.action('uid_find', async (ctx) => {
    if (!(await auth.isSeller(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'uid_find' });
    await render(ctx, `🔍 Enter the <b>IP address</b> to look up:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('uid_activate', async (ctx) => {
    if (!(await auth.isSeller(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'uid_activate', step: 'key' });
    await render(ctx, `🚀 <b>Activate IP</b>\n\nEnter the <b>key code</b>:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('uid_change_ip', async (ctx) => {
    if (!(await auth.isSeller(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'uid_change_ip', step: 'old_ip' });
    await render(ctx, `♻️ <b>Change IP</b>\n\nEnter your <b>current (old) IP address</b>:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('uid_block', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'uid_block' });
    await render(ctx, `🚫 Enter the <b>IP address</b> to block:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('uid_unblock', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'uid_unblock' });
    await render(ctx, `✅ Enter the <b>IP address</b> to unblock:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('uid_delete', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'uid_delete' });
    await render(ctx, `🗑 Enter the <b>IP address</b> to permanently delete:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('uid_extend', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'uid_extend' });
    await render(ctx, `⏰ Enter the <b>IP address</b> to extend, then days (e.g. <code>1.2.3.4 30</code>):`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.on('text', async (ctx, next) => {
    const state = pending.get(ctx.from.id);
    if (!state) return next();
    if (!(await auth.isSeller(ctx))) return next();

    const text = ctx.message.text.trim();
    const isAdm = await auth.isAdmin(ctx);

    if (state.action === 'uid_find') {
      pending.delete(ctx.from.id);
      const ip = text;
      const now = Math.floor(Date.now() / 1000);
      const rows = await db.query(`SELECT u.*, k.key_code FROM proxy_uids u LEFT JOIN proxy_keys k ON u.key_id=k.id WHERE u.ip=?`, [ip]);
      if (!rows.length) { await render(ctx, `❌ IP <code>${esc(ip)}</code> not found.`, { parse_mode: 'HTML', ...uidsKeyboard(isAdm) }); return; }
      let msg = '';
      for (const r of rows) {
        const st = r.status === 'blocked' ? '🚫 Blocked' : (r.expires_at && r.expires_at < now ? '⏰ Expired' : '🟢 Active');
        msg += `👤 <b>${esc(r.ip)}</b>\n📊 Status: ${st}\n🔑 Key: <code>${esc(r.key_code || '—')}</code>\n📅 Expires: ${fmtUnix(r.expires_at)}\n\n`;
      }
      await render(ctx, msg, { parse_mode: 'HTML', ...uidsKeyboard(isAdm) });
      return;
    }

    if (state.action === 'uid_activate' && state.step === 'key') {
      const code = text.toUpperCase();
      const k = await db.queryOne('SELECT * FROM proxy_keys WHERE key_code=?', [code]);
      if (!k) { await render(ctx, `❌ Key not found: <code>${esc(code)}</code>`, { parse_mode: 'HTML' }); return; }
      if (k.used_count >= k.max_uids) { await render(ctx, `❌ This key is full (${k.used_count}/${k.max_uids} IPs used).`); return; }
      state.key = k; state.step = 'ip';
      pending.set(ctx.from.id, state);
      await render(ctx, `✅ Key found! Duration: <b>${k.duration_days > 0 ? k.duration_days + ' days' : 'Unlimited'}</b>\n\nEnter the <b>IP address</b> to activate:`, { parse_mode: 'HTML' });
      return;
    }

    if (state.action === 'uid_activate' && state.step === 'ip') {
      pending.delete(ctx.from.id);
      const ip = text;
      if (!isValidIp(ip)) { await render(ctx, '❌ Invalid IP format. Use format: 1.2.3.4'); return; }

      const k = state.key;
      const existing = await db.queryOne('SELECT * FROM proxy_uids WHERE key_id=? AND ip=?', [k.id, ip]);
      if (existing) {
        await render(ctx, `ℹ️ IP <code>${esc(ip)}</code> is already active on this key.`, { parse_mode: 'HTML', ...uidsKeyboard(isAdm) });
        return;
      }

      const otherKey = await db.queryOne(`SELECT k.key_code FROM proxy_uids u JOIN proxy_keys k ON u.key_id=k.id WHERE u.ip=? AND k.id!=?`, [ip, k.id]);
      if (otherKey) {
        await render(ctx, `❌ IP <code>${esc(ip)}</code> is already bound to key <code>${esc(otherKey.key_code)}</code>.`, { parse_mode: 'HTML' });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const expiresAt = k.duration_days > 0 ? now + k.duration_days * 86400 : 0;
      const uid = `IP_${ip.replace(/\./g, '_')}`;

      await db.exec(`INSERT INTO proxy_uids (uid, key_id, key_code, status, ip, expires_at, created_by) VALUES (?,?,?,'active',?,?,?)`,
        [uid, k.id, k.key_code, ip, expiresAt, 'bot']
      );
      await db.exec('UPDATE proxy_keys SET used_count=used_count+1 WHERE id=?', [k.id]);

      let msg = `✅ <b>IP Activated!</b>\n\n🌐 IP: <code>${esc(ip)}</code>\n🔑 Key: <code>${esc(k.key_code)}</code>\n📅 Expires: ${fmtUnix(expiresAt)}`;
      await render(ctx, msg, { parse_mode: 'HTML', ...uidsKeyboard(isAdm) });
      return;
    }

    if (state.action === 'uid_change_ip' && state.step === 'old_ip') {
      const oldIp = text;
      if (!isValidIp(oldIp)) { await render(ctx, '❌ Invalid IP format.'); return; }
      const rec = await db.queryOne('SELECT * FROM proxy_uids WHERE ip=?', [oldIp]);
      if (!rec) { await render(ctx, `❌ IP <code>${esc(oldIp)}</code> not found.`, { parse_mode: 'HTML' }); pending.delete(ctx.from.id); return; }
      state.oldIp = oldIp; state.rec = rec; state.step = 'new_ip';
      pending.set(ctx.from.id, state);
      await render(ctx, `Found: <code>${esc(oldIp)}</code> on key <code>${esc(rec.key_code)}</code>\n\nEnter your <b>new IP address</b>:`, { parse_mode: 'HTML' });
      return;
    }

    if (state.action === 'uid_change_ip' && state.step === 'new_ip') {
      pending.delete(ctx.from.id);
      const newIp = text;
      if (!isValidIp(newIp)) { await render(ctx, '❌ Invalid IP format.'); return; }
      if (newIp === state.oldIp) { await render(ctx, '❌ New IP is the same as the current IP.'); return; }

      const conflict = await db.queryOne(`SELECT k.key_code FROM proxy_uids u JOIN proxy_keys k ON u.key_id=k.id WHERE u.ip=? AND k.id!=?`, [newIp, state.rec.key_id]);
      if (conflict) {
        await render(ctx, `❌ IP <code>${esc(newIp)}</code> is already used on another key.`, { parse_mode: 'HTML', ...uidsKeyboard(isAdm) });
        return;
      }

      const newUid = `IP_${newIp.replace(/\./g, '_')}`;
      await db.exec('UPDATE proxy_uids SET ip=?, uid=? WHERE id=?', [newIp, newUid, state.rec.id]);

      await render(ctx, `✅ <b>IP Changed!</b>\n\n🔄 Old IP: <code>${esc(state.oldIp)}</code>\n🌐 New IP: <code>${esc(newIp)}</code>\n🔑 Key: <code>${esc(state.rec.key_code)}</code>`, { parse_mode: 'HTML', ...uidsKeyboard(isAdm) });
      return;
    }

    if (state.action === 'uid_block') {
      pending.delete(ctx.from.id);
      if (!isAdm) return next();
      const ip = text;
      const r = await db.exec(`UPDATE proxy_uids SET status='blocked' WHERE ip=?`, [ip]);
      await render(ctx, r.affectedRows ? `🚫 IP <code>${esc(ip)}</code> blocked.` : `❌ IP not found.`, { parse_mode: 'HTML', ...uidsKeyboard(isAdm) });
      return;
    }

    if (state.action === 'uid_unblock') {
      pending.delete(ctx.from.id);
      if (!isAdm) return next();
      const ip = text;
      const r = await db.exec(`UPDATE proxy_uids SET status='active' WHERE ip=?`, [ip]);
      await render(ctx, r.affectedRows ? `✅ IP <code>${esc(ip)}</code> unblocked.` : `❌ IP not found.`, { parse_mode: 'HTML', ...uidsKeyboard(isAdm) });
      return;
    }

    if (state.action === 'uid_delete') {
      pending.delete(ctx.from.id);
      if (!isAdm) return next();
      const ip = text;
      const rec = await db.queryOne('SELECT id, key_id FROM proxy_uids WHERE ip=?', [ip]);
      if (!rec) { await render(ctx, `❌ IP <code>${esc(ip)}</code> not found.`, { parse_mode: 'HTML', ...uidsKeyboard(isAdm) }); return; }
      await db.exec('DELETE FROM proxy_uids WHERE ip=?', [ip]);
      await db.exec('UPDATE proxy_keys SET used_count=used_count-1 WHERE id=? AND used_count>0', [rec.key_id]);
      await render(ctx, `✅ IP <code>${esc(ip)}</code> deleted.`, { parse_mode: 'HTML', ...uidsKeyboard(isAdm) });
      return;
    }

    if (state.action === 'uid_extend') {
      pending.delete(ctx.from.id);
      if (!isAdm) return next();
      const parts = text.split(/\s+/);
      if (parts.length < 2) { await render(ctx, '❌ Format: <code>IP DAYS</code> (e.g. <code>1.2.3.4 30</code>)', { parse_mode: 'HTML' }); return; }
      const ip = parts[0];
      const days = parseInt(parts[1]);
      if (!isValidIp(ip) || isNaN(days) || days < 1) { await render(ctx, '❌ Invalid format. Use: <code>1.2.3.4 30</code>', { parse_mode: 'HTML' }); return; }
      const now = Math.floor(Date.now() / 1000);
      const rec = await db.queryOne('SELECT id, expires_at FROM proxy_uids WHERE ip=?', [ip]);
      if (!rec) { await render(ctx, `❌ IP <code>${esc(ip)}</code> not found.`, { parse_mode: 'HTML', ...uidsKeyboard(isAdm) }); return; }
      const base = Math.max(rec.expires_at || now, now);
      const newExp = base + days * 86400;
      await db.exec('UPDATE proxy_uids SET expires_at=? WHERE ip=?', [newExp, ip]);
      await render(ctx, `✅ <b>Extended!</b>\n🌐 IP: <code>${esc(ip)}</code>\n📅 New expiry: ${fmtUnix(newExp)}`, { parse_mode: 'HTML', ...uidsKeyboard(isAdm) });
      return;
    }

    return next();
  });
}

module.exports = { register };
