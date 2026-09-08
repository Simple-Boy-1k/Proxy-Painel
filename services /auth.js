// services/auth.js — Role checks against MySQL admin_users table
const db = require('./db');
const { SUPER_ADMIN_ID } = require('../config');

async function getUser(ctx) {
  const tgId = String(ctx.from.id);
  const uname = ctx.from.username ? ctx.from.username.toLowerCase().replace(/^@/, '') : null;
  const rows = await db.query(
    `SELECT * FROM admin_users WHERE status='active' AND bot_id='main'
     AND (note LIKE ? OR (? IS NOT NULL AND note LIKE ?) OR (username IS NOT NULL AND LOWER(username) = ?))`,
    [`%tg:${tgId}%`, uname, uname ? `%tguser:${uname}%` : '__none__', uname || '__none__']
  );
  if (!rows[0]) return null;
  const u = rows[0];
  if (uname && (u.note || '').includes(`tguser:${uname}`) && !(u.note || '').includes(`tg:${tgId}`)) {
    const newNote = (u.note || '').replace(`tguser:${uname}`, `tg:${tgId}`);
    await db.exec('UPDATE admin_users SET note=? WHERE id=?', [newNote, u.id]);
    u.note = newNote;
  }
  return u;
}

async function isOwner(ctx) {
  if (String(ctx.from.id) === SUPER_ADMIN_ID) return true;
  const u = await getUser(ctx);
  return !!(u && u.role === 'owner');
}

async function isAdmin(ctx) {
  if (String(ctx.from.id) === SUPER_ADMIN_ID) return true;
  const u = await getUser(ctx);
  return !!(u && (u.role === 'owner' || u.role === 'admin'));
}

async function isSeller(ctx) {
  if (String(ctx.from.id) === SUPER_ADMIN_ID) return true;
  const u = await getUser(ctx);
  return !!(u && (u.role === 'owner' || u.role === 'admin' || u.role === 'seller'));
}

async function linkTelegram(userId, tgId) {
  const u = await db.queryOne('SELECT note FROM admin_users WHERE id=?', [userId]);
  if (!u) return false;
  const note = u.note || '';
  if (note.includes(`tg:${tgId}`)) return true;
  const newNote = note ? `${note} tg:${tgId}` : `tg:${tgId}`;
  await db.exec('UPDATE admin_users SET note=? WHERE id=?', [newNote, userId]);
  return true;
}

module.exports = { getUser, isOwner, isAdmin, isSeller, linkTelegram };
