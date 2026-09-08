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
    await render(ctx, `${pe('person','👤')} <b>User Management</b>\n\n${is
