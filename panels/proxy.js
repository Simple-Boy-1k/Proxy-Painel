// panels/proxy.js — VPS / Port Management Panel
const { Markup } = require('telegraf');
const auth = require('../services/auth');
const vps = require('../services/vps');
const { render, esc } = require('../utils/render');
const { pe } = require('../utils/emoji');
const { getLang, STRINGS } = require('../services/lang');

function proxyKeyboard(d) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 Port Status', 'prx_status'), Markup.button.callback('🖥 Screens', 'prx_screens')],
    [Markup.button.callback('▶️ Start All', 'prx_start_all'), Markup.button.callback('⏹ Stop All', 'prx_stop_all')],
    [Markup.button.callback('🔌 Start Port', 'prx_start_port'), Markup.button.callback('🔴 Stop Port', 'prx_stop_port')],
    [Markup.button.callback('🔁 Restart Port', 'prx_restart_port'), Markup.button.callback('📜 Logs', 'prx_logs')],
    [Markup.button.callback('🔙 Main Menu', 'nav_main_menu')],
  ]);
}

function portGrid(statusMap, action) {
  const ports = Object.values(statusMap);
  const rows = [];
  for (let i = 0; i < ports.length; i += 3) {
    rows.push(ports.slice(i, i + 3).map(p => Markup.button.callback(`${p.running ? '🟢' : '🔴'} ${p.port}`, `${action}:${p.port}`)));
  }
  rows.push([Markup.button.callback('🔙 Back', 'nav_proxy_panel')]);
  return Markup.inlineKeyboard(rows);
}

function register(bot) {
  bot.action('nav_proxy_panel', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔ No access'); return; }
    const d = await getLang(ctx.from.id);
    await ctx.answerCbQuery();
    await render(ctx, `📡 <b>Proxy / Port Manager</b>\n\nManage mitmdump instances.`, { parse_mode: 'HTML', ...proxyKeyboard(d) });
  });

  bot.action('prx_status', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    try { await ctx.answerCbQuery('📊 Checking…'); } catch (_) {}
    const d = await getLang(ctx.from.id);
    const map = await vps.status();
    const run = Object.values(map).filter(p => p.running).length;
    let msg = `📊 <b>Port Status</b>  🟢 ${run} / ${Object.values(map).length}\n\n`;
    for (const p of Object.values(map)) {
      msg += `${p.running ? '🟢' : '🔴'} <code>${p.port}</code>\n`;
    }
    await render(ctx, msg, { parse_mode: 'HTML', ...proxyKeyboard(d) });
  });

  bot.action('prx_screens', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    try { await ctx.answerCbQuery(); } catch (_) {}
    const d = await getLang(ctx.from.id);
    const out = vps.listScreens();
    await render(ctx, `🖥 <b>Screen Sessions</b>\n\n<code>${esc(out || 'No sessions.')}</code>`, { parse_mode: 'HTML', ...proxyKeyboard(d) });
  });

  bot.action('prx_start_all', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔ Owner only'); return; }
    try { await ctx.answerCbQuery('⏳ Starting…'); } catch (_) {}
    const d = await getLang(ctx.from.id);
    await ctx.editMessageText('⏳ <b>Starting all proxies…</b>', { parse_mode: 'HTML' });
    const r = await vps.startAll();
    await render(ctx, r.ok ? `✅ <b>All proxies started!</b>` : `❌ <b>Start failed:</b>`, { parse_mode: 'HTML', ...proxyKeyboard(d) });
  });

  bot.action('prx_stop_all', async (ctx) => {
    if (!(await auth.isOwner(ctx))) { await ctx.answerCbQuery('⛔ Owner only'); return; }
    try { await ctx.answerCbQuery(); } catch (_) {}
    const d = await getLang(ctx.from.id);
    vps.stopAll();
    await render(ctx, `⏹ <b>All processes killed.</b>`, { parse_mode: 'HTML', ...proxyKeyboard(d) });
  });

  bot.action('prx_start_port', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    try { await ctx.answerCbQuery('📊 Loading…'); } catch (_) {}
    const map = await vps.status();
    await render(ctx, `▶️ <b>Start Port</b>\n\nTap a port:`, { parse_mode: 'HTML', ...portGrid(map, 'prx_do_start') });
  });

  bot.action(/^prx_do_start:(\d+)$/, async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const port = parseInt(ctx.match[1]);
    try { await ctx.answerCbQuery(`⏳ Starting ${port}…`); } catch (_) {}
    await vps.startPort(port);
    const map = await vps.status();
    await render(ctx, `▶️ <b>Start Port</b>\n\n✅ Port <code>${port}</code> started.`, { parse_mode: 'HTML', ...portGrid(map, 'prx_do_start') });
  });

  bot.action('prx_stop_port', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    try { await ctx.answerCbQuery('📊 Loading…'); } catch (_) {}
    const map = await vps.status();
    await render(ctx, `⏹ <b>Stop Port</b>\n\nTap a port:`, { parse_mode: 'HTML', ...portGrid(map, 'prx_do_stop') });
  });

  bot.action(/^prx_do_stop:(\d+)$/, async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const port = parseInt(ctx.match[1]);
    vps.stopPort(port);
    try { await ctx.answerCbQuery(`⏹ ${port} stopped`); } catch (_) {}
    const map = await vps.status();
    await render(ctx, `⏹ <b>Stop Port</b>\n\n🔴 <code>${port}</code> stopped.`, { parse_mode: 'HTML', ...portGrid(map, 'prx_do_stop') });
  });

  bot.action('prx_restart_port', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    try { await ctx.answerCbQuery('📊 Loading…'); } catch (_) {}
    const map = await vps.status();
    await render(ctx, `🔁 <b>Restart Port</b>\n\nTap a port:`, { parse_mode: 'HTML', ...portGrid(map, 'prx_do_restart') });
  });

  bot.action(/^prx_do_restart:(\d+)$/, async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    const port = parseInt(ctx.match[1]);
    try { await ctx.answerCbQuery(`🔁 Restarting ${port}…`); } catch (_) {}
    await vps.restartPort(port);
    const map = await vps.status();
    await render(ctx, `🔁 <b>Restart Port</b>\n\n✅ <code>${port}</code> restarted.`, { parse_mode: 'HTML', ...portGrid(map, 'prx_do_restart') });
  });

  bot.action('prx_logs', async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    try { await ctx.answerCbQuery(); } catch (_) {}
    const d = await getLang(ctx.from.id);
    await render(ctx, `📜 <b>Logs</b>\n\nSelect a port:`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback(':8881', 'prx_show_log:8881'), Markup.button.callback(':8882', 'prx_show_log:8882'), Markup.button.callback(':8883', 'prx_show_log:8883')],
      [Markup.button.callback(':8884', 'prx_show_log:8884'), Markup.button.callback(':8885', 'prx_show_log:8885')],
      [Markup.button.callback('🔙 Back', 'nav_proxy_panel')],
    ]) });
  });

  bot.action(/^prx_show_log:(\d+)$/, async (ctx) => {
    if (!(await auth.isAdmin(ctx))) { await ctx.answerCbQuery('⛔'); return; }
    try { await ctx.answerCbQuery(); } catch (_) {}
    const port = parseInt(ctx.match[1]);
    const log = vps.logs(port, 30);
    await render(ctx, `📜 <b>Port ${port} — last 30 lines</b>\n\n<code>${esc(log.slice(-3500))}</code>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh', `prx_show_log:${port}`)],
      [Markup.button.callback('🔙 Back', 'prx_logs')],
    ]) });
  });
}

module.exports = { register };
