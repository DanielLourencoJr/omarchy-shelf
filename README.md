# Shelf (ReadingManager)

A lightweight reading progress manager and motivator for PDF books, designed for Linux and Omarchy (Hyprland + Quickshell).

![Shelf Overview](web/index.html)

## Features

- **Automatic PDF inspection**: Extracts total pages, title, author, and generates front cover thumbnails automatically via `poppler` (`pdfinfo` and `pdftoppm`).
- **Motivational tracking**:
  - Daily page reading goal with circular progress ring.
  - Reading streaks (flame count) and 120-day activity heatmap.
  - Daily pace calculation (pages/day over last 7 days) and estimated completion date (ETA).
  - "Slipping" badge warnings for books with no recent reading to prevent abandonment.
  - "Shelf limit" nudge when starting new books while others are already active.
- **Omarchy Bar Widget (`daniel.readingmanager`)**:
  - Live circular progress ring in the top bar showing % progress of current focus book.
  - Click to open popup panel with book covers, quick `+1`, `+5`, `+10` page logging, daily goal status, and streak.
  - Matches current Omarchy theme live (Tokyo Night, etc.).
- **Local Web Interface**:
  - Responsive, dark-mode web application running at `http://127.0.0.1:8765`.
  - Accessible via application launcher (`Shelf`) or terminal (`reading`).
  - Add books via local path, drag-and-drop, or built-in file picker.
  - Log pages with quick buttons or custom inputs, with one-click undo toasts.
- **Terminal CLI (`reading`)**:
  - First-class CLI interface for terminal workflows.
  - JSON API output (`reading state --json`) for scripting and widget integration.

## Installation

Run the installation script:

```bash
./install.sh
```

This will:
1. Symlink `bin/reading` into `~/.local/bin/reading`.
2. Set up and start the systemd user service `readingmanager.service`.
3. Install the Omarchy bar widget into `~/.config/omarchy/plugins/daniel.readingmanager` and add it to `~/.config/omarchy/shell.json`.
4. Register the `Shelf` desktop application launcher entry in `~/.local/share/applications/shelf.desktop`.

To uninstall:
```bash
./uninstall.sh
```
*(User data in `~/.local/share/readingmanager` is preserved).*

## CLI Commands

```bash
reading                     # Open the web shelf in your browser
reading list                # Print current shelf, progress, pace, and streaks
reading add <path-to-pdf>   # Add a book from a PDF file
reading log [book] <pages>  # Log pages read (defaults to focus book)
reading finish [book]       # Mark a book as completed
reading pause [book]        # Pause reading a book
reading resume [book]       # Resume a paused book
reading remove [book]       # Remove a book from the shelf
reading start               # Ensure background service is running
reading stop                # Stop background service
reading state --json        # Output JSON state
```

## Architecture

- **Backend**: Node.js 22.5+ using built-in `node:sqlite` (zero npm dependencies).
- **Storage**: SQLite database at `~/.local/share/readingmanager/reading.db`.
- **Thumbnails**: Cached front-cover images in `~/.local/share/readingmanager/covers/`.
- **Desktop Widget**: Quickshell QML plugin (`Panel.qml`, `Cli.qml`, `manifest.json`).
- **Frontend**: Vanilla JS, HTML5, CSS3 with native CSS variables linked to the active Omarchy theme.
