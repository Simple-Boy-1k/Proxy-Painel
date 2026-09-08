// panels/sellers.js — Seller Management
const { Markup } = require('telegraf');
const db = require('../services/db');
const auth = require('../services/auth');
const { render, esc } = require('../utils/render');
const { pe } = require('../utils/emoji');
const { getLang, STRINGS } = require('../services/lang');

function sellersMainKeyboard(isOwner) {
  const rows = [];
  if (isOwner) {
    rows.push([Markup.button.callback('👥 All Sellers', 'sel_tab_sellers'), Markup.button.callback('🛡 All Admins', 'sel_tab_admins')]);
    rows.push([Markup.button.callback('➕ Add Seller', 'sel_add'), Markup.button.callback('➕ Add Admin', 'sel_add_admin')]);
    rows.push([Markup.button.callback('📊 Stats', 'sel_stats')]);
  } else {
    rows.push([Markup.button.callback('👥 My Sellers', 'sel_tab_my_sellers')]);
    rows.push([Markup.button.callback('➕ Add Seller', 'sel_add')]);
  }
  rows.push([Markup.button.callback('🔗 Link Telegram', 'sel_link_tg')]);
  rows.push([Markup.button.callback('🔙 Main Menu', 'nav_main_menu')]);
  return Markup.inlineKeyboard(rows);
}

function sellerDetailKeyboard(sellerId, canDelete) {
  const rows = [
    [Markup.button.callback('🔑 View Keys', `sel_user_keys:${sellerId}`), Markup.button.callback('🗑 Delete Unused Keys', `sel_delunused:${sellerId}`)],
  ];
  if (canDelete) {
    rows.push([Markup.button.callback('🚫 Disable', `sel_disable:${sellerId}`), Markup.button.callback('✅ Enable', `sel_enable:${sellerId}`)]);
    rows.push([Markup.button.callback('❌ Delete Seller', `sel_delete_user:${sellerId}`)]);
  }
  rows.push([Markup.button.callback('🔙 Back', 'nav_sellers_panel')]);
  return Markup.inlineKeyboard(rows);
}

const pending = new Map();

async function getCallerTgId(ctx) { return String(ctx.from.id); }
async function canManage(ctx, targetUser) {
  if (await auth.isOwner(ctx)) return true;
  const myTg = await getCallerTgId(ctx);
  return targetUser.created_by_tg === myTg;
}

function register(bot) {
  bot.action('nav_sellers_panel', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔ No access'); return; }
    const isOwn = await auth.isOwner(ctx);
    await render(ctx, `${pe('person','👤')} <b>User Management</b>\n\n${isOwn ? 'Manage sellers and admins.' : 'Manage your sellers below.'}`, { parse_mode: 'HTML', ...sellersMainKeyboard(isOwn) });
    await ctx.answerCbQuery();
  });

  bot.action('sel_tab_sellers', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔ Owner only'); return; }
    const rows = await db.query(`SELECT id, username, status, created_by_tg FROM admin_users WHERE role='seller' ORDER BY id DESC LIMIT 50`);
    if (!rows.length) { await render(ctx, 'ℹ️ No sellers yet.', { ...sellersMainKeyboard(true) }); await ctx.answerCbQuery(); return; }
    const btns = rows.map(u => [Markup.button.callback(`${u.status === 'active' ? '🟢' : '🔴'} ${u.username}`, `sel_view_user:${u.id}`)]);
    btns.push([Markup.button.callback('🔙 Back', 'nav_sellers_panel')]);
    await ctx.editMessageText(`👥 <b>All Sellers (${rows.length})</b>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(btns) });
    await ctx.answerCbQuery();
  });

  bot.action('sel_tab_admins', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔ Owner only'); return; }
    const rows = await db.query(`SELECT id, username, status, role FROM admin_users WHERE role IN ('admin','owner') AND bot_id='main' ORDER BY id DESC LIMIT 30`);
    if (!rows.length) { await render(ctx, 'ℹ️ No admins yet.', { ...sellersMainKeyboard(true) }); await ctx.answerCbQuery(); return; }
    const btns = rows.map(u => [Markup.button.callback(`${u.status === 'active' ? '🟢' : '🔴'} ${u.username} [${u.role}]`, `sel_view_admin:${u.id}`)]);
    btns.push([Markup.button.callback('🔙 Back', 'nav_sellers_panel')]);
    await ctx.editMessageText(`🛡 <b>All Admins (${rows.length})</b>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(btns) });
    await ctx.answerCbQuery();
  });

  bot.action(/^sel_view_admin:(\d+)$/, async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔ Owner only'); return; }
    const adminId = parseInt(ctx.match[1]);
    const u = await db.queryOne(`SELECT * FROM admin_users WHERE id=? AND bot_id='main'`, [adminId]);
    if (!u) { await ctx.answerCbQuery('❌ Admin not found'); return; }
    const tgMatch = (u.note || '').match(/tg:(\d+)/);
    let msg = `🛡 <b>${esc(u.username)}</b>\nRole: <b>${u.role}</b>  Status: ${u.status === 'active' ? '🟢 Active' : '🔴 Disabled'}\n`;
    if (tgMatch) msg += `🔗 Telegram: <code>${tgMatch[1]}</code>\n`;
    await render(ctx, msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('🚫 Disable', `sel_disable:${adminId}`), Markup.button.callback('✅ Enable', `sel_enable:${adminId}`)],
      [Markup.button.callback('❌ Delete Admin', `sel_delete_admin:${adminId}`)],
      [Markup.button.callback('🔙 Back', 'sel_tab_admins')],
    ]) });
    await ctx.answerCbQuery();
  });

  bot.action(/^sel_delete_admin:(\d+)$/, async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔ Owner only'); return; }
    const adminId = parseInt(ctx.match[1]);
    const u = await db.queryOne(`SELECT * FROM admin_users WHERE id=? AND bot_id='main'`, [adminId]);
    if (!u) { await ctx.answerCbQuery('❌ Not found'); return; }
    await render(ctx, `⚠️ <b>Delete admin <code>${esc(u.username)}</code>?</b>\n\nCannot be undone!`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('❌ Yes, Delete', `sel_delete_admin_ok:${adminId}`), Markup.button.callback('🔙 Cancel', `sel_view_admin:${adminId}`)],
    ]) });
    await ctx.answerCbQuery();
  });

  bot.action(/^sel_delete_admin_ok:(\d+)$/, async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔ Owner only'); return; }
    const adminId = parseInt(ctx.match[1]);
    const u = await db.queryOne(`SELECT * FROM admin_users WHERE id=? AND bot_id='main'`, [adminId]);
    if (!u) { await ctx.answerCbQuery('❌ Not found'); return; }
    await db.exec('DELETE FROM admin_users WHERE id=?', [adminId]);
    await render(ctx, `🗑 Admin <b>${esc(u.username)}</b> deleted.`, { parse_mode: 'HTML', ...sellersMainKeyboard(true) });
    await ctx.answerCbQuery('✅ Deleted');
  });

  bot.action('sel_tab_my_sellers', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    if (await auth.isOwner(ctx)) {
      return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'sel_tab_sellers' } });
    }
    const myTg = await getCallerTgId(ctx);
    const rows = await db.query(`SELECT id, username, status FROM admin_users WHERE role='seller' AND created_by_tg=? ORDER BY id DESC LIMIT 50`, [myTg]);
    if (!rows.length) {
      await render(ctx, 'ℹ️ You haven\'t created any sellers yet.', { parse_mode: 'HTML', ...sellersMainKeyboard(false) });
      await ctx.answerCbQuery(); return;
    }
    const btns = rows.map(u => [Markup.button.callback(`${u.status === 'active' ? '🟢' : '🔴'} ${u.username}`, `sel_view_user:${u.id}`)]);
    btns.push([Markup.button.callback('🔙 Back', 'nav_sellers_panel')]);
    await ctx.editMessageText(`👥 <b>My Sellers (${rows.length})</b>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(btns) });
    await ctx.answerCbQuery();
  });

  bot.action(/^sel_view_user:(\d+)$/, async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const userId = parseInt(ctx.match[1]);
    const u = await db.queryOne('SELECT * FROM admin_users WHERE id=?', [userId]);
    if (!u) { await ctx.answerCbQuery('❌ User not found'); return; }
    if (!(await auth.isOwner(ctx)) && u.role !== 'seller') { await ctx.answerCbQuery('⛔ No access'); return; }
    if (!(await auth.isOwner(ctx)) && u.created_by_tg !== await getCallerTgId(ctx)) { await ctx.answerCbQuery('⛔ Not your seller'); return; }

    const totalKeys = (await db.queryOne('SELECT COUNT(*) c FROM proxy_keys WHERE owner_id=?', [userId])).c;
    const unusedKeys = (await db.queryOne('SELECT COUNT(*) c FROM proxy_keys WHERE owner_id=? AND used_count=0', [userId])).c;
    const tgMatch = (u.note || '').match(/tg:(\d+)/);
    const manage = await canManage(ctx, u);

    let msg = `👤 <b>${esc(u.username)}</b>\nRole: <b>${u.role}</b>  Status: ${u.status === 'active' ? '🟢 Active' : '🔴 Disabled'}\n`;
    msg += `Keys: ${totalKeys} total  |  ${unusedKeys} unused\nMax keys: ${u.max_keys || '∞'}\n`;
    if (tgMatch) msg += `🔗 Telegram: <code>${tgMatch[1]}</code>\n`;
    await render(ctx, msg, { parse_mode: 'HTML', ...sellerDetailKeyboard(userId, manage) });
    await ctx.answerCbQuery();
  });

  bot.action(/^sel_user_keys:(\d+)$/, async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const userId = parseInt(ctx.match[1]);
    const u = await db.queryOne('SELECT username, created_by_tg FROM admin_users WHERE id=?', [userId]);
    if (!u) { await ctx.answerCbQuery('❌ Not found'); return; }
    if (!(await auth.isOwner(ctx)) && u.created_by_tg !== await getCallerTgId(ctx)) { await ctx.answerCbQuery('⛔ Not your seller'); return; }

    const keys = await db.query(`SELECT k.key_code, k.used_count, k.max_uids, k.duration_days FROM proxy_keys k WHERE k.owner_id=? ORDER BY k.id DESC LIMIT 50`, [userId]);
    if (!keys.length) { await render(ctx, `ℹ️ <b>${esc(u.username)}</b> has no keys.`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', `sel_view_user:${userId}`)]]) }); await ctx.answerCbQuery(); return; }
    let msg = `🔑 <b>${esc(u.username)}'s Keys (${keys.length})</b>\n\n`;
    for (const k of keys) {
      msg += `<code>${esc(k.key_code)}</code> — ${k.used_count}/${k.max_uids} slots, ${k.duration_days}d\n`;
    }
    await render(ctx, msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('🗑 Delete ALL Unused', `sel_delunused:${userId}`)],
      [Markup.button.callback('🔙 Back', `sel_view_user:${userId}`)],
    ]) });
    await ctx.answerCbQuery();
  });

  bot.action(/^sel_delunused:(\d+)$/, async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const ownerId = parseInt(ctx.match[1]);
    const u = await db.queryOne('SELECT username, created_by_tg FROM admin_users WHERE id=?', [ownerId]);
    if (!u) { await ctx.answerCbQuery('❌ Not found'); return; }
    if (!(await auth.isOwner(ctx)) && u.created_by_tg !== await getCallerTgId(ctx)) { await ctx.answerCbQuery('⛔ Not your seller'); return; }
    const count = (await db.queryOne('SELECT COUNT(*) c FROM proxy_keys WHERE owner_id=? AND used_count=0', [ownerId])).c;
    if (!count) { await ctx.answerCbQuery('ℹ️ No unused keys.'); return; }
    await render(ctx, `⚠️ Delete <b>${count}</b> unused key(s) of <code>${esc(u.username)}</code>?`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('🗑 Yes, Delete', `sel_delunused_ok:${ownerId}`), Markup.button.callback('❌ Cancel', `sel_view_user:${ownerId}`)],
    ]) });
    await ctx.answerCbQuery();
  });

  bot.action(/^sel_delunused_ok:(\d+)$/, async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const ownerId = parseInt(ctx.match[1]);
    const u = await db.queryOne('SELECT username, created_by_tg FROM admin_users WHERE id=?', [ownerId]);
    if (!u) { await ctx.answerCbQuery('❌'); return; }
    if (!(await auth.isOwner(ctx)) && u.created_by_tg !== await getCallerTgId(ctx)) { await ctx.answerCbQuery('⛔ Not your seller'); return; }
    const r = await db.exec('DELETE FROM proxy_keys WHERE owner_id=? AND used_count=0', [ownerId]);
    await render(ctx, `🗑 Deleted <b>${r.affectedRows}</b> unused keys.`, { parse_mode: 'HTML', ...sellersMainKeyboard(await auth.isOwner(ctx)) });
    await ctx.answerCbQuery('✅ Done');
  });

  bot.action(/^sel_disable:(\d+)$/, async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const userId = parseInt(ctx.match[1]);
    const u = await db.queryOne('SELECT * FROM admin_users WHERE id=?', [userId]);
    if (!u || !(await canManage(ctx, u))) { await ctx.answerCbQuery('⛔ No permission'); return; }
    await db.exec(`UPDATE admin_users SET status='disabled' WHERE id=?`, [userId]);
    await ctx.answerCbQuery('🔴 Disabled');
    await ctx.editMessageText(`✅ User <b>${esc(u.username)}</b> disabled.`, { parse_mode: 'HTML', ...sellersMainKeyboard(await auth.isOwner(ctx)) });
  });

  bot.action(/^sel_enable:(\d+)$/, async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const userId = parseInt(ctx.match[1]);
    const u = await db.queryOne('SELECT * FROM admin_users WHERE id=?', [userId]);
    if (!u || !(await canManage(ctx, u))) { await ctx.answerCbQuery('⛔ No permission'); return; }
    await db.exec(`UPDATE admin_users SET status='active' WHERE id=?`, [userId]);
    await ctx.answerCbQuery('🟢 Enabled');
    await ctx.editMessageText(`✅ User <b>${esc(u.username)}</b> enabled.`, { parse_mode: 'HTML', ...sellersMainKeyboard(await auth.isOwner(ctx)) });
  });

  bot.action(/^sel_delete_user:(\d+)$/, async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const userId = parseInt(ctx.match[1]);
    const u = await db.queryOne('SELECT * FROM admin_users WHERE id=?', [userId]);
    if (!u || !(await canManage(ctx, u))) { await ctx.answerCbQuery('⛔ No permission'); return; }
    await render(ctx, `⚠️ <b>Delete seller <code>${esc(u.username)}</code>?</b>\n\nAll keys will be deleted.`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('❌ Yes, Delete', `sel_delete_ok:${userId}`), Markup.button.callback('🔙 Cancel', `sel_view_user:${userId}`)],
    ]) });
    await ctx.answerCbQuery();
  });

  bot.action(/^sel_delete_ok:(\d+)$/, async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const userId = parseInt(ctx.match[1]);
    const u = await db.queryOne('SELECT * FROM admin_users WHERE id=?', [userId]);
    if (!u || !(await canManage(ctx, u))) { await ctx.answerCbQuery('⛔ No permission'); return; }
    const keyIds = await db.query('SELECT id FROM proxy_keys WHERE owner_id=?', [userId]);
    for (const k of keyIds) await db.exec('DELETE FROM proxy_uids WHERE key_id=?', [k.id]);
    await db.exec('DELETE FROM proxy_keys WHERE owner_id=?', [userId]);
    await db.exec('DELETE FROM admin_users WHERE id=?', [userId]);
    await render(ctx, `🗑 Seller <b>${esc(u.username)}</b> and all keys deleted.`, { parse_mode: 'HTML', ...sellersMainKeyboard(await auth.isOwner(ctx)) });
    await ctx.answerCbQuery('✅ Deleted');
  });

  bot.action('sel_stats', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔ Owner only'); return; }
    const sellers = (await db.queryOne(`SELECT COUNT(*) c FROM admin_users WHERE role='seller' AND bot_id='main'`)).c;
    const admins = (await db.queryOne(`SELECT COUNT(*) c FROM admin_users WHERE role='admin' AND bot_id='main'`)).c;
    const active = (await db.queryOne(`SELECT COUNT(*) c FROM admin_users WHERE status='active' AND bot_id='main'`)).c;
    await render(ctx, `📊 <b>Stats</b>\n\n👥 Sellers: ${sellers}\n🛡 Admins: ${admins}\n✅ Active: ${active}`, { parse_mode: 'HTML', ...sellersMainKeyboard(true) });
    await ctx.answerCbQuery();
  });

  bot.action('sel_add', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'sel_add', step: 'username', role: 'seller' });
    await render(ctx, `➕ <b>Add Seller</b>\n\nEnter <b>username</b>:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('sel_add_admin', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔ Owner only'); return; }
    pending.set(ctx.from.id, { action: 'sel_add', step: 'username', role: 'admin' });
    await render(ctx, `➕ <b>Add Admin</b>\n\nEnter <b>username</b>:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('sel_link_tg', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    pending.set(ctx.from.id, { action: 'sel_link_tg', step: 'username' });
    await render(ctx, `🔗 <b>Link Telegram</b>\n\nEnter the <b>username</b> to link:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.on('text', async (ctx, next) => {
    const state = pending.get(ctx.from.id);
    if (!state) return next();
    if (!(await auth.isAdmin(ctx))) return next();
    const isOwn = await auth.isOwner(ctx);
    const text = ctx.message.text.trim();

    if (state.action === 'sel_add') {
      if (state.step === 'username') {
        const uname = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!uname) { await ctx.reply('❌ Letters, numbers, underscore only.'); return; }
        if (await db.queryOne('SELECT id FROM admin_users WHERE username=?', [uname])) {
          await ctx.reply(`❌ Username <code>${esc(uname)}</code> already exists.`, { parse_mode: 'HTML' }); return;
        }
        state.username = uname; state.step = 'password';
        pending.set(ctx.from.id, state);
        await ctx.reply(`Username: <code>${esc(uname)}</code>\n\nEnter <b>password</b>:`, { parse_mode: 'HTML' });
        return;
      }
      if (state.step === 'password') {
        state.password = text; state.step = 'max_keys';
        pending.set(ctx.from.id, state);
        await ctx.reply('Max keys? (0 = unlimited):');
        return;
      }
      if (state.step === 'max_keys') {
        state.maxKeys = Math.max(0, parseInt(text) || 0);
        state.step = 'days';
        pending.set(ctx.from.id, state);
        await ctx.reply('Validity in days? (0 = never expires):');
        return;
      }
      if (state.step === 'days') {
        state.days = Math.max(0, parseInt(text) || 0);
        state.step = 'tg_username';
        pending.set(ctx.from.id, state);
        await ctx.reply(`📅 Validity: ${state.days > 0 ? state.days + ' days' : 'Never expires'}\n\n📲 Enter their <b>Telegram username</b> (e.g. @username) or skip:`, { parse_mode: 'HTML' });
        return;
      }
      if (state.step === 'tg_username') {
        pending.delete(ctx.from.id);
        const days = state.days;
        const expiresAt = days > 0 ? new Date(Date.now() + days * 86400000).toISOString().slice(0,19).replace('T',' ') : null;
        const myTg = String(ctx.from.id);
        const botId = 'main';

        const insertRes = await db.exec(`INSERT INTO admin_users (username, password_hash, role, status, max_keys, expires_at, created_by_tg, bot_id) VALUES (?,?,?,?,?,?,?,?)`,
          [state.username, `$bot$${state.password}`, state.role, 'active', state.maxKeys, expiresAt, myTg, botId]
        );
        const newUserId = insertRes.insertId;

        let tgNote = '';
        const rawTg = text.trim().replace(/^@/, '').toLowerCase();
        if (rawTg && rawTg !== 'skip') {
          const botUser = await db.queryOne(`SELECT telegram_id FROM bot_users WHERE LOWER(username)=? AND bot_id='main' ORDER BY last_seen DESC LIMIT 1`, [rawTg]);
          if (botUser) {
            await db.exec(`UPDATE admin_users SET note=? WHERE id=?`, [`tg:${botUser.telegram_id}`, newUserId]);
            tgNote = `\n🔗 Telegram auto-linked: <code>${botUser.telegram_id}</code> (@${rawTg})`;
            try {
              await ctx.telegram.sendMessage(botUser.telegram_id, `🎉 <b>Account created!</b>\n\n👤 Username: <code>${esc(state.username)}</code>\n🔐 Role: ${state.role}\n🔑 Max keys: ${state.maxKeys || '∞'}\n\nTap /start to begin!`, { parse_mode: 'HTML' });
            } catch (_) { tgNote += ' <i>(notification failed)</i>'; }
          } else {
            await db.exec(`UPDATE admin_users SET note=? WHERE id=?`, [`tguser:${rawTg}`, newUserId]);
            tgNote = `\n⚠️ @${rawTg} not found in bot users.\n<i>They can use /link to connect.</i>`;
          }
        }

        await ctx.reply(`✅ <b>${state.role === 'admin' ? 'Admin' : 'Seller'} Added!</b>\n\n👤 Username: <code>${esc(state.username)}</code>\n🔑 Max keys: ${state.maxKeys || '∞'}\n📅 Expires: ${expiresAt || 'Never'}` + (tgNote || `\n\n<i>No Telegram linked. Use /link to connect.</i>`), { parse_mode: 'HTML', ...sellersMainKeyboard(isOwn) });
        return;
      }
    }

    if (state.action === 'sel_link_tg') {
      if (state.step === 'username') {
        const uname = text.toLowerCase().replace(/^@/, '');
        const u = await db.queryOne('SELECT * FROM admin_users WHERE LOWER(username)=?', [uname]);
        if (!u) { await ctx.reply(`❌ <code>${esc(uname)}</code> not found.`, { parse_mode: 'HTML' }); return; }
        if (!isOwn && u.created_by_tg !== String(ctx.from.id)) { await ctx.reply('⛔ That is not your seller.'); return; }
        state.userId = u.id; state.step = 'tg_id';
        pending.set(ctx.from.id, state);
        await ctx.reply(`Found: <code>${esc(u.username)}</code>\n\nEnter their <b>Telegram ID</b> or <b>@username</b>:`, { parse_mode: 'HTML' });
        return;
      }
      if (state.step === 'tg_id') {
        pending.delete(ctx.from.id);
        let tgId = '';
        const raw = text.trim();
        if (/^\d+$/.test(raw)) { tgId = raw; } else {
          const tgUname = raw.replace(/^@/, '').toLowerCase();
          const botUser = await db.queryOne(`SELECT telegram_id FROM bot_users WHERE LOWER(username)=? AND bot_id='main' ORDER BY last_seen DESC LIMIT 1`, [tgUname]);
          if (botUser) { tgId = String(botUser.telegram_id); } else {
            await ctx.reply(`❌ @${tgUname} hasn't started the bot.\n\nEnter their numeric Telegram ID directly:`, { parse_mode: 'HTML' });
            state.step = 'tg_id';
            pending.set(ctx.from.id, state);
            return;
          }
        }
        if (!tgId) { await ctx.reply('❌ Invalid Telegram ID.'); return; }
        await auth.linkTelegram(state.userId, tgId);
        try {
          const u = await db.queryOne('SELECT username, role FROM admin_users WHERE id=?', [state.userId]);
          if (u) { await ctx.telegram.sendMessage(tgId, `🔗 <b>Account Linked!</b>\n\nYour Telegram has been linked to <code>${esc(u.username)}</code> (${u.role}).\nTap /start to access!`, { parse_mode: 'HTML' }); }
        } catch (_) {}
        await ctx.reply(`✅ Telegram <code>${tgId}</code> linked.`, { parse_mode: 'HTML', ...sellersMainKeyboard(isOwn) });
        return;
      }
    }

    return next();
  });
}

module.exports = { register };
