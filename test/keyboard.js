'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const appDir = path.resolve(__dirname, '..');
const panel = fs.readFileSync(path.join(appDir, 'shell', 'Panel.qml'), 'utf8');

// These checks keep the tested Omarchy key catcher connected to Shelf's real
// cursor model and ensure opening selects the first book before taking focus.
assert.match(panel, /function selectInitialControl\(\)[\s\S]*?selectedBookIndex = 0[\s\S]*?focusSection = "books"/);
assert.match(panel, /function open\(\)[\s\S]*?panel\.ensureContent\(\)[\s\S]*?root\.controller\.show\(\)/);
assert.match(panel, /function focusSelectedControl\(\)[\s\S]*?catcher\.focusSelection\(\)[\s\S]*?catcher\.forceActiveFocus\(\)/);
assert.match(panel, /function focusSelection\(\)[\s\S]*?pageButtons\.itemAt\(root\.selectedQuickIndex\)[\s\S]*?revealItem\(target\)/);
assert.match(panel, /onMoveRequested:[\s\S]*?root\.moveCursor\(dx, dy\)/);
assert.match(panel, /onActivateRequested: root\.activateCursor\(\)/);
assert.match(panel, /onCloseRequested: root\.close\(\)/);

const runner = process.env.QMLTESTRUNNER || '/usr/lib/qt6/bin/qmltestrunner';
const result = spawnSync(runner, [
  '-input', path.join(__dirname, 'tst_keyboard.qml'),
  '-o', '-,txt',
], {
  cwd: appDir,
  encoding: 'utf8',
  env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' },
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
assert.equal(result.status, 0, 'Qt keyboard interaction tests must pass');
console.log('keyboard: Shelf wiring and key interactions passed');
