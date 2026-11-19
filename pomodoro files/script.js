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
  const ROUNDS_PER_CYCLE = 4;                 // long break is offered after every 4th focus round
  const RING_LENGTH = 2 * Math.PI * 90;       // circumference of the SVG ring (r = 90)
  const LOOP_SEQUENCE = ['focus', 'short', 'long'];  // one auto loop
  const DEFAULT_MINUTES = { focus: 25, short: 5, long: 15 };
  const STORAGE_KEY = 'pomodoro.minutes';     // user-chosen durations, remembered in this browser

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
    loopTotal: $('loopTotal'),
    settingsBtn: $('settingsBtn'), settingsDialog: $('settingsDialog'), settingsForm: $('settingsForm'),
    settingsDefaults: $('settingsDefaults'),
    setInputs: { focus: $('setFocus'), short: $('setShort'), long: $('setLong') },
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
    loop: null,            // null, or { total, current (1-based), step (index into LOOP_SEQUENCE) }
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
    el.modesNav.style.setProperty('--x', `${btn.offsetLeft}px`);
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
    playChime();
    if (state.loop) advanceLoop();
    else advanceManual();
    pulse();
  }

  function advanceManual() {
    let next, message;
    if (state.mode === 'focus') {
      next = state.completedFocus % ROUNDS_PER_CYCLE === 0 ? 'long' : 'short';
      message = `Focus round done. Ready for a ${MODES[next].label.toLowerCase()}?`;
    } else {
      next = 'focus';
      message = 'Break over. Ready for the next focus round?';
    }
    setMode(next, message);                     // loads the next session but waits for a click
  }

  /* ---------- Auto loop ---------- */
  function startLoop(total) {
    state.loop = { total, current: 1, step: 0 };
    setMode(LOOP_SEQUENCE[0]);
    renderLoop();
    start();
  }

  function advanceLoop() {
    const loop = state.loop;
    const prevEnd = state.endTime;
    loop.step += 1;
    if (loop.step === LOOP_SEQUENCE.length) {
      loop.step = 0;
      loop.current += 1;
    }
    if (loop.current > loop.total) {
      state.loop = null;
      renderLoop();
      setMode('focus', `All ${loop.total} loop${loop.total > 1 ? 's' : ''} done. Great work!`);
      return;
    }
    renderLoop();
    setMode(LOOP_SEQUENCE[loop.step]);
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

  function openSettings() {
    Object.keys(MODES).forEach((m) => { el.setInputs[m].value = MODES[m].minutes; });
    el.settingsDialog.showModal();
  }

  function applySettings() {
    Object.keys(MODES).forEach((m) => {
      MODES[m].minutes = clampInput(el.setInputs[m]);
    });
    saveMinutes();
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
    const perLoop = LOOP_SEQUENCE.reduce((sum, m) => sum + MODES[m].minutes, 0);
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
  }

  function playChime() {
    const ctx = state.audioCtx;
    if (!ctx) return;
    [523.25, 659.25, 783.99].forEach((freq, i) => {       // C5, E5, G5
      const t = ctx.currentTime + i * 0.22;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1.3);
    });
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

  el.settingsBtn.addEventListener('click', openSettings);
  el.settingsDefaults.addEventListener('click', () => {
    Object.keys(MODES).forEach((m) => { el.setInputs[m].value = DEFAULT_MINUTES[m]; });
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
  setMode('focus');
  // Enable the pill's slide only after its first placement, so it doesn't sweep in from the left on load.
  requestAnimationFrame(() => requestAnimationFrame(() => el.modesNav.classList.add('is-ready')));
})();
