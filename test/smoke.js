'use strict';

/**
 * End-to-end smoke test: starts a server against a throwaway data directory,
 * adds a real PDF, logs pages, finishes it and checks the derived stats.
 *
 *   node test/smoke.js [path/to/sample.pdf]
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const APP_DIR = path.resolve(__dirname, '..');
const port = 8800 + Math.floor(Math.random() * 100);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-test-'));
const base = `http://127.0.0.1:${port}`;

const candidates = [
  process.argv[2],
  path.join(APP_DIR, 'test', 'sample.pdf'),
  '/home/dlrs/Downloads/preliminar.pdf',
].filter(Boolean);
const sample = candidates.find((file) => fs.existsSync(file));

async function call(method, route, body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const health = await call('GET', '/api/health');
      if (health.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('server did not start');
}

async function main() {
  if (!sample) throw new Error('Need a sample PDF: pass one as the first argument.');

  const server = spawn(process.execPath, [path.join(APP_DIR, 'server', 'server.js')], {
    env: { ...process.env, READINGMANAGER_DATA: dataDir, READINGMANAGER_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));

  try {
    await waitForServer();

    let result = await call('GET', '/api/state');
    assert.equal(result.status, 200);
    assert.equal(result.payload.books.length, 0);
    assert.equal(result.payload.stats.todayPages, 0);

    result = await call('GET', '/api/theme');
    assert.ok(result.payload.background.startsWith('#'));

    result = await call('POST', '/api/inspect', { path: sample });
    assert.equal(result.status, 200);
    assert.ok(result.payload.pages > 0, 'pdf has pages');

    result = await call('POST', '/api/books', { path: sample, currentPage: 1 });
    assert.equal(result.status, 201);
    const addedId = result.payload.addedBookId;
    const added = result.payload.books.find((book) => book.id === addedId);
    assert.ok(added, 'book was added');
    assert.ok(added.totalPages > 0, 'page count read');
    assert.equal(added.currentPage, 1);
    assert.ok(added.coverUrl, 'cover generated');

    const coverResponse = await fetch(base + added.coverUrl);
    assert.equal(coverResponse.status, 200);
    assert.match(coverResponse.headers.get('content-type') || '', /image\/jpeg/);

    result = await call('POST', `/api/books/${addedId}/log`, { pages: 3 });
    assert.equal(result.status, 200);
    let book = result.payload.books.find((entry) => entry.id === addedId);
    assert.equal(book.currentPage, 4);
    assert.equal(result.payload.stats.todayPages, 3);
    assert.equal(result.payload.stats.streak, 1);

    result = await call('POST', '/api/books', { path: sample });
    assert.equal(result.status, 409, 'duplicate path rejected');

    result = await call('POST', `/api/books/${addedId}/log`, { pages: 4000 });
    assert.equal(result.status, 200, 'huge logs clamp to the last page');
    book = result.payload.books.find((entry) => entry.id === addedId);
    assert.equal(book.currentPage, book.totalPages);
    assert.equal(book.status, 'finished');
    assert.ok(book.finishedAt);

    result = await call('POST', `/api/books/${addedId}/log`, { pages: -5 });
    book = result.payload.books.find((entry) => entry.id === addedId);
    assert.equal(book.status, 'active', 'undoing the finish reopens the book');

    result = await call('PATCH', `/api/books/${addedId}`, { title: 'Renamed', totalPages: 50 });
    book = result.payload.books.find((entry) => entry.id === addedId);
    assert.equal(book.title, 'Renamed');
    assert.equal(book.totalPages, 50);

    result = await call('POST', `/api/books/${addedId}/finish`);
    assert.equal(result.payload.books.find((entry) => entry.id === addedId).status, 'finished');

    result = await call('GET', '/api/browse?path=~');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.payload.entries));

    result = await call('DELETE', `/api/books/${addedId}`);
    assert.equal(result.payload.books.length, 0);

    console.log('smoke: ok');
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.on('exit', resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('smoke: failed —', error.message);
  process.exit(1);
});
