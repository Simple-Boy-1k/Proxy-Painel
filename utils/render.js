// utils/render.js — safe edit/reply helpers + formatting utilities

function esc(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtUnix(ts) {
  if (!ts || ts === 0) return '—';
  return fmtDate(new Date(ts * 1000).toISOString());
}

async function render(ctx, text, extra = {}) {
  const MAX = 4000;
  if (extra && extra.parse_mode === 'HTML') {
    text = require('./emoji').autoPremium(text);
  }
  const safeText = text.length > MAX ? text.slice(0, MAX) + '\n…' : text;

  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(safeText, extra);
    } else {
      await ctx.reply(safeText, extra);
    }
  } catch (e) {
    if (e.message && e.message.includes('message is not modified')) return;
    try {
      await ctx.reply(safeText, extra);
    } catch (_) {}
  }
}

module.exports = { esc, fmtDate, fmtUnix, render };
