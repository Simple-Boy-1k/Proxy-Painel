// bot.js — Proxies Bot v3 (MySQL + server.py auto-copy, no APY)
const { Telegraf, Markup } = require('telegraf');
const { BOT_TOKEN, SUPER_ADMIN_ID } = require('./config');
const auth = require('./services/auth');
const { render, esc } = require('./utils/render');
const { pe } = require('./utils/emoji');
const { getLang, STRINGS } = require('./services/lang');

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not set. Copy .env.example to .env and fill in values.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ── Premium emoji auto-convert middleware ──────────────────────────────────
bot.use((ctx, next) => {
  const wrap = (fn) => function (text, extra, ...rest) {
    if (typeof text === 'string' && text.length > 0) {
      const converted = require('./utils/emoji').autoPremium(text);
      if (converted !== text) {
        text = converted;
        extra = { ...(extra || {}), parse_mode: 'HTML' };
      }
    }
    return fn.call(this, text, extra, ...rest);
  };
  if (ctx.reply)              ctx.reply = wrap(ctx.reply.bind(ctx));
  if (ctx.editMessageText)    ctx.editMessageText = wrap(ctx.editMessageText.bind(ctx));
  if (ctx.editMessageCaption) ctx.editMessageCaption = wrap(ctx.editMessageCaption.bind(ctx));
  if (ctx.sendMessage)        ctx.sendMessage = wrap(ctx.sendMessage.bind(ctx));
  if (ctx.replyWithHTML)      ctx.replyWithHTML = wrap(ctx.replyWithHTML.bind(ctx));
  return next();
});

// ── Auto-answer callback after 7s ──────────────────────────────────────────
bot.use(async (ctx, next) => {
  if (ctx.updateType !== 'callback_query') return next();
  let answered = false;
  const orig = ctx.answerCbQuery.bind(ctx);
  ctx.answerCbQuery = async (...a) => { answered = true; return orig(...a); };
  const timer = setTimeout(async () => {
    if (!answered) { answered = true; try { await orig(); } catch (_) {} }
  }, 7000);
  try { await next(); } finally {
    clearTimeout(timer);
    if (!answered) try { await orig(); } catch (_) {}
  }
});

// ── Track users in bot_users ──────────────────────────────────────────────
const db = require('./services/db');
bot.use(async (ctx, next) => {
  if (ctx.from && ctx.from.id) {
    const gid = String(ctx.from.id);
    const uname = (ctx.from.username || '').toLowerCase();
    const fname = ctx.from.first_name || '';
    try {
      await db.exec(
        `INSERT INTO bot_users (telegram_id, first_name, username, bot_id)
         VALUES (?,?,?, 'main')
         ON DUPLICATE KEY UPDATE
           first_name = VALUES(first_name),
           username = VALUES(username),
           last_seen = CURRENT_TIMESTAMP`,
        [ctx.from.id, fname, uname]
      );
    } catch (_) {}
    if (uname) {
      try {
        const rows = await db.query(
          `SELECT id, username, role, note FROM admin_users
           WHERE note LIKE ? AND (note NOT LIKE ?)`,
          [`%tguser:${uname}%`, `%tg:${ctx.from.id}%`]
        );
        for (const u of rows) {
          const newNote = (u.note || '').replace(`tguser:${uname}`, `tg:${ctx.from.id}`);
          await db.exec(`UPDATE admin_users SET note=? WHERE id=?`, [newNote, u.id]);
          try {
            await ctx.telegram.sendMessage(
              u.id,
              `🔗 Account Auto-Linked!\n\nYour Telegram (@${uname}) has been automatically linked to <code>${u.username}</code> (${u.role})\nTap /start to access your panel.`,
              { parse_mode: 'HTML' }
            );
          } catch (_) {}
          console.log(`[auto-link] Linked @${uname} (${u.role}) to admin_users #${u.id} (${u.username})`);
        }
      } catch (_) {}
    }
  }
  return next();
});

// ── Main Menu Keyboard ─────────────────────────────────────────────────────
async function mainMenuKeyboard(ctx) {
  const isOwn = await auth.isOwner(ctx);
  const isAdm = await auth.isAdmin(ctx);
  const isSel = await auth.isSeller(ctx);
  const lang  = await getLang(ctx.from.id);
  const d     = STRINGS[lang] || STRINGS['en'];

  const rows = [];
  rows.push([Markup.button.callback(d.user_panel, 'nav_user_panel')]);

  if (isSel) rows.push([Markup.button.callback(d.keys_panel, 'nav_keys_panel')]);
  if (isAdm) rows.push([Markup.button.callback('👥 IPs', 'nav_uids_panel')]);
  if (isAdm) rows.push([Markup.button.callback(d.proxy_panel, 'nav_proxy_panel')]);
  if (isAdm) rows.push([Markup.button.callback(d.sellers_panel, 'nav_sellers_panel')]);
  if (isOwn) rows.push([Markup.button.callback(d.owner_panel, 'nav_owner_panel')]);

  rows.push([Markup.button.callback(d.lang_btn, 'nav_lang_panel')]);
  return Markup.inlineKeyboard(rows);
}

// ── /start ──────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const name = ctx.from.first_name || 'User';
  const gid  = String(ctx.from.id);
  const u    = await auth.getUser(ctx);
  const role = u ? u.role : (gid === SUPER_ADMIN_ID ? 'owner' : null);
  const lang = await getLang(gid);
  const d    = STRINGS[lang] || STRINGS['en'];

  let greeting = `${pe('wave', '👋')} ${d.welcome.replace('{name}', esc(name))}\n\n`;
  if (role) {
    greeting += `${pe('lock', '🔐')} ${d.role_label.replace('{role}', role)}\n`;
  } else {
    greeting += `${pe('id', '🆔')} Your Telegram ID: <code>${gid}</code>\n<i>Use /link if you have an account</i>\n\n`;
    greeting += `<i>Tap User Panel to activate a key.</i>\n`;
  }
  greeting += `\n${d.choose_option}`;

  const kb = await mainMenuKeyboard(ctx);
  await ctx.reply(greeting, { parse_mode: 'HTML', ...kb });
});

// ── /link ──────────────────────────────────────────────────────────────────
const linkState = new Map();
bot.command('link', async (ctx) => {
  const existing = await auth.getUser(ctx);
  if (existing) {
    const kb = await mainMenuKeyboard(ctx);
    await ctx.reply(
      `${pe('check', '✅')} <b>Already Linked!</b>\n\n` +
      `${pe('person', '👤')} Account: <code>${esc(existing.username)}</code>\n` +
      `${pe('lock', '🔐')} Role: <b>${esc(existing.role)}</b>\n\n` +
      `You already have access. Tap /start to open your panel.`,
      { parse_mode: 'HTML', ...kb }
    );
    return;
  }
  linkState.set(ctx.from.id, true);
  await ctx.reply(
    `${pe('link', '🔗')} <b>Link Telegram Account</b>\n\nEnter your <b>website username</b> to link this Telegram ID (<code>${ctx.from.id}</code>) to your account:`,
    { parse_mode: 'HTML' }
  );
});

// ── /myid ──────────────────────────────────────────────────────────────────
bot.command('myid', async (ctx) => {
  await ctx.reply(
    `${pe('id', '🆔')} Telegram ID: <code>${ctx.from.id}</code>` +
    (ctx.from.username ? `\n${pe('person', '👤')} @${ctx.from.username}` : ''),
    { parse_mode: 'HTML' }
  );
});

// ── /help ──────────────────────────────────────────────────────────────────
bot.help(async (ctx) => {
  const isOwn = await auth.isOwner(ctx);
  const isAdm = await auth.isAdmin(ctx);
  const isSel = await auth.isSeller(ctx);
  let msg = `${pe('robot', '🤖')} <b>Proxies Bot Help</b>\n\n/start — Main menu\n/link — Link your website account\n/myid — Your Telegram ID\n/help — This message\n\n`;
  if (isSel) msg += `${pe('key', '🔑')} <b>Seller:</b> Generate & manage keys, activate IPs\n`;
  if (isAdm) msg += `${pe('shield', '🛡')} <b>Admin:</b> Manage IPs, users, proxy instances & ports\n`;
  if (isOwn) msg += `${pe('crown', '👑')} <b>Owner:</b> Full system control — broadcast, upload files, ports, settings\n`;
  if (!isSel && !isOwn) {
    msg += `\n${pe('warning', '⚠️')} Not linked yet — use /link or ask admin to link your ID: <code>${ctx.from.id}</code>`;
  }
  await ctx.reply(msg, { parse_mode: 'HTML' });
});

// ── /setup (owner only) ──────────────────────────────────────────────────
bot.command('setup', async (ctx) => {
  const gid = String(ctx.from.id);
  if (gid !== SUPER_ADMIN_ID) {
    await ctx.reply('⛔ This command is for the Super Admin only.', { parse_mode: 'HTML' });
    return;
  }

  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const { START_SCRIPT, SERVER_PY, MITMDUMP, INSTANCES_DIR } = require('./config');
  const botDir = __dirname;
  const lines = [];

  // chmod +x *.sh
  try {
    execSync(`find ${botDir} -maxdepth 1 -name "*.sh" -exec chmod +x {} \\;`, { encoding: 'utf8' });
    const shFiles = fs.readdirSync(botDir).filter(f => f.endsWith('.sh'));
    lines.push(`🔧 chmod +x: ${shFiles.map(f => `<code>${f}</code>`).join(', ')}`);
  } catch (e) {
    lines.push(`⚠️ chmod error: ${e.message}`);
  }

  // Check mitmdump
  if (MITMDUMP && fs.existsSync(MITMDUMP)) {
    lines.push(`✅ mitmdump: <code>${MITMDUMP}</code>`);
  } else {
    lines.push(`❌ mitmdump NOT found at <code>${MITMDUMP || '/opt/mitmproxy-venv/bin/mitmdump'}</code>`);
    lines.push(`   Install: <code>python3 -m venv /opt/mitmproxy-venv && /opt/mitmproxy-venv/bin/pip install mitmproxy pymysql</code>`);
  }

  // Check server.py
  const serverPy = SERVER_PY || path.join(botDir, 'server.py');
  if (fs.existsSync(serverPy)) {
    lines.push(`✅ server.py: <code>${serverPy}</code>`);
  } else {
    lines.push(`❌ server.py NOT found at <code>${serverPy}</code>`);
  }

  // Check start_proxies.sh
  const startScript = START_SCRIPT || path.join(botDir, 'start_proxies.sh');
  if (fs.existsSync(startScript)) {
    lines.push(`✅ start_proxies.sh: <code>${startScript}</code>`);
  } else {
    lines.push(`❌ start_proxies.sh NOT found at <code>${startScript}</code>`);
  }

  // Check INSTANCES_DIR
  if (INSTANCES_DIR) {
    try {
      fs.mkdirSync(INSTANCES_DIR, { recursive: true });
      lines.push(`✅ INSTANCES_DIR: <code>${INSTANCES_DIR}</code>`);
    } catch (e) {
      lines.push(`⚠️ INSTANCES_DIR error: ${e.message}`);
    }
  } else {
    lines.push(`⚠️ INSTANCES_DIR not set in .env`);
  }

  // DB check
  try {
    const existing = await db.queryOne(`SELECT id FROM admin_users WHERE bot_id='main' AND note LIKE '%tg:${ctx.from.id}%'`);
    if (existing) {
      lines.push(`✅ Super admin already linked in DB`);
    } else {
      const ownerRow = await db.queryOne(`SELECT id, note FROM admin_users WHERE role='owner' AND bot_id='main' LIMIT 1`);
      if (ownerRow) {
        const newNote = (ownerRow.note || '') + ` tg:${ctx.from.id}`;
        await db.exec(`UPDATE admin_users SET note=? WHERE id=?`, [newNote, ownerRow.id]);
        lines.push(`✅ Super admin linked to existing owner (#${ownerRow.id})`);
      } else {
        await db.exec(
          `INSERT INTO admin_users (username, password_hash, role, status, max_keys, bot_id, note)
           VALUES ('superadmin', '$bot$auto', 'owner', 'active', 0, 'main', ?)`,
          [`tg:${ctx.from.id}`]
        );
        lines.push(`✅ Super admin auto-created in DB (role: owner)`);
      }
    }
  } catch (e) {
    lines.push(`⚠️ DB link error: ${e.message}`);
  }

  const kb = await mainMenuKeyboard(ctx);
  await ctx.reply(
    `${pe('check', '✅')} <b>Setup Complete!</b>\n\n${lines.join('\n')}\n\nTap /start to open the main menu.`,
    { parse_mode: 'HTML', ...kb }
  );
});

// ── Text handler for /link flow ────────────────────────────────────────────
bot.on('text', async (ctx, next) => {
  const uid = ctx.from.id;
  if (linkState.has(uid)) {
    linkState.delete(uid);
    const uname = ctx.message.text.trim().toLowerCase();
    const user = await db.queryOne(
      `SELECT * FROM admin_users WHERE LOWER(username)=? AND bot_id='main'`,
      [uname]
    );
    if (!user) {
      await ctx.reply(`❌ Username <code>${esc(uname)}</code> not found. Check the spelling.`, { parse_mode: 'HTML' });
      return;
    }
    await auth.linkTelegram(user.id, String(uid));
    const kb = await mainMenuKeyboard(ctx);
    await ctx.reply(
      `${pe('check', '✅')} <b>Linked!</b>\n\n${pe('person', '👤')} Account: <code>${esc(user.username)}</code>\n${pe('lock', '🔐')} Role: <b>${user.role}</b>\n\nYou now have full bot access.`,
      { parse_mode: 'HTML', ...kb }
    );
    return;
  }
  return next();
});

// ── nav_main_menu ──────────────────────────────────────────────────────────
bot.action('nav_main_menu', async (ctx) => {
  const kb = await mainMenuKeyboard(ctx);
  const u   = await auth.getUser(ctx);
  const role = u ? u.role : (String(ctx.from.id) === SUPER_ADMIN_ID ? 'owner' : 'guest');
  const lang = await getLang(ctx.from.id);
  const d    = STRINGS[lang] || STRINGS['en'];
  await render(ctx,
    `${pe('home', '🏠')} <b>${lang === 'en' ? 'Main Menu' : lang === 'bn' ? 'মূল মেনু' : 'Главное меню'}</b>\n\n${d.role_label.replace('{role}', role)}`,
    { parse_mode: 'HTML', ...kb }
  );
  await ctx.answerCbQuery();
});

// ── Load panels ────────────────────────────────────────────────────────────
require('./panels/user').register(bot);
require('./panels/keys').register(bot);
require('./panels/uids').register(bot);
require('./panels/proxy').register(bot);
require('./panels/sellers').register(bot);
require('./panels/owner').register(bot);
require('./panels/language').register(bot);

// ── Expired key cleanup ────────────────────────────────────────────────────
async function runExpiredKeyCleanup() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const expiredUids = await db.query(
      `SELECT pu.id, pu.key_id, pk.key_code, pk.created_by, pu.ip
       FROM proxy_uids pu
       JOIN proxy_keys pk ON pk.id = pu.key_id
       WHERE pu.expires_at > 0 AND pu.expires_at <= ? AND pu.status='active'`,
      [now]
    );
    if (expiredUids && expiredUids.length) {
      console.log(`[cleanup] Found ${expiredUids.length} expired UIDs — cleaning up.`);
      const { clearProxyCache } = require('./services/cacheInvalidate');
      for (const row of expiredUids) {
        await db.exec(`DELETE FROM proxy_uids WHERE id=?`, [row.id]);
        if (row.ip) clearProxyCache(row.ip).catch(() => {});
        if ((row.created_by || '').startsWith('trial:')) {
          await db.exec(`DELETE FROM key_instances WHERE key_id=?`, [row.key_id]);
          await db.exec(`DELETE FROM proxy_keys WHERE id=? AND created_by LIKE 'trial:%'`, [row.key_id]);
          await db.exec(`DELETE FROM trial_logs WHERE key_id=?`, [row.key_id]);
          console.log(`[cleanup] Trial key ${row.key_code} expired — deleted`);
        }
      }
    }
  } catch (e) {
    console.error('[cleanup] Error:', e.message);
  }
}
setTimeout(runExpiredKeyCleanup, 30 * 1000);
setInterval(runExpiredKeyCleanup, 5 * 60 * 1000);

// ── Error handler ──────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`[Bot] Error for ${ctx.updateType}:`, err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(0, 4).join('\n'));
});

// ── Launch ─────────────────────────────────────────────────────────────────
const subbotManager = require('./services/subbot.manager');

(async () => {
  try {
    await db.ensureDatabase();
    await require('./services/schema').ensureSchema();
    await bot.launch();
    console.log(`${pe('rocket', '🚀')} Proxies Bot started`);
    console.log(`${pe('crown', '👑')} Super Admin ID: ${SUPER_ADMIN_ID || '(not set — set SUPER_ADMIN_ID in .env)'}`);
    console.log(`📊 Database: ${db.DB.user}@${db.DB.host}/${db.DB.database}`);
    await subbotManager.launchAllFromDB();
  } catch (err) {
    console.error(`${pe('cross', '❌')} Startup failed:`, err.message);
    if (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error(`${pe('warning', '⚠️')} Check DB_HOST, DB_USER, DB_PASS in your .env file.`);
    }
    process.exit(1);
  }
})();

process.once('SIGINT', () => { subbotManager.stopAll(); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { subbotManager.stopAll(); bot.stop('SIGTERM'); });
