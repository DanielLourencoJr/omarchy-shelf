#!/usr/bin/env bash
# Remove the Shelf service, bar widget and launcher entry.
# Your books and reading history in ~/.local/share/readingmanager are kept.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$HOME/.config/omarchy/plugins/daniel.readingmanager"

say() { printf '\033[38;5;111m[shelf]\033[0m %s\n' "$*"; }

if command -v systemctl >/dev/null; then
  systemctl --user disable --now readingmanager.service >/dev/null 2>&1 || true
  rm -f "$HOME/.config/systemd/user/readingmanager.service"
  systemctl --user daemon-reload || true
  say "Stopped and removed the user service."
fi

if [[ -d "$HOME/.config/omarchy" && -f "$HOME/.config/omarchy/shell.json" ]]; then
  node "$APP_DIR/scripts/install-widget.js" --remove || true
  command -v omarchy-shell >/dev/null && omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
fi

rm -rf "$PLUGIN_DIR"
rm -f "$HOME/.local/share/applications/shelf.desktop"
rm -f "$HOME/.local/bin/reading"

say "Removed. Keep your data: $HOME/.local/share/readingmanager"
