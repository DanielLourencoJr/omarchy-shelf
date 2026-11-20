#!/usr/bin/env node
'use strict';

/**
 * Add (or remove) the Shelf bar widget in ~/.config/omarchy/shell.json.
 * The shell hot-reloads this file, so no restart is required.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WIDGET_ID = 'daniel.readingmanager';
const shellPath = path.join(os.homedir(), '.config', 'omarchy', 'shell.json');
const remove = process.argv.includes('--remove');

function fail(message) {
  console.error(`[shelf] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(shellPath)) {
  fail(`No Omarchy shell config at ${shellPath}. Install the widget from the app directory or add ${WIDGET_ID} to your bar by hand.`);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(shellPath, 'utf8'));
} catch (error) {
  fail(`Could not parse ${shellPath}: ${error.message}`);
}

config.bar = config.bar || {};
config.bar.layout = config.bar.layout || {};
config.bar.layout.right = Array.isArray(config.bar.layout.right) ? config.bar.layout.right : [];

const right = config.bar.layout.right;
const existing = right.findIndex((entry) => entry && entry.id === WIDGET_ID);

if (remove) {
  if (existing === -1) {
    console.log('[shelf] Widget already absent from the bar.');
    process.exit(0);
  }
  right.splice(existing, 1);
} else {
  if (existing !== -1) {
    console.log('[shelf] Widget already in the bar.');
    process.exit(0);
  }
  const preferred = right.findIndex((entry) => entry && entry.id === 'omarchy.keyboard-layout');
  const entry = { id: WIDGET_ID };
  if (preferred === -1) right.push(entry);
  else right.splice(preferred, 0, entry);
}

const backup = `${shellPath}.bak.${Date.now()}`;
fs.copyFileSync(shellPath, backup);
fs.writeFileSync(shellPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`[shelf] ${remove ? 'Removed from' : 'Added to'} the bar. Backup: ${backup}`);
