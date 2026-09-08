# 🚀 Proxies Bot v3

Telegram bot for managing proxy servers with IP-based authentication.

## ✨ Features

- 🔑 Key management (generate, search, block, delete)
- 👥 IP-based access (no UID registration)
- ♻️ Users can change their own IP
- 📡 Port/VPS manager
- 📢 Broadcast with full formatting
- 📤 File upload (fileinfo, cache_res, shaders, zip)
- 👑 Owner panel with full system stats
- 🤖 Sub-bot support

## 🛠️ Tech Stack

- **Node.js** (Telegraf)
- **Python** (mitmproxy addon)
- **MySQL** (database)
- **PM2** (process manager)

## 📦 Installation

```bash
git clone https://github.com/yourusername/proxies-bot.git
cd proxies-bot
npm install
pip install pymysql mitmproxy
cp .env.example .env
nano .env
pm2 start ecosystem.config.js
pm2 save
pm2 startup
