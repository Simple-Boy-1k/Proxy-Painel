// panels/keys.js — Proxy Key Management (MySQL proxy_keys table)
const { Markup } = require('telegraf');
const db = require('../services/db');
const auth = require('../services/auth');
const { render, esc, fmtDate } = require('../utils/render');
const { pe } = require('../utils/emoji');
const { getLang, STRINGS } = require('../services/lang');

function genKeyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const group = () => Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${group()}-${group()}-${group()}-${group()}`;
}

function keysKeyboard(isAdm, d) {
  const rows = [
    [Markup.button.callback('🔑 My Keys', 'key_list'), Markup.button.callback('🔍 Search Key', 'key_search')],
    [Markup.button.callback('➕ Generate Keys', 'key_gen'), Markup.button.callback('🗑 Delete My Key', 'key_delete_own')],
  ];
  if (isAdm) {
    rows.push([Markup.button.callback('🗑 Delete Key', 'key_delete'), Markup.button.callback('🚫 Block Key', 'key_block')]);
    rows.push([Markup.button.callback('📊 Key Stats', 'key_stats')]);
  }
  rows.push([Markup.button.callback('🔙 Main Menu', 'nav_main_menu')]);
  return Markup.inlineKeyboard(rows);
}

const pending = new Map();

function register(bot, authOverride) {
  const auth = authOverride || require('../services/auth');

  bot.action('nav_keys_panel', async (ctx) => {
    const isAdm = await auth.isAdmin(ctx);
    if (!(await auth.isSeller(ctx))) { await ctx.answerCbQuery('⛔ No access'); return; }
    const lang = await getLang(ctx.from.id);
    const d = STRINGS[lang] || STRINGS['en'];
    await render(ctx, `${pe('key', '🔑')} <b>Keys Panel</b>\n\nManage proxy activation keys:`, { parse_mode: 'HTML', ...keysKeyboard(isAdm, d) });
    await ctx.answerCbQuery();
  });

  bot.action('key_stats', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const now = Math.floor(Date.now() / 1000);
    const total = (await db.queryOne('SELECT COUNT(*) c FROM proxy_keys')).c;
    const avail = (await db.queryOne('SELECT COUNT(*) c FROM proxy_keys WHERE used_count < max_uids')).c;
    const uids = (await db.queryOne('SELECT COUNT(*) c FROM proxy_uids')).c;
    const active = (await db.queryOne(`SELECT COUNT(*) c FROM proxy_uids WHERE status='active' AND (expires_at=0 OR expires_at>${now})`)).c;
    const expired = (await db.queryOne(`SELECT COUNT(*) c FROM proxy_uids WHERE expires_at>0 AND expires_at<=${now}`)).c;
    const blocked = (await db.queryOne(`SELECT COUNT(*) c FROM proxy_uids WHERE status='blocked'`)).c;

    await render(ctx,
      `${pe('barchart','📊')} <b>Key Statistics</b>\n\n🔑 Total Keys: <b>${total}</b>\n✅ Available: ${avail}\n\n👥 Total IPs: <b>${uids}</b>\n🟢 Active: ${active}\n⏰ Expired: ${expired}\n🚫 Blocked: ${blocked}`,
      { parse_mode: 'HTML', ...keysKeyboard(true) }
    );
    await ctx.answerCbQuery();
  });

  bot.action('key_list', async (ctx) => {
    if (!(await auth.isSeller(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const u = await auth.getUser(ctx);
    const isAdm = await auth.isAdmin(ctx);
    const lang = await getLang(ctx.from.id);
    const d = STRINGS[lang] || STRINGS['en'];

    let rows;
    if (isAdm) {
      rows = await db.query(`SELECT k.*, au.username owner_name FROM proxy_keys k LEFT JOIN admin_users au ON k.owner_id=au.id ORDER BY k.id DESC LIMIT 50`);
    } else {
      rows = await db.query(`SELECT k.* FROM proxy_keys k WHERE k.owner_id=? ORDER BY k.id DESC LIMIT 50`, [u ? u.id : 0]);
    }

    if (!rows.length) {
      await render(ctx, `ℹ️ No keys found.`, { ...keysKeyboard(isAdm, d) });
      await ctx.answerCbQuery(); return;
    }

    let msg = `🔑 <b>Keys (${rows.length})</b>\n\n`;
    for (const k of rows) {
      msg += `<code>${esc(k.key_code)}</code>\n`;
      msg += `  📦 ${k.duration_days > 0 ? k.duration_days + 'd' : '∞'} | 👥 ${k.used_count}/${k.max_uids}`;
      if (k.owner_name) msg += ` | 👤 ${esc(k.owner_name)}`;
      msg += '\n';
    }
    await render(ctx, msg, { parse_mode: 'HTML', ...keysKeyboard(isAdm, d) });
    await ctx.answerCbQuery();
  });

  bot.action('key_search', async (ctx) => {
    if (!(await auth.isSeller(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'key_search' });
    await render(ctx, `🔍 Enter the <b>key code</b> to look up:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('key_gen', async (ctx) => {
    if (!(await auth.isSeller(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'key_gen', step: 'count' });
    await render(ctx, `➕ <b>Generate Keys</b>\n\nHow many keys? (1–100)`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('key_block', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'key_block' });
    await render(ctx, `🚫 Enter the <b>key code</b> to block:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('key_delete', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'key_delete' });
    await render(ctx, `🗑 Enter the <b>key code</b> to permanently delete:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('key_delete_own', async (ctx) => {
    if (!(await auth.isSeller(ctx))) { await ctx.answerCbQuery('⛔ No access'); return; }
    pending.set(ctx.from.id, { action: 'key_delete_own' });
    await render(ctx, `🗑 <b>Delete My Key</b>\n\nEnter the <b>key code</b> to delete (only your own keys):`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.on('text', async (ctx, next) => {
    const state = pending.get(ctx.from.id);
    if (!state) return next();
    if (!(await auth.isSeller(ctx))) return next();

    const text = ctx.message.text.trim();
    const isAdm = await auth.isAdmin(ctx);

    if (state.action === 'key_search') {
      pending.delete(ctx.from.id);
      const code = text.toUpperCase();
      const k = await db.queryOne(`SELECT k.*, au.username owner_name FROM proxy_keys k LEFT JOIN admin_users au ON k.owner_id=au.id WHERE k.key_code=?`, [code]);
      if (!k) {
        await ctx.reply(`❌ Key <code>${esc(code)}</code> not found.`, { parse_mode: 'HTML', ...keysKeyboard(isAdm) });
        return;
      }
      const uids = await db.query('SELECT ip, expires_at, status FROM proxy_uids WHERE key_id=?', [k.id]);
      let msg = `🔑 <b>Key: <code>${esc(k.key_code)}</code></b>\n\n📦 Duration: ${k.duration_days > 0 ? k.duration_days + ' days' : 'Unlimited'}\n👥 Slots: ${k.used_count}/${k.max_uids}\n👤 Owner: ${esc(k.owner_name || k.created_by || '—')}\n\n`;
      if (uids.length) {
        msg += `<b>Registered IPs:</b>\n`;
        for (const u of uids) {
          const now = Math.floor(Date.now() / 1000);
          const st = u.status === 'blocked' ? '🚫' : (u.expires_at && u.expires_at < now ? '⏰' : '🟢');
          msg += `${st} <code>${esc(u.ip)}</code> — ${fmtDate(new Date(u.expires_at * 1000).toISOString())}\n`;
        }
      }
      await ctx.reply(msg, { parse_mode: 'HTML', ...keysKeyboard(isAdm) });
      return;
    }

    if (state.action === 'key_gen') {
      if (state.step === 'count') {
        const n = parseInt(text);
        if (isNaN(n) || n < 1 || n > 100) {
          await ctx.reply('❌ Enter a number between 1 and 100:');
          return;
        }
        state.count = n; state.step = 'days';
        pending.set(ctx.from.id, state);
        await ctx.reply(`📅 Duration in days? (e.g. 30 for 1 month):`);
        return;
      }
      if (state.step === 'days') {
        const d = parseInt(text);
        if (isNaN(d) || d < 1) { await ctx.reply('❌ Enter a valid number of days (min 1):'); return; }
        state.days = d; state.step = 'max_ips';
        pending.set(ctx.from.id, state);
        await ctx.reply(`👥 Max IPs per key? (e.g. 1, 5, or 0 for unlimited):`);
        return;
      }
      if (state.step === 'max_ips') {
        pending.delete(ctx.from.id);
        const maxIps = Math.max(0, parseInt(text) || 1);
        const u = await auth.getUser(ctx);
        const ownerId = u ? u.id : null;

        // Check seller max_keys limit
        if (u && u.max_keys > 0) {
          const existing = (await db.queryOne('SELECT COUNT(*) c FROM proxy_keys WHERE owner_id=?', [u.id])).c;
          if (existing + state.count > u.max_keys) {
            await ctx.reply(`❌ Limit exceeded. You can only create ${u.max_keys - existing} more key(s) (limit: ${u.max_keys}).`, { parse_mode: 'HTML', ...keysKeyboard(isAdm) });
            return;
          }
        }

        const codes = [];
        for (let i = 0; i < state.count; i++) {
          let code;
          for (let t = 0; t < 10; t++) {
            code = genKeyCode();
            const exists = await db.queryOne('SELECT id FROM proxy_keys WHERE key_code=?', [code]);
            if (!exists) break;
          }
          await db.exec('INSERT INTO proxy_keys (key_code, owner_id, duration_days, max_uids, created_by) VALUES (?,?,?,?,?)',
            [code, ownerId, state.days, maxIps || 1, u ? u.username : 'bot']
          );
          codes.push(code);
        }

        let msg = `✅ <b>Generated ${codes.length} key(s)</b>\n📅 Duration: ${state.days} days | 👥 Max IPs: ${maxIps || 1}\n\n`;
        msg += codes.map(c => `<code>${c}</code>`).join('\n');
        await ctx.reply(msg, { parse_mode: 'HTML', ...keysKeyboard(isAdm) });
        return;
      }
    }

    if (state.action === 'key_block') {
      pending.delete(ctx.from.id);
      if (!isAdm) return next();
      const code = text.toUpperCase();
      const k = await db.queryOne('SELECT id FROM proxy_keys WHERE key_code=?', [code]);
      if (!k) { await ctx.reply(`❌ Key <code>${esc(code)}</code> not found.`, { parse_mode: 'HTML', ...keysKeyboard(isAdm) }); return; }
      await db.exec(`UPDATE proxy_uids SET status='blocked' WHERE key_id=?`, [k.id]);
      await ctx.reply(`🚫 All IPs on key <code>${esc(code)}</code> blocked.`, { parse_mode: 'HTML', ...keysKeyboard(isAdm) });
      return;
    }

    if (state.action === 'key_delete') {
      pending.delete(ctx.from.id);
      if (!isAdm) return next();
      const code = text.toUpperCase();
      const k = await db.queryOne('SELECT id FROM proxy_keys WHERE key_code=?', [code]);
      if (!k) { await ctx.reply(`❌ Key <code>${esc(code)}</code> not found.`, { parse_mode: 'HTML', ...keysKeyboard(isAdm) }); return; }
      await db.exec('DELETE FROM proxy_uids WHERE key_id=?', [k.id]);
      await db.exec('DELETE FROM proxy_keys WHERE id=?', [k.id]);
      await ctx.reply(`✅ Key <code>${esc(code)}</code> and all its IPs deleted.`, { parse_mode: 'HTML', ...keysKeyboard(isAdm) });
      return;
    }

    if (state.action === 'key_delete_own') {
      pending.delete(ctx.from.id);
      const code = text.toUpperCase();
      const u = await auth.getUser(ctx);
      if (!u) {
        await ctx.reply('❌ You are not linked. Use /link first.', { parse_mode: 'HTML', ...keysKeyboard(isAdm) });
        return;
      }
      const k = await db.queryOne('SELECT * FROM proxy_keys WHERE key_code=? AND owner_id=?', [code, u.id]);
      if (!k) {
        await ctx.reply(`❌ Key <code>${esc(code)}</code> not found or does not belong to you.`, { parse_mode: 'HTML', ...keysKeyboard(isAdm) });
        return;
      }
      await db.exec('DELETE FROM proxy_uids WHERE key_id=?', [k.id]);
      await db.exec('DELETE FROM proxy_keys WHERE id=?', [k.id]);
      await ctx.reply(`✅ Key <code>${esc(code)}</code> deleted successfully.`, { parse_mode: 'HTML', ...keysKeyboard(isAdm) });
      return;
    }

    return next();
  });
}

module.exports = { register };
