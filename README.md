# Diff Checker

A fully offline, single-file diff tool. Open `index.html` in any browser — no server, no network, no dependencies.

## Features

- **Line diff** (Myers algorithm) with **word- or character-level** inline highlighting
- **Unified and split** (side-by-side) views, minimap, prev/next change navigation
- **Compare options**: ignore leading/trailing or all whitespace, ignore case, detect moved lines/blocks (click to jump between source and destination), ignore comment-only changes (language-aware via the vendored highlighter), collapse unchanged regions (GitHub-style expanders), live compare as you type, synced input scrolling
- **Syntax highlighting** (highlight.js, 36 languages, vendored) with auto-detection, composed with the inline diff marks
- **JSON mode**: key-order-insensitive structural comparison (sorted-key normalization)
- **Patch mode**: paste a unified diff / `git diff` output and render it
- **File handling**: drag & drop or file picker per pane, filenames flow into patch headers and language detection
- **Export**: copy/download a `git apply`-compatible `.patch`, standalone HTML report, or a compressed shareable URL (gzip in the location hash). Share links involve no server: the entire diff is encoded into the URL's `#` fragment, which browsers never transmit over the network — but the link itself therefore contains your full text, so treat it as being as sensitive as the diff.
- **Persistence**: inputs and settings auto-save to localStorage

## Development

The deliverable is the single built `index.html` at the repo root. Source lives in `src/`; `vendor/` holds the committed highlight.js build (see `vendor/VENDOR.md`).

```sh
node build.js          # build index.html from src/ + vendor/
node build.js --watch  # rebuild on change
node --test            # run the test suite (Node 18+)
```

The build script is dependency-free: it inlines the stylesheets, the vendored highlight.js, and the app modules (concatenated into one IIFE) into `src/index.html`'s placeholders, then sanity-checks that the output is fully self-contained. Do not edit the root `index.html` directly — it is overwritten by the build.
