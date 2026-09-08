// services/db.js — MySQL connection pool with auto-database creation
const mysql = require('mysql2/promise');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT) || 3306;
const DB_NAME = process.env.DB_NAME || 'proxy';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASS = process.env.DB_PASS || '';

const DB = { host: DB_HOST, port: DB_PORT, database: DB_NAME, user: DB_USER, password: DB_PASS };

let pool = null;
let _dbReady = false;

async function ensureDatabase() {
  if (_dbReady) return;
  const tempConn = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT,
    user: DB_USER, password: DB_PASS,
    charset: 'utf8mb4',
  });
  await tempConn.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await tempConn.end();
  console.log(`✅ Database '${DB_NAME}' ready (created if missing).`);
  _dbReady = true;
}

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: DB_HOST, port: DB_PORT, database: DB_NAME,
      user: DB_USER, password: DB_PASS,
      waitForConnections: true, connectionLimit: 10, queueLimit: 0,
      timezone: '+00:00', charset: 'utf8mb4',
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

async function exec(sql, params = []) {
  const [result] = await getPool().execute(sql, params);
  return result;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

async function raw(sql) {
  const [result] = await getPool().query(sql);
  return result;
}

module.exports = { query, exec, queryOne, raw, getPool, ensureDatabase, DB };
