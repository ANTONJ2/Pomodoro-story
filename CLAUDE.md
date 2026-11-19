# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A single-page Pomodoro timer in plain HTML/CSS/JS with no build step, no dependencies, no package manager and no tests. All source (`index.html`, `style.css`, `script.js`) lives at the repository root, because GitHub Pages serves the site from the root of `main`; keep it there.

## Running

Open `index.html` directly in a browser, or serve the repo root on port 8080 to match the VS Code Chrome launch config in `.vscode/launch.json`:

```
npx serve -l 8080 .
```

(any static server works, e.g. `python -m http.server 8080`).

## Architecture

- **`script.js`** is one IIFE organised into sections: config (`MODES`, `ROUNDS_PER_CYCLE`), DOM refs (`el`), a single mutable `state` object, rendering, timer logic, audio and event wiring.
- **Timing is wall-clock based.** `start()` sets `state.endTime`; `tick()` always recomputes `remainingMs = endTime - Date.now()` and never counts ticks. A `requestAnimationFrame` loop drives the smooth ring while visible, a 500 ms `setInterval` keeps time moving in throttled background tabs, and `visibilitychange` re-syncs at once. Keep this model when changing timer behaviour.
- **`setMode(mode, message)`** is the central reset: it stops timers, reloads the duration, updates `body[data-mode]`, tab ARIA state, the label and the rings. `complete()` advances focus → short/long break (long after every 4th focus round) → focus, but leaves the next session idle until the user clicks Start.
- **Theming is driven by `body[data-mode]`.** `style.css` sets three tokens (`--bg1`, `--bg2`, `--accent`) per mode; they are registered with `@property` so background and accent colours cross-fade via CSS transitions. A new mode needs an entry in `MODES`, a button with `data-mode` in `index.html` and a `body[data-mode="…"]` rule in CSS.
- **Progress ring:** the SVG circle has `r = 90`; `RING_LENGTH` in JS must match it. Progress is set via `strokeDashoffset`; the `is-easing` class temporarily enables a CSS transition for refills after reset or mode change (it is removed while running so per-frame updates aren't animated).
- **Audio** is synthesised with the Web Audio API (no sound files). The `AudioContext` is created/resumed in `start()` because browsers only allow it after a user gesture.
