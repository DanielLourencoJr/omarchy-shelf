'use strict';

const fs = require('node:fs');
const { THEME_PATHS } = require('./paths');

const FALLBACK = {
  mode: 'dark',
  accent: '#7aa2f7',
  background: '#1a1b26',
  dark_background: '#13141c',
  darker_background: '#0e0e14',
  lighter_background: '#24283b',
  foreground: '#a9b1d6',
  dark_foreground: '#565f89',
  light_foreground: '#b4bee6',
  bright_foreground: '#c0caf5',
  red: '#f7768e',
  yellow: '#e0af68',
  orange: '#eb927b',
  green: '#9ece6a',
  cyan: '#449dab',
  blue: '#7aa2f7',
  magenta: '#ad8ee6',
  muted: '#414868',
  selection: '#292e42',
};

const KEYS = Object.keys(FALLBACK);

/** Read the active Omarchy theme so the web app matches the desktop. */
function readTheme() {
  for (const file of THEME_PATHS) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = {};
      for (const line of raw.split('\n')) {
        const match = line.match(/^\s*([a-z_]+)\s*=\s*"([^"]+)"/i);
        if (!match) continue;
        const key = match[1].toLowerCase();
        if (KEYS.includes(key)) parsed[key] = match[2];
      }
      if (Object.keys(parsed).length > 3) {
        return { ...FALLBACK, ...parsed, source: file };
      }
    } catch {
      // Try the next known theme location.
    }
  }
  return { ...FALLBACK, source: null };
}

module.exports = { readTheme, FALLBACK };
