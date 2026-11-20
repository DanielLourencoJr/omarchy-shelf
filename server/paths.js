'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const HOME = os.homedir();

const APP_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(
  process.env.READINGMANAGER_DATA || path.join(HOME, '.local', 'share', 'readingmanager')
);
const DB_PATH = path.join(DATA_DIR, 'reading.db');
const COVERS_DIR = path.join(DATA_DIR, 'covers');
const LIBRARY_DIR = path.join(DATA_DIR, 'library');
const WEB_DIR = path.join(APP_DIR, 'web');

const PORT = Number(process.env.READINGMANAGER_PORT || 8765);
const HOST = process.env.READINGMANAGER_HOST || '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;

const THEME_PATHS = [
  path.join(HOME, '.local', 'state', 'omarchy', 'current', 'theme', 'colors.toml'),
  path.join(HOME, '.config', 'omarchy', 'current', 'theme', 'colors.toml'),
];

function ensureDirs() {
  for (const dir of [DATA_DIR, COVERS_DIR, LIBRARY_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Expand a leading `~` and resolve against the home directory. */
function expandPath(input) {
  if (!input) return '';
  let value = String(input).trim();
  if (value === '~') value = HOME;
  else if (value.startsWith('~/')) value = path.join(HOME, value.slice(2));
  if (!path.isAbsolute(value)) value = path.resolve(HOME, value);
  return path.normalize(value);
}

/** Compact a path for display, replacing the home directory with `~`. */
function displayPath(input) {
  if (!input) return '';
  if (input === HOME) return '~';
  if (input.startsWith(HOME + path.sep)) return '~' + input.slice(HOME.length);
  return input;
}

module.exports = {
  HOME,
  APP_DIR,
  DATA_DIR,
  DB_PATH,
  COVERS_DIR,
  LIBRARY_DIR,
  WEB_DIR,
  PORT,
  HOST,
  BASE_URL,
  THEME_PATHS,
  ensureDirs,
  expandPath,
  displayPath,
};
