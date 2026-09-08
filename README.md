# 🚀 Proxies Bot v3

Telegram bot for managing proxy servers with IP-based authentication.

[![Deploy on Heroku](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/Simple-Boy-1k/Proxy-Painel)

---

## ✨ Features

- 🔑 Key management (generate, search, block, delete)
- 👥 IP-based access (no UID registration)
- ♻️ Users can change their own IP
- 📡 Port/VPS manager
- 📢 Broadcast with full formatting
- 📤 File upload (fileinfo, cache_res, shaders, zip)
- 👑 Owner panel with full system stats
- 🤖 Sub-bot support
- 🌐 Multi-language (English, বাংলা)

---

## 🛠️ Tech Stack

- **Node.js** (Telegraf)
- **Python** (mitmproxy addon)
- **MySQL** (database)
- **PM2** (process manager)
- **Heroku** (cloud deployment)

---

## 🚀 Deploy to Heroku (One Click)

[![Deploy on Heroku](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/Simple-Boy-1k/Proxy-Painel)

### Manual Heroku Deploy

```bash
# 1. Login to Heroku
heroku login

# 2. Create app
heroku create proxy-painel-bot

# 3. Add MySQL database
heroku addons:create cleardb:ignite

# 4. Get database URL
heroku config:get CLEARDB_DATABASE_URL

# 5. Set environment variables
heroku config:set BOT_TOKEN=your_bot_token
heroku config:set SUPER_ADMIN_ID=your_telegram_id
heroku config:set DB_HOST=us-cdbr-east-06.cleardb.net
heroku config:set DB_NAME=heroku_1234567890abc
heroku config:set DB_USER=b7f4e9a1c2d3e4
heroku config:set DB_PASS=your_password
heroku config:set SERVER_PY=./server.py
heroku config:set INSTANCES_DIR=./data
heroku config:set UPLOAD_DIR=./data
heroku config:set PROXY_PORTS=8881,8882,8883,8884,8885
heroku config:set IP_DETECT_URL=https://xtrikeip.netlify.app
heroku config:set PROXY_TOKEN=tokenapi

# 6. Deploy
git push heroku main

# 7. Scale dynos
heroku ps:scale web=1
heroku ps:scale worker=0

# 8. Check logs
heroku logs --tail
