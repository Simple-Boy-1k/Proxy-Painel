// panels/user.js — User Panel (public — anyone who /start's the bot)
const { Markup } = require('telegraf');
const db = require('../services/db');
const auth = require('../services/auth');
const { render, esc, fmtUnix } = require('../utils/render');
const { pe } = require('../utils/emoji');
const { getLang, STRINGS } = require('../services/lang');

function isValidIp(ip) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(n => parseInt(n) >= 0 && parseInt(n) <= 255);
}

function userKeyboard(d) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚀 Activate Key', 'u_activate')],
    [Markup.button.callback('📋 Key Status', 'u_status'), Markup.button.callback('♻️ Change IP', 'u_change_ip')],
    [Markup.button.callback('🔙 Main Menu', 'nav_main_menu')],
  ]);
}

const activateState = new Map();
const statusState = new Map();
const changeIpState = new Map();

function register(bot) {
  bot.action('nav_user_panel', async (ctx) => {
    try {
      await db.exec(`INSERT INTO bot_users (telegram_id, first_name, username, bot_id) VALUES (?, ?, ?, 'main') ON DUPLICATE KEY UPDATE first_name=VALUES(first_name), username=VALUES(username), last_seen=CURRENT_TIMESTAMP`,
        [String(ctx.from.id), ctx.from.first_name || '', ctx.from.username || '']
      );
    } catch (_) {}
    const lang = await getLang(ctx.from.id);
    const d = STRINGS[lang] || STRINGS['en'];
    await render(ctx, `${pe('person', '👤')} <b>User Panel</b>\n\nActivate or manage your proxy key:`, { parse_mode: 'HTML', ...userKeyboard(d) });
    await ctx.answerCbQuery();
  });

  bot.action('u_activate', async (ctx) => {
    activateState.set(ctx.from.id, { step: 'key' });
    await render(ctx, `🚀 <b>Key Activation</b>\n\nEnter your <b>key code</b>:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('u_status', async (ctx) => {
    statusState.set(ctx.from.id, true);
    await render(ctx, `📋 Enter your <b>key code</b>:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.action('u_change_ip', async (ctx) => {
    changeIpState.set(ctx.from.id, { step: 'key' });
    await render(ctx, `♻️ <b>Change IP</b>\n\nEnter your <b>key code</b>:`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });

  bot.on('text', async (ctx, next) => {
    const uid = ctx.from.id;
    const text = ctx.message.text.trim();

    if (statusState.has(uid)) {
      statusState.delete(uid);
      const code = text.toUpperCase();
      const k = await db.queryOne(`SELECT k.*, au.username owner_name FROM proxy_keys k LEFT JOIN admin_users au ON k.owner_id=au.id WHERE k.key_code=?`, [code]);
      if (!k) {
        await ctx.reply(`❌ Key <code>${esc(code)}</code> not found.`, { parse_mode: 'HTML' });
        return;
      }
      const mySlot = await db.queryOne(`SELECT * FROM proxy_uids WHERE key_id=? AND created_by=?`, [k.id, `tg:${uid}`]);
      const now = Math.floor(Date.now() / 1000);
      let msg = `📋 <b>Key: <code>${esc(k.key_code)}</code></b>\n\n`;
      msg += `📦 Duration: ${k.duration_days} days\n👥 Slots: ${k.used_count}/${k.max_uids}\n\n`;
      if (mySlot) {
        const st = mySlot.status === 'blocked' ? '🚫 Blocked' : (mySlot.expires_at && mySlot.expires_at < now ? '⏰ Expired' : '🟢 Active');
        msg += `<b>Your slot:</b>\n${st}\n🌐 IP: <code>${esc(mySlot.ip)}</code>\n📅 Expires: ${mySlot.expires_at ? new Date(mySlot.expires_at * 1000).toUTCString() : 'Never'}\n`;
      } else {
        msg += `⬜ You haven't activated this key yet.`;
      }
      await ctx.reply(msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 User Panel', 'nav_user_panel')]]) });
      return;
    }

    if (activateState.has(uid) && activateState.get(uid).step === 'key') {
      const state = activateState.get(uid);
      const code = text.toUpperCase();
      const k = await db.queryOne('SELECT * FROM proxy_keys WHERE key_code=?', [code]);
      if (!k) {
        activateState.delete(uid);
        await ctx.reply(`❌ Key <code>${esc(code)}</code> not found.`, { parse_mode: 'HTML' });
        return;
      }
      if (k.used_count >= k.max_uids) {
        activateState.delete(uid);
        await ctx.reply(`❌ This key is full (${k.used_count}/${k.max_uids} slots used).`, { parse_mode: 'HTML' });
        return;
      }
      state.key = k;
      state.step = 'ip';
      activateState.set(uid, state);
      await ctx.reply(`✅ Key found!\n\nEnter your <b>IP address</b> (e.g. 103.20.14.5):`, { parse_mode: 'HTML' });
      return;
    }

    if (activateState.has(uid) && activateState.get(uid).step === 'ip') {
      const state = activateState.get(uid);
      const ip = text;
      if (!isValidIp(ip)) {
        await ctx.reply('❌ Invalid IP format. Should look like: 103.20.14.5', { parse_mode: 'HTML' });
        return;
      }
      activateState.delete(uid);
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = state.key.duration_days > 0 ? now + state.key.duration_days * 86400 : 0;
      const uidCode = `IP_${ip.replace(/\./g, '_')}`;
      await db.exec(`INSERT INTO proxy_uids (uid, key_id, key_code, status, ip, expires_at, created_by) VALUES (?,?,?,'active',?,?,?)`,
        [uidCode, state.key.id, state.key.key_code, ip, expiresAt, `tg:${uid}`]
      );
      await db.exec('UPDATE proxy_keys SET used_count=used_count+1 WHERE id=?', [state.key.id]);
      await ctx.reply(`✅ <b>Proxy Activated!</b>\n\n🔑 Key: <code>${esc(state.key.key_code)}</code>\n🌐 IP: <code>${esc(ip)}</code>\n📅 Expires: ${expiresAt ? new Date(expiresAt * 1000).toUTCString() : 'Never'}`, { parse_mode: 'HTML', ...userKeyboard(STRINGS.en) });
      return;
    }

    if (changeIpState.has(uid) && changeIpState.get(uid).step === 'key') {
      const state = changeIpState.get(uid);
      const code = text.toUpperCase();
      const k = await db.queryOne('SELECT * FROM proxy_keys WHERE key_code=?', [code]);
      if (!k) {
        changeIpState.delete(uid);
        await ctx.reply(`❌ Key <code>${esc(code)}</code> not found.`, { parse_mode: 'HTML' });
        return;
      }
      const mySlot = await db.queryOne(`SELECT * FROM proxy_uids WHERE key_id=? AND created_by=?`, [k.id, `tg:${uid}`]);
      if (!mySlot) {
        changeIpState.delete(uid);
        await ctx.reply(`❌ You don't have an activated slot on key <code>${esc(code)}</code>.`, { parse_mode: 'HTML' });
        return;
      }
      state.key = k;
      state.rec = mySlot;
      state.step = 'new_ip';
      changeIpState.set(uid, state);
      await ctx.reply(`♻️ <b>Change IP</b>\n\n🔑 Key: <code>${esc(code)}</code>\n🌐 Current IP: <code>${esc(mySlot.ip)}</code>\n\nEnter your <b>new IP address</b>:`, { parse_mode: 'HTML' });
      return;
    }

    if (changeIpState.has(uid) && changeIpState.get(uid).step === 'new_ip') {
      const state = changeIpState.get(uid);
      const newIp = text;
      if (!isValidIp(newIp)) {
        await ctx.reply('❌ Invalid IP format.', { parse_mode: 'HTML' });
        return;
      }
      if (newIp === state.rec.ip) {
        await ctx.reply(`❌ That's the same as your current IP.`, { parse_mode: 'HTML' });
        return;
      }
      changeIpState.delete(uid);
      const newUid = `IP_${newIp.replace(/\./g, '_')}`;
      await db.exec('UPDATE proxy_uids SET ip=?, uid=? WHERE id=?', [newIp, newUid, state.rec.id]);
      await ctx.reply(`✅ <b>IP Updated!</b>\n\n🔄 Old IP: <code>${esc(state.rec.ip)}</code>\n🌐 New IP: <code>${esc(newIp)}</code>\n🔑 Key: <code>${esc(state.key.key_code)}</code>`, { parse_mode: 'HTML', ...userKeyboard(STRINGS.en) });
      return;
    }

    return next();
  });
}

module.exports = { register };
