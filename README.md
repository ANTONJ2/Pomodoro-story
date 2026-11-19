# Pomodoro Timer – Self Help

A minimal, distraction-free Pomodoro timer that runs entirely in the browser. It is built with plain HTML, CSS and JavaScript: no frameworks, no build step and no dependencies.

The [Pomodoro Technique](https://en.wikipedia.org/wiki/Pomodoro_Technique) splits work into focused intervals separated by short breaks, with a longer break after every few rounds. This app guides you through that cycle automatically.

## Features

- **Three modes:** Focus (25 min), Short break (5 min) and Long break (15 min) by default, switchable with tabs at the top.
- **Custom durations:** the ⚙ button opens **Timer settings**, where you set each session's length in minutes (Focus 1–120, breaks 1–60). Your choice is remembered in this browser, and **Restore defaults** brings back 25 / 5 / 15.
- **Automatic cycle:** after a focus round the next break is loaded for you. Every 4th focus round is followed by a long break; otherwise a short break. After a break, the next focus round is loaded.
- **You stay in control:** the next session is loaded but does not start until you click **Start**.
- **Auto loop:** click **Loop**, choose how many loops (1–12) and the app runs Focus → Short break → Long break by itself, starting each session automatically. A "Loop 2 of 3" badge shows progress inside the ring. Pause works as usual, **Stop loop** ends it, and clicking a mode tab takes back manual control.
- **Animated progress ring:** an SVG ring drains smoothly as time runs out and refills with an easing animation on reset or mode change.
- **Round tracker:** four segments below the timer show how many focus rounds you've completed in the current cycle.
- **Start / Pause / Resume and Reset** controls.
- **Live tab title:** the browser tab shows the remaining time and current mode (e.g. `24:13 · Focus`), so you can keep track from another tab.
- **Accurate in background tabs:** the countdown is based on the real clock, not on counting ticks, so it stays correct even when the browser throttles inactive tabs.
- **Completion chime:** a gentle three-note chime (C–E–G) generated with the Web Audio API. No sound files are needed.
- **Mode-based colour themes** that cross-fade smoothly:
  | Mode | Accent colour |
  |---|---|
  | Focus | Rose `#ff6b81` |
  | Short break | Teal `#4fd1c5` |
  | Long break | Blue `#7c9cff` |
- **Accessible:** mode tabs use ARIA `tablist`/`tab` roles, the clock uses `role="timer"`, and status messages are announced through an `aria-live` region.
- **Smooth animations:** a staggered entrance on load, a sliding pill behind the mode tabs, a glow that breathes behind the ring while the timer runs, gently pulsing digits when paused, a blur crossfade when the mode changes, springy buttons and softly drifting background lights. All of these are turned off for users who have reduced motion enabled.
- **Responsive** dark, glass-style UI that works on desktop and mobile.

## Getting started

### Option 1: Open the file

Open `pomodoro files/index.html` directly in any modern browser.

### Option 2: Serve it locally

Serve the folder on port 8080 (this matches the VS Code launch configuration):

```bash
cd "pomodoro files"
npx serve -l 8080 .
# or
python -m http.server 8080
```

Then visit <http://localhost:8080>.

### Option 3: Debug from VS Code

With the server running on port 8080, use the **Launch Chrome against localhost** configuration in `pomodoro files/.vscode/launch.json` (Run and Debug panel, or F5).

## How to use

1. Pick a mode (Focus is selected by default).
2. Click **Start**. The button changes to **Pause**; pausing turns it into **Resume**.
3. When the timer reaches zero, a chime plays, the timer pulses, and the next session is loaded with a short message.
4. Click **Start** to begin the next session.
5. **Reset** restarts the current mode from its full duration.

**Auto loop:** click **Loop**, set the number of loops with **−** / **+** (the dialog shows the total time), then click **Start loop**. Each loop is Focus → Short break → Long break (using your chosen durations), and every session starts on its own after a chime. Click **Stop loop** at any time to end it.

> Sound only plays after you've clicked Start at least once, because browsers block audio until the user interacts with the page.

## Project structure

```
Pomodoro story/
├── README.md
├── CLAUDE.md                 # Guidance for AI coding assistants
└── pomodoro files/
    ├── index.html            # Markup: mode tabs, SVG ring, round tracker, controls
    ├── style.css             # Theming, layout and animations
    ├── script.js             # All timer logic
    └── .vscode/
        └── launch.json       # Chrome debug config (localhost:8080)
```

## How it works

`script.js` is a single self-contained IIFE organised into sections:

| Section | Responsibility |
|---|---|
| Config | `MODES` (labels and durations) and `ROUNDS_PER_CYCLE` |
| DOM | References to all elements the script updates |
| State | One `state` object: mode, status (`idle`/`running`/`paused`), remaining time, end time, completed rounds |
| Rendering | Updates the clock, tab title, ring, buttons, round tracker and message |
| Timer logic | `setMode`, `start`, `pause`, `tick`, `complete` |
| Audio | Lazily creates an `AudioContext` and plays the chime |
| Events | Button clicks and the `visibilitychange` re-sync |

**Timing model.** `start()` records an `endTime`. Every tick recomputes `remaining = endTime - Date.now()`. A `requestAnimationFrame` loop keeps the ring smooth while the tab is visible, a 500 ms `setInterval` keeps time moving when the tab is in the background, and `visibilitychange` re-syncs immediately when you return.

**Theming.** The `<body>` element carries a `data-mode` attribute. `style.css` sets three colour tokens (`--bg1`, `--bg2`, `--accent`) for each mode. They are registered with `@property`, which lets the background and accent colours animate between modes.

## Customisation

- **Durations:** users can change them in the app via the ⚙ settings button (saved in `localStorage` under `pomodoro.minutes`). To change the built-in defaults, edit `minutes` in `MODES` and `DEFAULT_MINUTES` at the top of `script.js`, and the allowed range via the `min`/`max` attributes on the settings inputs in `index.html`.
- **Rounds before a long break:** change `ROUNDS_PER_CYCLE` (also update the number of `.cycle-seg` elements in `index.html` to match).
- **Colours:** edit the `body[data-mode="…"]` rules in `style.css`.
- **Chime:** change the frequencies in `playChime()` in `script.js`.
- **Adding a new mode:** add an entry to `MODES`, a button with a matching `data-mode` in `index.html`, and a `body[data-mode="…"]` rule in `style.css`.
- **Ring size:** the SVG circle radius is `90`; if you change it, update `RING_LENGTH` in `script.js` too.

## Browser support

Works in current versions of Chrome, Edge, Firefox and Safari. Smooth colour cross-fades rely on CSS `@property`; browsers without it still work but switch colours instantly.
