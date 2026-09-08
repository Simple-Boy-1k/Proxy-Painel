// services/lang.js — Multi-language support (en, bn)
const db = require('./db');

const STRINGS = {
  en: {
    welcome: '<b>Welcome, {name}!</b>',
    role_label: 'Role: <b>{role}</b>',
    choose_option: '\nChoose an option:',
    user_panel: '👤 User Panel',
    keys_panel: '🔑 Keys',
    uids_panel: '👥 IPs',
    proxy_panel: '📡 Proxy / Ports',
    sellers_panel: '👤 Users',
    owner_panel: '👑 Owner Panel',
    lang_btn: '🌐 Language',
    activate_key: '🚀 Activate Key',
    key_status: '📋 Key Status',
    change_ip: '♻️ Change IP',
    detect_ip: '🌐 Auto-Detect IP',
    key_found: '✅ Key Found!',
    key_duration: '📦 Duration: <b>{days} days</b>',
    key_slots: '👥 Slots: {used}/{max}',
    ip_detect_prompt: '🌐 Tap Auto-Detect IP or type manually.',
    ip_confirm_title: '🚀 <b>Confirm Activation</b>',
    ip_confirm_body: '🔑 Key: <code>{key}</code>\n🌐 IP: <code>{ip}</code>\n{dur}',
    ip_confirm_q: 'Proceed?',
    btn_yes_activate: '✅ Yes, Activate',
    btn_cancel: '❌ Cancel',
    act_success: '✅ <b>Proxy Activated!</b>\n🔑 Key: <code>{key}</code>\n🌐 IP: <code>{ip}</code>\n{dur}',
    ip_change_title: '♻️ <b>Change IP</b>',
    ip_current: '🌐 Current IP: <code>{ip}</code>',
    ip_new_prompt: '🌐 Tap Auto-Detect IP or type manually.',
    ip_change_confirm: '♻️ <b>Confirm IP Change</b>',
    ip_old: '🔄 Old IP: <code>{old}</code>',
    ip_new: '🌐 New IP: <code>{new}</code>',
    btn_yes_update: '✅ Yes, Update',
    back_main: '🔙 Main Menu',
  },
  bn: {
    welcome: '<b>স্বাগতম, {name}!</b>',
    role_label: 'ভূমিকা: <b>{role}</b>',
    choose_option: '\nঅপশন বেছে নিন:',
    user_panel: '👤 ইউজার প্যানেল',
    keys_panel: '🔑 কী',
    uids_panel: '👥 আইপি',
    proxy_panel: '📡 প্রক্সি / পোর্ট',
    sellers_panel: '👤 ব্যবহারকারী',
    owner_panel: '👑 ওনার প্যানেল',
    lang_btn: '🌐 ভাষা',
    activate_key: '🚀 কী অ্যাক্টিভেট',
    key_status: '📋 কী স্ট্যাটাস',
    change_ip: '♻️ আইপি পরিবর্তন',
    detect_ip: '🌐 অটো-ডিটেক্ট আইপি',
    key_found: '✅ কী পাওয়া গেছে!',
    key_duration: '📦 মেয়াদ: <b>{days} দিন</b>',
    key_slots: '👥 স্লট: {used}/{max}',
    ip_detect_prompt: '🌐 অটো-ডিটেক্ট আইপি ব্যবহার করুন বা ম্যানুয়ালি লিখুন।',
    ip_confirm_title: '🚀 <b>অ্যাক্টিভেশন নিশ্চিত করুন</b>',
    ip_confirm_body: '🔑 কী: <code>{key}</code>\n🌐 আইপি: <code>{ip}</code>\n{dur}',
    ip_confirm_q: 'নিশ্চিত করবেন?',
    btn_yes_activate: '✅ হ্যাঁ, অ্যাক্টিভেট করুন',
    btn_cancel: '❌ বাতিল',
    act_success: '✅ <b>প্রক্সি অ্যাক্টিভ!</b>\n🔑 কী: <code>{key}</code>\n🌐 আইপি: <code>{ip}</code>\n{dur}',
    ip_change_title: '♻️ <b>আইপি পরিবর্তন</b>',
    ip_current: '🌐 বর্তমান আইপি: <code>{ip}</code>',
    ip_new_prompt: '🌐 অটো-ডিটেক্ট আইপি ব্যবহার করুন বা ম্যানুয়ালি লিখুন।',
    ip_change_confirm: '♻️ <b>আইপি পরিবর্তন নিশ্চিত করুন</b>',
    ip_old: '🔄 পুরনো আইপি: <code>{old}</code>',
    ip_new: '🌐 নতুন আইপি: <code>{new}</code>',
    btn_yes_update: '✅ হ্যাঁ, আপডেট করুন',
    back_main: '🔙 মূল মেনু',
  },
};

const VALID_LANGS = ['en', 'bn'];
const DEFAULT_LANG = 'en';
const _langCache = new Map();

async function getLang(tgId) {
  const id = String(tgId);
  if (_langCache.has(id)) return _langCache.get(id);
  try {
    const row = await db.queryOne('SELECT setting_value FROM proxy_settings WHERE setting_key=?', [`lang_${id}`]);
    const lang = row?.setting_value || DEFAULT_LANG;
    _langCache.set(id, lang);
    return lang;
  } catch (_) { return DEFAULT_LANG; }
}

async function setLang(tgId, lang) {
  if (!VALID_LANGS.includes(lang)) lang = DEFAULT_LANG;
  const id = String(tgId);
  _langCache.set(id, lang);
  try {
    await db.exec('INSERT INTO proxy_settings (setting_key, setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=?', [`lang_${id}`, lang, lang]);
  } catch (_) {}
}

function langKeyboard() {
  const { Markup } = require('telegraf');
  return Markup.inlineKeyboard([
    [Markup.button.callback('🇬🇧 English', 'set_lang:en'), Markup.button.callback('🇧🇩 বাংলা', 'set_lang:bn')],
    [Markup.button.callback('🔙 Back', 'nav_main_menu')],
  ]);
}

function t(lang, key, vars = {}) {
  const dict = STRINGS[lang] || STRINGS[DEFAULT_LANG];
  let str = dict[key] ?? STRINGS[DEFAULT_LANG][key] ?? key;
  for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, v);
  return str;
}

async function tr(tgId, key, vars = {}) {
  const lang = await getLang(tgId);
  return t(lang, key, vars);
}

module.exports = { getLang, setLang, t, tr, langKeyboard, VALID_LANGS, DEFAULT_LANG, STRINGS };
