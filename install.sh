#!/usr/bin/env bash
# Install Shelf: the reading server, the `reading` CLI, and the Omarchy bar widget.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$HOME/.config/omarchy/plugins/daniel.readingmanager"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/readingmanager.service"

say() { printf '\033[38;5;111m[shelf]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[shelf]\033[0m %s\n' "$*"; }

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  warn "node was not found on PATH. Install Node.js 22.5+ first (mise, pacman, etc.)."
  exit 1
fi

node -e 'const [maj,min]=process.versions.node.split(".").map(Number); if (maj<22||(maj===22&&min<5)) { console.error("Node 22.5+ is required (found "+process.versions.node+")"); process.exit(1) }'
say "Using node $("$NODE_BIN" --version) at $NODE_BIN"

if ! command -v pdfinfo >/dev/null; then
  warn "pdfinfo (poppler) is missing. Page counts and covers need it: sudo pacman -S poppler"
fi

# 1. CLI on PATH ------------------------------------------------------------
mkdir -p "$HOME/.local/bin"
chmod +x "$APP_DIR/bin/reading"
ln -sfn "$APP_DIR/bin/reading" "$HOME/.local/bin/reading"
say "Linked $HOME/.local/bin/reading"

# 2. Data directory ---------------------------------------------------------
mkdir -p "$HOME/.local/share/readingmanager/covers" "$HOME/.local/share/readingmanager/library"

# 3. systemd user service ---------------------------------------------------
mkdir -p "$UNIT_DIR" "$HOME/.config"
cat > "$UNIT" <<EOF
[Unit]
Description=Shelf reading manager (local web app + bar widget backend)
After=graphical-session.target
PartOf=graphical-session.target

[Service]
Type=simple
ExecStart=$NODE_BIN $APP_DIR/server/server.js
Environment=READINGMANAGER_PORT=8765
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF
say "Wrote $UNIT"

if command -v systemctl >/dev/null; then
  systemctl --user daemon-reload || true
  systemctl --user enable --now readingmanager.service || warn "Could not start the user service; run: systemctl --user start readingmanager"
  say "Service: $(systemctl --user is-active readingmanager.service 2>/dev/null || echo unknown)"
else
  warn "systemctl not found; start the server with 'reading start'."
fi

# 4. Omarchy bar widget -----------------------------------------------------
if [[ -d "$HOME/.config/omarchy" ]]; then
  mkdir -p "$PLUGIN_DIR"
  cp -f "$APP_DIR/shell/manifest.json" "$APP_DIR/shell/Panel.qml" "$APP_DIR/shell/Cli.qml" "$PLUGIN_DIR/"
  mkdir -p "$PLUGIN_DIR/i18n"
  cp -f "$APP_DIR/shell/i18n/"*.json "$PLUGIN_DIR/i18n/"
  say "Installed bar widget in $PLUGIN_DIR"

  if [[ -f "$HOME/.config/omarchy/shell.json" ]]; then
    node "$APP_DIR/scripts/install-widget.js" || warn "Could not edit shell.json automatically."
  fi

  if command -v omarchy-shell >/dev/null; then
    omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
  fi
else
  warn "No ~/.config/omarchy found; skipping the bar widget (the web app still works)."
fi

# 5. Launcher entry ---------------------------------------------------------
APPS_DIR="$HOME/.local/share/applications"
mkdir -p "$APPS_DIR"
cat > "$APPS_DIR/shelf.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Shelf
Comment=Track the books you are reading
Exec=$HOME/.local/bin/reading open
Icon=book
Terminal=false
Categories=Office;Education;
Keywords=reading;books;pages;
EOF
say "Added Shelf to the app launcher"

# 6. Health check -----------------------------------------------------------
sleep 0.6
if command -v curl >/dev/null && curl -fsS http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
  say "Running at http://127.0.0.1:8765"
else
  warn "Server is not answering yet. Try: reading start"
fi

say "Done. Open it with 'reading', the Shelf launcher entry, or the new bar widget."
