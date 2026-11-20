'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { COVERS_DIR } = require('./paths');

const run = promisify(execFile);

const PDFINFO = process.env.READINGMANAGER_PDFINFO || 'pdfinfo';
const PDFTOPPM = process.env.READINGMANAGER_PDFTOPPM || 'pdftoppm';

/** Turn a filename into a readable title: `the_hobbit-final.pdf` -> `The Hobbit Final`. */
function titleFromFilename(file) {
  const base = path.basename(file).replace(/\.pdf$/i, '');
  const cleaned = base
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return path.basename(file);
  return cleaned
    .split(' ')
    .map((word) => (word.length > 2 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Clean metadata titles that PDF generators love to fill with filenames. */
function cleanTitle(raw, file) {
  let value = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return titleFromFilename(file);
  value = value
    .replace(/^Microsoft\s+(Word|PowerPoint)\s*-\s*/i, '')
    .replace(/^LibreOffice\s*-\s*/i, '')
    .replace(/\.(docx?|pptx?|indd|qxd|pdf|html?|xhtml|tex|md|txt)$/i, '')
    .replace(/^(untitled|document\d*|book\d*)$/i, '')
    .trim();
  // A single hyphenated token is almost always a filename, not a title.
  if (value && !/\s/.test(value) && /[-_]/.test(value)) {
    value = titleFromFilename(value.replace(/[-_]+/g, '-') + '.pdf');
  }
  // Lowercase-only metadata titles are usually a filename stem too.
  if (value && !/[A-Z]/.test(value)) value = titleFromFilename(file);
  if (!value || value.length < 2) return titleFromFilename(file);
  return value;
}

function cleanAuthor(raw) {
  const value = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!value || /^(unknown|admin|administrator|user|owner|microsoft|libreoffice)$/i.test(value)) return null;
  return value.slice(0, 160);
}

function parseInfo(stdout) {
  const fields = {};
  for (const line of stdout.split('\n')) {
    const match = line.match(/^([A-Za-z ]+):\s*(.*)$/);
    if (!match) continue;
    fields[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return fields;
}

async function readPdfInfo(file) {
  try {
    const { stdout } = await run(PDFINFO, [file], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
    const fields = parseInfo(stdout);
    const pages = Number.parseInt(fields.pages, 10);
    return {
      pages: Number.isFinite(pages) ? pages : 0,
      title: cleanTitle(fields.title, file),
      author: cleanAuthor(fields.author),
      encrypted: /^yes$/i.test(fields.encrypted || ''),
    };
  } catch (error) {
    return {
      pages: 0,
      title: titleFromFilename(file),
      author: null,
      encrypted: false,
      error: error.message,
    };
  }
}

function coverNameFor(file) {
  const stat = fs.statSync(file);
  const hash = crypto
    .createHash('sha1')
    .update(`${file}:${stat.size}:${stat.mtimeMs}`)
    .digest('hex')
    .slice(0, 20);
  return `${hash}.jpg`;
}

/**
 * Render page 1 of the PDF into a small JPEG used as the book thumbnail.
 * Returns the cover filename (relative to COVERS_DIR) or null.
 */
async function makeCover(file) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  const name = coverNameFor(file);
  const target = path.join(COVERS_DIR, name);
  if (fs.existsSync(target) && fs.statSync(target).size > 0) return name;

  const prefix = path.join(COVERS_DIR, `tmp-${Date.now()}-${process.pid}`);
  try {
    await run(
      PDFTOPPM,
      ['-jpeg', '-f', '1', '-l', '1', '-scale-to', '480', '-jpegopt', 'quality=82', file, prefix],
      { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }
    );
    const produced = fs.readdirSync(COVERS_DIR).find((entry) => entry.startsWith(path.basename(prefix)));
    if (!produced) return null;
    fs.renameSync(path.join(COVERS_DIR, produced), target);
    return name;
  } catch (error) {
    for (const entry of fs.readdirSync(COVERS_DIR)) {
      if (entry.startsWith(path.basename(prefix))) {
        try {
          fs.unlinkSync(path.join(COVERS_DIR, entry));
        } catch {}
      }
    }
    return null;
  }
}

async function inspect(file) {
  const info = await readPdfInfo(file);
  return info;
}

module.exports = { inspect, makeCover, titleFromFilename, cleanTitle, coverNameFor };
