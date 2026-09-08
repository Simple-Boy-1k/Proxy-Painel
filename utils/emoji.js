// utils/emoji.js — Telegram Premium custom emoji support
const fs = require('fs');
const path = require('path');

const MAP_FILE = path.join(__dirname, '..', 'data', 'premium_emojis.json');
let cache = null;
let cacheMtime = 0;

function loadMap() {
  try {
    const stat = fs.statSync(MAP_FILE);
    if (cache && stat.mtimeMs === cacheMtime) return cache;
    cache = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
    cacheMtime = stat.mtimeMs;
    return cache;
  } catch (e) {
    return {};
  }
}

function pe(name, fallback) {
  const map = loadMap();
  const id = map[name];
  if (id) {
    return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
  }
  return fallback;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const EMOJI_NAME_BY_CHAR = [
  ['♻️', 'refresh'], ['⚙️', 'gear'], ['⚠️', 'warning'], ['ℹ️', 'info'],
  ['🗑️', 'bin'], ['▶️', 'play'], ['↩️', 'back'], ['✉️', 'memo'],
  ['👑', 'crown'], ['🛡', 'shield'], ['💎', 'diamond'], ['⭐', 'star'],
  ['✨', 'sparkles'], ['🏆', 'trophy'], ['📢', 'broadcast'], ['✅', 'check'],
  ['❌', 'cross'], ['👋', 'wave'], ['💰', 'moneybag'], ['🛍', 'shoppingbag'],
  ['💳', 'creditcard'], ['🛒', 'cart'], ['📦', 'package'], ['📊', 'barchart'],
  ['📱', 'phone'], ['⏳', 'hourglass'], ['🔑', 'key'], ['🚀', 'rocket'],
  ['🔗', 'link'], ['🌐', 'globe'], ['🗑', 'bin'], ['🔍', 'search'],
  ['🔒', 'lock'], ['🔓', 'unlock'], ['👤', 'person'], ['👥', 'people'],
  ['📅', 'calendar'], ['🖥', 'computer'], ['⏹', 'stop'], ['📤', 'upload'],
  ['📋', 'memo'], ['💬', 'memo'], ['🆔', 'id'], ['🔴', 'redcircle'],
  ['🟢', 'greencircle'], ['⬜', 'whitesquare'], ['🔥', 'fire'], ['🔎', 'magnifier'],
  ['🔔', 'bell'], ['🔙', 'back'], ['🏠', 'home'], ['🤖', 'robot'],
  ['🔹', 'info'], ['📌', 'memo'], ['⏱', 'hourglass'], ['🎁', 'package'],
  ['➕', 'sparkles'], ['⏸', 'stop'], ['🔁', 'refresh'], ['🔌', 'gear'],
  ['📜', 'memo'], ['🧹', 'bin'], ['🚫', 'cross'], ['🟡', 'warning'],
  ['⭕', 'redcircle'], ['💡', 'sparkles'], ['📝', 'memo'], ['🗃', 'memo'],
  ['🛠', 'gear'], ['🧩', 'sparkles'], ['🔐', 'lock'], ['🎯', 'rocket'],
  ['📩', 'upload'], ['📨', 'upload'], ['🕐', 'hourglass'], ['⌛', 'hourglass'],
  ['🔂', 'refresh'], ['🔄', 'refresh'], ['📡', 'broadcast'], ['🌊', 'wave'],
  ['🔵', 'info'], ['👊', 'star'],
];

function autoPremium(text) {
  if (!text || typeof text !== 'string') return text;
  const map = loadMap();
  if (!map || Object.keys(map).length === 0) return text;

  if (!text.includes('<tg-emoji')) {
    let out = text;
    for (const [emoji, name] of EMOJI_NAME_BY_CHAR) {
      const id = map[name];
      if (id && out.includes(emoji)) {
        out = out.split(emoji).join(`<tg-emoji emoji-id="${id}">${emoji}</tg-emoji>`);
      }
    }
    return out;
  }

  const TAG_REGEX = /(<tg-emoji[^>]*>[\s\S]*?<\/tg-emoji>)/g;
  const parts = text.split(TAG_REGEX);
  const processed = parts.map((part, idx) => {
    if (idx % 2 === 1) return part;
    let out = part;
    for (const [emoji, name] of EMOJI_NAME_BY_CHAR) {
      const id = map[name];
      if (id && out.includes(emoji)) {
        out = out.split(emoji).join(`<tg-emoji emoji-id="${id}">${emoji}</tg-emoji>`);
      }
    }
    return out;
  });
  return processed.join('');
}

module.exports = { pe, escapeHtml, autoPremium };
