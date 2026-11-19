/* Pomodoro Builder - script.js
   Sections: config, DOM, state, rendering, timer logic, audio, events. */
(() => {
  'use strict';

  /* ---------- Config ---------- */
  const MODES = {
    focus: { label: 'Focus',       minutes: 25 },
    short: { label: 'Short break', minutes: 5  },
    long:  { label: 'Long break',  minutes: 15 },
  };
  const ROUNDS_PER_CYCLE = 4;                 // segments in the round tracker
  const RING_LENGTH = 2 * Math.PI * 90;       // circumference of the SVG ring (r = 90)
  const DEFAULT_ORDER = ['focus', 'short', 'long'];
  const DEFAULT_MINUTES = { focus: 25, short: 5, long: 15 };
  const DEFAULT_NAMES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
  const NAMES_KEY = 'pomodoro.names';         // user-chosen mode names
  const NAME_MAX = 16;
  const STORAGE_KEY = 'pomodoro.minutes';     // user-chosen durations, remembered in this browser
  const ORDER_KEY = 'pomodoro.order';         // user-chosen run order (1st, 2nd, 3rd)

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    timer: $('timer'), readout: document.querySelector('.readout'),
    modesNav: document.querySelector('.modes'), ring: $('ring'), time: $('time'), label: $('label'),
    message: $('message'), primary: $('primary'), reset: $('reset'),
    modes: document.querySelectorAll('.mode'),
    segs: document.querySelectorAll('.cycle-seg'),
    loopBtn: $('loop'), loopText: $('loopText'), loopBadge: $('loopBadge'),
    loopDialog: $('loopDialog'), loopForm: $('loopForm'), loopCount: $('loopCount'),
    loopTotal: $('loopTotal'), loopSeq: $('loopSeq'), settingRows: $('settingRows'),
    settingsBtn: $('settingsBtn'), settingsDialog: $('settingsDialog'), settingsForm: $('settingsForm'),
    settingsDefaults: $('settingsDefaults'),
    setInputs: { focus: $('setFocus'), short: $('setShort'), long: $('setLong') },
    nameInputs: { focus: $('nameFocus'), short: $('nameShort'), long: $('nameLong') },
    steps: document.querySelectorAll('.step'),
    dialogs: document.querySelectorAll('dialog'),
  };

  /* ---------- State ---------- */
  const state = {
    mode: 'focus',
    status: 'idle',        // 'idle' | 'running' | 'paused'
    durationMs: 0,
    remainingMs: 0,
    endTime: 0,            // real timestamp (ms) at which the countdown reaches zero
    completedFocus: 0,
    shownSeconds: -1,      // last value written to the screen, to avoid needless DOM writes
    rafId: 0,
    intervalId: 0,
    easeTimeout: 0,
    audioCtx: null,
    master: null,          // output node all sounds go through
    loop: null,            // null, or { total, current (1-based), step (index into state.order) }
    order: [...DEFAULT_ORDER],  // run order of the three modes; drives tabs, manual flow and auto loop
  };

  /* ---------- Rendering ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const formatTime = (s) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;

  function render() {
    const seconds = Math.ceil(state.remainingMs / 1000);
    if (seconds !== state.shownSeconds) {
      state.shownSeconds = seconds;
      const text = formatTime(seconds);
      el.time.textContent = text;
      document.title = `${text} \u00B7 ${MODES[state.mode].label}`;
    }
    // Ring drains from full to empty as the remaining fraction shrinks.
    const fraction = state.durationMs ? state.remainingMs / state.durationMs : 0;
    el.ring.style.strokeDashoffset = RING_LENGTH * (1 - fraction);
  }

  function renderControls() {
    const text = { idle: 'Start', running: 'Pause', paused: 'Resume' }[state.status];
    document.body.dataset.status = state.status;   // drives the breathing glow / paused blink in CSS
    if (el.primary.textContent !== text) {
      el.primary.textContent = text;
      restartAnimation(el.primary, 'is-popping');
    }
  }

  // Slide the pill behind the tabs to the active mode button.
  function moveIndicator() {
    const btn = document.querySelector('.mode.is-active');
    if (!btn) return;
    // While the active tab is being dragged, follow it (its drag offset is kept in btn.dragShift).
    el.modesNav.style.setProperty('--x', `${btn.offsetLeft + (btn.dragShift || 0)}px`);
    el.modesNav.style.setProperty('--w', `${btn.offsetWidth}px`);
  }

  // Re-trigger a CSS animation by removing the class, forcing reflow and adding it back.
  function restartAnimation(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  function renderRounds() {
    const filled = state.completedFocus === 0 ? 0 : ((state.completedFocus - 1) % ROUNDS_PER_CYCLE) + 1;
    el.segs.forEach((seg, i) => seg.classList.toggle('is-filled', i < filled));
  }

  function renderLoop() {
    const on = Boolean(state.loop);
    el.loopBtn.classList.toggle('is-active', on);
    el.loopBtn.setAttribute('aria-pressed', String(on));
    el.loopText.textContent = on ? 'Stop loop' : 'Loop';
    if (on) el.loopBadge.textContent = `Loop ${state.loop.current} of ${state.loop.total}`;
    el.loopBadge.classList.toggle('is-visible', on);
  }

  function setMessage(text) {
    el.message.textContent = text;
    el.message.classList.toggle('is-visible', Boolean(text));
  }

  // Briefly enable a CSS transition so the ring refills smoothly after a reset or mode change.
  function easeRing() {
    el.ring.classList.add('is-easing');
    clearTimeout(state.easeTimeout);
    state.easeTimeout = setTimeout(() => el.ring.classList.remove('is-easing'), 900);
  }

  function pulse() {
    restartAnimation(el.timer, 'is-complete');
  }

  /* ---------- Timer logic ---------- */
  function setMode(mode, message = '') {
    const changed = mode !== state.mode;
    stopTimers();
    state.mode = mode;
    state.status = 'idle';
    state.durationMs = MODES[mode].minutes * 60 * 1000;
    state.remainingMs = state.durationMs;
    state.shownSeconds = -1;

    document.body.dataset.mode = mode;
    el.label.textContent = MODES[mode].label;
    el.modes.forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    moveIndicator();
    if (changed) restartAnimation(el.readout, 'is-swapping');
    el.timer.classList.remove('is-complete');
    setMessage(message);
    easeRing();
    render();
    renderControls();
    renderRounds();
  }

  // Time is always derived from endTime, never from counting ticks,
  // so it stays correct even when the browser throttles a background tab.
  function tick() {
    if (state.status !== 'running') return;
    state.remainingMs = Math.max(0, state.endTime - Date.now());
    render();
    if (state.remainingMs === 0) complete();
  }

  function frame() {
    state.rafId = 0;
    tick();
    // tick() may have finished a session and start()ed the next one (auto loop), which
    // already scheduled a frame, so only schedule here if nothing is pending.
    if (state.status === 'running' && !state.rafId) state.rafId = requestAnimationFrame(frame);
  }

  function stopTimers() {
    cancelAnimationFrame(state.rafId);
    clearInterval(state.intervalId);
  }

  // `from` lets auto loops chain sessions back to back from the previous end time,
  // so no time is lost even if a background tab notices the end late.
  function start(from = Date.now()) {
    ensureAudio();                              // must be created from a user click
    el.ring.classList.remove('is-easing');
    el.timer.classList.remove('is-complete');
    setMessage('');
    state.endTime = from + state.remainingMs;
    state.status = 'running';
    state.rafId = requestAnimationFrame(frame); // smooth ring while the tab is visible
    state.intervalId = setInterval(tick, 500);  // keeps time moving in background tabs
    renderControls();
  }

  function pause() {
    state.remainingMs = Math.max(0, state.endTime - Date.now());
    state.status = 'paused';
    stopTimers();
    render();
    renderControls();
  }

  function complete() {
    if (state.mode === 'focus') state.completedFocus += 1;
    playSound(state.mode);                      // the sound of the session that just ended
    if (state.loop) advanceLoop();
    else advanceManual();
    pulse();
  }

  // Without a loop, the next session in the user's order is loaded but waits for a click.
  function advanceManual() {
    const done = MODES[state.mode].label;
    const next = nextInOrder(state.mode);
    setMode(next, `${done} done. Ready for ${MODES[next].label}?`);
  }

  /* ---------- Run order (1st, 2nd, 3rd) ---------- */
  const nextInOrder = (mode) => state.order[(state.order.indexOf(mode) + 1) % state.order.length];
  const isValidOrder = (o) =>
    Array.isArray(o) && o.length === DEFAULT_ORDER.length && DEFAULT_ORDER.every((m) => o.includes(m));

  function applyOrder(order, { save = true } = {}) {
    state.order = [...order];
    tabsSort.reorder(state.order);              // animates the tabs into place (no-op if already there)
    if (state.loop) state.loop.step = state.order.indexOf(state.mode);  // keep the running loop in step
    el.loopSeq.textContent = state.order.map((m) => MODES[m].label).join(' → ');
    moveIndicator();
    if (save) {
      try { localStorage.setItem(ORDER_KEY, JSON.stringify(state.order)); } catch { /* ignore */ }
    }
  }

  function loadOrder() {
    try {
      const saved = JSON.parse(localStorage.getItem(ORDER_KEY));
      if (isValidOrder(saved)) return saved;
    } catch { /* ignore */ }
    return DEFAULT_ORDER;
  }

  /* ---------- Drag to reorder (pointer events: mouse, touch and pen) ---------- */
  // Makes the children matching `items` inside `container` sortable along one axis.
  // `handle` limits where a drag can start; `onDrop(keys)` gets the new order of data-mode keys.
  function makeSortable(container, { items, handle = items, axis, onMove, onDrop, keyMove }) {
    const horiz = axis === 'x';
    const pos = (e) => (horiz ? e.clientX : e.clientY);
    const offset = (n) => (horiz ? n.offsetLeft : n.offsetTop);
    const size = (n) => (horiz ? n.offsetWidth : n.offsetHeight);
    const translate = (px) => (horiz ? `translateX(${px}px)` : `translateY(${px}px)`);
    const list = () => [...container.querySelectorAll(items)];
    const keys = () => list().map((n) => n.dataset.mode);
    const origin = () => {
      const r = container.getBoundingClientRect();
      return horiz ? r.left + container.clientLeft : r.top + container.clientTop;
    };
    const sibling = (n, dir) => {
      let s = dir < 0 ? n.previousElementSibling : n.nextElementSibling;
      while (s && !s.matches(items)) s = dir < 0 ? s.previousElementSibling : s.nextElementSibling;
      return s;
    };

    // FLIP: let `mutate` move nodes in the DOM, then animate every node from where it was.
    function flip(nodes, mutate) {
      const before = new Map(nodes.map((n) => [n, n.getBoundingClientRect()]));
      mutate();
      nodes.forEach((n) => {
        n.style.transition = 'none';
        n.style.transform = '';
        const a = before.get(n), b = n.getBoundingClientRect();
        const delta = horiz ? a.left - b.left : a.top - b.top;
        if (!delta) { n.style.transition = ''; return; }
        n.style.transform = translate(delta);
        void n.offsetWidth;
        n.style.transition = 'transform .38s cubic-bezier(.16, 1, .3, 1)';
        n.style.transform = '';
        n.addEventListener('transitionend', () => { n.style.transition = ''; }, { once: true });
      });
    }

    function reorder(order) {
      if (keys().join() === order.join()) return;
      flip(list(), () => order.forEach((k) => container.appendChild(list().find((n) => n.dataset.mode === k))));
    }

    let drag = null;
    let suppressClick = false;

    container.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const grip = e.target.closest(handle);
      if (!grip || !container.contains(grip)) return;
      const item = grip.closest(items);
      drag = { item, id: e.pointerId, start: pos(e), grab: pos(e) - origin() - offset(item), active: false };
    });

    // Move/up are watched on window: the item is moved in the DOM mid-drag, and the
    // pointer may leave the container, so container-level listeners could miss them.
    window.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { item } = drag;
      if (!drag.active) {
        if (Math.abs(pos(e) - drag.start) < 6) return;   // small moves are still clicks
        drag.active = true;
        item.setPointerCapture(e.pointerId);
        item.style.transition = 'none';
        item.classList.add('is-dragging');
        container.classList.add('is-sorting');
      }
      e.preventDefault();
      const lead = pos(e) - origin() - drag.grab;          // where the item's leading edge should be
      const center = lead + size(item) / 2;
      const prev = sibling(item, -1), next = sibling(item, 1);
      const others = list().filter((n) => n !== item);
      if (prev && center < offset(prev) + size(prev) / 2) {
        flip(others, () => container.insertBefore(item, prev));
      } else if (next && center > offset(next) + size(next) / 2) {
        flip(others, () => container.insertBefore(item, next.nextSibling));
      }
      item.dragShift = lead - offset(item);
      item.style.transition = 'none';
      item.style.transform = translate(item.dragShift);
      if (onMove) onMove();
    });

    function end(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const { item, active } = drag;
      drag = null;
      if (!active) return;
      container.classList.remove('is-sorting');
      item.dragShift = 0;
      // Spring the dropped item into its slot.
      item.style.transition = 'transform .45s cubic-bezier(.34, 1.56, .64, 1), scale .3s ease';
      item.style.transform = '';
      item.classList.remove('is-dragging');
      setTimeout(() => { item.style.transition = ''; }, 500);
      suppressClick = true;                                 // the click that follows a drag is not a selection
      setTimeout(() => { suppressClick = false; }, 0);
      if (onMove) onMove();
      if (onDrop) onDrop(keys());
    }
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    container.addEventListener('click', (e) => {
      if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
    }, true);

    // Keyboard: keyMove(e) returns -1 / +1 to move the focused item back / forward.
    container.addEventListener('keydown', (e) => {
      const grip = e.target.closest(handle);
      if (!grip || !keyMove) return;
      const dir = keyMove(e);
      if (!dir) return;
      const item = grip.closest(items);
      const target = sibling(item, dir);
      if (!target) return;
      e.preventDefault();
      flip(list(), () => container.insertBefore(item, dir < 0 ? target : target.nextSibling));
      grip.focus();
      if (onMove) onMove();
      if (onDrop) onDrop(keys());
    });

    return { reorder, keys };
  }

  // Tabs: drag left/right, or Shift + ←/→ on a focused tab. Changes apply immediately.
  const tabsSort = makeSortable(el.modesNav, {
    items: '.mode', axis: 'x',
    onMove: moveIndicator,
    onDrop: (order) => {
      applyOrder(order);
      setMessage(`Order: ${state.order.map((m) => MODES[m].label).join(' → ')}`);
    },
    keyMove: (e) => (e.shiftKey ? { ArrowLeft: -1, ArrowRight: 1 }[e.key] || 0 : 0),
  });

  // Settings rows: drag the ⠿ handle up/down, or ↑/↓ on a focused handle. Applied on Save.
  const rowsSort = makeSortable(el.settingRows, {
    items: '.setting-row', handle: '.drag-handle', axis: 'y',
    keyMove: (e) => ({ ArrowUp: -1, ArrowDown: 1 }[e.key] || 0),
  });

  /* ---------- Auto loop ---------- */
  function startLoop(total) {
    state.loop = { total, current: 1, step: 0 };
    setMode(state.order[0]);
    renderLoop();
    start();
  }

  function advanceLoop() {
    const loop = state.loop;
    const prevEnd = state.endTime;
    loop.step += 1;
    if (loop.step === state.order.length) {
      loop.step = 0;
      loop.current += 1;
    }
    if (loop.current > loop.total) {
      state.loop = null;
      renderLoop();
      setMode(state.order[0], `All ${loop.total} loop${loop.total > 1 ? 's' : ''} done. Great work!`);
      return;
    }
    renderLoop();
    setMode(state.order[loop.step]);
    start(prevEnd);                             // next session begins immediately, no click needed
  }

  function stopLoop(message = '') {
    if (!state.loop) return;
    state.loop = null;
    renderLoop();
    setMode(state.mode, message);
  }

  /* ---------- Dialog helpers ---------- */
  // Keep a number input within its own min/max attributes.
  function clampInput(input, value = Number(input.value)) {
    const min = Number(input.min), max = Number(input.max);
    return Math.min(max, Math.max(min, Math.round(value) || min));
  }

  /* ---------- Timer settings (custom durations) ---------- */
  function loadMinutes() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved) return;
      Object.keys(MODES).forEach((m) => {
        const v = Number(saved[m]);
        if (Number.isFinite(v) && v >= 1) MODES[m].minutes = clampInput(el.setInputs[m], v);
      });
    } catch { /* storage blocked or corrupt: keep defaults */ }
  }

  function saveMinutes() {
    try {
      const data = {};
      Object.keys(MODES).forEach((m) => { data[m] = MODES[m].minutes; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* storage unavailable: settings last for this visit only */ }
  }

  /* ---------- Custom mode names ---------- */
  // Trim, collapse spaces and cap the length; an empty name falls back to the default.
  const cleanName = (m, raw) =>
    String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || DEFAULT_NAMES[m];

  function loadNames() {
    try {
      const saved = JSON.parse(localStorage.getItem(NAMES_KEY));
      if (saved) Object.keys(MODES).forEach((m) => { MODES[m].label = cleanName(m, saved[m]); });
    } catch { /* keep defaults */ }
  }

  function saveNames() {
    try {
      const data = {};
      Object.keys(MODES).forEach((m) => { data[m] = MODES[m].label; });
      localStorage.setItem(NAMES_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
  }

  // Push the current names into every place they appear.
  function renderNames() {
    el.modes.forEach((btn) => {
      const name = MODES[btn.dataset.mode].label;
      btn.querySelector('.mode-name').textContent = name;
      btn.title = `${name} (drag to change the order)`;
    });
    Object.keys(MODES).forEach((m) => {
      const name = MODES[m].label;
      const row = el.setInputs[m].closest('.setting-row');
      row.querySelector('.drag-handle').setAttribute('aria-label', `Reorder ${name} (use ↑ and ↓)`);
      row.querySelector('.sound-btn').setAttribute('aria-label', `Play the ${name} end sound`);
      el.setInputs[m].setAttribute('aria-label', `${name} minutes`);
      el.nameInputs[m].setAttribute('aria-label', 'Session name');
    });
    el.label.textContent = MODES[state.mode].label;
    el.loopSeq.textContent = state.order.map((m) => MODES[m].label).join(' → ');
    state.shownSeconds = -1;                    // refresh the browser tab title
    render();
    moveIndicator();                            // tab widths may have changed
  }

  function openSettings() {
    Object.keys(MODES).forEach((m) => { el.setInputs[m].value = MODES[m].minutes; });
    Object.keys(MODES).forEach((m) => { el.nameInputs[m].value = MODES[m].label; });
    state.order.forEach((m) => el.settingRows.appendChild(el.setInputs[m].closest('.setting-row')));
    el.settingsDialog.showModal();
  }

  function applySettings() {
    Object.keys(MODES).forEach((m) => {
      MODES[m].minutes = clampInput(el.setInputs[m]);
    });
    saveMinutes();
    Object.keys(MODES).forEach((m) => { MODES[m].label = cleanName(m, el.nameInputs[m].value); });
    saveNames();
    renderNames();
    applyOrder(rowsSort.keys());
    if (state.status === 'idle') {
      setMode(state.mode, 'Timer settings saved.');   // reload the current session with the new length
    } else {
      setMessage('Saved. New times start from the next session.');
    }
  }

  /* ---------- Loop dialog ---------- */
  const clampLoops = (n) => clampInput(el.loopCount, n);

  function formatDuration(minutes) {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return [h && `${h} h`, m && `${m} min`].filter(Boolean).join(' ') || '0 min';
  }

  function renderLoopTotal() {
    const n = clampLoops(Number(el.loopCount.value));
    const perLoop = state.order.reduce((sum, m) => sum + MODES[m].minutes, 0);
    el.loopTotal.textContent = `${n} × ${perLoop} min = ${formatDuration(n * perLoop)} in total`;
  }

  function openLoopDialog() {
    renderLoopTotal();
    el.loopDialog.showModal();
    el.loopCount.focus();
    el.loopCount.select();
  }

  /* ---------- Audio (Web Audio API, no files) ---------- */
  function ensureAudio() {
    if (!state.audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) state.audioCtx = new AC();
    }
    if (state.audioCtx && state.audioCtx.state === 'suspended') state.audioCtx.resume();
    if (state.audioCtx && !state.master) {
      // A gentle compressor on the way out keeps overlapping notes from clipping.
      state.master = state.audioCtx.createDynamicsCompressor();
      state.master.connect(state.audioCtx.destination);
    }
  }

  // One enveloped oscillator: quick attack, exponential fade.
  function voice({ freq, type = 'sine', t, attack = 0.01, decay, peak, detune = 0 }) {
    const ctx = state.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(gain).connect(state.master);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  // Bell: pure tone plus an inharmonic shimmer partial.
  function bell(freq, t, decay, peak) {
    voice({ freq, t, decay, peak });
    voice({ freq: freq * 2, type: 'triangle', t, decay: decay * 0.5, peak: peak * 0.2 });
    voice({ freq: freq * 2.76, t, decay: decay * 0.35, peak: peak * 0.25 });
  }

  // Pluck: short, bright, percussive.
  function pluck(freq, t, decay, peak) {
    voice({ freq, type: 'triangle', t, attack: 0.004, decay, peak });
    voice({ freq: freq * 3, t, attack: 0.004, decay: decay * 0.4, peak: peak * 0.15 });
  }

  // Singing bowl: two slightly detuned fundamentals that slowly "beat", plus metallic partials.
  function bowl(freq, t, decay, peak) {
    voice({ freq, t, attack: 0.05, decay, peak, detune: -5 });
    voice({ freq, t, attack: 0.05, decay, peak: peak * 0.8, detune: 5 });
    voice({ freq: freq * 2.71, t, attack: 0.03, decay: decay * 0.6, peak: peak * 0.3 });
    voice({ freq: freq * 5.15, t, attack: 0.02, decay: decay * 0.3, peak: peak * 0.12 });
  }

  // A distinct end-of-session sound for each mode. Returns roughly how long it rings (s).
  const SOUNDS = {
    // Focus finished: a warm, rising bell arpeggio (C5 E5 G5 C6), "well done, take a break".
    focus(t) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(f, t + i * 0.16, 1.6, 0.14));
      return 2.1;
    },
    // Short break finished: a bright double "ding-ding" (E6 then A6, twice), "back to it".
    short(t) {
      [0, 0.42].forEach((d) => {
        pluck(1318.5, t + d, 0.35, 0.13);
        pluck(1760, t + d + 0.11, 0.5, 0.13);
      });
      return 1.1;
    },
    // Long break finished: a deep, slowly fading singing bowl (G3 then D4), calm but unmistakable.
    long(t) {
      bowl(196, t, 4, 0.22);
      bowl(293.66, t + 0.6, 3.4, 0.13);
      return 4;
    },
  };

  function playSound(mode) {
    const ctx = state.audioCtx;
    if (!ctx || !state.master) return 0;
    return SOUNDS[mode](ctx.currentTime + 0.02);
  }

  /* ---------- Events ---------- */
  el.primary.addEventListener('click', () => (state.status === 'running' ? pause() : start()));
  el.reset.addEventListener('click', () => setMode(state.mode));
  el.modes.forEach((btn) =>
    btn.addEventListener('click', () => {
      if (btn.dataset.mode === state.mode) return;
      if (state.loop) { state.loop = null; renderLoop(); }   // picking a mode by hand ends the loop
      setMode(btn.dataset.mode);
    })
  );

  el.loopBtn.addEventListener('click', () => (state.loop ? stopLoop('Loop stopped.') : openLoopDialog()));
  el.loopCount.addEventListener('input', renderLoopTotal);
  // − / + buttons in any dialog step the number input next to them.
  el.steps.forEach((btn) =>
    btn.addEventListener('click', () => {
      const input = btn.closest('.stepper').querySelector('input');
      input.value = clampInput(input, Number(input.value) + Number(btn.dataset.step));
      input.dispatchEvent(new Event('input'));
    })
  );
  el.dialogs.forEach((dialog) => {
    dialog.addEventListener('click', (e) => {                // click on the backdrop closes it
      if (e.target === dialog) dialog.close();
    });
    dialog.querySelectorAll('[data-close]').forEach((btn) =>
      btn.addEventListener('click', () => dialog.close())
    );
  });

  // 🔊 buttons in Timer settings preview each mode's sound.
  document.querySelectorAll('.sound-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      ensureAudio();
      const seconds = playSound(btn.dataset.sound);
      restartAnimation(btn, 'is-playing');
      clearTimeout(btn.playTimer);
      btn.playTimer = setTimeout(() => btn.classList.remove('is-playing'), seconds * 1000);
    })
  );

  el.settingsBtn.addEventListener('click', openSettings);
  el.settingsDefaults.addEventListener('click', () => {
    Object.keys(MODES).forEach((m) => {
      el.setInputs[m].value = DEFAULT_MINUTES[m];
      el.nameInputs[m].value = DEFAULT_NAMES[m];
    });
    rowsSort.reorder(DEFAULT_ORDER);
  });
  el.settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    el.settingsDialog.close();
    applySettings();
  });
  el.loopForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const total = clampLoops(Number(el.loopCount.value));
    el.loopCount.value = total;
    el.loopDialog.close();
    startLoop(total);
  });
  document.addEventListener('visibilitychange', tick);    // re-sync instantly when the tab returns

  window.addEventListener('resize', moveIndicator);

  el.ring.style.strokeDasharray = RING_LENGTH;
  loadMinutes();
  loadNames();
  applyOrder(loadOrder(), { save: false });
  setMode(state.order[0]);
  renderNames();
  // Enable the pill's slide only after its first placement, so it doesn't sweep in from the left on load.
  requestAnimationFrame(() => requestAnimationFrame(() => el.modesNav.classList.add('is-ready')));
})();
