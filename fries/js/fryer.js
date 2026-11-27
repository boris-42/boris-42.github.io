/* Fries timer: fryer screen. Two isolated fryers (L = left pedal, R = right pedal).
   Each half shows that fryer's steps on a wheel rolling out of its outer edge:
   2 done steps above (gray, struck), the current step big in the middle, 2 upcoming steps below.
   The loop is: Ready ("Drop fries in") -> step 1 -> ... -> last step -> Ready -> ...
   All timing uses absolute timestamps (Date.now) kept in localStorage, so a reload resumes a running batch. */
(function () {
  'use strict';
  const F = window.Fries;
  const IDS = F.FRYERS;
  const STALE_MS = 30 * 60 * 1000;      // a step running this long at page load is treated as abandoned
  const SLOT_Y = [0, 0.25, 0.4, 0.56];  // vertical offset of wheel slots 0..3, as a fraction of the wheel area height
  const TOP_BAND = 0.1;     // stats row at the top (fraction of panel height)
  const BOTTOM_BAND = 0.12; // buttons at the bottom

  const openSettingsOnLoad = location.hash === '#settings'; // e.g. the Settings link on the Stats page
  let cfg = F.loadConfig({ useHash: true, persist: true });
  // The address always carries the current setup. On an iPad, a Home Screen app has its own storage (separate from
  // Safari), so "Add to Home Screen" must take the settings along in the URL.
  const syncUrl = () => history.replaceState(null, '', location.pathname + location.search + '#' + F.configHash(cfg));
  syncUrl();
  F.Sound.setEnabled(cfg.sound);
  F.Sound.setVolume(cfg.volume);
  F.Sound.setSides(cfg.soundL, cfg.soundR);

  const state = F.loadState();
  const held = { L: null, R: null };  // pedal/screen currently pressed
  const fired = { L: {}, R: {} };     // alerts already sounded for the current step
  const ui = {};
  const today = { L: null, R: null }; // on-screen stats, recomputed from today's telemetry

  // the window a step may be finished in: from earlyMs before the target to lateMs after it (snapshotted per round)
  const earlyMs = (s) => (typeof s.early === 'number' ? s.early : typeof s.tolerance === 'number' ? s.tolerance : cfg.earlySeconds) * 1000;
  const lateMs = (s) => (typeof s.late === 'number' ? s.late : typeof s.tolerance === 'number' ? s.tolerance : cfg.lateSeconds) * 1000;
  const stepEnd = (s) => s.stepStart + s.steps[s.stepIndex].duration * 1000;
  const totalTarget = (steps) => steps.reduce((a, x) => a + x.duration * 1000, 0);
  const mod = (a, n) => ((a % n) + n) % n;

  // ---------- state ----------

  function initFryer(id, now) {
    let s = state[id];
    if (!s || typeof s !== 'object') s = state[id] = { phase: 'idle' };
    const broken = s.phase === 'cycle' &&
      (!Array.isArray(s.steps) || !s.steps.length || !(s.stepIndex >= 0 && s.stepIndex < s.steps.length) || !s.stepStart);
    if (broken) s.phase = 'idle';
    if (s.phase === 'cycle' && now - s.stepStart > STALE_MS) reset(id, now, 'stale_on_load');
    if (s.phase === 'break' && (!s.breakStart || F.dayKey(s.breakStart) !== F.dayKey(now))) {
      endBreak(id, s.breakStart ? s.breakStart : now, 'stale_on_load');
    }
    if (s.phase === 'break') return;
    if (s.phase !== 'cycle') {
      s.phase = 'idle';
      // keep the waiting clock across a reload on the same day; otherwise start a new wait
      if (!s.readySince || F.dayKey(s.readySince) !== F.dayKey(now)) {
        s.readySince = now;
        s.readyReason = 'session_start';
      }
    }
  }

  // A step may only be finished once its window opens (auto steps finish themselves).
  const windowOpen = (s, t) => !s.steps[s.stepIndex].auto && stepEnd(s) - t <= earlyMs(s);

  function phaseOf(s, now) {
    if (s.phase === 'break') return 'break';
    if (s.phase !== 'cycle') return 'idle';
    const st = s.steps[s.stepIndex];
    const rem = stepEnd(s) - now;
    const early = earlyMs(s);
    if (rem > cfg.warnSeconds * 1000 && rem > early) return 'run';
    if (rem > early) return 'soon';
    if (rem >= -lateMs(s) || st.auto) return 'due';
    return 'late';
  }

  // ---------- batch logic ----------

  function advance(id, t, source) {
    const s = state[id];
    if (source !== 'auto' && t - (s.lastAdvanceAt || 0) < cfg.pressGuardMs) {
      F.log('press_ignored', id, { t, reason: 'too_soon', sinceLastMs: t - s.lastAdvanceAt, source });
      return;
    }
    if (source !== 'auto' && s.phase === 'cycle' && !windowOpen(s, t)) {
      // too early: refuse, give feedback, and record the attempt
      F.log('press_blocked', id, { t, source, step: s.stepIndex, remainingMs: stepEnd(s) - t, cycleId: s.cycleId });
      F.Sound.play(id, 'blocked');
      ui[id].nopeUntil = Date.now() + 450;
      return;
    }
    s.lastAdvanceAt = t;
    if (s.phase === 'break') endBreak(id, t, source); // pedal during a break: break over, round starts
    if (s.phase !== 'cycle') {
      startCycle(id, t, source);
    } else {
      endStep(id, t, source);
      if (s.stepIndex + 1 < s.steps.length) startStep(id, s.stepIndex + 1, t);
      else endCycle(id, t);
    }
    F.saveState(state);
  }

  function startCycle(id, t, source) {
    const s = state[id];
    s.phase = 'cycle';
    s.cycleId = `${id}-${t}`;
    s.cycleStart = t;
    s.steps = cfg.fryers[id].program.steps.map((x) => Object.assign({}, x)); // snapshot: edits apply to the next batch
    s.early = cfg.earlySeconds;
    s.late = cfg.lateSeconds;
    s.results = [];
    // waiting time before this round, not counting breaks taken meanwhile
    s.idleBeforeMs = s.readySince ? t - s.readySince - (s.waitBreakMs || 0) : null;
    s.idleReason = s.readyReason || null;
    F.log('cycle_start', id, {
      t, cycleId: s.cycleId, source,
      idleBeforeMs: s.idleBeforeMs, idleReason: s.idleReason, breakMsBefore: s.waitBreakMs || 0,
      sinceLastCycleEndMs: s.lastCycleEnd ? t - s.lastCycleEnd : null,
      targetMs: totalTarget(s.steps), earlyMs: earlyMs(s), lateMs: lateMs(s), steps: s.steps,
    });
    F.Sound.play(id, 'start');
    startStep(id, 0, t);
    refreshToday(id); // shift clock starts with the first round of the day
  }

  function startStep(id, i, t) {
    const s = state[id];
    const st = s.steps[i];
    s.stepIndex = i;
    s.stepStart = t;
    F.log('step_start', id, {
      t, cycleId: s.cycleId, step: i, name: st.name,
      targetMs: st.duration * 1000, earlyMs: earlyMs(s), lateMs: lateMs(s), auto: st.auto,
    });
  }

  function endStep(id, t, source) {
    const s = state[id];
    const st = s.steps[s.stepIndex];
    const actualMs = t - s.stepStart;
    const targetMs = st.duration * 1000;
    const devMs = actualMs - targetMs;
    const status = devMs < -earlyMs(s) ? 'early' : devMs > lateMs(s) ? 'late' : 'on_time';
    const r = { step: s.stepIndex, name: st.name, targetMs, earlyMs: earlyMs(s), lateMs: lateMs(s), actualMs, devMs, status, source };
    s.results.push(r);
    F.log('step_end', id, Object.assign({ t, cycleId: s.cycleId }, r));
    F.Sound.play(id, source === 'auto' ? 'auto' : 'press');
  }

  function endCycle(id, t) {
    const s = state[id];
    const totalMs = t - s.cycleStart;
    const targetMs = totalTarget(s.steps);
    const onTimeSteps = s.results.filter((r) => r.status === 'on_time').length;
    const stepCount = s.results.length;
    F.log('cycle_end', id, {
      t, cycleId: s.cycleId, cycleStart: s.cycleStart, totalMs, targetMs, devMs: totalMs - targetMs,
      idleBeforeMs: s.idleBeforeMs, idleReason: s.idleReason,
      onTimeSteps, stepCount, steps: s.results,
    });
    s.last = {
      totalMs, devMs: totalMs - targetMs, onTimeSteps, stepCount, endedAt: t,
      results: s.results.map((r) => ({ status: r.status, devMs: r.devMs })),
    };
    toIdle(s, t, 'cycle_end');
    s.lastCycleEnd = t;
    F.Sound.play(id, 'done');
    refreshToday(id);
  }

  function reset(id, t, how, pressAt) {
    const s = state[id];
    if (s.phase === 'break') endBreak(id, t, how);
    if (s.phase === 'cycle') {
      // Holding the pedal while Ready first starts a batch (press = start), then cancels it.
      const startedByThisPress = pressAt != null && s.cycleStart === pressAt;
      F.log('cycle_reset', id, {
        t, how, startedByThisPress, cycleId: s.cycleId, step: s.stepIndex,
        stepName: s.steps[s.stepIndex] && s.steps[s.stepIndex].name,
        cycleElapsedMs: t - s.cycleStart, stepElapsedMs: t - s.stepStart, stepsDone: (s.results || []).length, steps: s.results,
      });
    } else {
      F.log('idle_reset', id, { t, how, idleMs: s.readySince ? t - s.readySince : null });
    }
    s.last = null;
    toIdle(s, t, 'reset');
    F.saveState(state);
    refreshToday(id);
  }

  // Breaks: only between rounds (fries can't pause in the oil). Break time is not counted as waiting.
  function startBreak(id, t, how) {
    const s = state[id];
    if (s.phase !== 'idle') return;
    s.phase = 'break';
    s.breakStart = t;
    F.log('break_start', id, { t, how, waitedMs: s.readySince ? t - s.readySince - (s.waitBreakMs || 0) : null });
    F.saveState(state);
  }

  function endBreak(id, t, how) {
    const s = state[id];
    if (s.phase !== 'break') return;
    const durationMs = Math.max(0, t - s.breakStart);
    F.log('break_end', id, { t, how, breakStart: s.breakStart, durationMs });
    s.waitBreakMs = (s.waitBreakMs || 0) + durationMs;
    s.phase = 'idle';
    delete s.breakStart;
    if (!s.readySince) s.readySince = t;
    F.saveState(state);
    refreshToday(id);
  }

  function toIdle(s, t, reason) {
    s.phase = 'idle';
    s.readySince = t;
    s.readyReason = reason;
    s.waitBreakMs = 0;
    ['cycleId', 'cycleStart', 'steps', 'results', 'stepIndex', 'stepStart', 'idleBeforeMs', 'idleReason', 'tolerance', 'early', 'late']
      .forEach((k) => delete s[k]);
  }

  // ---------- alerts (sound + telemetry) ----------

  function alerts(id, now) {
    const s = state[id];
    if (s.phase !== 'cycle') return;
    const st = s.steps[s.stepIndex];
    const key = `${s.cycleId}:${s.stepIndex}`;
    if (fired[id].key !== key) fired[id] = { key };
    const f = fired[id];
    const rem = stepEnd(s) - now;
    // "time is approaching": once, when the screen turns amber (not for steps shorter than the warning)
    const warn = cfg.warnSeconds * 1000;
    if (!f.approach && rem <= warn) {
      f.approach = true;
      if (now - s.stepStart > 1500 && rem > warn - 1000 && rem > 3500) {
        F.Sound.play(id, 'approach');
        F.log('alert', id, { level: 'approach', cycleId: s.cycleId, step: s.stepIndex });
      }
    }
    for (const sec of [3, 2, 1]) { // countdown ticks; skipped if already past them (e.g. after a reload)
      if (rem <= sec * 1000 && !f['t' + sec]) {
        f['t' + sec] = true;
        if (rem > (sec - 1) * 1000) F.Sound.play(id, 'tick');
      }
    }
    if (st.auto) return; // auto steps advance on their own
    if (rem <= 0 && !f.due) {
      f.due = true;
      if (rem > -1000) {
        F.Sound.play(id, 'now');
        F.log('alert', id, { level: 'due', cycleId: s.cycleId, step: s.stepIndex });
      }
    }
    if (-rem - lateMs(s) > 0) {
      if (!f.late) {
        f.late = true;
        f.nextLate = now;
        F.log('alert', id, { level: 'late', cycleId: s.cycleId, step: s.stepIndex });
      }
      if (now >= f.nextLate) {
        F.Sound.play(id, 'late');
        f.nextLate = now + 3000; // penalty repeats while late
      }
    }
  }

  // ---------- input: pedals (keys) and touching the screen ----------

  function codeFor(k) {
    if (/^[a-z]$/.test(k)) return 'Key' + k.toUpperCase();
    if (/^[0-9]$/.test(k)) return 'Digit' + k;
    return null;
  }

  // Match the physical key first (works with any keyboard layout), then the typed character.
  function fryerForEvent(e) {
    for (const id of IDS) if (e.code && e.code === codeFor(cfg.fryers[id].key)) return id;
    const k = (e.key || '').toLowerCase();
    for (const id of IDS) if (k === cfg.fryers[id].key) return id;
    return null;
  }

  function down(id, source, e) {
    if (held[id]) return;
    const now = Date.now();
    const s = state[id];
    // remember the state before this press: a 5 s hold decides what to do based on it
    held[id] = {
      downAt: now, source,
      pre: { phase: s.phase, readySince: s.readySince, readyReason: s.readyReason, waitBreakMs: s.waitBreakMs || 0,
        breakStart: s.breakStart, lastAdvanceAt: s.lastAdvanceAt },
    };
    F.log('pedal_down', id, { t: now, source, key: e && e.key, code: e && e.code });
    unlockExtras();
    advance(id, now, source);
    render(id, now);
  }

  function up(id, reason) {
    const h = held[id];
    if (!h) return;
    held[id] = null;
    F.log('pedal_up', id, { source: h.source, heldMs: Date.now() - h.downAt, reason, holdAction: h.done || null });
  }

  // Holding the pedal (or Next) for holdResetSeconds:
  //   pressed during a round   -> reset the round
  //   pressed while Ready      -> break (e.g. bathroom); the round this press started is cancelled
  //   pressed while on a break -> stay on break (the round this press started is cancelled)
  function holdCheck(id, now) {
    const h = held[id];
    const u = ui[id];
    if (!h) { u.hold.classList.remove('show'); return; }
    const need = cfg.holdResetSeconds * 1000;
    const ms = now - h.downAt;
    const mode = h.pre.phase === 'cycle' ? 'reset' : 'break';
    if (ms >= need && !h.done) {
      h.done = mode;
      if (mode === 'reset') {
        reset(id, now, h.source === 'pedal' ? 'hold_pedal' : 'hold_button', h.downAt);
        F.Sound.play(id, 'reset');
      } else {
        holdToBreak(id, h);
        F.Sound.play(id, 'break');
      }
    }
    if (ms < 1000 && !h.done) { u.hold.classList.remove('show'); return; }
    u.hold.classList.add('show');
    u.hold.dataset.mode = mode;
    u.holdBar.style.width = Math.min(100, (ms / need) * 100) + '%';
    const left = Math.ceil((need - ms) / 1000);
    u.holdTxt.textContent = h.done
      ? (h.done === 'reset' ? 'Reset ✓' : 'On break ✓  you can let go')
      : (mode === 'reset' ? `Hold to reset · ${left}` : `Hold for a break · ${left}`);
  }

  function holdToBreak(id, h) {
    const s = state[id];
    const pre = h.pre;
    const how = h.source === 'pedal' ? 'hold_pedal' : 'hold_button';
    if (s.phase === 'cycle' && s.cycleStart === h.downAt) { // undo the round this press started
      F.log('cycle_cancelled', id, { how, reason: 'hold_for_break', cycleId: s.cycleId });
      toIdle(s, pre.readySince || h.downAt, pre.readyReason || 'reset');
      // a break that this press ended still counts as break time, not waiting
      s.waitBreakMs = pre.waitBreakMs + (pre.phase === 'break' && pre.breakStart ? h.downAt - pre.breakStart : 0);
      s.lastAdvanceAt = pre.lastAdvanceAt;
    }
    if (s.phase === 'idle') startBreak(id, h.downAt, how); // the break began when the pedal went down
    F.saveState(state);
    refreshToday(id);
  }

  const isTyping = (e) => {
    const t = e.target;
    if (!t || !t.tagName) return false;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
    return t.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(t.type);
  };

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSettings(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
    const id = fryerForEvent(e);
    if (!id) return;
    e.preventDefault();
    if (e.repeat) return; // the OS repeats keydown while the pedal is held: ignore
    down(id, 'pedal', e);
  });
  addEventListener('keyup', (e) => {
    const id = fryerForEvent(e);
    if (id) up(id, 'keyup');
  });
  addEventListener('blur', () => IDS.forEach((id) => up(id, 'blur')));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) IDS.forEach((id) => up(id, 'hidden'));
    else unlockExtras();
  });
  // Browsers only allow audio after a user gesture; any tap/key unlocks it.
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach((t) => addEventListener(t, unlockExtras, { passive: true }));

  // ---------- wake lock, fullscreen, duplicate-tab guard ----------

  let wakeLock = null;
  let wakePending = false;
  async function unlockExtras() {
    F.Sound.unlock();
    if (!('wakeLock' in navigator) || wakeLock || wakePending || document.hidden) return;
    wakePending = true;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { /* not allowed yet; retried on next interaction */ }
    wakePending = false;
  }

  let duplicateTab = false;
  if ('BroadcastChannel' in window) {
    const bc = new BroadcastChannel('fries-fryer-screen');
    bc.onmessage = (m) => {
      if (m.data === 'hello') bc.postMessage('here');
      duplicateTab = true;
    };
    bc.postMessage('hello');
  }

  // ---------- the wheel ----------

  // What a fryer loops through: Ready, then its steps (a running batch keeps its own copy of the steps).
  function sequence(id) {
    const s = state[id];
    const prog = cfg.fryers[id].program;
    const steps = s.phase === 'cycle' ? s.steps : prog.steps;
    return [{ ready: true, name: prog.startPrompt }]
      .concat(steps.map((x, i) => ({ step: i, name: x.name, duration: x.duration, auto: x.auto })));
  }
  const position = (s) => (s.phase === 'cycle' ? s.stepIndex + 1 : 0);

  const SVGNS = 'http://www.w3.org/2000/svg';

  // static button icons (fixed markup, never user text)
  const ICONS = {
    next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4.5l11 7.5-11 7.5z"/><rect x="17" y="4.5" width="2.6" height="15" rx="1"/></svg>',
    start: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/></svg>',
    break: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h12v4.5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5v3M12 3.5v3"/></svg>',
    resume: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg>',
  };
  function iconButton(cls, icon, label) {
    const ic = F.h('span', { class: 'ic' });
    const tl = F.h('span', { class: 'tl' }, label);
    const b = F.h('button', { class: 'tbtn ' + cls, type: 'button' }, ic, tl);
    b._ic = ic;
    b._tl = tl;
    setIcon(b, icon);
    return b;
  }
  function setIcon(b, icon) {
    if (b._icon === icon) return;
    b._icon = icon;
    b._ic.innerHTML = ICONS[icon];
  }
  function build(id) {
    const root = document.querySelector(`.fryer[data-id="${id}"]`);
    root.textContent = '';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'rail');
    const track = document.createElementNS(SVGNS, 'circle');
    track.setAttribute('class', 'track');
    const ticks = document.createElementNS(SVGNS, 'circle');
    ticks.setAttribute('class', 'ticks');
    const progGlow = document.createElementNS(SVGNS, 'path');
    progGlow.setAttribute('class', 'progGlow');
    const prog = document.createElementNS(SVGNS, 'path');
    prog.setAttribute('class', 'prog');
    svg.append(ticks, track, progGlow, prog);
    const u = {
      root, svg, track, ticks, prog, progGlow,
      timer: F.h('div', { class: 'bigtimer' }),
      items: F.h('div', { class: 'items' }),
      holdBar: F.h('div', { class: 'holdbar' }),
      holdTxt: F.h('div', { class: 'holdtxt' }),
      wheel: { abs: 0, p: null, n: null, els: new Map(), fresh: true },
    };
    u.hold = F.h('div', { class: 'hold' }, u.holdTxt, F.h('div', { class: 'holdtrack' }, u.holdBar));
    // bottom: stats (outer side) and finger buttons (inner side). Steps advance only with the pedal.
    u.v = {};
    const cell = (k, label) => F.h('div', { class: 'cell' }, (u.v[k] = F.h('b', null, '–')), F.h('span', null, label));
    u.key = F.h('span', { class: 'k' });
    u.stats = F.h('div', { class: 'stats' },
      cell('rounds', 'rounds'), cell('inTime', 'in time'), cell('mistakes', 'mistakes / round'), cell('off', 'avg off'),
      cell('wait', 'avg wait'), cell('breaks', 'breaks'), cell('shift', 'shift'));
    u.nextBtn = iconButton('next', 'start', 'Start');
    u.nextBtn.addEventListener('pointerdown', (e) => { // same as the pedal
      if (u.nextBtn.disabled) return;
      e.preventDefault();
      try { u.nextBtn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      down(id, 'button');
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => u.nextBtn.addEventListener(t, () => up(id, t)));
    u.pauseBtn = iconButton('side', 'break', 'Break');
    u.resetBtn = iconButton('side', 'reset', 'Reset');
    u.pauseBtn.addEventListener('click', () => {
      const s = state[id];
      if (s.phase === 'idle') startBreak(id, Date.now(), 'button');
      else if (s.phase === 'break') endBreak(id, Date.now(), 'button');
      updateBar(id, Date.now());
    });
    u.resetBtn.addEventListener('click', () => { // two taps: arm, then confirm within 3 s
      const now = Date.now();
      if (u.armedUntil && now < u.armedUntil) {
        u.armedUntil = 0;
        reset(id, now, 'button');
        F.Sound.play(id, 'reset');
      } else {
        u.armedUntil = now + 3000;
      }
      updateBar(id, now);
    });
    root.append(svg, u.items, u.timer, u.stats, u.hold, F.h('div', { class: 'bar' }, u.key, F.h('div', { class: 'tbtns' }, u.resetBtn, u.nextBtn, u.pauseBtn)));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    ui[id] = u;
    if ('ResizeObserver' in window) new ResizeObserver(() => layout(id)).observe(root);
  }

  // Geometry: a big circle whose center sits outside the panel's outer edge; items ride on its visible arc.
  function layout(id) {
    const u = ui[id];
    const W = u.root.clientWidth;
    const H = u.root.clientHeight;
    if (!W || !H) return;
    const safeTop = document.getElementById('safeProbe').offsetHeight; // iPad status bar in full screen
    const top = TOP_BAND * H + safeTop;
    const Hu = H - top - BOTTOM_BAND * H; // height available to the wheel
    const R = 1.0 * Hu;
    const ang = SLOT_Y.map((y) => Math.asin(Math.min(0.98, (y * Hu) / R)));
    const margin = Math.max(14, 0.035 * W);
    const x0 = margin + R * (1 - Math.cos(ang[2])) + 0.02 * H; // arc point of the current step, from the outer edge
    const gap = Math.max(16, 0.032 * H);
    const cx = id === 'L' ? x0 - R : W - x0 + R;
    const cy = top + Hu / 2;
    u.geo = { W, H, R, ang, cx, cy, gap };
    const st = u.root.style;
    st.setProperty('--u', H / 100 + 'px');
    st.setProperty('--w', W / 100 + 'px');
    st.setProperty('--gap', gap + 'px');
    const timerPx = Math.min(0.26 * H, (W - x0 - gap - margin) / 2.6); // condensed digits: a big timer fits
    st.setProperty('--timer', timerPx + 'px');
    // The current step = name (6.6u) above the countdown, centered on the dot. The name's text block also holds a
    // hidden time line (4.4u); move it up so the name sits right above the countdown.
    const unit = H / 100;
    const nameH = 6.6 * unit * 1.08;
    const subH = 4.4 * unit * 1.08;
    const timerLine = timerPx * 0.92;
    st.setProperty('--cur-dy', (subH / 2 - timerLine / 2) + 'px');
    st.setProperty('--cur-dy-small', (subH / 2 - (timerLine * 0.42) / 2 - 1.6 * unit) + 'px'); // + a little air above the small time
    st.setProperty('--timer-x', (x0 + gap) + 'px');
    st.setProperty('--timer-y', (cy + nameH / 2) + 'px');
    u.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    u.track.setAttribute('cx', cx);
    u.track.setAttribute('cy', cy);
    u.track.setAttribute('r', R);
    u.ticks.setAttribute('cx', cx);
    u.ticks.setAttribute('cy', cy);
    u.ticks.setAttribute('r', R);
    const gapLen = (2 * Math.PI * R) / 240 - 1.5; // 240 dial ticks around the circle
    u.ticks.setAttribute('stroke-dasharray', `1.5 ${gapLen.toFixed(2)}`);
    u.wheel.els.forEach((el, key) => place(id, el, key - u.wheel.abs, true));
  }

  function arcPoint(id, a) { // a = radians from the current slot, positive = downwards
    const g = ui[id].geo;
    const t = id === 'L' ? a : Math.PI - a;
    return [g.cx + g.R * Math.cos(t), g.cy + g.R * Math.sin(t)];
  }

  // rotate(a) translateX(R) rotate(-a): interpolating a moves the item along the arc (that's the roll animation).
  function slotTransform(id, o) {
    const g = ui[id].geo;
    const k = Math.min(3, Math.abs(o));
    const a = (Math.sign(o) * g.ang[k] * 180) / Math.PI;
    if (id === 'L') {
      return `translate(${g.cx}px, ${g.cy}px) rotate(${a}deg) translateX(${g.R}px) rotate(${-a}deg) translate(${g.gap}px, -50%)`;
    }
    const b = 180 - a;
    return `translate(${g.cx}px, ${g.cy}px) rotate(${b}deg) translateX(${g.R}px) rotate(${-b}deg) translate(-100%, -50%) translateX(${-g.gap}px)`;
  }

  function place(id, el, o, instant) {
    const tf = slotTransform(id, o);
    if (instant) {
      el.style.transition = 'none';
      el.style.transform = tf;
      void el.offsetWidth;
      el.style.transition = '';
    } else if (el._tf !== tf) {
      el.style.transform = tf;
    }
    el._tf = tf;
  }

  function makeItem(id) {
    const nm = F.h('span', { class: 'nm' });
    const sub = F.h('span', { class: 'sub' });
    const el = F.h('div', { class: 'item' }, F.h('i', { class: 'dot' }), F.h('div', { class: 'txt' }, nm, sub));
    el._nm = nm;
    el._sub = sub;
    ui[id].items.append(el);
    return el;
  }

  function fill(id, el, item, o, key, batchStart, now, phase) {
    const s = state[id];
    const cls = ['item', o < 0 ? 'past' : o === 0 ? 'cur' : 'next', 'd' + Math.abs(o)];
    if (item.ready) cls.push('ready');
    if (o === 0 && ui[id].nopeUntil > now) cls.push('nope');
    let sub = '';
    let name = item.name;
    if (o === 0) {
      if (s.phase === 'break') name = 'On break'; // the countdown itself is drawn by .bigtimer
    } else if (o > 0) {
      if (!item.ready) sub = F.fmtDur(item.duration * 1000) + (item.auto ? ' auto' : '');
      if (o === 1 && (phase === 'due' || phase === 'late')) cls.push('go');
    } else if (!item.ready) {
      // done steps show how they went in their dot on the rail: ✓ on time, ✕ missed
      const results = key >= batchStart ? s.results : s.last && s.last.results;
      const r = results && results[item.step];
      if (r) cls.push(r.status);
    }
    const c = cls.join(' ');
    if (el.className !== c) el.className = c;
    if (el._nm.textContent !== name) el._nm.textContent = name;
    if (el._sub.textContent !== sub) el._sub.textContent = sub;
  }

  function syncWheel(id, now, phase) {
    const u = ui[id];
    const w = u.wheel;
    const s = state[id];
    if (!u.geo) return;
    const seq = sequence(id);
    const n = seq.length;
    const p = position(s);
    if (w.n !== n) { // program length changed: rebuild without animation
      w.els.forEach((el) => el.remove());
      w.els.clear();
      w.n = n; w.p = p; w.abs = p; w.fresh = true;
    } else if (w.p !== p) {
      w.abs += mod(p - w.p, n); // the wheel only ever rolls forward
      w.p = p;
    }
    const after = 2;
    const before = 2;
    const batchStart = w.abs - p;
    const live = new Set();
    for (let o = -before; o <= after; o++) {
      const key = w.abs + o;
      live.add(key);
      let el = w.els.get(key);
      const isNew = !el;
      if (isNew) { el = makeItem(id); w.els.set(key, el); }
      fill(id, el, seq[mod(key, n)], o, key, batchStart, now, phase);
      if (isNew && !w.fresh) { // slide in from below, faded
        el.classList.add('gone');
        place(id, el, o + 1, true);
        el.classList.remove('gone');
      }
      place(id, el, o, isNew && w.fresh);
    }
    for (const [key, el] of w.els) { // roll out at the top and fade
      if (live.has(key)) continue;
      w.els.delete(key);
      el.classList.add('gone');
      place(id, el, key < w.abs ? -3 : 3, false);
      setTimeout(() => el.remove(), 900);
    }
    w.fresh = false;
  }

  // Progress: a bright line grows along the rail from the current dot to the next one; it arrives when the step is due.
  function drawProgress(id, now) {
    const u = ui[id];
    const s = state[id];
    const g = u.geo;
    if (!g || s.phase !== 'cycle') {
      if (u.progD) { u.prog.setAttribute('d', ''); u.progGlow.setAttribute('d', ''); u.progD = ''; }
      return;
    }
    const st = s.steps[s.stepIndex];
    const frac = Math.max(0.001, Math.min(1, (now - s.stepStart) / (st.duration * 1000)));
    const [x0, y0] = arcPoint(id, 0);
    const [x1, y1] = arcPoint(id, g.ang[1] * frac);
    const d = `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${g.R} ${g.R} 0 0 ${id === 'L' ? 1 : 0} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    if (d === u.progD) return; // only redraw when it moved (saves work on older iPads)
    u.progD = d;
    u.prog.setAttribute('d', d);
    u.progGlow.setAttribute('d', d);
  }

  function render(id, now) {
    const u = ui[id];
    const phase = phaseOf(state[id], now);
    if (u.root.dataset.phase !== phase) u.root.dataset.phase = phase;
    syncWheel(id, now, phase);
    drawProgress(id, now);
    renderTimer(id, now);
  }

  function renderTimer(id, now) {
    const s = state[id];
    const u = ui[id];
    let txt;
    if (s.phase === 'break') txt = F.fmtDur(now - s.breakStart);
    else if (s.phase !== 'cycle') txt = F.fmtDur(now - s.readySince - (s.waitBreakMs || 0));
    else {
      const rem = stepEnd(s) - now;
      txt = rem > 0 ? F.fmtDur(rem, { ceil: true }) : F.fmtDur(-rem, { signed: true });
    }
    if (u.timer.textContent !== txt) u.timer.textContent = txt;
    const key = s.phase === 'cycle' ? `${s.cycleId}:${s.stepIndex}` : s.phase;
    if (u.timerKey !== key) { // a new step: fade the new time in
      if (u.timerKey !== undefined) {
        u.timer.classList.remove('swap');
        void u.timer.offsetWidth;
        u.timer.classList.add('swap');
      }
      u.timerKey = key;
    }
    u.timer.classList.toggle('nope', u.nopeUntil > now);
  }

  // ---------- on-screen stats + finger buttons ----------

  function computeToday(id) {
    const t = { rounds: 0, steps: 0, inTime: 0, absDev: 0, waits: [], breaks: 0, breakMs: 0, firstStart: null };
    const events = F.readDay(F.dayKey(Date.now())).filter((e) => e.fryer === id);
    const cancelled = new Set(events.filter((e) => e.type === 'cycle_cancelled').map((e) => e.cycleId));
    for (const e of events) {
      if (e.type === 'cycle_start' && t.firstStart == null && !cancelled.has(e.cycleId)) t.firstStart = e.t;
      else if (e.type === 'cycle_end') {
        t.rounds++;
        t.steps += e.stepCount || 0;
        t.inTime += e.onTimeSteps || 0;
        (e.steps || []).forEach((x) => { t.absDev += Math.abs(x.devMs || 0); });
        if (e.idleReason !== 'session_start' && e.idleBeforeMs != null) t.waits.push(e.idleBeforeMs);
      } else if (e.type === 'break_end') {
        t.breaks++;
        t.breakMs += e.durationMs || 0;
      }
    }
    return t;
  }

  function refreshToday(id) {
    today[id] = computeToday(id);
    today[id].day = F.dayKey(Date.now());
  }

  function setText(el, txt) {
    if (el.textContent !== txt) el.textContent = txt;
  }

  function updateBar(id, now) {
    const u = ui[id];
    const s = state[id];
    if (!today[id] || today[id].day !== F.dayKey(now)) refreshToday(id);
    const t = today[id];
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    setText(u.key, cfg.fryers[id].key.toUpperCase());
    setText(u.v.rounds, String(t.rounds));
    setText(u.v.inTime, t.steps ? Math.round((t.inTime / t.steps) * 100) + '%' : '–');
    setText(u.v.mistakes, t.rounds ? ((t.steps - t.inTime) / t.rounds).toFixed(1) : '–');
    setText(u.v.off, t.steps ? (t.absDev / t.steps / 1000).toFixed(1) + 's' : '–');
    setText(u.v.wait, t.waits.length ? F.fmtDur(avg(t.waits)) : '–');
    setText(u.v.breaks, t.breaks ? `${t.breaks} · ${F.fmtDur(t.breakMs / t.breaks)}` : '0');
    setText(u.v.shift, t.firstStart ? F.fmtDur(now - t.firstStart) : '–');
    // Next: "Start" between rounds; during a step only enabled once its window is open
    const canNext = s.phase !== 'cycle' || windowOpen(s, now);
    if (u.nextBtn.disabled === canNext) u.nextBtn.disabled = !canNext;
    setText(u.nextBtn._tl, s.phase === 'cycle' ? 'Next' : 'Start');
    setIcon(u.nextBtn, s.phase === 'cycle' ? 'next' : 'start');
    u.nextBtn.classList.toggle('go', s.phase === 'cycle' && canNext);
    // Break only between rounds; Reset needs a second tap within 3 s
    const inRound = s.phase === 'cycle';
    if (u.pauseBtn.disabled !== inRound) u.pauseBtn.disabled = inRound; // visible, but only usable between rounds
    setText(u.pauseBtn._tl, s.phase === 'break' ? 'End break' : 'Break');
    setIcon(u.pauseBtn, s.phase === 'break' ? 'resume' : 'break');
    u.pauseBtn.classList.toggle('on', s.phase === 'break');
    const armed = u.armedUntil && now < u.armedUntil;
    setText(u.resetBtn._tl, armed ? 'Tap again' : 'Reset');
    u.resetBtn.classList.toggle('armed', !!armed);
  }

  function renderNotice() {
    const parts = [];
    if (duplicateTab) parts.push(['bad', 'Fryer screen is open twice: close one']);
    if (F.storageError) parts.push(['bad', 'Storage full: stats not saved (Stats → export & delete old days)']);
    const key = JSON.stringify(parts);
    if (noticeEl.dataset.key === key) return;
    noticeEl.dataset.key = key;
    noticeEl.textContent = '';
    parts.forEach(([cls, txt]) => noticeEl.append(F.h('span', { class: cls }, txt)));
  }

  // ---------- loops ----------

  function logicTick() {
    const now = Date.now();
    for (const id of IDS) {
      const s = state[id];
      // auto steps end exactly at their target time, even if this timer fired late (background tab)
      let guard = 0;
      while (s.phase === 'cycle' && guard++ < 50) {
        const st = s.steps[s.stepIndex];
        if (st.auto && now >= stepEnd(s)) advance(id, stepEnd(s), 'auto');
        else break;
      }
      alerts(id, now);
      holdCheck(id, now);
      updateBar(id, now);
      render(id, now);
    }
    renderNotice();
  }

  // New settings apply right away (a running round keeps its own copy of the steps).
  function applyConfig(next) {
    cfg = next;
    syncUrl();
    F.Sound.setEnabled(true);
    F.Sound.setVolume(cfg.volume);
    F.Sound.setSides(cfg.soundL, cfg.soundR);
  }
  addEventListener('storage', (e) => { if (e.key === F.KEYS.config) applyConfig(F.loadStoredConfig()); });

  // ---------- settings window ----------

  const modal = document.getElementById('settings');
  const modalBody = modal.querySelector('.modal-body');
  const statusEl = modal.querySelector('.s-status');
  const IDLE_STATUS = 'Changes save automatically';
  let panel = null;
  let statusTimer = null;

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('err', !!isError);
    clearTimeout(statusTimer);
    if (!isError) statusTimer = setTimeout(() => { statusEl.textContent = IDLE_STATUS; }, 1800);
  }

  function openSettings() {
    if (!modal.hidden) return;
    modal.hidden = false;
    panel = window.FriesSettings.mount(modalBody, {
      onSaved: applyConfig, onStatus: setStatus,
      onStatsCleared: () => IDS.forEach(refreshToday), // counters on screen go back to zero
    });
    statusEl.textContent = IDLE_STATUS;
    statusEl.classList.remove('err');
  }

  function closeSettings() {
    if (modal.hidden) return;
    if (panel && panel.flush()) F.log('config_change', null, { source: 'settings', config: cfg });
    panel = null;
    modal.hidden = true;
    modalBody.textContent = '';
    syncUrl();
  }

  document.getElementById('gear').addEventListener('click', openSettings);
  modal.querySelector('.modal-x').addEventListener('click', closeSettings);
  modal.querySelector('.modal-backdrop').addEventListener('click', closeSettings);
  document.getElementById('copyLink').addEventListener('click', async () => {
    const url = F.shareUrl(cfg, 'index.html');
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Setup link copied');
    } catch (e) {
      prompt('Copy this link:', url);
    }
  });
  // A settings link opened in this same tab only changes the #hash (no page load): reload to apply it.
  addEventListener('hashchange', () => { // a different setup link opened in this tab
    const fromUrl = F.configFromHash();
    if (fromUrl && JSON.stringify(fromUrl) !== JSON.stringify(cfg)) location.reload();
    else if (location.hash === '#settings') { syncUrl(); openSettings(); }
  });
  addEventListener('resize', () => IDS.forEach(layout));

  const noticeEl = document.getElementById('notice');
  noticeEl.addEventListener('click', unlockExtras);
  // Full screen button (top center). Hidden when the app already runs full screen from the Home Screen,
  // or where the browser can't do it (iPhone). Browsers only allow full screen after a tap.
  const fsBtn = document.getElementById('fs');
  const fsTarget = document.documentElement;
  const FS_ICONS = {
    enter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    exit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  };
  const inFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let fsShown = null;
  function updateFsButton() {
    const on = inFullscreen();
    if (on === fsShown) return;
    fsShown = on;
    fsBtn.innerHTML = on ? FS_ICONS.exit : FS_ICONS.enter;
    fsBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    document.documentElement.classList.toggle('fs-mode', on || standalone);
    if (ui.L && ui.R) IDS.forEach(layout); // the header moves down/up for the status bar
  }
  document.documentElement.classList.toggle('fs-mode', standalone);
  if (fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen) {
    fsBtn.hidden = false;
    updateFsButton();
    setInterval(updateFsButton, 500); // keep the icon right even if a browser misses the change event
    fsBtn.addEventListener('click', () => {
      const p = inFullscreen()
        ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
        : (fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen).call(fsTarget);
      if (p && p.catch) p.catch(() => {}); // refused (e.g. no tap allowed): nothing to do
    });
    ['fullscreenchange', 'webkitfullscreenchange'].forEach((t) => document.addEventListener(t, updateFsButton));
  }

  // Sound is always on. Browsers start audio only after the first pedal press or touch; try right away anyway.
  unlockExtras();

  const now0 = Date.now();
  IDS.forEach((id) => {
    build(id);
    initFryer(id, now0);
    layout(id);
  });
  F.saveState(state);
  F.log('session_start', null, {
    page: 'fryer', ua: navigator.userAgent, screen: `${screen.width}x${screen.height}`,
    viewport: `${innerWidth}x${innerHeight}`, state: JSON.parse(JSON.stringify(state)),
  });
  logicTick();
  setInterval(logicTick, 100); // logic + screen updates; the roll itself is animated by CSS on the GPU
  if (openSettingsOnLoad) openSettings();
})();
