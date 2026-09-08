// Sub bots are no longer started via PM2.
// They are spawned and managed automatically by the main bot process
// (via services/subbot_manager.js) using tokens stored in the `sub_bots` DB table.
// To add a sub bot: open the bot → Owner Panel → 🤖 Sub Bots → ➕ Add Sub Bot.
// Do NOT run subbot.js via PM2 anymore — the main bot handles it.

module.exports = {
  apps: [
    {
      name:         'proxies-bot',
      script:       'bot.js',
      cwd:          __dirname,
      instances:    1,
      autorestart:  true,
      watch:        false,
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
      error_file:   '/tmp/proxies-bot-error.log',
      out_file:     '/tmp/proxies-bot-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
