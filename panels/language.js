// panels/language.js — Language selection panel
const { Markup } = require('telegraf');
const { getLang, setLang, langKeyboard, STRINGS } = require('../services/lang');
const { render } = require('../utils/render');

function register(bot) {
  bot.action('nav_lang_panel', async (ctx) => {
    const lang = await getLang(ctx.from.id);
    const dict = STRINGS[lang] || STRINGS['en'];
    await render(ctx, dict.lang_panel_title || '🌐 <b>Select Language</b>\n\nChoose your preferred language:', { parse_mode: 'HTML', ...langKeyboard() });
    await ctx.answerCbQuery();
  });

  bot.action(/^set_lang:([a-z]{2})$/, async (ctx) => {
    const lang = ctx.match[1];
    await setLang(ctx.from.id, lang);
    const dict = STRINGS[lang] || STRINGS['en'];
    await ctx.answerCbQuery(dict.lang_changed?.replace(/<[^>]+>/g, '') || '✅ Language changed');
    await render(ctx, dict.lang_changed || '✅ Language changed', { parse_mode: 'HTML', ...langKeyboard() });
  });
}

module.exports = { register };
