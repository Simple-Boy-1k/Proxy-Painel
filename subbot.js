// subbot.js — Sub Bot entry point (v4)
// ─── Architecture ─────────────────────────────────────────────────────────────
//  • Shares the same MySQL DB as the main bot
//  • Has its own BOT_TOKEN  (SUBBOT_TOKEN in .env)
//  • Has its own SUPER_ADMIN (SUBBOT_ADMIN_ID in .env)
//  • bot_id column = 'subbot' — isolates this bot's users from main bot
//  • Sub bot owner/admins:  NO access to proxy/VPS/port management
//  • Sub bot owner:         Can add admins, see all sellers under this bot
//  • Sub bot admins:        Can add sellers, manage ONLY their own sellers
//  • Sub bot sellers:       Keys/UIDs panel only
//  • Main bot users:        Cannot log in here (different bot_id)
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const db       = require('./services/db');
const auth     = require('./services/auth');
const { getLang, STRINGS } = require('./services/lang');
const { pe, autoPremium } = require('./utils/emoji');
const { render, esc, fmtDate } = require('./utils/render');
const schema   = require('./services/schema');

// ── Config ────────────────────────────────────────────────────────────────────
const SUB_TOKEN    = process.env.SUBBOT_TOKEN    || '';
const SUB_ADMIN_ID = String(process.env.SUBBOT_ADMIN_ID || '');
const BOT_ID       = process.env.SUBBOT_BOT_ID   || 'subbot';

if (!SUB_TOKEN) {
  console.error('❌  SUBBOT_TOKEN not set');
  process.exit(1);
}
if (!SUB_ADMIN_ID) {
  console.warn('⚠️  SUBBOT_ADMIN_ID not set — no super-admin will be recognised.');
}

const bot = new Telegraf(SUB_TOKEN);

// ─────────────────────────────────────────────────────────────────────────────
// Auth helpers (scoped to this sub bot's bot_id)
// ─────────────────────────────────────────────────────────────────────────────

async function getSubUser(ctx) {
  const tgId  = String(ctx.from.id);
  const uname = ctx.from.username ? ctx.from.username.toLowerCase().replace(/^@/, '') : null;
  const rows = await db.query(
    `SELECT * FROM admin_users WHERE status='active' AND bot_id=?
     AND (note LIKE ? OR (username IS NOT NULL AND LOWER(username)=?))`,
    [BOT_ID, `%tg:${tgId}%`, uname || '__none__']
  );
  return rows[0] || null;
}

async function isSubOwner(ctx) {
  return String(ctx.from.id) === SUB_ADMIN_ID;
}

async function isSubAdmin(ctx) {
  if (await isSubOwner(ctx)) return true;
  const u = await getSubUser(ctx);
  return !!(u && (u.role === 'admin' || u.role === 'owner'));
}

async function isSubSeller(ctx) {
  if (await isSubAdmin(ctx)) return true;
  const u = await getSubUser(ctx);
  return !!(u && u.role === 'seller');
}

async function getSubCallerTgId(ctx) {
  return String(ctx.from.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

bot.use((ctx, next) => {
  const wrap = (fn) => function (text, extra, ...rest) {
    if (typeof text === 'string' && text.length > 0) {
      const converted = autoPremium(text);
      if (converted !== text) {
        text  = converted;
        extra = { ...(extra || {}), parse_mode: 'HTML' };
      }
    }
    return fn.call(this, text, extra, ...rest);
  };
  if (ctx.reply)               ctx.reply               = wrap(ctx.reply.bind(ctx));
  if (ctx.editMessageText)     ctx.editMessageText      = wrap(ctx.editMessageText.bind(ctx));
  if (ctx.editMessageCaption)  ctx.editMessageCaption   = wrap(ctx.editMessageCaption.bind(ctx));
  if (ctx.sendMessage)         ctx.sendMessage          = wrap(ctx.sendMessage.bind(ctx));
  return next();
});

bot.use(async (ctx, next) => {
  if (ctx.updateType !== 'callback_query') return next();
  let answered = false;
  const orig = ctx.answerCbQuery.bind(ctx);
  ctx.answerCbQuery = async (...a) => { answered = true; return orig(...a); };
  const t = setTimeout(async () => {
    if (!answered) { answered = true; try { await orig(); } catch (_) {} }
  }, 7000);
  try { await next(); } finally {
    clearTimeout(t);
    if (!answered) try { await orig(); } catch (_) {}
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Main menu
// ─────────────────────────────────────────────────────────────────────────────

async function subMainMenu(ctx) {
  const isOwn = await isSubOwner(ctx);
  const isAdm = await isSubAdmin(ctx);
  const isSel = await isSubSeller(ctx);
  const lang  = await getLang(ctx.from.id);
  const d     = STRINGS[lang] || STRINGS['en'];
  const rows  = [];

  rows.push([Markup.button.callback(d.user_panel, 'sub_nav_user_panel')]);

  if (isSel) rows.push([
    Markup.button.callback(d.keys_panel, 'nav_keys_panel'),
    Markup.button.callback(d.uids_panel, 'nav_uids_panel'),
  ]);

  if (isAdm) rows.push([Markup.button.callback('👥 Manage Sellers', 'sub_nav_sellers')]);

  if (isOwn) rows.push([Markup.button.callback('👑 Owner Panel', 'sub_nav_owner')]);

  rows.push([Markup.button.callback(d.lang_btn, 'nav_lang_panel')]);
  return Markup.inlineKeyboard(rows);
}

// ── /start ────────────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  const name  = ctx.from.first_name || 'User';
  const tgId  = String(ctx.from.id);
  const u     = await getSubUser(ctx);
  const role  = u ? u.role : (tgId === SUB_ADMIN_ID ? 'owner' : null);
  const lang  = await getLang(tgId);
  const d     = STRINGS[lang] || STRINGS['en'];

  try {
    await db.exec(
      `INSERT INTO bot_users (telegram_id, first_name, username, bot_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         first_name = VALUES(first_name),
         username   = VALUES(username),
         last_seen  = CURRENT_TIMESTAMP`,
      [ctx.from.id, ctx.from.first_name || '', ctx.from.username || '', BOT_ID]
    );
  } catch (_) {}

  let greeting = d.welcome.replace('{name}', esc(name)) + '\n\n';
  if (role) greeting += `🔐 Role: <b>${role}</b>\n`;
  else      greeting += `🆔 Your Telegram ID: <code>${tgId}</code>\n<i>Use /link if you have an account.</i>\n`;
  greeting += d.choose_option;

  const kb = await subMainMenu(ctx);
  await ctx.reply(greeting, { parse_mode: 'HTML', ...kb });
});

// ── Basic commands ──────────────────────────────────────────────────────────

bot.command('myid', async (ctx) => {
  await ctx.reply(
    `🆔 Telegram ID: <code>${ctx.from.id}</code>` +
    (ctx.from.username ? `\n👤 @${ctx.from.username}` : ''),
    { parse_mode: 'HTML' }
  );
});

bot.help(async (ctx) => {
  const isOwn = await isSubOwner(ctx);
  const isAdm = await isSubAdmin(ctx);
  const isSel = await isSubSeller(ctx);
  let msg = `<b>Sub Bot Help</b>\n\n/start — Main menu\n/myid — Your Telegram ID\n/link — Link your account\n/help — This message\n\n`;
  if (isSel)  msg += `<b>Seller:</b> Generate & manage keys, activate IPs\n`;
  if (isAdm)  msg += `<b>Admin:</b> Manage sellers you created\n`;
  if (isOwn)  msg += `<b>Owner:</b> Add admins, view all sellers\n`;
  if (!isSel && !isOwn) msg += `\n⛔ Not linked yet — use /link or ask the admin to link your ID: <code>${ctx.from.id}</code>`;
  await ctx.reply(msg, { parse_mode: 'HTML' });
});

// ── /link ──────────────────────────────────────────────────────────────────

const linkState = new Map();
bot.command('link', async (ctx) => {
  linkState.set(ctx.from.id, true);
  await ctx.reply(
    `🔗 <b>Link Account</b>\n\nEnter your <b>username</b> to link Telegram ID <code>${ctx.from.id}</code>:`,
    { parse_mode: 'HTML' }
  );
});

// ── nav_main_menu ──────────────────────────────────────────────────────────

bot.action('nav_main_menu', async (ctx) => {
  const kb   = await subMainMenu(ctx);
  const lang = await getLang(ctx.from.id);
  const d    = STRINGS[lang] || STRINGS['en'];
  await render(ctx, `👋 ${d.choose_option}`, { parse_mode: 'HTML', ...kb });
  await ctx.answerCbQuery();
});

// ── User panel stub ────────────────────────────────────────────────────────

bot.action('sub_nav_user_panel', async (ctx) => {
  try {
    await db.exec(
      `INSERT INTO bot_users (telegram_id, first_name, username, bot_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         first_name = VALUES(first_name),
         username   = VALUES(username),
         last_seen  = CURRENT_TIMESTAMP`,
      [ctx.from.id, ctx.from.first_name || '', ctx.from.username || '', BOT_ID]
    );
  } catch (_) {}
  ctx.callbackQuery.data = 'nav_user_panel';
  await bot.handleUpdate(ctx.update);
});

// ── Owner Panel ─────────────────────────────────────────────────────────────

function subOwnerKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 Stats',         'subown_stats')],
    [Markup.button.callback('👑 All Admins',    'subown_admins'),
     Markup.button.callback('➕ Add Admin',     'subown_add_admin')],
    [Markup.button.callback('👥 All Sellers',   'subown_sellers')],
    [Markup.button.callback('📢 Broadcast',     'subown_broadcast')],
    [Markup.button.callback('🔙 Main Menu',     'nav_main_menu')],
  ]);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runSubBroadcast(telegram, ownerId, botId, messageText, entities, parseMode) {
  const users = await db.query(`SELECT telegram_id FROM bot_users WHERE bot_id=? ORDER BY id ASC`, [botId]);
  const ids   = users.map(u => String(u.telegram_id));
  let sent = 0, failed = 0;
  for (const id of ids) {
    let opts = {};
    if (parseMode)              opts = { parse_mode: parseMode };
    else if (entities?.length)  opts = { entities };
    let delivered = false;
    for (let attempt = 1; attempt <= 2 && !delivered; attempt++) {
      try {
        await telegram.sendMessage(id, messageText, opts);
        delivered = true; sent++;
      } catch (e) {
        const retry = e?.response?.parameters?.retry_after;
        if (retry && attempt === 1) await sleep((retry + 1) * 1000);
        else { failed++; break; }
      }
    }
    await sleep(35);
  }
  try {
    await telegram.sendMessage(
      ownerId,
      `📢 <b>Broadcast complete!</b>\n\n✅ Sent: ${sent}\n❌ Failed: ${failed}`,
      { parse_mode: 'HTML' }
    );
  } catch (_) {}
}

bot.action('sub_nav_owner', async (ctx) => {
  if (!(await isSubOwner(ctx))) { await ctx.answerCbQuery('⛔ Owner only'); return; }
  const admCount = (await db.queryOne(
    `SELECT COUNT(*) c FROM admin_users WHERE bot_id=? AND role='admin'`, [BOT_ID])).c;
  const selCount = (await db.queryOne(
    `SELECT COUNT(*) c FROM admin_users WHERE bot_id=? AND role='seller'`, [BOT_ID])).c;
  await render(ctx,
    `👑 <b>Owner Panel</b>\n\n👤 Admins: ${admCount}\n🛒 Sellers: ${selCount}\n\n` +
    `<i>You can add admins, view all sellers, and manage users of this sub bot.\nProxy/VPS management is only available in the main bot.</i>`,
    { parse_mode: 'HTML', ...subOwnerKeyboard() }
  );
  await ctx.answerCbQuery();
});

// ── Owner sub-panels ────────────────────────────────────────────────────────

bot.action('subown_stats', async (ctx) => {
  if (!(await isSubOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const admCount  = (await db.queryOne(`SELECT COUNT(*) c FROM admin_users WHERE bot_id=? AND role='admin'`, [BOT_ID])).c;
  const selCount  = (await db.queryOne(`SELECT COUNT(*) c FROM admin_users WHERE bot_id=? AND role='seller'`, [BOT_ID])).c;
  const actCount  = (await db.queryOne(`SELECT COUNT(*) c FROM admin_users WHERE bot_id=? AND status='active'`, [BOT_ID])).c;
  const keyCount  = (await db.queryOne(
    `SELECT COUNT(*) c FROM proxy_keys pk
     INNER JOIN admin_users au ON au.id=pk.owner_id AND au.bot_id=?`, [BOT_ID])).c;
  await render(ctx,
    `📊 <b>Sub Bot Stats</b>\n\n` +
    `👑 Admins: ${admCount}\n👤 Sellers: ${selCount}\n✅ Active accounts: ${actCount}\n🔑 Total keys: ${keyCount}`,
    { parse_mode: 'HTML', ...subOwnerKeyboard() }
  );
  await ctx.answerCbQuery();
});

bot.action('subown_admins', async (ctx) => {
  if (!(await isSubOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const admins = await db.query(
    `SELECT id, username, status, role FROM admin_users WHERE bot_id=? AND role IN ('admin','owner') ORDER BY id DESC LIMIT 30`,
    [BOT_ID]
  );
  if (!admins.length) {
    await render(ctx, 'ℹ️ No admins yet. Tap ➕ Add Admin to create one.',
      { parse_mode: 'HTML', ...subOwnerKeyboard() });
    await ctx.answerCbQuery(); return;
  }
  const btns = admins.map(a => {
    const st = a.status === 'active' ? '🟢' : '🔴';
    return [Markup.button.callback(`${st} ${a.username} [${a.role}]`, `subown_admin_view:${a.id}`)];
  });
  btns.push([Markup.button.callback('🔙 Back', 'sub_nav_owner')]);
  await ctx.editMessageText(
    `👑 <b>Admins (${admins.length})</b>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(btns) }
  );
  await ctx.answerCbQuery();
});

bot.action(/^subown_admin_view:(\d+)$/, async (ctx) => {
  if (!(await isSubOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const userId = parseInt(ctx.match[1]);
  const u = await db.queryOne('SELECT * FROM admin_users WHERE id=? AND bot_id=?', [userId, BOT_ID]);
  if (!u) { await ctx.answerCbQuery('❌ Not found'); return; }
  const selCount = (await db.queryOne(
    `SELECT COUNT(*) c FROM admin_users WHERE bot_id=? AND role='seller' AND created_by_tg=?`,
    [BOT_ID, u.created_by_tg || ''])).c;
  const tgMatch = (u.note || '').match(/tg:(\d+)/);
  let msg = `👤 <b>${esc(u.username)}</b>\n`;
  msg += `Role: <b>${u.role}</b>  Status: ${u.status === 'active' ? '🟢 Active' : '🔴 Disabled'}\n`;
  msg += `Sellers created: ${selCount}\n`;
  if (tgMatch) msg += `🔗 Telegram: <code>${tgMatch[1]}</code>\n`;
  const kb = Markup.inlineKeyboard([
    [u.status === 'active'
      ? Markup.button.callback('🔴 Disable', `subown_admin_disable:${userId}`)
      : Markup.button.callback('🟢 Enable',  `subown_admin_enable:${userId}`)],
    [Markup.button.callback('❌ Delete Admin', `subown_admin_delete:${userId}`)],
    [Markup.button.callback('🔙 Back', 'subown_admins')],
  ]);
  await render(ctx, msg, { parse_mode: 'HTML', ...kb });
  await ctx.answerCbQuery();
});

bot.action(/^subown_admin_disable:(\d+)$/, async (ctx) => {
  if (!(await isSubOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const userId = parseInt(ctx.match[1]);
  await db.exec(`UPDATE admin_users SET status='disabled' WHERE id=? AND bot_id=?`, [userId, BOT_ID]);
  await ctx.answerCbQuery('🔴 Disabled');
  ctx.match[1] = String(userId);
  return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `subown_admin_view:${userId}` } });
});

bot.action(/^subown_admin_enable:(\d+)$/, async (ctx) => {
  if (!(await isSubOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const userId = parseInt(ctx.match[1]);
  await db.exec(`UPDATE admin_users SET status='active' WHERE id=? AND bot_id=?`, [userId, BOT_ID]);
  await ctx.answerCbQuery('🟢 Enabled');
  return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `subown_admin_view:${userId}` } });
});

bot.action(/^subown_admin_delete:(\d+)$/, async (ctx) => {
  if (!(await isSubOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const userId = parseInt(ctx.match[1]);
  const u = await db.queryOne('SELECT username FROM admin_users WHERE id=? AND bot_id=?', [userId, BOT_ID]);
  if (!u) { await ctx.answerCbQuery('❌ Not found'); return; }
  await render(ctx,
    `⚠️ Delete admin <b>${esc(u.username)}</b>?\n\nTheir sellers stay in the DB.`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('❌ Yes, Delete', `subown_admin_delete_ok:${userId}`),
       Markup.button.callback('🔙 Cancel',      `subown_admin_view:${userId}`)],
    ]) }
  );
  await ctx.answerCbQuery();
});

bot.action(/^subown_admin_delete_ok:(\d+)$/, async (ctx) => {
  if (!(await isSubOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const userId = parseInt(ctx.match[1]);
  const u = await db.queryOne('SELECT username FROM admin_users WHERE id=? AND bot_id=?', [userId, BOT_ID]);
  if (!u) { await ctx.answerCbQuery('❌ Not found'); return; }
  await db.exec('DELETE FROM admin_users WHERE id=? AND bot_id=?', [userId, BOT_ID]);
  await render(ctx, `🗑 Admin <b>${esc(u.username)}</b> deleted.`,
    { parse_mode: 'HTML', ...subOwnerKeyboard() });
  await ctx.answerCbQuery('✅ Deleted');
});

bot.action('subown_sellers', async (ctx) => {
  if (!(await isSubOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const sellers = await db.query(
    `SELECT id, username, status, created_by_tg FROM admin_users
     WHERE bot_id=? AND role='seller' ORDER BY id DESC LIMIT 50`,
    [BOT_ID]
  );
  if (!sellers.length) {
    await render(ctx, 'ℹ️ No sellers yet.', { parse_mode: 'HTML', ...subOwnerKeyboard() });
    await ctx.answerCbQuery(); return;
  }
  const btns = sellers.map(s => {
    const st = s.status === 'active' ? '🟢' : '🔴';
    const by = s.created_by_tg ? ` [by ${s.created_by_tg}]` : '';
    return [Markup.button.callback(`${st} ${s.username}${by}`, `sub_sel_view:${s.id}`)];
  });
  btns.push([Markup.button.callback('🔙 Back', 'sub_nav_owner')]);
  await ctx.editMessageText(
    `👥 <b>All Sellers (${sellers.length})</b>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(btns) }
  );
  await ctx.answerCbQuery();
});

// ── Broadcast ─────────────────────────────────────────────────────────────────
const subBroadcastState = new Map();

bot.action('subown_broadcast', async (ctx) => {
  if (!(await isSubOwner(ctx))) { await ctx.answerCbQuery('⛔ Owner only'); return; }
  subBroadcastState.set(ctx.from.id, true);
  const count = (await db.queryOne(`SELECT COUNT(*) c FROM bot_users WHERE bot_id=?`, [BOT_ID])).c;
  await render(ctx,
    `📢 <b>Broadcast</b>\n\n<b>${count}</b> users will receive this message.\n\n` +
    `Send your message now (supports <b>bold</b>, <i>italic</i>, links, etc.):`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'sub_nav_owner')]]) }
  );
  await ctx.answerCbQuery();
});

// Owner add admin flow
const subPending = new Map();
bot.action('subown_add_admin', async (ctx) => {
  if (!(await isSubOwner(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  subPending.set(ctx.from.id, { action: 'subown_addadmin', step: 'username' });
  await render(ctx, '➕ <b>Add Admin</b>\n\nEnter <b>username</b>:', { parse_mode: 'HTML' });
  await ctx.answerCbQuery();
});

// ─────────────────────────────────────────────────────────────────────────────
// Seller Management (admin-scoped: admins see own sellers; owner sees all)
// ─────────────────────────────────────────────────────────────────────────────

function subSellersKeyboard(isOwn) {
  const rows = [];
  if (isOwn) {
    rows.push([Markup.button.callback('👥 All Sellers', 'subown_sellers')]);
    rows.push([Markup.button.callback('➕ Add Seller',  'sub_sel_add')]);
  } else {
    rows.push([Markup.button.callback('👥 My Sellers', 'sub_my_sellers')]);
    rows.push([Markup.button.callback('➕ Add Seller',  'sub_sel_add')]);
  }
  rows.push([Markup.button.callback('🔙 Main Menu', 'nav_main_menu')]);
  return Markup.inlineKeyboard(rows);
}

bot.action('sub_nav_sellers', async (ctx) => {
  if (!(await isSubAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const isOwn = await isSubOwner(ctx);
  await render(ctx,
    `👥 <b>Seller Management</b>\n\n${isOwn ? 'Manage all sellers.' : 'Manage your sellers below.'}`,
    { parse_mode: 'HTML', ...subSellersKeyboard(isOwn) }
  );
  await ctx.answerCbQuery();
});

bot.action('sub_my_sellers', async (ctx) => {
  if (!(await isSubAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const myTg = await getSubCallerTgId(ctx);
  const sellers = await db.query(
    `SELECT id, username, status, max_keys FROM admin_users
     WHERE bot_id=? AND role='seller' AND created_by_tg=? ORDER BY id DESC LIMIT 50`,
    [BOT_ID, myTg]
  );
  if (!sellers.length) {
    await render(ctx,
      'ℹ️ You haven\'t created any sellers yet.\n\nTap ➕ Add Seller to create one.',
      { parse_mode: 'HTML', ...subSellersKeyboard(false) });
    await ctx.answerCbQuery(); return;
  }
  const btns = sellers.map(s => {
    const st = s.status === 'active' ? '🟢' : '🔴';
    return [Markup.button.callback(`${st} ${s.username}`, `sub_sel_view:${s.id}`)];
  });
  btns.push([Markup.button.callback('🔙 Back', 'sub_nav_sellers')]);
  await ctx.editMessageText(
    `👥 <b>My Sellers (${sellers.length})</b>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(btns) }
  );
  await ctx.answerCbQuery();
});

bot.action(/^sub_sel_view:(\d+)$/, async (ctx) => {
  if (!(await isSubAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const userId = parseInt(ctx.match[1]);
  const u = await db.queryOne('SELECT * FROM admin_users WHERE id=? AND bot_id=?', [userId, BOT_ID]);
  if (!u) { await ctx.answerCbQuery('❌ Not found'); return; }
  if (!(await isSubOwner(ctx)) && u.created_by_tg !== await getSubCallerTgId(ctx)) {
    await ctx.answerCbQuery('⛔ Not your seller'); return;
  }
  const totalKeys  = (await db.queryOne('SELECT COUNT(*) c FROM proxy_keys WHERE owner_id=?', [userId])).c;
  const unusedKeys = (await db.queryOne('SELECT COUNT(*) c FROM proxy_keys WHERE owner_id=? AND used_count=0', [userId])).c;
  const tgMatch    = (u.note || '').match(/tg:(\d+)/);
  const canManage  = (await isSubOwner(ctx)) || u.created_by_tg === await getSubCallerTgId(ctx);

  let msg = `👤 <b>${esc(u.username)}</b>\n`;
  msg += `Status: ${u.status === 'active' ? '🟢 Active' : '🔴 Disabled'}\n`;
  msg += `Keys: ${totalKeys} total | ${unusedKeys} unused\n`;
  msg += `Max keys: ${u.max_keys || '∞'}\n`;
  if (tgMatch) msg += `🔗 Telegram: <code>${tgMatch[1]}</code>\n`;
  if (u.created_by_tg) msg += `Created by: <code>${u.created_by_tg}</code>\n`;

  const rows = [
    [Markup.button.callback('🔑 View Keys',          `sub_sel_keys:${userId}`),
     Markup.button.callback('🗑 Del Unused Keys',    `sub_sel_delunused:${userId}`)],
  ];
  if (canManage) {
    rows.push([
      Markup.button.callback('🚫 Disable', `sub_sel_disable:${userId}`),
      Markup.button.callback('✅ Enable',  `sub_sel_enable:${userId}`),
    ]);
    rows.push([Markup.button.callback('❌ Delete Seller', `sub_sel_delete:${userId}`)]);
  }
  rows.push([Markup.button.callback('🔙 Back', 'sub_nav_sellers')]);
  await render(ctx, msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  await ctx.answerCbQuery();
});

bot.action(/^sub_sel_keys:(\d+)$/, async (ctx) => {
  if (!(await isSubAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const userId = parseInt(ctx.match[1]);
  const u = await db.queryOne('SELECT username, created_by_tg FROM admin_users WHERE id=? AND bot_id=?', [userId, BOT_ID]);
  if (!u) { await ctx.answerCbQuery('❌ Not found'); return; }
  if (!(await isSubOwner(ctx)) && u.created_by_tg !== await getSubCallerTgId(ctx)) {
    await ctx.answerCbQuery('⛔ Not your seller'); return;
  }
  const now  = Math.floor(Date.now() / 1000);
  const keys = await db.query(
    `SELECT k.key_code, k.used_count, k.max_uids, k.duration_days,
            SUM(CASE WHEN pu.status='active' AND (pu.expires_at=0 OR pu.expires_at>${now}) THEN 1 ELSE 0 END) active_slots
     FROM proxy_keys k LEFT JOIN proxy_uids pu ON pu.key_id=k.id
     WHERE k.owner_id=?
     GROUP BY k.id ORDER BY k.id DESC LIMIT 50`, [userId]);

  if (!keys.length) {
    await render(ctx, `ℹ️ <b>${esc(u.username)}</b> has no keys.`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', `sub_sel_view:${userId}`)]]) });
    await ctx.answerCbQuery(); return;
  }
  const unused = keys.filter(k => k.used_count === 0);
  const used   = keys.filter(k => k.used_count > 0);
  let msg = `🔑 <b>${esc(u.username)}'s Keys (${keys.length})</b>\n\n`;
  if (unused.length) {
    msg += `⬜ <b>Unused (${unused.length})</b>\n`;
    for (const k of unused.slice(0, 15))
      msg += `  <code>${esc(k.key_code)}</code> [${k.duration_days}d]\n`;
    if (unused.length > 15) msg += `  …+${unused.length - 15} more\n`;
    msg += '\n';
  }
  if (used.length) {
    msg += `🟢 <b>Used (${used.length})</b>\n`;
    for (const k of used.slice(0, 20))
      msg += `  <code>${esc(k.key_code)}</code>  🟢${k.active_slots||0} / ${k.max_uids}\n`;
  }
  await render(ctx, msg, { parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🗑 Delete ALL Unused', `sub_sel_delunused:${userId}`)],
      [Markup.button.callback('🔙 Back', `sub_sel_view:${userId}`)],
    ])
  });
  await ctx.answerCbQuery();
});

bot.action(/^sub_sel_delunused:(\d+)$/, async (ctx) => {
  if (!(await isSubAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const ownerId = parseInt(ctx.match[1]);
  const u = await db.queryOne('SELECT username, created_by_tg FROM admin_users WHERE id=? AND bot_id=?', [ownerId, BOT_ID]);
  if (!u) { await ctx.answerCbQuery('❌ Not found'); return; }
  if (!(await isSubOwner(ctx)) && u.created_by_tg !== await getSubCallerTgId(ctx)) {
    await ctx.answerCbQuery('⛔ Not your seller'); return;
  }
  const count = (await db.queryOne('SELECT COUNT(*) c FROM proxy_keys WHERE owner_id=? AND used_count=0', [ownerId])).c;
  if (!count) { await ctx.answerCbQuery('ℹ️ No unused keys.'); return; }
  await render(ctx,
    `⚠️ Delete <b>${count}</b> unused key(s) of <code>${esc(u.username)}</code>?\n\nCannot be undone.`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('🗑 Yes, Delete', `sub_sel_delunused_ok:${ownerId}`),
       Markup.button.callback('❌ Cancel',      `sub_sel_view:${ownerId}`)],
    ]) }
  );
  await ctx.answerCbQuery();
});

bot.action(/^sub_sel_delunused_ok:(\d+)$/, async (ctx) => {
  if (!(await isSubAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const ownerId = parseInt(ctx.match[1]);
  const u = await db.queryOne('SELECT username, created_by_tg FROM admin_users WHERE id=? AND bot_id=?', [ownerId, BOT_ID]);
  if (!u) { await ctx.answerCbQuery('❌'); return; }
  if (!(await isSubOwner(ctx)) && u.created_by_tg !== await getSubCallerTgId(ctx)) {
    await ctx.answerCbQuery('⛔'); return;
  }
  const r = await db.exec('DELETE FROM proxy_keys WHERE owner_id=? AND used_count=0', [ownerId]);
  await render(ctx, `🗑 Deleted <b>${r.affectedRows}</b> unused keys from <code>${esc(u.username)}</code>.`,
    { parse_mode: 'HTML', ...subSellersKeyboard(await isSubOwner(ctx)) });
  await ctx.answerCbQuery('✅ Done');
});

bot.action(/^sub_sel_disable:(\d+)$/, async (ctx) => {
  if (!(await isSubAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const userId = parseInt(ctx.match[1]);
  const u = await db.queryOne('SELECT created_by_tg FROM admin_users WHERE id=? AND bot_id=?', [userId, BOT_ID]);
  if (!u || (!(await isSubOwner(ctx)) && u.created_by_tg !== await getSubCallerTgId(ctx))) {
    await ctx.answerCbQuery('⛔ No permission'); return;
  }
  await db.exec(`UPDATE admin_users SET status='disabled' WHERE id=?`, [userId]);
  await ctx.answerCbQuery('🔴 Disabled');
  return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `sub_sel_view:${userId}` } });
});

bot.action(/^sub_sel_enable:(\d+)$/, async (ctx) => {
  if (!(await isSubAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const userId = parseInt(ctx.match[1]);
  const u = await db.queryOne('SELECT created_by_tg FROM admin_users WHERE id=? AND bot_id=?', [userId, BOT_ID]);
  if (!u || (!(await isSubOwner(ctx)) && u.created_by_tg !== await getSubCallerTgId(ctx))) {
    await ctx.answerCbQuery('⛔ No permission'); return;
  }
  await db.exec(`UPDATE admin_users SET status='active' WHERE id=?`, [userId]);
  await ctx.answerCbQuery('🟢 Enabled');
  return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `sub_sel_view:${userId}` } });
});

bot.action(/^sub_sel_delete:(\d+)$/, async (ctx) => {
  if (!(await isSubAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const userId = parseInt(ctx.match[1]);
  const u = await db.queryOne('SELECT *, created_by_tg FROM admin_users WHERE id=? AND bot_id=?', [userId, BOT_ID]);
  if (!u || (!(await isSubOwner(ctx)) && u.created_by_tg !== await getSubCallerTgId(ctx))) {
    await ctx.answerCbQuery('⛔ No permission'); return;
  }
  await render(ctx,
    `⚠️ <b>Delete seller <code>${esc(u.username)}</code>?</b>\n\nAll their keys will also be deleted. Cannot be undone!`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('❌ Yes, Delete', `sub_sel_delete_ok:${userId}`),
       Markup.button.callback('🔙 Cancel',      `sub_sel_view:${userId}`)],
    ]) }
  );
  await ctx.answerCbQuery();
});

bot.action(/^sub_sel_delete_ok:(\d+)$/, async (ctx) => {
  if (!(await isSubAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  const userId = parseInt(ctx.match[1]);
  const u = await db.queryOne('SELECT *, created_by_tg FROM admin_users WHERE id=? AND bot_id=?', [userId, BOT_ID]);
  if (!u || (!(await isSubOwner(ctx)) && u.created_by_tg !== await getSubCallerTgId(ctx))) {
    await ctx.answerCbQuery('⛔'); return;
  }
  const keyIds = await db.query('SELECT id FROM proxy_keys WHERE owner_id=?', [userId]);
  for (const k of keyIds) await db.exec('DELETE FROM proxy_uids WHERE key_id=?', [k.id]);
  await db.exec('DELETE FROM proxy_keys WHERE owner_id=?', [userId]);
  await db.exec('DELETE FROM admin_users WHERE id=?', [userId]);
  await render(ctx, `🗑 Seller <b>${esc(u.username)}</b> and all keys deleted.`,
    { parse_mode: 'HTML', ...subSellersKeyboard(await isSubOwner(ctx)) });
  await ctx.answerCbQuery('✅ Deleted');
});

// Add Seller action (admin/owner)
bot.action('sub_sel_add', async (ctx) => {
  if (!(await isSubAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
  subPending.set(ctx.from.id, { action: 'sub_add_seller', step: 'username' });
  await render(ctx, '➕ <b>Add Seller</b>\n\nEnter <b>username</b>:', { parse_mode: 'HTML' });
  await ctx.answerCbQuery();
});

// ─────────────────────────────────────────────────────────────────────────────
// Load shared panels (user, keys, uids, language) — NO proxy/owner panels
// ─────────────────────────────────────────────────────────────────────────────
const subbotAuth = {
  isOwner:  isSubOwner,
  isAdmin:  isSubAdmin,
  isSeller: isSubSeller,
  getUser:  getSubUser,
  linkTelegram: require('./services/auth').linkTelegram,
};

const sharedPanels = ['user', 'language'];
for (const p of sharedPanels) {
  try {
    require(`./panels/${p}`).register(bot);
    console.log(`✅ Sub-bot panel loaded: ${p}`);
  } catch (e) {
    console.error(`❌ Panel ${p} failed:`, e.message);
  }
}

for (const p of ['keys', 'uids']) {
  try {
    require(`./panels/${p}`).register(bot, subbotAuth);
    console.log(`✅ Sub-bot panel loaded: ${p} (subbot auth)`);
  } catch (e) {
    console.error(`❌ Panel ${p} failed:`, e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Text handler (multi-step flows + /link)
// ─────────────────────────────────────────────────────────────────────────────

bot.on('text', async (ctx, next) => {
  const uid = ctx.from.id;

  // ── Broadcast capture (owner only) ─────────────────────────────────────────
  if (subBroadcastState.has(uid)) {
    if (!(await isSubOwner(ctx))) { subBroadcastState.delete(uid); return next(); }
    subBroadcastState.delete(uid);
    const text      = ctx.message.text;
    const count     = (await db.queryOne(`SELECT COUNT(*) c FROM bot_users WHERE bot_id=?`, [BOT_ID])).c;
    const hasHtml   = /<(b|i|u|s|code|pre|a|tg-emoji)[\s>]/i.test(text);
    const parseMode = hasHtml ? 'HTML' : null;
    const entities  = hasHtml ? null : (ctx.message.entities || []);
    await ctx.reply(
      `📢 Broadcast started to <b>${count}</b> user(s).\nYou'll be notified when done.`,
      { parse_mode: 'HTML', ...subOwnerKeyboard() }
    );
    runSubBroadcast(ctx.telegram, uid, BOT_ID, text, entities, parseMode)
      .catch(err => console.error('[SubBot] Broadcast error:', err));
    return;
  }

  // ── /link flow ──────────────────────────────────────────────────────────────
  if (linkState.has(uid)) {
    linkState.delete(uid);
    const uname = ctx.message.text.trim().toLowerCase();
    const user  = await db.queryOne(
      'SELECT * FROM admin_users WHERE LOWER(username)=? AND bot_id=?', [uname, BOT_ID]
    );
    if (!user) {
      await ctx.reply(`❌ Username <code>${esc(uname)}</code> not found.`, { parse_mode: 'HTML' });
      return;
    }
    await auth.linkTelegram(user.id, String(uid));
    const kb = await subMainMenu(ctx);
    await ctx.reply(
      `✅ <b>Linked!</b>\n\n👤 Account: <code>${esc(user.username)}</code>\n🔐 Role: <b>${user.role}</b>\n\nYou now have access.`,
      { parse_mode: 'HTML', ...kb }
    );
    return;
  }

  // ── Pending multi-step flows ────────────────────────────────────────────────
  const state = subPending.get(uid);
  if (!state) return next();

  const text = ctx.message.text.trim();
  const isOwn = await isSubOwner(ctx);
  const isAdm = await isSubAdmin(ctx);
  if (!isAdm) { subPending.delete(uid); return next(); }

  // ── Owner: add admin ────────────────────────────────────────────────────────
  if (state.action === 'subown_addadmin') {
    if (!isOwn) { subPending.delete(uid); return next(); }
    if (state.step === 'username') {
      const uname = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (!uname) { await ctx.reply('❌ Letters, numbers, underscore only.'); return; }
      if (await db.queryOne('SELECT id FROM admin_users WHERE username=? AND bot_id=?', [uname, BOT_ID])) {
        await ctx.reply(`❌ Username <code>${esc(uname)}</code> already exists.`, { parse_mode: 'HTML' }); return;
      }
      state.username = uname; state.step = 'tg_username';
      subPending.set(uid, state);
      await ctx.reply(
        `Username: <code>${esc(uname)}</code>\n\n` +
        `📲 Enter their <b>Telegram @username</b> to auto-link,\nor send <b>skip</b>:`,
        { parse_mode: 'HTML' }
      );
      return;
    }
    if (state.step === 'tg_username') {
      subPending.delete(uid);
      const rawTg = text.replace(/^@/, '').toLowerCase();
      let noteVal = '';
      let tgNote  = '';

      if (rawTg && rawTg !== 'skip') {
        const botUser = await db.queryOne(
          `SELECT telegram_id FROM bot_users WHERE LOWER(username)=? ORDER BY last_seen DESC LIMIT 1`, [rawTg]
        );
        if (botUser) {
          noteVal = `tg:${botUser.telegram_id}`;
          tgNote  = `\n🔗 Auto-linked: <code>${botUser.telegram_id}</code> (@${rawTg})`;
          try {
            await ctx.telegram.sendMessage(botUser.telegram_id,
              `🎉 <b>Admin account created!</b>\n👤 Username: <code>${esc(state.username)}</code>\n🔐 Role: Admin\n\nTap /start to access the bot!`,
              { parse_mode: 'HTML' }
            );
          } catch (_) { tgNote += ' <i>(notification failed)</i>'; }
        } else {
          noteVal = `tguser:${rawTg}`;
          tgNote  = `\n⚠️ @${rawTg} hasn't started the bot yet — will auto-link when they do.`;
        }
      }

      await db.exec(
        `INSERT INTO admin_users (username, password_hash, role, status, max_keys, created_by_tg, bot_id, note)
         VALUES (?,?,?,?,?,?,?,?)`,
        [state.username, '$bot$auto', 'admin', 'active', 0, String(uid), BOT_ID, noteVal]
      );
      await ctx.reply(
        `✅ <b>Admin Added!</b>\n\n👤 Username: <code>${esc(state.username)}</code>${tgNote || '\n\n<i>No Telegram linked. They can /link later.</i>'}`,
        { parse_mode: 'HTML', ...subOwnerKeyboard() }
      );
      return;
    }
  }

  // ── Admin/Owner: add seller ─────────────────────────────────────────────────
  if (state.action === 'sub_add_seller') {
    if (state.step === 'username') {
      const uname = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (!uname) { await ctx.reply('❌ Letters, numbers, underscore only.'); return; }
      if (await db.queryOne('SELECT id FROM admin_users WHERE username=? AND bot_id=?', [uname, BOT_ID])) {
        await ctx.reply(`❌ Username <code>${esc(uname)}</code> already exists.`, { parse_mode: 'HTML' }); return;
      }
      state.username = uname; state.step = 'max_keys';
      subPending.set(uid, state);
      await ctx.reply(`Username: <code>${esc(uname)}</code>\n\nMax keys? (0 = unlimited):`, { parse_mode: 'HTML' });
      return;
    }
    if (state.step === 'max_keys') {
      state.maxKeys = Math.max(0, parseInt(text) || 0);
      state.step = 'days';
      subPending.set(uid, state);
      await ctx.reply('Validity in days? (0 = never expires):');
      return;
    }
    if (state.step === 'days') {
      state.days = Math.max(0, parseInt(text) || 0);
      state.step = 'tg_username';
      subPending.set(uid, state);
      await ctx.reply(
        `📅 Validity: ${state.days > 0 ? state.days + ' days' : 'Never expires'}\n\n` +
        `📲 Enter their <b>Telegram @username</b> to auto-link,\nor send <b>skip</b>:`,
        { parse_mode: 'HTML' }
      );
      return;
    }
    if (state.step === 'tg_username') {
      subPending.delete(uid);
      const days      = state.days;
      const expiresAt = days > 0
        ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ')
        : null;
      const rawTg = text.replace(/^@/, '').toLowerCase();
      let noteVal = '';
      let tgNote  = '';

      if (rawTg && rawTg !== 'skip') {
        const botUser = await db.queryOne(
          `SELECT telegram_id FROM bot_users WHERE LOWER(username)=? ORDER BY last_seen DESC LIMIT 1`, [rawTg]
        );
        if (botUser) {
          noteVal = `tg:${botUser.telegram_id}`;
          tgNote  = `\n🔗 Auto-linked: <code>${botUser.telegram_id}</code> (@${rawTg})`;
          try {
            await ctx.telegram.sendMessage(botUser.telegram_id,
              `🎉 <b>Seller account created!</b>\n👤 Username: <code>${esc(state.username)}</code>\n🔐 Role: Seller\n🔑 Max keys: ${state.maxKeys || '∞'}\n📅 Expires: ${expiresAt || 'Never'}\n\nTap /start to access the bot!`,
              { parse_mode: 'HTML' }
            );
          } catch (_) { tgNote += ' <i>(notification failed)</i>'; }
        } else {
          noteVal = `tguser:${rawTg}`;
          tgNote  = `\n⚠️ @${rawTg} hasn't started the bot yet — will auto-link when they do.`;
        }
      }

      await db.exec(
        `INSERT INTO admin_users (username, password_hash, role, status, max_keys, expires_at, created_by_tg, bot_id, note)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [state.username, '$bot$auto', 'seller', 'active', state.maxKeys, expiresAt, String(uid), BOT_ID, noteVal]
      );
      await ctx.reply(
        `✅ <b>Seller Added!</b>\n\n👤 Username: <code>${esc(state.username)}</code>\n🔑 Max keys: ${state.maxKeys || '∞'}\n📅 Expires: ${expiresAt || 'Never'}` +
        (tgNote || '\n\n<i>No Telegram linked. They can /link later.</i>'),
        { parse_mode: 'HTML', ...subSellersKeyboard(isOwn) }
      );
      return;
    }
  }

  return next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Error handler
// ─────────────────────────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`[SubBot] Error for ${ctx.updateType}:`, err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(0, 4).join('\n'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Launch
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  await schema.ensureSchema();
  await bot.launch();
  console.log(`🤖 Sub Bot started — @${bot.botInfo?.username || 'unknown'}`);
  console.log(`🔐 Sub Admin ID : ${SUB_ADMIN_ID || '(not set — set SUBBOT_ADMIN_ID)'}`);
  console.log(`🏷  Bot ID       : ${BOT_ID}`);
})();

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
