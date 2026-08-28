# Plotting Bed

An Eisenhower matrix task board. Four flush quadrants form one continuous plotting surface,
each with its own resizable sub-grid;
tasks are chips you drag into a specific cell, and every cell has a coordinate (`A1`, `B3`)
that follows the task into its detail popup.

Open `index.html` in a browser. No build step, no server, no dependencies.

## Layout

|                   | Urgent                | Not urgent                |
| ----------------- | --------------------- | ------------------------- |
| **Important**     | Do it now             | Give it a date            |
| **Not important** | Hand it to someone    | Let it go                 |

Each quadrant is labelled by its reading of the axes — *Urgent · Important*,
*Not urgent · Important*, and so on — with the label outside the surface and that quadrant's
colour wrapping its two outer edges.

## What it does

- **Drag and drop** — drag a chip from the Unplotted tray into any sub-grid cell, between
  cells, between quadrants, or back to the tray to take it off the board.
- **Resizable sub-grids** — each quadrant sets its own columns and rows, 1×1 up to 6×6.
  Shrinking a grid clamps tasks into the remaining cells instead of losing them.
- **Cell popup** — click a cell to open it. One task opens straight to its detail; several
  open a list you pick from. Click any chip to jump directly to its detail.
- **Task detail** — title, notes, due date, tags, checklist with progress, done state, and
  dropdowns to move the task to another quadrant or cell without dragging.
- **Quick add syntax** — `Renew the domain #admin !2 >fri`
  - `#tag` adds a tag
  - `!1`–`!4` plots straight into a quadrant (1 urgent+important, 2 important only,
    3 urgent only, 4 neither)
  - `>today`, `>tomorrow`, `>fri`, `>9/4`, `>2026-09-04` set a due date
- **Search** dims everything that doesn't match title, notes, or tags.
- **Due dates** show as `today`, `2d`, or `3d late` in red once overdue.
- **Undo** — ⌘Z / Ctrl+Z reverses moves, deletes, resizes, imports, and wipes.
- **Import / export JSON** and **clear completed** live under the Board menu.
- **Light and dark themes**, following the system setting until you switch it.

## Keyboard

| Key | Action |
| --- | ------ |
| `/` | Focus search |
| `N` | Focus quick add |
| `Enter` / `Space` | Open the focused chip or cell |
| `Esc` | Close the popup, or clear the search |
| `⌘Z` / `Ctrl+Z` | Undo |

## Storage

Everything is saved to `localStorage` under `plotting-bed.v1`, so the board is per-browser
and never leaves the machine. Export to JSON to move it somewhere else.

Drag and drop uses the HTML5 drag API, which desktop browsers support and touch browsers do
not — on a phone or tablet, move tasks with the Quadrant and Cell dropdowns in the popup.
# EisenhowerMatrix-To-Dos
