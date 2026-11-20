'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const config = require('./paths');
const db = require('./db');
const books = require('./books');
const pdf = require('./pdf');
const { readTheme } = require('./theme');

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 400 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ---------------------------------------------------------------- helpers

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendError(res, error) {
  const status = error instanceof books.UserError ? error.status : 500;
  if (status >= 500) console.error('[reading]', error);
  sendJson(res, status, { error: error.message || 'Something went wrong.' });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        reject(new books.UserError('Request body too large.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new books.UserError('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function safeName(name) {
  return String(name || 'upload.pdf')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+/, '')
    .slice(0, 180) || 'upload.pdf';
}

async function saveUpload(req, filename) {
  const target = path.join(config.LIBRARY_DIR, `${Date.now()}-${safeName(filename)}`);
  await fsp.mkdir(config.LIBRARY_DIR, { recursive: true });
  const handle = await fsp.open(target, 'w');
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) throw new books.UserError('PDF is too large (max 400 MB).', 413);
      await handle.write(chunk);
    }
  } catch (error) {
    await handle.close();
    await fsp.unlink(target).catch(() => {});
    throw error;
  }
  await handle.close();
  return target;
}

function browse(target) {
  const dir = config.expandPath(target || '~');
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    throw new books.UserError(`No folder at ${config.displayPath(dir)}`);
  }
  if (!stat.isDirectory()) throw new books.UserError(`${config.displayPath(dir)} is not a folder`);

  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push({ name: entry.name, path: full, type: 'dir' });
    } else if (/\.pdf$/i.test(entry.name)) {
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {}
      entries.push({ name: entry.name, path: full, type: 'pdf', size });
    }
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const parent = path.dirname(dir);
  return {
    path: dir,
    displayPath: config.displayPath(dir),
    parent: parent === dir ? null : parent,
    home: config.HOME,
    entries: entries.slice(0, 400),
  };
}

function suggestPaths(query) {
  let raw = String(query || '').trim();
  const home = config.HOME;
  if (!raw) raw = '~/';
  const expanded = config.expandPath(raw);
  let dir, prefix;
  if (raw.endsWith('/') || raw.endsWith(path.sep)) {
    dir = expanded;
    prefix = '';
  } else {
    dir = path.dirname(expanded);
    prefix = path.basename(expanded).toLowerCase();
  }
  if (!fs.existsSync(dir)) return [];
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const matches = [];
    for (const ent of entries) {
      if (ent.name.startsWith('.') && !prefix.startsWith('.')) continue;
      if (!ent.name.toLowerCase().startsWith(prefix)) continue;
      const isDir = ent.isDirectory();
      if (!isDir && !ent.name.toLowerCase().endsWith('.pdf')) continue;
      const full = path.join(dir, ent.name) + (isDir ? '/' : '');
      const display = config.displayPath(full);
      matches.push({ display, path: full, isDir, name: ent.name + (isDir ? '/' : '') });
    }
    matches.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
    return matches.slice(0, 15);
  } catch {
    return [];
  }
}

async function inspectPath(target) {
  const file = config.expandPath(target || '');
  if (!file) throw new books.UserError('A PDF path is required.');
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new books.UserError(`No file at ${config.displayPath(file)}`);
  }
  if (!stat.isFile() || !/\.pdf$/i.test(file)) throw new books.UserError('That path is not a PDF.');
  const info = await pdf.inspect(file);
  return {
    path: file,
    displayPath: config.displayPath(file),
    size: stat.size,
    pages: info.pages,
    title: info.title,
    author: info.author,
    encrypted: info.encrypted,
  };
}

// ---------------------------------------------------------------- static

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(config.WEB_DIR, relative);
  if (!target.startsWith(config.WEB_DIR + path.sep) && target !== path.join(config.WEB_DIR, 'index.html')) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  try {
    const data = await fsp.readFile(target);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

// ---------------------------------------------------------------- routes

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;
  const method = req.method;

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { ok: true, version: 1, dataDir: config.DATA_DIR });
  }

  if (pathname === '/api/state' && method === 'GET') {
    return sendJson(res, 200, books.buildState());
  }

  if (pathname === '/api/theme' && method === 'GET') {
    return sendJson(res, 200, readTheme());
  }

  if (pathname === '/api/settings' && method === 'GET') {
    return sendJson(res, 200, { settings: db.allSettings() });
  }

  if (pathname === '/api/settings' && method === 'PATCH') {
    const body = await readJson(req);
    for (const [key, value] of Object.entries(body)) {
      if (['daily_goal', 'shelf_limit', 'reminder_enabled'].includes(key)) db.setSetting(key, value);
    }
    return sendJson(res, 200, { settings: db.allSettings(), state: books.buildState() });
  }

  if (pathname === '/api/browse' && method === 'GET') {
    return sendJson(res, 200, browse(searchParams.get('path')));
  }

  if (pathname === '/api/suggest' && method === 'GET') {
    return sendJson(res, 200, { suggestions: suggestPaths(searchParams.get('q')) });
  }

  if (pathname === '/api/inspect' && method === 'POST') {
    const body = await readJson(req);
    return sendJson(res, 200, await inspectPath(body.path));
  }

  if (pathname === '/api/books' && method === 'POST') {
    const body = await readJson(req);
    const state = await books.addBook(body);
    return sendJson(res, 201, state);
  }

  if (pathname === '/api/books/upload' && method === 'POST') {
    const filename = searchParams.get('filename') || 'upload.pdf';
    const saved = await saveUpload(req, filename);
    try {
      const state = await books.addBook({ ...(await readJsonFromQuery(searchParams)), path: saved });
      return sendJson(res, 201, state);
    } catch (error) {
      await fsp.unlink(saved).catch(() => {});
      throw error;
    }
  }

  const bookMatch = pathname.match(/^\/api\/books\/(\d+)$/);
  if (bookMatch) {
    const id = Number(bookMatch[1]);
    if (method === 'GET') return sendJson(res, 200, books.bookDetail(id));
    if (method === 'PATCH') return sendJson(res, 200, books.updateBook(id, await readJson(req)));
    if (method === 'DELETE') return sendJson(res, 200, books.deleteBook(id));
  }

  const coverMatch = pathname.match(/^\/api\/books\/(\d+)\/cover$/);
  if (coverMatch && method === 'GET') {
    const book = books.bookDetail(Number(coverMatch[1])).book;
    const file = book.coverPath;
    if (file && fs.existsSync(file)) {
      const data = await fsp.readFile(file);
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': data.length,
        'Cache-Control': 'public, max-age=86400',
      });
      return res.end(data);
    }
    return sendJson(res, 404, { error: 'No cover for this book' });
  }

  const logMatch = pathname.match(/^\/api\/books\/(\d+)\/log$/);
  if (logMatch && method === 'POST') {
    return sendJson(res, 200, books.logPages(Number(logMatch[1]), await readJson(req)));
  }

  const logDateMatch = pathname.match(/^\/api\/books\/(\d+)\/log\/(\d{4}-\d{2}-\d{2})$/);
  if (logDateMatch && method === 'DELETE') {
    return sendJson(res, 200, books.deleteLog(Number(logDateMatch[1]), logDateMatch[2]));
  }

  const finishMatch = pathname.match(/^\/api\/books\/(\d+)\/finish$/);
  if (finishMatch && method === 'POST') {
    return sendJson(res, 200, books.finishBook(Number(finishMatch[1])));
  }

  const reopenMatch = pathname.match(/^\/api\/books\/(\d+)\/reopen$/);
  if (reopenMatch && method === 'POST') {
    return sendJson(res, 200, books.reopenBook(Number(reopenMatch[1])));
  }

  return sendJson(res, 404, { error: 'Unknown API route' });
}

function readJsonFromQuery(params) {
  const out = {};
  for (const [key, value] of params) {
    if (['title', 'author', 'notes', 'targetDate'].includes(key)) out[key] = value;
    if (['totalPages', 'currentPage', 'startPage', 'readToday'].includes(key)) out[key] = Number(value);
  }
  return out;
}

// ---------------------------------------------------------------- server

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || `${config.HOST}:${config.PORT}`}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch((error) => sendError(res, error));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    serveStatic(req, res, url.pathname).catch((error) => sendError(res, error));
  });
}

function start() {
  config.ensureDirs();
  db.open();
  const server = createServer();
  server.listen(config.PORT, config.HOST, () => {
    fs.writeFileSync(path.join(config.DATA_DIR, 'server.pid'), String(process.pid));
    console.log(`[reading] http://${config.HOST}:${config.PORT}`);
    console.log(`[reading] data: ${config.DATA_DIR}`);
  });
  const shutdown = () => {
    try {
      fs.unlinkSync(path.join(config.DATA_DIR, 'server.pid'));
    } catch {}
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

module.exports = { createServer, start };

if (require.main === module) start();
