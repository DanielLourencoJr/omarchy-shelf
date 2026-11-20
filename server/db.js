'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH, ensureDirs } = require('./paths');

const SCHEMA_VERSION = 1;

const DEFAULTS = {
  daily_goal: '20',
  reminder_enabled: '0',
  shelf_limit: '3',
};

let db = null;

function open() {
  if (db) return db;
  ensureDirs();
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(handle) {
  const version = Number(handle.prepare('PRAGMA user_version').get().user_version || 0);

  if (version < 1) {
    handle.exec(`
      CREATE TABLE IF NOT EXISTS books (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL,
        author      TEXT,
        path        TEXT,
        total_pages INTEGER NOT NULL DEFAULT 0,
        start_page  INTEGER NOT NULL DEFAULT 0,
        status      TEXT    NOT NULL DEFAULT 'active',
        color       TEXT,
        cover       TEXT,
        target_date TEXT,
        notes       TEXT,
        file_size   INTEGER,
        file_mtime  TEXT,
        created_at  TEXT    NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS logs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        date       TEXT    NOT NULL,
        pages      INTEGER NOT NULL,
        note       TEXT,
        created_at TEXT    NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS logs_book_date ON logs(book_id, date);
      CREATE INDEX IF NOT EXISTS logs_date ON logs(date);

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      PRAGMA user_version = 1;
    `);
  }
}

function getSetting(key, fallback = null) {
  const row = open().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback === null ? DEFAULTS[key] ?? null : fallback;
  return row.value;
}

function setSetting(key, value) {
  open()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

function allSettings() {
  const rows = open().prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULTS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

function touchBookFile(id) {
  // Reserved hook for future re-scan support.
  return id;
}

module.exports = {
  open,
  get db() {
    return open();
  },
  getSetting,
  setSetting,
  allSettings,
  DEFAULTS,
  touchBookFile,
  exists: () => fs.existsSync(DB_PATH),
  SCHEMA_VERSION,
};
