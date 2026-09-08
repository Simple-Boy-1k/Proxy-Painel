// services/schema.js — Self-contained database migration
const db = require('./db');

const TABLES = [
  [`admin_users`, `
    CREATE TABLE IF NOT EXISTS admin_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('owner','admin','seller') NOT NULL DEFAULT 'seller',
      status ENUM('active','disabled') NOT NULL DEFAULT 'active',
      expires_at DATETIME DEFAULT NULL,
      max_keys INT UNSIGNED NOT NULL DEFAULT 0,
      note VARCHAR(255) DEFAULT '',
      created_by_tg VARCHAR(30) NOT NULL DEFAULT '',
      bot_id VARCHAR(30) NOT NULL DEFAULT 'main',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_role (role), INDEX idx_bot_id (bot_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  [`proxy_keys`, `
    CREATE TABLE IF NOT EXISTS proxy_keys (
      id INT AUTO_INCREMENT PRIMARY KEY,
      key_code VARCHAR(50) NOT NULL UNIQUE,
      owner_id INT DEFAULT NULL,
      duration_days INT UNSIGNED NOT NULL DEFAULT 30,
      max_uids INT UNSIGNED NOT NULL DEFAULT 1,
      used_count INT UNSIGNED NOT NULL DEFAULT 0,
      created_by VARCHAR(100) NOT NULL DEFAULT 'admin',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_key_code (key_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  [`proxy_uids`, `
    CREATE TABLE IF NOT EXISTS proxy_uids (
      id INT AUTO_INCREMENT PRIMARY KEY,
      uid VARCHAR(50) NOT NULL UNIQUE,
      key_id INT NOT NULL,
      key_code VARCHAR(50) DEFAULT '',
      status ENUM('active','blocked') DEFAULT 'active',
      ip VARCHAR(45) DEFAULT '',
      expires_at INT UNSIGNED DEFAULT 0,
      created_by VARCHAR(100) DEFAULT 'public',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ip (ip), INDEX idx_key_id (key_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  [`proxy_instances`, `
    CREATE TABLE IF NOT EXISTS proxy_instances (
      id INT AUTO_INCREMENT PRIMARY KEY,
      label VARCHAR(100) NOT NULL,
      port INT UNSIGNED NOT NULL,
      vpn_server_ip VARCHAR(45) NOT NULL DEFAULT '',
      status ENUM('active','disabled') DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_port (port)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  [`proxy_messages`, `
    CREATE TABLE IF NOT EXISTS proxy_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      msg_key VARCHAR(50) NOT NULL UNIQUE,
      content TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  [`proxy_settings`, `
    CREATE TABLE IF NOT EXISTS proxy_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      setting_key VARCHAR(50) NOT NULL UNIQUE,
      setting_value LONGTEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  [`bot_users`, `
    CREATE TABLE IF NOT EXISTS bot_users (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      first_name VARCHAR(100) DEFAULT '',
      username VARCHAR(100) DEFAULT '',
      bot_id VARCHAR(30) NOT NULL DEFAULT 'main',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_tg_bot (telegram_id, bot_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  [`trial_logs`, `
    CREATE TABLE IF NOT EXISTS trial_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      key_id INT NOT NULL,
      key_code VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_tg (telegram_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
];

async function ensureSchema() {
  for (const [name, sql] of TABLES) {
    try { await db.raw(sql); } catch (e) { console.error(`❌ Schema ${name}:`, e.message); }
  }
  try {
    await db.exec(`INSERT IGNORE INTO proxy_messages (msg_key, content) VALUES 
      ('success', '[00FF88]✅ Activated Successfully\\n[FFFFFF]Turn Off Proxy And Enter Game.\\n[FFAA00]IP: [00FFFF]{ip}\\n[00FF88]Expires: [FFFFFF]{expires}'),
      ('banned', '[FF0000]⛔ Access Revoked\\n[FFFFFF]Your account has been banned.'),
      ('not_registered', '[FF6600]🔒 Not Activated\\n[FFFFFF]IP not registered.'),
      ('expired', '[FF8800]⏰ Subscription Expired\\n[FFFFFF]Contact admin to renew.')`);
  } catch (_) {}
  console.log('✅ Database schema verified/created.');
}

module.exports = { ensureSchema };
