'use strict';

/* Shelf — a deliberately small reading manager. */

const app = {
  data: null,
  theme: null,
  logBookId: null,
  menuBookId: null,
  editMode: false,
  uploadFile: null,
  inspecting: false,
  detected: null,
  suggestionTimer: null,
  suggestionIndex: -1,
  pollTimer: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// ---------------------------------------------------------------- helpers

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);

function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function parseDay(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDay(value, options = { month: 'short', day: 'numeric' }) {
  if (!value) return '';
  return parseDay(value.slice(0, 10)).toLocaleDateString(undefined, options);
}

function todayDay() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function api(method, url, body, options = {}) {
  const config = { method, headers: {} };
  if (body !== undefined && body !== null) {
    if (body instanceof File || body instanceof Blob) {
      config.body = body;
      config.headers['Content-Type'] = 'application/pdf';
    } else {
      config.body = JSON.stringify(body);
      config.headers['Content-Type'] = 'application/json';
    }
  }
  if (options.headers) Object.assign(config.headers, options.headers);

  const response = await fetch(url, config);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text || `Request failed (${response.status})` };
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed (${response.status})`);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

// ---------------------------------------------------------------- theme

function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement.style;
  const set = (name, value) => value && root.setProperty(name, value);

  set('--bg', theme.background);
  set('--bg-deep', theme.dark_background);
  set('--bg-panel', theme.lighter_background);
  set('--bg-raised', theme.selection);
  set('--text', theme.foreground);
  set('--text-bright', theme.bright_foreground || theme.light_foreground);
  set('--dim', theme.dark_foreground);
  set('--faint', `color-mix(in srgb, ${theme.dark_foreground} 74%, ${theme.background})`);
  set('--accent', theme.accent);
  set('--green', theme.green);
  set('--yellow', theme.yellow);
  set('--orange', theme.orange);
  set('--red', theme.red);
  set('--magenta', theme.magenta);
  set('--cyan', theme.cyan);
  document.documentElement.style.colorScheme = theme.mode === 'light' ? 'light' : 'dark';
}

// ---------------------------------------------------------------- toasts

function addToast(message, kind = '', action = null) {
  const wrap = $('#toasts');
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`.trim();
  toast.innerHTML = `<span>${esc(message)}</span>`;
  if (action) {
    const button = document.createElement('button');
    button.className = 'toast-undo';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      action.run();
      toast.remove();
    });
    toast.append(button);
  }
  wrap.append(toast);
  setTimeout(() => toast.remove(), 7000);
}

// ---------------------------------------------------------------- rendering

function initialsFor(title) {
  return String(title || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

function percentLabel(book) {
  return book.percent === null ? '—' : `${Math.round(book.percent)}%`;
}

function progressLine(book) {
  if (!book.totalPages) return 'Page count unknown';
  if (book.status === 'finished') return `${book.totalPages} pages · finished`;
  return `p. ${book.currentPage} / ${book.totalPages}`;
}

function paceLine(book) {
  if (book.status === 'finished') {
    const when = book.finishedAt ? `· ${formatDay(book.finishedAt)}` : '';
    return `Finished ${when}`.trim();
  }
  const bits = [];
  if (book.pace > 0) {
    const arrow = book.trend === 'up' ? ' ↑' : book.trend === 'down' ? ' ↓' : '';
    bits.push(`${book.pace} pages/day${arrow}`);
  }
  if (book.etaDate) bits.push(`finish ~${formatDay(book.etaDate)}`);
  else if (book.remaining > 0 && book.pace === 0) bits.push('no recent reading');
  return bits.join(' · ') || '—';
}

function bookCard(book, { compact = false } = {}) {
  const cover = book.coverUrl
    ? `<img src="${esc(book.coverUrl)}" alt="" loading="lazy" onerror="this.remove()" />`
    : '';
  const percent = book.percent ?? 0;
  const todayChip = book.todayPages > 0
    ? `<span class="chip today">+${book.todayPages} today</span>`
    : '<span class="chip">not yet today</span>';
  const slippingChip = book.slipping
    ? `<span class="chip slipping">slipping${book.daysSinceRead ? ` · ${book.daysSinceRead}d` : ''}</span>`
    : '';
  const percentChip = book.percent !== null ? `<span class="chip percent">${percentLabel(book)}</span>` : '';

  const noteClass = book.trend === 'up' ? 'up' : book.trend === 'down' ? 'down' : '';

  return `
    <article class="book ${compact ? 'compact' : ''} ${book.status === 'finished' ? 'finished' : ''} ${book.slipping ? 'slipping' : ''}"
             style="--book-color: ${esc(book.color)}" data-id="${book.id}">
      <div class="cover">
        <span class="initials">${esc(initialsFor(book.title))}</span>
        ${cover}
      </div>
      <div class="book-main">
        <div class="book-head">
          <div class="book-title-wrap">
            <h3 title="${esc(book.title)}">${esc(book.title)}</h3>
            <p class="author">${esc(book.author || 'Unknown author')}</p>
          </div>
          <button class="menu-btn" data-action="menu" data-id="${book.id}" aria-label="Book options">⋯</button>
        </div>

        <div class="progress">
          <div class="bar"><span style="width:${Math.min(100, percent).toFixed(2)}%"></span></div>
          <div class="progress-meta">
            <span>${esc(progressLine(book))}</span>
            <span>${book.remaining !== null && book.status !== 'finished' ? `${book.remaining} left` : percentLabel(book)}</span>
          </div>
        </div>

        <div class="book-note ${noteClass}">${esc(paceLine(book))}</div>

        ${compact ? '' : `
        <div class="book-foot">
          <div class="chip-cluster">
            ${todayChip}
            ${slippingChip}
          </div>
          <div class="quick">
            ${book.status === 'finished' ? percentChip : `
              <button data-action="log" data-id="${book.id}" data-pages="1" title="Log 1 page">+1</button>
              <button data-action="log" data-id="${book.id}" data-pages="5" title="Log 5 pages">+5</button>
              <button data-action="log" data-id="${book.id}" data-pages="10" title="Log 10 pages">+10</button>
              <button data-action="log-custom" data-id="${book.id}" title="Log custom amount">…</button>
            `}
          </div>
        </div>`}
      </div>
    </article>`;
}

function emptyState(html) {
  return `<div class="empty">${html}</div>`;
}

function render() {
  const data = app.data;
  if (!data) return;

  const stats = data.stats;
  const goalPercent = Math.min(1, stats.todayPages / data.goal);

  // Header
  $('#goalRing').style.strokeDashoffset = String(113 - 113 * goalPercent);
  $('#goalRing').style.stroke = stats.todayPages >= data.goal ? 'var(--green)' : 'var(--accent)';
  $('#goalPages').textContent = stats.todayPages;
  $('#goalTarget').textContent = `/ ${data.goal} pages`;
  $('#streakDays').textContent = stats.streak;
  $('#streakPill').classList.toggle('zero', stats.streak === 0);

  const activeCount = stats.activeCount;
  $('#brandSub').textContent = activeCount === 0
    ? 'an empty shelf is a fresh start'
    : activeCount === 1
      ? 'one book in progress'
      : `${activeCount} books in progress`;

  // Focus banner
  const active = data.books.filter((book) => book.status === 'active');
  const focus = active.find((book) => book.id === stats.focusBookId) || active[0];
  const banner = $('#focusBanner');
  if (focus) {
    banner.hidden = false;
    let line;
    if (focus.remaining !== null && focus.remaining <= 35) {
      line = `Only ${plural(Math.max(0, focus.remaining), 'page')} from the end of “${focus.title}”. Finish it today.`;
    } else if (focus.todayPages > 0) {
      line = `You read ${plural(focus.todayPages, 'page')} of “${focus.title}” today. ${focus.remaining} to go.`;
    } else if (focus.lastReadDate && focus.daysSinceRead >= 2) {
      line = `“${focus.title}” is waiting — ${plural(focus.daysSinceRead, 'day')} since your last page.`;
    } else {
      line = `Pick up “${focus.title}” — ${plural(focus.remaining ?? 0, 'page')} left to the end.`;
    }
    $('#focusLine').textContent = line;

    const figures = [
      { value: percentLabel(focus), label: 'complete' },
      { value: focus.remaining === null ? '—' : focus.remaining, label: 'pages left' },
      { value: focus.pace, label: 'pages / day' },
      { value: focus.etaDays === null ? '—' : focus.etaDays, label: 'days to finish' },
    ];
    $('#focusFigures').innerHTML = figures
      .map((figure) => `<div class="focus-figure"><strong>${esc(figure.value)}</strong><span>${esc(figure.label)}</span></div>`)
      .join('');
  } else {
    banner.hidden = true;
  }

  // Active shelf
  $('#activeMeta').textContent = active.length
    ? `${plural(active.length, 'book')} · ${stats.todayPages >= data.goal ? 'daily goal reached' : `${Math.max(0, data.goal - stats.todayPages)} pages to today's goal`}`
    : '';
  $('#activeBooks').innerHTML = active.length
    ? active.map((book) => bookCard(book)).join('')
    : emptyState(`
        <div class="empty-icon">📚</div>
        <h3>Nothing on the shelf yet</h3>
        <p>Add the PDF you are reading right now. Shelf reads its page count and first page, then keeps score of every page you turn.</p>
        <button class="btn primary" data-action="add">Add your first book</button>
      `);

  // Paused
  const paused = data.books.filter((book) => book.status === 'paused');
  $('#pausedSection').hidden = paused.length === 0;
  $('#pausedBooks').innerHTML = paused.map((book) => bookCard(book, { compact: true })).join('');

  // Finished
  const finished = data.books.filter((book) => book.status === 'finished');
  $('#finishedSection').hidden = finished.length === 0;
  $('#finishedBooks').innerHTML = finished.map((book) => bookCard(book, { compact: true })).join('');
  $('#finishedMeta').textContent = finished.length ? `${plural(finished.length, 'book')} completed` : '';

  // Heatmap
  renderHeatmap(stats.daily, data.goal);

  // Stats
  const uniqueDays = stats.daily.filter((day) => day.pages > 0).length;
  $('#historyMeta').textContent = `${plural(uniqueDays, 'day')} with pages in the last ${stats.daily.length} days`;
  $('#statsRow').innerHTML = [
    { value: stats.todayPages, label: 'pages today' },
    { value: stats.weekPages, label: 'last 7 days' },
    { value: stats.monthPages, label: 'last 30 days' },
    { value: stats.allTimePages, label: 'pages all time' },
    { value: stats.bestStreak, label: 'best streak (days)' },
    { value: stats.finishedCount, label: 'books finished' },
  ]
    .map((stat) => `<div class="stat"><strong>${esc(stat.value)}</strong><span>${esc(stat.label)}</span></div>`)
    .join('');
}

function renderHeatmap(days, goal) {
  const map = $('#heatmap');
  if (!days.length) {
    map.innerHTML = '';
    return;
  }
  const first = parseDay(days[0].date);
  const weekday = (first.getDay() + 6) % 7; // Monday = 0
  const cells = [];
  for (let i = 0; i < weekday; i += 1) {
    cells.push('<i class="cell l0 future"></i>');
  }
  for (const day of days) {
    const ratio = goal > 0 ? day.pages / goal : 0;
    const level = day.pages === 0 ? 0 : ratio < 0.5 ? 1 : ratio < 1 ? 2 : ratio < 1.6 ? 3 : 4;
    const title = `${formatDay(day.date, { weekday: 'short', month: 'short', day: 'numeric' })} — ${plural(day.pages, 'page')}`;
    cells.push(`<i class="cell l${level}" title="${esc(title)}"></i>`);
  }
  map.innerHTML = cells.join('');
}

// ---------------------------------------------------------------- loading

async function loadState() {
  try {
    const data = await api('GET', '/api/state');
    app.data = data;
    render();
  } catch (error) {
    addToast(`Could not load the shelf: ${error.message}`, 'error');
  }
}

async function refreshFrom(promise) {
  const data = await promise;
  if (data && data.books) {
    app.data = data;
    render();
  }
}

// ---------------------------------------------------------------- log flow

function openLog(id, presetPages = null) {
  const book = app.data?.books.find((entry) => entry.id === Number(id));
  if (!book) return;
  app.logBookId = book.id;

  $('#logTitle').textContent = `Log pages`;
  $('#logSub').textContent = `“${book.title}” · ${book.remaining !== null ? `${book.remaining} pages left` : 'page count unknown'}`;
  $('#logPages').value = presetPages ?? '';
  $('#logDate').value = app.data.today || todayDay();
  $('#logDate').max = app.data.today || todayDay();
  $('#logNote').value = '';
  $('#logError').hidden = true;
  $('#logHint').textContent = book.pace > 0
    ? `Your current pace is ${book.pace} pages/day.`
    : 'Even one page keeps the streak alive.';

  const quick = [1, 5, 10, 20];
  const chips = quick.map((pages) => `<button type="button" data-quick="${pages}">+${pages}</button>`);
  if (book.remaining !== null && book.remaining > 0 && book.remaining <= 80) {
    chips.push(`<button type="button" data-quick="${book.remaining}">Finish (+${book.remaining})</button>`);
  }
  $('#logQuick').innerHTML = chips.join('');

  const dialog = $('#logDialog');
  if (!dialog.open) dialog.showModal();
  setTimeout(() => $('#logPages').focus(), 60);
}

async function submitLog(event) {
  event.preventDefault();
  const pages = Number($('#logPages').value);
  const error = $('#logError');
  if (!Number.isFinite(pages) || pages === 0) {
    error.textContent = 'Enter how many pages you read.';
    error.hidden = false;
    return;
  }
  const body = { pages, date: $('#logDate').value || undefined, note: $('#logNote').value || undefined };
  try {
    const bookId = app.logBookId;
    const bookBefore = app.data.books.find((entry) => entry.id === bookId);
    const data = await api('POST', `/api/books/${bookId}/log`, body);
    app.data = data;
    render();
    $('#logDialog').close();

    const bookAfter = data.books.find((entry) => entry.id === bookId);
    const finishedNow = bookAfter?.status === 'finished' && bookBefore?.status !== 'finished';
    if (finishedNow) {
      addToast(`Finished “${bookAfter.title}”. That is the whole point. 🎉`, 'success');
    } else {
      addToast(`Logged ${plural(Math.abs(pages), 'page')} in “${bookAfter?.title || 'book'}”.`, 'success', {
        label: 'Undo',
        run: async () => {
          try {
            await refreshFrom(api('POST', `/api/books/${bookId}/log`, { pages: -pages, date: body.date }));
          } catch (undoError) {
            addToast(undoError.message, 'error');
          }
        },
      });
    }
  } catch (submitError) {
    error.textContent = submitError.message;
    error.hidden = false;
  }
}

// ---------------------------------------------------------------- add flow

function openAdd() {
  if (!app.data) return;
  $('#addForm').reset();
  app.uploadFile = null;
  app.detected = null;
  $('#detected').hidden = true;
  $('#addError').hidden = true;
  $('#addSubmit').disabled = false;
  $('#addSubmit').textContent = 'Add to shelf';
  $('#totalInput').value = '';
  $('#titleInput').value = '';
  $('#authorInput').value = '';
  $('#startPageInput').value = '';
  $('#readTodayInput').value = '';
  $('#pathSuggestions').hidden = true;
  $('#dropTitle').textContent = 'Drop a PDF here';
  $('#dropSub').textContent = 'or click to choose a file — it is copied into your local shelf library';
  $('#dropzone').classList.remove('has-file');
  setTab('path');

  const stats = app.data.stats;
  const warning = $('#shelfWarning');
  const active = app.data.books.filter((book) => book.status === 'active');
  if (active.length >= stats.shelfLimit) {
    warning.hidden = false;
    const names = active.map((book) => `“${esc(book.title)}” (${percentLabel(book)})`).join(', ');
    warning.innerHTML = `<strong>${plural(active.length, 'book')} already in progress.</strong> ${names}. Adding another makes it easier to abandon all of them — but it is your shelf.`;
  } else {
    warning.hidden = true;
  }

  $('#addDialog').showModal();
  setTimeout(() => $('#pathInput').focus(), 80);
}

function setTab(tab) {
  $$('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  $$('.tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
  $('#addHint').textContent = tab === 'path'
    ? 'One book at a time is the whole trick.'
    : 'The PDF is copied once into ~/.local/share/readingmanager/library.';
  app.currentTab = tab;
}

async function inspectPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return;
  if (app.inspecting) return;
  app.inspecting = true;
  const error = $('#addError');
  error.hidden = true;
  try {
    const info = await api('POST', '/api/inspect', { path: raw });
    app.detected = info;
    $('#detected').hidden = false;
    $('#detectedTitle').textContent = info.title || 'Untitled PDF';
    $('#detectedMeta').textContent = [
      info.author,
      info.pages ? plural(info.pages, 'page') : 'page count unavailable',
      info.displayPath,
    ].filter(Boolean).join(' · ');
    if (info.pages) {
      $('#totalInput').placeholder = String(info.pages);
      $('#startPageInput').max = String(info.pages);
      $('#readTodayInput').max = String(info.pages);
    }
    $('#titleInput').placeholder = info.title || 'Detected from the PDF';
    $('#authorInput').placeholder = info.author || 'Optional';
  } catch (inspectError) {
    app.detected = null;
    $('#detected').hidden = true;
    error.textContent = inspectError.message;
    error.hidden = false;
  } finally {
    app.inspecting = false;
  }
}

async function submitAdd(event) {
  event.preventDefault();
  const error = $('#addError');
  error.hidden = true;
  const submit = $('#addSubmit');

  const title = $('#titleInput').value.trim();
  const author = $('#authorInput').value.trim();
  const totalPages = Number($('#totalInput').value) || undefined;
  const startPage = Number($('#startPageInput').value) || 0;
  const readToday = Number($('#readTodayInput').value) || 0;

  submit.disabled = true;
  submit.textContent = 'Adding…';

  try {
    let data;
    if (app.currentTab === 'upload') {
      if (!app.uploadFile) throw new Error('Choose a PDF to upload first.');
      const query = new URLSearchParams({ filename: app.uploadFile.name });
      if (title) query.set('title', title);
      if (author) query.set('author', author);
      if (totalPages) query.set('totalPages', String(totalPages));
      if (startPage) query.set('startPage', String(startPage));
      if (readToday) query.set('readToday', String(readToday));
      data = await api('POST', `/api/books/upload?${query}`, app.uploadFile);
    } else {
      const filePath = $('#pathInput').value.trim();
      if (!filePath) throw new Error('Enter the path to a PDF.');
      data = await api('POST', '/api/books', { path: filePath, title, author, totalPages, startPage, readToday });
    }

    app.data = data;
    render();
    $('#addDialog').close();
    const added = data.books.find((book) => book.id === data.addedBookId);
    addToast(`“${added?.title || 'Book'}” is on the shelf.`, 'success');
  } catch (submitError) {
    error.textContent = submitError.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Add to shelf';
  }
}

// ----------------------------------------------------------- path suggestions

function hidePathSuggestions() {
  $('#pathSuggestions').hidden = true;
  app.suggestionIndex = -1;
}

async function showPathSuggestions() {
  const input = $('#pathInput');
  const list = $('#pathSuggestions');
  const query = input.value.trim();
  if (!query) { hidePathSuggestions(); return; }
  try {
    const result = await api('GET', `/api/suggest?q=${encodeURIComponent(query)}`);
    if (document.activeElement !== input || input.value.trim() !== query) return;
    const suggestions = result.suggestions || [];
    list.innerHTML = suggestions.map((item, index) => `<button type="button" class="suggestion-item" role="option" aria-selected="false" data-suggest="${index}" data-path="${esc(item.path)}" data-dir="${item.isDir}">
      <span>${esc(item.name)}</span><small>${esc(item.display)}</small>
    </button>`).join('');
    list.hidden = suggestions.length === 0;
    app.suggestionIndex = -1;
  } catch {
    hidePathSuggestions();
  }
}

function choosePathSuggestion(target) {
  const value = target.dataset.path;
  $('#pathInput').value = value;
  hidePathSuggestions();
  if (target.dataset.dir === 'true') {
    $('#pathInput').focus();
    showPathSuggestions();
  } else {
    inspectPath(value);
  }
}

function moveSuggestionSelection(delta) {
  const buttons = $$('.suggestion-item', $('#pathSuggestions'));
  if (!buttons.length) return false;
  app.suggestionIndex = (app.suggestionIndex + delta + buttons.length) % buttons.length;
  buttons.forEach((button, index) => {
    const selected = index === app.suggestionIndex;
    button.setAttribute('aria-selected', String(selected));
    if (selected) button.scrollIntoView({ block: 'nearest' });
  });
  return true;
}

// ---------------------------------------------------------------- book menu

function openBookMenu(id) {
  const book = app.data?.books.find((entry) => entry.id === Number(id));
  if (!book) return;
  app.menuBookId = book.id;
  app.editMode = false;

  $('#bookDialogTitle').textContent = book.title;
  $('#bookDialogSub').textContent = [
    book.author,
    progressLine(book),
    book.percent !== null ? percentLabel(book) : null,
  ].filter(Boolean).join(' · ');
  $('#bookError').hidden = true;
  $('#editPanel').hidden = true;

  const actions = [];
  if (book.status !== 'finished') {
    actions.push(`<button data-book-action="log"><span class="ico">✎</span>Log pages</button>`);
  }
  actions.push(`<button data-book-action="edit"><span class="ico">⚙</span>Edit details</button>`);
  if (book.status === 'active') {
    actions.push(`<button data-book-action="pause"><span class="ico">⏸</span>Pause this book</button>`);
    actions.push(`<button data-book-action="finish"><span class="ico">✓</span>Mark as finished</button>`);
  } else if (book.status === 'paused') {
    actions.push(`<button data-book-action="resume"><span class="ico">▶</span>Resume reading</button>`);
  } else if (book.status === 'finished') {
    actions.push(`<button data-book-action="reopen"><span class="ico">↺</span>Read it again</button>`);
  }
  actions.push(`<button data-book-action="remove" class="danger"><span class="ico">✕</span>Remove from shelf</button>`);
  $('#bookActions').innerHTML = actions.join('');

  $('#bookDialog').showModal();
}

async function handleBookAction(action) {
  const id = app.menuBookId;
  const book = app.data?.books.find((entry) => entry.id === id);
  if (!book) return;
  const error = $('#bookError');
  error.hidden = true;

  try {
    if (action === 'log') {
      $('#bookDialog').close();
      openLog(id);
      return;
    }
    if (action === 'edit') {
      app.editMode = !app.editMode;
      $('#editPanel').hidden = !app.editMode;
      $('#editTitle').value = book.title;
      $('#editAuthor').value = book.author || '';
      $('#editTotal').value = book.totalPages || '';
      $('#editCurrent').value = book.currentPage;
      return;
    }
    if (action === 'pause' || action === 'resume') {
      await refreshFrom(api('PATCH', `/api/books/${id}`, { status: action === 'pause' ? 'paused' : 'active' }));
      $('#bookDialog').close();
      addToast(action === 'pause' ? 'Book paused.' : 'Book is back on the shelf.', 'success');
      return;
    }
    if (action === 'finish') {
      await refreshFrom(api('POST', `/api/books/${id}/finish`));
      $('#bookDialog').close();
      addToast(`“${book.title}” marked finished. 🎉`, 'success');
      return;
    }
    if (action === 'reopen') {
      await refreshFrom(api('POST', `/api/books/${id}/reopen`));
      $('#bookDialog').close();
      addToast('Book reopened.', 'success');
      return;
    }
    if (action === 'remove') {
      if (!confirm(`Remove “${book.title}” and all of its reading history from the shelf?`)) return;
      await refreshFrom(api('DELETE', `/api/books/${id}`));
      $('#bookDialog').close();
      addToast('Removed from shelf.');
    }
  } catch (actionError) {
    error.textContent = actionError.message;
    error.hidden = false;
  }
}

async function saveEdit() {
  const id = app.menuBookId;
  const error = $('#bookError');
  error.hidden = true;
  try {
    const patch = {
      title: $('#editTitle').value.trim(),
      author: $('#editAuthor').value.trim(),
      totalPages: Number($('#editTotal').value) || undefined,
      currentPage: Number($('#editCurrent').value),
    };
    await refreshFrom(api('PATCH', `/api/books/${id}`, patch));
    $('#bookDialog').close();
    addToast('Book updated.', 'success');
  } catch (editError) {
    error.textContent = editError.message;
    error.hidden = false;
  }
}

// ---------------------------------------------------------------- settings

function openSettings() {
  const settings = app.data?.stats;
  $('#goalInput').value = app.data?.goal ?? 20;
  $('#shelfInput').value = settings?.shelfLimit ?? 3;
  $('#settingsDialog').showModal();
}

async function saveSettings(event) {
  event.preventDefault();
  try {
    const result = await api('PATCH', '/api/settings', {
      daily_goal: Number($('#goalInput').value) || 20,
      shelf_limit: Number($('#shelfInput').value) || 3,
    });
    app.data = result.state;
    render();
    $('#settingsDialog').close();
    addToast('Settings saved.', 'success');
  } catch (error) {
    addToast(error.message, 'error');
  }
}

// ---------------------------------------------------------------- events

function bindEvents() {
  $('#addBookBtn').addEventListener('click', openAdd);
  $('#settingsBtn').addEventListener('click', openSettings);

  // Global delegated actions.
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action], [data-close], [data-suggest], [data-book-action], [data-quick]');
    if (!target) {
      // Clicking the backdrop of a dialog closes it.
      const dialog = event.target.closest('dialog');
      if (dialog && event.target === dialog) dialog.close();
      return;
    }

    if (target.dataset.close !== undefined) {
      target.closest('dialog')?.close();
      return;
    }
    if (target.dataset.suggest !== undefined) {
      choosePathSuggestion(target);
      return;
    }
    if (target.dataset.quick) {
      $('#logPages').value = target.dataset.quick;
      $('#logPages').focus();
      return;
    }
    if (target.dataset.bookAction) {
      handleBookAction(target.dataset.bookAction);
      return;
    }

    const action = target.dataset.action;
    if (action === 'add') openAdd();
    else if (action === 'menu') openBookMenu(target.dataset.id);
    else if (action === 'log') logQuick(target.dataset.id, Number(target.dataset.pages));
    else if (action === 'log-custom') openLog(target.dataset.id);
  });

  // Tabs.
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => setTab(tab.dataset.tab));
  });

  // Add dialog: path suggestions, inspection, and native file picker.
  const pathInput = $('#pathInput');
  const pathSuggestions = $('#pathSuggestions');
  pathSuggestions.addEventListener('pointerdown', (event) => event.preventDefault());
  pathInput.addEventListener('input', () => {
    clearTimeout(app.suggestionTimer);
    app.suggestionTimer = setTimeout(showPathSuggestions, 140);
  });
  $('#pathInput').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && !pathSuggestions.hidden) {
      event.preventDefault(); moveSuggestionSelection(1); return;
    }
    if (event.key === 'ArrowUp' && !pathSuggestions.hidden) {
      event.preventDefault(); moveSuggestionSelection(-1); return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const selected = $$('.suggestion-item', pathSuggestions)[app.suggestionIndex];
      if (selected) choosePathSuggestion(selected);
      else { hidePathSuggestions(); inspectPath(pathInput.value); }
    }
  });
  $('#pathInput').addEventListener('blur', () => {
    setTimeout(hidePathSuggestions, 120);
    if ($('#pathInput').value.trim()) inspectPath($('#pathInput').value);
  });
  $('#browseBtn').addEventListener('click', () => {
    setTab('upload');
    $('#fileInput').click();
  });

  // Upload.
  const dropzone = $('#dropzone');
  const fileInput = $('#fileInput');
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) setUploadFile(fileInput.files[0]);
  });
  for (const type of ['dragenter', 'dragover']) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('dragging');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragging');
    });
  }
  dropzone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) setUploadFile(file);
  });

  $('#addForm').addEventListener('submit', submitAdd);
  $('#logForm').addEventListener('submit', submitLog);
  $('#settingsForm').addEventListener('submit', saveSettings);

  $('#editSave').addEventListener('click', saveEdit);
  $('#editCancel').addEventListener('click', () => {
    app.editMode = false;
    $('#editPanel').hidden = true;
  });

  // Keyboard shortcuts.
  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea, select')) return;
    if (document.querySelector('dialog[open]')) return;
    if (event.key === 'n') {
      event.preventDefault();
      openAdd();
    } else if (event.key === 'l') {
      event.preventDefault();
      const focus = app.data?.stats.focusBookId;
      if (focus) openLog(focus);
    }
  });

  // Refresh when the tab regains focus.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadState();
  });
  app.pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) loadState();
  }, 90000);
}

function setUploadFile(file) {
  if (!/\.pdf$/i.test(file.name)) {
    addToast('That is not a PDF.', 'error');
    return;
  }
  app.uploadFile = file;
  $('#dropTitle').textContent = file.name;
  $('#dropSub').textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB — it will be copied into the shelf library`;
  $('#dropzone').classList.add('has-file');
  if (!$('#titleInput').value) {
    const guess = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    $('#titleInput').placeholder = guess;
  }
}

async function logQuick(id, pages) {
  if (!pages) return;
  try {
    const data = await api('POST', `/api/books/${id}/log`, { pages, date: app.data?.today });
    const before = app.data.books.find((book) => book.id === Number(id));
    app.data = data;
    render();
    const after = data.books.find((book) => book.id === Number(id));
    if (before?.status !== 'finished' && after?.status === 'finished') {
      addToast(`Finished “${after.title}”. 🎉`, 'success');
      return;
    }
    addToast(`+${pages} · “${after?.title}” is at ${percentLabel(after)}.`, 'success', {
      label: 'Undo',
      run: () => refreshFrom(api('POST', `/api/books/${id}/log`, { pages: -pages, date: app.data?.today })).catch((error) => addToast(error.message, 'error')),
    });
  } catch (error) {
    addToast(error.message, 'error');
  }
}

// ---------------------------------------------------------------- boot

async function boot() {
  bindEvents();
  try {
    app.theme = await api('GET', '/api/theme');
    applyTheme(app.theme);
  } catch {
    // Keep the built-in Tokyo Night palette.
  }
  await loadState();

  if (new URLSearchParams(location.search).has('add') && app.data) {
    setTimeout(openAdd, 120);
  }
}

boot();
