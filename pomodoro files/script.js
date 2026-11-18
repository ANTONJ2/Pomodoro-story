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

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    timer: $('timer'), ring: $('ring'), time: $('time'), label: $('label'),
    message: $('message'), primary: $('primary'), reset: $('reset'),
    modes: document.querySelectorAll('.mode'),
    segs: document.querySelectorAll('.cycle-seg'),
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
    el.primary.textContent = { idle: 'Start', running: 'Pause', paused: 'Resume' }[state.status];
  }

  function renderRounds() {
    const filled = state.completedFocus === 0 ? 0 : ((state.completedFocus - 1) % ROUNDS_PER_CYCLE) + 1;
    el.segs.forEach((seg, i) => seg.classList.toggle('is-filled', i < filled));
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
    el.timer.classList.remove('is-complete');
    void el.timer.offsetWidth;                // restart the CSS animation
    el.timer.classList.add('is-complete');
  }

  /* ---------- Timer logic ---------- */
  function setMode(mode, message = '') {
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
    tick();
    if (state.status === 'running') state.rafId = requestAnimationFrame(frame);
  }

  function stopTimers() {
    cancelAnimationFrame(state.rafId);
    clearInterval(state.intervalId);
  }

  function start() {
    ensureAudio();                              // must be created from a user click
    el.ring.classList.remove('is-easing');
    el.timer.classList.remove('is-complete');
    setMessage('');
    state.endTime = Date.now() + state.remainingMs;
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
    let next, message;
    if (state.mode === 'focus') {
      state.completedFocus += 1;
      next = state.completedFocus % ROUNDS_PER_CYCLE === 0 ? 'long' : 'short';
      message = `Focus round done. Ready for a ${MODES[next].label.toLowerCase()}?`;
    } else {
      next = 'focus';
      message = 'Break over. Ready for the next focus round?';
    }
    setMode(next, message);                     // loads the next session but waits for a click
    playChime();
    pulse();
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
      if (btn.dataset.mode !== state.mode) setMode(btn.dataset.mode);
    })
  );
  document.addEventListener('visibilitychange', tick);    // re-sync instantly when the tab returns

  el.ring.style.strokeDasharray = RING_LENGTH;
  setMode('focus');
})();
