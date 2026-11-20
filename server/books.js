'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { open, getSetting, allSettings } = require('./db');
const { expandPath, displayPath, COVERS_DIR } = require('./paths');
const pdf = require('./pdf');

const PALETTE = ['#7aa2f7', '#9ece6a', '#bb9af7', '#7dcfff', '#e0af68', '#ff9e64', '#f7768e', '#73daca'];
const STATUSES = new Set(['active', 'paused', 'finished', 'dropped']);

class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------- dates

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayNumber(value) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function addDays(value, amount) {
  return new Date(dayNumber(value) + amount * 86400000).toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((dayNumber(to) - dayNumber(from)) / 86400000);
}

function isDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(dayNumber(value));
}

// ---------------------------------------------------------------- helpers

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round1 = (value) => Math.round(value * 10) / 10;

function row(id) {
  return open().prepare('SELECT * FROM books WHERE id = ?').get(id);
}

function allBooks() {
  return open().prepare('SELECT * FROM books ORDER BY id').all();
}

function allLogs() {
  return open().prepare('SELECT id, book_id, date, pages, note, created_at FROM logs ORDER BY date, id').all();
}

function pickColor() {
  const used = new Set(allBooks().map((book) => book.color));
  return PALETTE.find((color) => !used.has(color)) || PALETTE[allBooks().length % PALETTE.length];
}

function coverPath(book) {
  if (!book.cover) return null;
  const candidate = path.join(COVERS_DIR, book.cover);
  return fs.existsSync(candidate) ? candidate : null;
}

function coverUrl(book, version = '') {
  if (!book.cover) return null;
  return `/api/books/${book.id}/cover${version ? `?v=${encodeURIComponent(version)}` : ''}`;
}

// ---------------------------------------------------------------- stats

function streakFrom(dates, today) {
  if (!dates.has(today) && !dates.has(addDays(today, -1))) return 0;
  let cursor = dates.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function bestStreak(dates) {
  const sorted = [...dates].sort();
  let best = 0;
  let current = 0;
  let previous = null;
  for (const date of sorted) {
    current = previous && daysBetween(previous, date) === 1 ? current + 1 : 1;
    best = Math.max(best, current);
    previous = date;
  }
  return best;
}

function bookStats(book, logs, today) {
  const bookLogs = logs.filter((log) => log.book_id === book.id);
  const totalPages = Number(book.total_pages) || 0;
  const startPage = clamp(Number(book.start_page) || 0, 0, totalPages || Number.MAX_SAFE_INTEGER);
  const pagesLogged = bookLogs.reduce((sum, log) => sum + Number(log.pages || 0), 0);
  const currentPage = clamp(
    startPage + pagesLogged,
    0,
    totalPages > 0 ? totalPages : Number.MAX_SAFE_INTEGER
  );
  const remaining = totalPages > 0 ? Math.max(0, totalPages - currentPage) : null;
  const percent = totalPages > 0 ? clamp((currentPage / totalPages) * 100, 0, 100) : null;

  const todayPages = bookLogs
    .filter((log) => log.date === today)
    .reduce((sum, log) => sum + Number(log.pages || 0), 0);

  // Pace averages over the book's lifetime until it has a full week of data.
  // Count calendar days inclusively so a book added today divides by one.
  const startedDate = localDate(new Date(book.created_at));
  const startedDaysAgo = Math.max(0, daysBetween(startedDate, today));
  const paceWindowDays = Math.max(1, Math.min(7, startedDaysAgo + 1));

  const readingDates = new Set(bookLogs.filter((log) => Number(log.pages) !== 0).map((log) => log.date));
  const lastReadDate = readingDates.size ? [...readingDates].sort().at(-1) : null;
  const daysSinceRead = lastReadDate ? daysBetween(lastReadDate, today) : null;

  const last7 = bookLogs
    .filter((log) => log.date >= addDays(today, -6) && log.date <= today)
    .reduce((sum, log) => sum + Number(log.pages || 0), 0);
  const previous7 = bookLogs
    .filter((log) => log.date >= addDays(today, -13) && log.date <= addDays(today, -7))
    .reduce((sum, log) => sum + Number(log.pages || 0), 0);
  const pace = round1(last7 / paceWindowDays);

  const status =
    book.status === 'finished' || (totalPages > 0 && currentPage >= totalPages)
      ? 'finished'
      : book.status;

  let etaDays = null;
  let etaDate = null;
  if (remaining !== null && remaining > 0 && pace > 0) {
    etaDays = Math.ceil(remaining / pace);
    etaDate = addDays(today, etaDays);
  }

  let trend = 'flat';
  if (last7 > previous7 * 1.15 + 1) trend = 'up';
  else if (last7 < previous7 * 0.85 - 1) trend = 'down';

  const slipping =
    status === 'active' &&
    ((lastReadDate && daysSinceRead >= 3) || (!lastReadDate && startedDaysAgo >= 3));

  return {
    id: book.id,
    title: book.title,
    author: book.author || null,
    path: book.path,
    displayPath: book.path ? displayPath(book.path) : null,
    status,
    color: book.color || PALETTE[0],
    notes: book.notes || null,
    totalPages,
    startPage,
    currentPage,
    remaining,
    percent,
    pagesLogged,
    todayPages,
    lastReadDate,
    daysSinceRead,
    startedAt: book.created_at,
    finishedAt: book.finished_at,
    targetDate: book.target_date,
    coverUrl: coverUrl(book, book.file_mtime),
    coverPath: coverPath(book),
    pace,
    trend,
    etaDays,
    etaDate,
    streak: streakFrom(readingDates, today),
    slipping,
    activeDays: readingDates.size,
  };
}

function buildState(options = {}) {
  const today = options.today || localDate();
  const logs = allLogs();
  const books = allBooks().map((book) => bookStats(book, logs, today));
  const byId = new Map(books.map((book) => [book.id, book]));

  const dates = new Set(logs.filter((log) => Number(log.pages) !== 0).map((log) => log.date));
  const todayPages = logs
    .filter((log) => log.date === today)
    .reduce((sum, log) => sum + Number(log.pages || 0), 0);

  const last7 = [...Array(7).keys()].reduce((sum, offset) => {
    const date = addDays(today, -offset);
    return sum + logs.filter((log) => log.date === date).reduce((s, log) => s + Number(log.pages || 0), 0);
  }, 0);

  const last30 = [...Array(30).keys()].reduce((sum, offset) => {
    const date = addDays(today, -offset);
    return sum + logs.filter((log) => log.date === date).reduce((s, log) => s + Number(log.pages || 0), 0);
  }, 0);

  const allTimePages = logs.reduce((sum, log) => sum + Number(log.pages || 0), 0);

  const dailyMap = new Map();
  for (const log of logs) {
    dailyMap.set(log.date, (dailyMap.get(log.date) || 0) + Number(log.pages || 0));
  }
  const daily = [...Array(140).keys()]
    .map((offset) => addDays(today, -offset))
    .reverse()
    .map((date) => ({ date, pages: dailyMap.get(date) || 0 }));

  const active = books.filter((book) => book.status === 'active');
  const paused = books.filter((book) => book.status === 'paused');
  const finished = books.filter((book) => book.status === 'finished');
  const dropped = books.filter((book) => book.status === 'dropped');

  const focusCandidates = [...active].sort((a, b) => {
    if (a.lastReadDate !== b.lastReadDate) return (b.lastReadDate || '').localeCompare(a.lastReadDate || '');
    return (b.percent || 0) - (a.percent || 0);
  });

  const settings = allSettings();
  const goal = Math.max(1, Number(options.goal ?? settings.daily_goal) || 20);

  const order = { active: 0, paused: 1, finished: 2, dropped: 3 };
  const sorted = [...books].sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    if (a.status === 'active') {
      if (a.slipping !== b.slipping) return a.slipping ? -1 : 1;
      return (b.lastReadDate || '').localeCompare(a.lastReadDate || '');
    }
    return (b.finishedAt || b.startedAt).localeCompare(a.finishedAt || a.startedAt);
  });

  return {
    today,
    generatedAt: new Date().toISOString(),
    goal,
    books: sorted,
    stats: {
      todayPages,
      weekPages: last7,
      monthPages: last30,
      allTimePages,
      streak: streakFrom(dates, today),
      bestStreak: bestStreak(dates),
      readToday: dates.has(today),
      activeCount: active.length,
      pausedCount: paused.length,
      finishedCount: finished.length,
      droppedCount: dropped.length,
      focusBookId: focusCandidates[0]?.id ?? null,
      shelfLimit: Math.max(1, Number(settings.shelf_limit) || 3),
      daily,
    },
  };
}

// ---------------------------------------------------------------- mutations

async function addBook(input = {}) {
  const filePath = expandPath(input.path || '');
  if (!filePath) throw new UserError('A PDF path is required.');

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new UserError(`No file at ${displayPath(filePath)}`);
  }
  if (!stat.isFile()) throw new UserError(`${displayPath(filePath)} is not a file`);
  if (!/\.pdf$/i.test(filePath)) throw new UserError('The file must be a .pdf');

  const duplicate = open().prepare('SELECT * FROM books WHERE path = ?').get(filePath);
  if (duplicate) throw new UserError(`"${duplicate.title}" is already on the shelf.`, 409);

  const info = await pdf.inspect(filePath);
  const totalPages = Number(input.totalPages) || info.pages || 0;
  if (totalPages <= 0) {
    throw new UserError('Could not read the page count. Enter the total pages manually.', 422);
  }

  // Pages read before putting on shelf (does NOT count towards today's goal or streak)
  let startPage = Math.round(Number(input.startPage !== undefined ? input.startPage : (input.currentPage || 0)));
  startPage = clamp(startPage, 0, totalPages);

  // Pages read today (counts towards today's goal and streak)
  let readToday = Math.round(Number(input.readToday || 0));
  if (readToday > 0) {
    readToday = clamp(readToday, 0, Math.max(0, totalPages - startPage));
  }
  const initialCurrent = startPage + readToday;

  const cover = await pdf.makeCover(filePath);
  const now = new Date().toISOString();
  const status = STATUSES.has(input.status) ? input.status : 'active';

  const result = open()
    .prepare(
      `INSERT INTO books
        (title, author, path, total_pages, start_page, status, color, cover, target_date,
         notes, file_size, file_mtime, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(input.title || '').trim() || info.title,
      String(input.author || '').trim() || info.author,
      filePath,
      totalPages,
      startPage,
      status,
      input.color || pickColor(),
      cover,
      input.targetDate || null,
      input.notes || null,
      stat.size,
      String(stat.mtimeMs),
      now,
      initialCurrent >= totalPages ? now.slice(0, 10) : null
    );

  const addedBookId = Number(result.lastInsertRowid);
  if (readToday > 0) {
    logPages(addedBookId, readToday);
  }

  return { ...buildState(), addedBookId };
}

function updateBook(id, patch = {}) {
  const book = row(id);
  if (!book) throw new UserError('Book not found.', 404);

  const next = { ...book };
  if (patch.title !== undefined) {
    const title = String(patch.title).trim();
    if (!title) throw new UserError('Title cannot be empty.');
    next.title = title.slice(0, 300);
  }
  if (patch.author !== undefined) next.author = String(patch.author || '').trim().slice(0, 200) || null;
  if (patch.notes !== undefined) next.notes = String(patch.notes || '').slice(0, 5000) || null;
  if (patch.color !== undefined) next.color = String(patch.color || '') || null;
  if (patch.targetDate !== undefined) {
    next.target_date = patch.targetDate && isDateString(patch.targetDate) ? patch.targetDate : null;
  }
  if (patch.totalPages !== undefined) {
    const pages = Math.round(Number(patch.totalPages));
    if (!Number.isFinite(pages) || pages <= 0) throw new UserError('Total pages must be a positive number.');
    next.total_pages = pages;
  }
  if (patch.startPage !== undefined) {
    const sp = Math.round(Number(patch.startPage));
    if (!Number.isFinite(sp) || sp < 0) throw new UserError('Start page must be zero or more.');
    next.start_page = clamp(sp, 0, next.total_pages);
  } else if (patch.currentPage !== undefined) {
    const page = Math.round(Number(patch.currentPage));
    if (!Number.isFinite(page) || page < 0) throw new UserError('Current page must be zero or more.');
    const logged = open()
      .prepare('SELECT COALESCE(SUM(pages), 0) AS total FROM logs WHERE book_id = ?')
      .get(id).total;
    next.start_page = clamp(page - Number(logged || 0), 0, next.total_pages);
  }
  if (patch.status !== undefined) {
    if (!STATUSES.has(patch.status)) throw new UserError('Unknown status.');
    next.status = patch.status;
    next.finished_at =
      patch.status === 'finished' ? next.finished_at || localDate() : patch.status === 'active' ? null : next.finished_at;
  }

  open()
    .prepare(
      `UPDATE books SET title = ?, author = ?, notes = ?, color = ?, target_date = ?,
        total_pages = ?, start_page = ?, status = ?, finished_at = ? WHERE id = ?`
    )
    .run(
      next.title,
      next.author,
      next.notes,
      next.color,
      next.target_date,
      next.total_pages,
      next.start_page,
      next.status,
      next.finished_at,
      id
    );

  return buildState();
}

function deleteBook(id) {
  const book = row(id);
  if (!book) throw new UserError('Book not found.', 404);
  open().prepare('DELETE FROM books WHERE id = ?').run(id);
  if (book.cover) {
    try {
      fs.unlinkSync(path.join(COVERS_DIR, book.cover));
    } catch {}
  }
  return buildState();
}

function logPages(id, input = {}) {
  const book = row(id);
  if (!book) throw new UserError('Book not found.', 404);

  const pages = Math.round(Number(input.pages));
  if (!Number.isFinite(pages) || pages === 0) throw new UserError('Enter how many pages you read.');
  if (Math.abs(pages) > 5000) throw new UserError('That is more pages than a day should hold.');

  const date = isDateString(input.date) ? input.date : localDate();
  const now = new Date().toISOString();

  const tx = open();
  tx.exec('BEGIN IMMEDIATE');
  try {
    tx.prepare(
      `INSERT INTO logs (book_id, date, pages, note, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(book_id, date) DO UPDATE SET pages = pages + excluded.pages, note = excluded.note`
    ).run(id, date, pages, input.note ? String(input.note).slice(0, 500) : null, now);

    const logged = Number(
      tx.prepare('SELECT COALESCE(SUM(pages), 0) AS total FROM logs WHERE book_id = ?').get(id).total || 0
    );
    const totalPages = Number(book.total_pages) || 0;
    let currentPage = Number(book.start_page) + logged;

    if (totalPages > 0 && currentPage > totalPages) {
      const overflow = currentPage - totalPages;
      tx.prepare('UPDATE logs SET pages = pages - ? WHERE book_id = ? AND date = ?').run(overflow, id, date);
      currentPage = totalPages;
    }
    if (currentPage < 0) {
      const deficit = -currentPage;
      tx.prepare('UPDATE logs SET pages = pages + ? WHERE book_id = ? AND date = ?').run(deficit, id, date);
      currentPage = 0;
    }
    tx.prepare('DELETE FROM logs WHERE book_id = ? AND pages = 0').run(id);

    if (totalPages > 0 && currentPage >= totalPages && book.status !== 'finished') {
      tx.prepare("UPDATE books SET status = 'finished', finished_at = ? WHERE id = ?").run(date, id);
    }
    // Undoing the pages that crossed the finish line puts the book back on the shelf.
    if (pages < 0 && totalPages > 0 && currentPage < totalPages && book.status === 'finished') {
      tx.prepare("UPDATE books SET status = 'active', finished_at = NULL WHERE id = ?").run(id);
    }
    tx.exec('COMMIT');
  } catch (error) {
    tx.exec('ROLLBACK');
    throw error;
  }

  const state = buildState();
  return { ...state, loggedDate: date };
}

function deleteLog(id, date) {
  const book = row(id);
  if (!book) throw new UserError('Book not found.', 404);
  if (!isDateString(date)) throw new UserError('Invalid date.');
  open().prepare('DELETE FROM logs WHERE book_id = ? AND date = ?').run(id, date);
  return buildState();
}

function finishBook(id) {
  const book = row(id);
  if (!book) throw new UserError('Book not found.', 404);
  open().prepare("UPDATE books SET status = 'finished', finished_at = ? WHERE id = ?").run(localDate(), id);
  return buildState();
}

function reopenBook(id) {
  const book = row(id);
  if (!book) throw new UserError('Book not found.', 404);
  open().prepare("UPDATE books SET status = 'active', finished_at = NULL WHERE id = ?").run(id);
  return buildState();
}

function bookDetail(id) {
  const book = row(id);
  if (!book) throw new UserError('Book not found.', 404);
  const state = buildState();
  const stats = state.books.find((entry) => entry.id === Number(id));
  const logs = open()
    .prepare('SELECT date, pages, note FROM logs WHERE book_id = ? ORDER BY date DESC')
    .all(id);
  return { book: stats, logs };
}

module.exports = {
  UserError,
  PALETTE,
  localDate,
  buildState,
  addBook,
  updateBook,
  deleteBook,
  logPages,
  deleteLog,
  finishBook,
  reopenBook,
  bookDetail,
  coverPath,
  getSetting,
};
