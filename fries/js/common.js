/* Fries timer: shared code for all pages (config, URL sharing, storage, telemetry, sound).
   Plain script, no build step, no dependencies. Exposes window.Fries. */
(function () {
  'use strict';

  const APP_VERSION = '0.2.0';
  const NS = 'fries.v1';
  const KEYS = {
    config: NS + '.config',
    state: NS + '.state',
    eventsPrefix: NS + '.events.', // one key per local day: fries.v1.events.YYYY-MM-DD
  };
  const FRYERS = ['L', 'R'];

  // ---------- defaults ----------

  // Fries: 3:00 total fry, lifted at 75% (2:15) for secret sauce, then back in for the remaining 25% (0:45).
  // The fryer screen loops: Ready ("Drop fries in") -> step 1 -> ... -> last step -> Ready.
  function friesProgram(totalSec = 180, splitPct = 75, sauceSec = 20) {
    const first = Math.round(totalSec * splitPct / 100);
    return {
      startPrompt: 'Drop fries in',
      steps: [
        { name: 'Frying', duration: first, auto: false },
        { name: 'Secret sauce', duration: sauceSec, auto: false },
        { name: 'Finish frying', duration: totalSec - first, auto: false },
      ],
    };
  }

  function defaultConfig() {
    return {
      version: 5,
      fryers: {
        L: { name: 'Left', key: 'a', program: friesProgram() },
        R: { name: 'Right', key: 'd', program: friesProgram() },
      },
      earlySeconds: 2,       // the pedal unlocks this many seconds before a step is due (earlier presses are refused)
      lateSeconds: 3,        // a press more than this many seconds after the target counts as late (a mistake)
      warnSeconds: 10,       // screen turns amber this many seconds before a step is due
      sound: true,
      soundL: 'bong',        // sound for the left fryer (see SOUNDS below); never the same as the right
      soundR: 'bip',
      volume: 0.8,
      holdResetSeconds: 5,   // hold a pedal this long: reset a running round, or take a break when Ready
      pressGuardMs: 800,     // ignore a second press within this window (stops double-steps)
    };
  }

  // ---------- validation (config can arrive from a URL, so never trust it) ----------

  const num = (v, def, min, max) => {
    v = Number(v);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  };
  const str = (v, def, max = 120) => (typeof v === 'string' ? v.slice(0, max) : def);

  function normalizeStep(s) {
    s = s && typeof s === 'object' ? s : {};
    return {
      name: str(s.name, 'Step', 40),
      duration: Math.round(num(s.duration, 60, 1, 3600)),
      auto: !!s.auto,
    };
  }

  function normalizeProgram(p) {
    p = p && typeof p === 'object' ? p : {};
    const steps = Array.isArray(p.steps) ? p.steps.slice(0, 30).map(normalizeStep) : [];
    const def = friesProgram();
    return {
      startPrompt: str(p.startPrompt, def.startPrompt, 40) || def.startPrompt,
      steps: steps.length ? steps : def.steps,
    };
  }

  function normalizeConfig(c) {
    const d = defaultConfig();
    c = c && typeof c === 'object' ? c : {};
    const f = c.fryers && typeof c.fryers === 'object' ? c.fryers : {};
    const fryer = (id) => {
      const x = f[id] && typeof f[id] === 'object' ? f[id] : {};
      // pedal keys are fixed by the pedals themselves: left = a, right = d (not configurable)
      return { name: str(x.name, d.fryers[id].name, 30) || d.fryers[id].name, key: d.fryers[id].key, program: normalizeProgram(x.program) };
    };
    const out = {
      version: 5,
      fryers: { L: fryer('L'), R: fryer('R') },
      // configs before v4 had one symmetric "tolerance": keep a custom one, otherwise use the new 2 s / 3 s defaults
      earlySeconds: Math.round(num(c.earlySeconds !== undefined ? c.earlySeconds
        : typeof c.tolerance === 'number' && c.tolerance !== 5 ? c.tolerance : d.earlySeconds, d.earlySeconds, 0, 120)),
      lateSeconds: Math.round(num(c.lateSeconds !== undefined ? c.lateSeconds
        : typeof c.tolerance === 'number' && c.tolerance !== 5 ? c.tolerance : d.lateSeconds, d.lateSeconds, 0, 120)),
      warnSeconds: Math.round(num(c.warnSeconds, d.warnSeconds, 0, 120)),
      sound: true, // always on
      ...pickSounds(c, d),
      volume: num(c.volume, d.volume, 0, 1),
      // configs saved before v3 used 10 s as the default hold; the default is now 5 s
      holdResetSeconds: (c.version || 1) < 3 && c.holdResetSeconds === 10 ? 5
        : Math.round(num(c.holdResetSeconds, d.holdResetSeconds, 2, 60)),
      pressGuardMs: Math.round(num(c.pressGuardMs, d.pressGuardMs, 0, 5000)),
    };
    return out;
  }

  // ---------- URL sharing: #c=<base64url(JSON)> ----------

  function b64urlEncode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  }

  function configFromHash() {
    const m = location.hash.match(/[#&]c=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    try {
      return normalizeConfig(JSON.parse(b64urlDecode(m[1])));
    } catch (e) {
      console.warn('Ignoring broken config in URL', e);
      return null;
    }
  }

  function stripHash() {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }

  const configHash = (cfg) => 'c=' + b64urlEncode(JSON.stringify(cfg));

  function shareUrl(cfg, page = 'index.html') {
    const u = new URL(page, location.href);
    u.search = '';
    u.hash = configHash(cfg);
    return u.href;
  }

  // ---------- storage ----------

  let storageError = null;

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
      storageError = null;
      return true;
    } catch (e) {
      storageError = e;
      console.error('localStorage write failed', key, e);
      return false;
    }
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function loadStoredConfig() {
    const raw = readJSON(KEYS.config, null);
    return raw ? normalizeConfig(raw) : defaultConfig();
  }

  /* URL config wins over stored config. persist=true saves it (fryer screen),
     persist=false only previews it (settings page, until you press Save). */
  function loadConfig({ useHash = true, persist = true } = {}) {
    const stored = loadStoredConfig();
    if (useHash) {
      const fromUrl = configFromHash();
      if (fromUrl) {
        if (persist && JSON.stringify(fromUrl) !== JSON.stringify(stored)) {
          saveConfig(fromUrl, 'url');
        }
        return fromUrl;
      }
    }
    return stored;
  }

  // logIt=false: autosave while editing (the settings window logs one config_change when it closes)
  function saveConfig(cfg, source, logIt = true) {
    cfg = normalizeConfig(cfg);
    const ok = safeSet(KEYS.config, JSON.stringify(cfg));
    if (ok && logIt) log('config_change', null, { source: source || 'settings', config: cfg });
    return ok;
  }

  const loadState = () => readJSON(KEYS.state, {}) || {};
  const saveState = (s) => safeSet(KEYS.state, JSON.stringify(s));

  // ---------- telemetry ----------

  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const dayKey = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const sid = Math.random().toString(36).slice(2, 10); // one id per page load

  function readDay(day) {
    const arr = readJSON(KEYS.eventsPrefix + day, []);
    return Array.isArray(arr) ? arr : [];
  }

  /* Every event: t (epoch ms), iso (UTC), local (wall clock), type, fryer, sid, v + type-specific fields.
     Read-modify-write per event so several tabs never overwrite each other's events. */
  function log(type, fryer, data) {
    const t = data && typeof data.t === 'number' ? data.t : Date.now();
    const d = new Date(t);
    const ev = Object.assign(
      {
        t,
        iso: d.toISOString(),
        local: `${dayKey(t)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`,
        type,
        fryer: fryer || null,
        sid,
        v: APP_VERSION,
      },
      data || {}
    );
    ev.t = t;
    const day = dayKey(t);
    const arr = readDay(day);
    arr.push(ev);
    safeSet(KEYS.eventsPrefix + day, JSON.stringify(arr));
    return ev;
  }

  function listDays() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEYS.eventsPrefix)) out.push(k.slice(KEYS.eventsPrefix.length));
    }
    return out.sort().reverse();
  }

  const deleteDay = (day) => localStorage.removeItem(KEYS.eventsPrefix + day);

  function storageBytes() {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      n += (k.length + (localStorage.getItem(k) || '').length) * 2; // UTF-16
    }
    return n;
  }

  // ---------- sound (Web Audio, synthesized in the browser: no audio files) ----------
  // The two signals that matter most, "step is due" and "late", come from the chosen sound theme: a pair of
  // famous public-domain tunes or everyday sounds people already know, one per side, never alike.
  // Small UI sounds (tick, press, start, done, reset, refused press) are a subtle built-in pair:
  //   LEFT = low, round, slow; RIGHT = high, sharp, fast. Each side plays on its own speaker.

  const SEMI = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  function hz(n) {
    if (typeof n === 'number') return n;
    const m = /^([A-G])(#|b)?(\d)$/.exec(n);
    const st = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
    return 440 * Math.pow(2, st / 12);
  }

  function env(g, t, peak, attack, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  // stack of sine partials [ratio, amplitude, decay share], used for bells, piano, music box
  function partials(c, out, t, f, list, dur, gain, attack) {
    list.forEach(([r, a, d]) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = f * r;
      env(g, t, gain * a, attack, dur * d);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur * d + 0.05);
    });
  }

  let noiseBuf = null;
  const INSTR = {
    osc(c, out, t, f, { type = 'sine', dur = 0.15, gain = 0.3, slideTo = null } = {}) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.012);
      g.gain.setValueAtTime(Math.max(0.0002, gain), t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur + 0.05);
    },
    bell: (c, out, t, f, { dur = 1.6, gain = 0.3 } = {}) =>
      partials(c, out, t, f, [[1, 1, 1], [2, 0.6, 0.6], [2.4, 0.4, 0.45], [3, 0.3, 0.35], [4.2, 0.22, 0.25], [5.4, 0.15, 0.2]], dur, gain, 0.004),
    piano: (c, out, t, f, { dur = 0.9, gain = 0.3 } = {}) =>
      partials(c, out, t, f, [[1, 1, 1], [2, 0.45, 0.7], [3, 0.2, 0.5], [4, 0.1, 0.35]], dur, gain, 0.006),
    musicbox: (c, out, t, f, { dur = 0.8, gain = 0.3 } = {}) =>
      partials(c, out, t, f, [[1, 1, 1], [4, 0.3, 0.25], [6.8, 0.12, 0.15]], dur, gain, 0.003),
    brass(c, out, t, f, { dur = 0.3, gain = 0.25 } = {}) {
      const o = c.createOscillator();
      const flt = c.createBiquadFilter();
      const g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(700, t);
      flt.frequency.exponentialRampToValueAtTime(3200, t + 0.05);
      flt.frequency.exponentialRampToValueAtTime(1600, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.03);
      g.gain.setValueAtTime(gain, t + dur * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
      o.connect(flt); flt.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur + 0.12);
    },
    flute(c, out, t, f, { dur = 0.4, gain = 0.3 } = {}) {
      const o = c.createOscillator();
      const lfo = c.createOscillator();
      const depth = c.createGain();
      const g = c.createGain();
      o.frequency.value = f;
      lfo.frequency.value = 5.5;
      depth.gain.value = f * 0.006;
      lfo.connect(depth); depth.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.05);
      g.gain.setValueAtTime(gain, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(out);
      o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    },
    noise(c, out, t, _f, { dur = 0.05, gain = 0.3, freq = 3000 } = {}) {
      if (!noiseBuf) {
        noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = c.createBufferSource();
      const flt = c.createBiquadFilter();
      const g = c.createGain();
      src.buffer = noiseBuf;
      flt.type = 'bandpass';
      flt.frequency.value = freq;
      flt.Q.value = 1.2;
      env(g, t, gain, 0.003, dur);
      src.connect(flt); flt.connect(g); g.connect(out);
      src.start(t); src.stop(t + dur + 0.02);
    },
  };

  // play a list of [note, startSeconds, duration?] with one instrument; speed > 1 plays faster
  const tune = (inst, notes, opts) => (c, out, t, speed = 1) =>
    notes.forEach(([n, at, dur]) => INSTR[inst](c, out, t + at / speed, hz(n), Object.assign({}, opts, dur ? { dur } : {})));
  const all = (...fns) => (c, out, t, sp = 1) => fns.forEach((f) => f(c, out, t, sp));
  const later = (sec, fn) => (c, out, t, sp = 1) => fn(c, out, t + sec / sp, sp);
  const strikes = (n, every, f, opts) => (c, out, t, sp = 1) => {
    for (let i = 0; i < n; i++) INSTR.bell(c, out, t + (i * every) / sp, hz(f), opts);
  };
  const noise = (freq, dur, gain) => (c, out, t) => INSTR.noise(c, out, t, 0, { freq, dur, gain });

  /* Each theme gives every side its own 4 signals:
       approach = time is approaching (screen turns amber)
       due      = time is up, press now
       late     = penalty, repeats while late
       done     = round finished
     Everything is public domain or an everyday sound, synthesized here. */
  const bike = (n) => strikes(n, 0.045, 'A6', { dur: 0.5, gain: 0.15 });
  const cuckooCall = tune('flute', [['E5', 0, 0.28], ['C5', 0.32, 0.5]], { gain: 0.42 });
  const timerRing = (n) => strikes(n, 0.05, 990, { dur: 0.35, gain: 0.14 });
  const elise = tune('piano', [['E5', 0], ['D#5', 0.15], ['E5', 0.3], ['D#5', 0.45], ['E5', 0.6], ['B4', 0.75], ['D5', 0.9], ['C5', 1.05], ['A4', 1.2, 1.3]], { gain: 0.32 });
  const joy = tune('musicbox', [['E6', 0], ['E6', 0.2], ['F6', 0.4], ['G6', 0.6], ['G6', 0.8], ['F6', 1], ['E6', 1.2], ['D6', 1.4, 1.1]], { gain: 0.26 });
  const kaching = all(noise(2500, 0.05, 0.35), later(0.07, noise(4200, 0.04, 0.25)),
    later(0.12, tune('bell', [['E7', 0, 1.4], ['B6', 0.06, 1.4]], { gain: 0.18 })));
  const osc = (notes, type, gain) => (c, out, t, sp = 1) =>
    notes.forEach(([f, at, dur, slideTo]) => INSTR.osc(c, out, t + at / sp, f, { type, dur, gain, slideTo }));

  const THEMES = {
    classic: {
      label: 'Built-in beeps', L: 'Low "bong… bong"', R: 'High "bip-bip-bip"',
      sides: {
        L: {
          approach: osc([[440, 0, 0.4]], 'triangle', 0.3),
          due: osc([[440, 0, 0.5], [330, 0.55, 0.7]], 'triangle', 0.55),
          late: osc([[220, 0, 0.6, 165], [220, 0.75, 0.6, 165]], 'sawtooth', 0.3),
          done: osc([[392, 0, 0.22], [330, 0.25, 0.22], [262, 0.5, 0.5]], 'triangle', 0.4),
        },
        R: {
          approach: osc([[1760, 0, 0.05]], 'square', 0.16),
          due: osc([[1760, 0, 0.06], [1760, 0.11, 0.06], [1760, 0.22, 0.06]], 'square', 0.24),
          late: osc([0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i % 2 ? 1568 : 1976, i * 0.08, 0.06]), 'square', 0.24),
          done: osc([[1319, 0, 0.05], [1568, 0.07, 0.05], [2093, 0.14, 0.12]], 'square', 0.18),
        },
      },
    },
    doorbell: {
      label: 'Doorbell vs bicycle bell', L: 'Doorbell "ding-dong"', R: 'Bicycle bell "ring-ring"',
      sides: {
        L: {
          approach: tune('bell', [['E5', 0, 1.6]], { gain: 0.16 }),
          due: tune('bell', [['E5', 0, 2.2], ['C5', 0.6, 2.6]], { gain: 0.32 }),
          late: tune('bell', [['E5', 0], ['C5', 0.3], ['E5', 0.6], ['C5', 0.9], ['E5', 1.2], ['C5', 1.5, 2]], { gain: 0.3, dur: 1.2 }),
          done: tune('bell', [['C5', 0], ['E5', 0.22], ['G5', 0.44, 2.2]], { gain: 0.26, dur: 1.6 }),
        },
        R: {
          approach: bike(2),
          due: all(bike(6), later(0.5, bike(6))),
          late: bike(24),
          done: bike(4),
        },
      },
    },
    westminster: {
      label: 'Big Ben vs "Charge!"', L: 'Big Ben chime (Westminster)', R: '"Charge!" bugle call',
      sides: {
        L: {
          approach: tune('bell', [['G#4', 0, 1.6], ['F#4', 0.5, 1.8]], { gain: 0.2 }),
          due: tune('bell', [['G#4', 0, 2], ['F#4', 0.5, 2], ['E4', 1, 2], ['B3', 1.5, 2.6]], { gain: 0.34 }),
          late: tune('bell', [['E3', 0], ['E3', 0.8], ['E3', 1.6]], { gain: 0.42, dur: 2.4 }), // the hour: BONG BONG BONG
          done: tune('bell', [['B3', 0], ['F#4', 0.4], ['G#4', 0.8], ['E4', 1.2, 2.6]], { gain: 0.3, dur: 1.8 }),
        },
        R: {
          approach: tune('brass', [['G4', 0, 0.12], ['C5', 0.14, 0.2]], { gain: 0.14 }),
          due: tune('brass', [['G4', 0, 0.12], ['C5', 0.14, 0.12], ['E5', 0.28, 0.12], ['G5', 0.42, 0.3], ['E5', 0.8, 0.12], ['G5', 0.94, 0.6]], { gain: 0.22 }),
          late: tune('brass', [['G4', 0, 0.32], ['F#4', 0.38, 0.32], ['F4', 0.76, 0.32], ['E4', 1.14, 0.9]], { gain: 0.22 }), // "wah-wah-wah-waaah"
          done: tune('brass', [['C5', 0, 0.1], ['E5', 0.12, 0.1], ['G5', 0.24, 0.1], ['C6', 0.36, 0.5]], { gain: 0.2 }),
        },
      },
    },
    cuckoo: {
      label: 'Cuckoo clock vs boxing bell', L: 'Cuckoo clock "cu-ckoo"', R: 'Boxing ring bell "ding-ding-ding"',
      sides: {
        L: {
          approach: tune('flute', [['E5', 0, 0.28], ['C5', 0.32, 0.5]], { gain: 0.24 }),
          due: all(cuckooCall, later(0.95, cuckooCall)),
          late: all(cuckooCall, later(0.55, cuckooCall), later(1.1, cuckooCall), later(1.65, cuckooCall)),
          done: tune('flute', [['C5', 0, 0.25], ['E5', 0.28, 0.25], ['G5', 0.56, 0.6]], { gain: 0.36 }),
        },
        R: {
          approach: tune('bell', [['C6', 0, 1.2]], { gain: 0.13 }),
          due: tune('bell', [['C6', 0, 1.2], ['C6', 0.2, 1.2], ['C6', 0.4, 1.6]], { gain: 0.26 }),
          late: strikes(12, 0.12, 'C6', { dur: 0.9, gain: 0.22 }),
          done: tune('bell', [['C6', 0, 1.2], ['C6', 0.35, 1.6]], { gain: 0.22 }),
        },
      },
    },
    classics: {
      label: 'Für Elise vs Ode to Joy', L: 'Für Elise (piano)', R: 'Ode to Joy (music box)',
      sides: {
        L: {
          approach: tune('piano', [['E5', 0], ['D#5', 0.15], ['E5', 0.3, 1.2]], { gain: 0.2 }),
          due: elise,
          late: all(tune('piano', [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i % 2 ? 'D#5' : 'E5', i * 0.09, 0.4]), { gain: 0.3 }),
            tune('piano', [['A2', 0.75, 1.6], ['A3', 0.75, 1.6]], { gain: 0.35 })),
          done: tune('piano', [['A4', 0], ['C5', 0.15], ['E5', 0.3], ['A5', 0.45, 1.6]], { gain: 0.3 }),
        },
        R: {
          approach: tune('musicbox', [['E6', 0], ['E6', 0.2], ['F6', 0.4, 0.9]], { gain: 0.16 }),
          due: joy,
          late: all((c, out, t) => joy(c, out, t, 2), (c, out, t) => joy(c, out, t + 0.8, 2)),
          done: tune('musicbox', [['E6', 0], ['D6', 0.3], ['D6', 0.5, 1.4]], { gain: 0.26 }),
        },
      },
    },
    kitchen: {
      label: 'Kitchen timer vs cash register', L: 'Kitchen timer "brrring"', R: 'Cash register "ka-ching"',
      sides: {
        L: {
          approach: all(noise(2200, 0.03, 0.3), later(0.45, noise(1500, 0.03, 0.3)), later(0.9, noise(2200, 0.03, 0.3)), later(1.35, noise(1500, 0.03, 0.3))),
          due: timerRing(16),
          late: timerRing(36),
          done: tune('bell', [[1320, 0, 2.2]], { gain: 0.3 }), // oven "ding"
        },
        R: {
          approach: tune('bell', [['E7', 0, 0.4]], { gain: 0.12 }),
          due: kaching,
          late: osc([[110, 0, 0.32], [110, 0.42, 0.32]], 'square', 0.22), // register error buzz
          done: tune('bell', [['E7', 0, 0.35], ['C7', 0.08, 0.35], ['G7', 0.16, 0.5]], { gain: 0.14 }), // coins
        },
      },
    },
  };
  // the 12 sounds a side can pick (each with its own approach / due / late / done signals)
  const SOUND_LIST = [
    ['bong', 'Low bong', THEMES.classic.sides.L], ['bip', 'High bip', THEMES.classic.sides.R],
    ['doorbell', 'Doorbell', THEMES.doorbell.sides.L], ['bicycle', 'Bicycle bell', THEMES.doorbell.sides.R],
    ['bigben', 'Big Ben', THEMES.westminster.sides.L], ['bugle', 'Bugle “Charge!”', THEMES.westminster.sides.R],
    ['cuckoo', 'Cuckoo clock', THEMES.cuckoo.sides.L], ['boxing', 'Boxing bell', THEMES.cuckoo.sides.R],
    ['elise', 'Für Elise', THEMES.classics.sides.L], ['joy', 'Ode to Joy', THEMES.classics.sides.R],
    ['timer', 'Kitchen timer', THEMES.kitchen.sides.L], ['register', 'Cash register', THEMES.kitchen.sides.R],
  ];
  const SOUNDS = Object.fromEntries(SOUND_LIST.map(([k, label, signals]) => [k, Object.assign({ label }, signals)]));
  const SOUND_KEYS = SOUND_LIST.map(([k]) => k);
  const SIGNALS = ['approach', 'due', 'late', 'done'];
  // configs before v5 picked a pair ("theme")
  const THEME_TO_SOUNDS = { classic: ['bong', 'bip'], doorbell: ['doorbell', 'bicycle'], westminster: ['bigben', 'bugle'],
    cuckoo: ['cuckoo', 'boxing'], classics: ['elise', 'joy'], kitchen: ['timer', 'register'] };

  function pickSounds(c, d) {
    const old = THEME_TO_SOUNDS[c.soundTheme];
    const soundL = SOUND_KEYS.includes(c.soundL) ? c.soundL : old ? old[0] : d.soundL;
    let soundR = SOUND_KEYS.includes(c.soundR) ? c.soundR : old ? old[1] : d.soundR;
    if (soundR === soundL) soundR = soundL === d.soundR ? d.soundL : d.soundR; // the sides must never sound alike
    return { soundL, soundR };
  }

  // small UI sounds per side: [Hz, start, duration, wave, gain, slideTo]
  const UI_SOUNDS = {
    L: {
      pan: -0.8,
      tick: [[330, 0, 0.16, 'triangle', 0.4]],
      press: [[196, 0, 0.08, 'triangle', 0.35]],
      start: [[262, 0, 0.2, 'triangle', 0.4], [392, 0.22, 0.3, 'triangle', 0.4]],
      reset: [[392, 0, 0.8, 'triangle', 0.4, 98]],
      blocked: [[131, 0, 0.18, 'triangle', 0.45]],
      break: [[392, 0, 0.35, 'triangle', 0.35], [294, 0.38, 0.6, 'triangle', 0.35]],
    },
    R: {
      pan: 0.8,
      tick: [[1760, 0, 0.04, 'square', 0.16]],
      press: [[2349, 0, 0.025, 'square', 0.14]],
      start: [[1319, 0, 0.05, 'square', 0.18], [1760, 0.07, 0.05, 'square', 0.18]],
      reset: [[2349, 0, 0.5, 'square', 0.16, 587]],
      blocked: [[740, 0, 0.05, 'square', 0.14], [622, 0.07, 0.07, 'square', 0.14]],
      break: [[1568, 0, 0.07, 'square', 0.15], [1175, 0.12, 0.14, 'square', 0.15]],
    },
  };

  const Sound = (() => {
    let ctx = null;
    let enabled = true;
    let volume = 0.8;
    const sides = { L: 'bong', R: 'bip' };

    function unlock() {
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          ctx = new AC();
        }
        if (ctx.state !== 'running') ctx.resume().catch(() => {});
      } catch (e) { /* ignore */ }
      return ctx;
    }

    let master = null;
    function output(pan) {
      if (!master) { // limiter: lets us play loud for a noisy kitchen without clipping
        master = ctx.createDynamicsCompressor();
        master.threshold.value = -14;
        master.knee.value = 6;
        master.ratio.value = 12;
        master.attack.value = 0.002;
        master.release.value = 0.15;
        master.connect(ctx.destination);
      }
      const g = ctx.createGain();
      g.gain.value = volume * 2.4;
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        g.connect(p);
        p.connect(master);
      } else {
        g.connect(master);
      }
      return g;
    }

    // signals from the side's sound: approach | now (= due) | late | done | auto; UI sounds: tick | press | start | reset | blocked | break
    function playWith(soundKey, fryer, name) {
      if (!ctx || ctx.state !== 'running') return;
      const ui = UI_SOUNDS[fryer];
      if (!ui) return;
      const out = output(ui.pan);
      const t = ctx.currentTime + 0.02;
      const snd = SOUNDS[soundKey] || SOUNDS.bong;
      const signal = name === 'now' || name === 'auto' ? 'due' : name;
      if (SIGNALS.includes(signal)) snd[signal](ctx, out, t, 1);
      else (ui[name] || []).forEach(([f, at, dur, type, gain, slideTo]) =>
        INSTR.osc(ctx, out, t + at, f, { dur, type, gain, slideTo }));
    }

    return {
      unlock,
      play: (fryer, name) => { if (enabled) playWith(sides[fryer], fryer, name); },
      preview: (soundKey, fryer, name) => { unlock(); setTimeout(() => playWith(soundKey, fryer, name), 60); },
      setEnabled: (b) => { enabled = !!b; },
      setVolume: (x) => { volume = num(x, 0.8, 0, 1); },
      setSides: (l, r) => { sides.L = SOUNDS[l] ? l : 'bong'; sides.R = SOUNDS[r] ? r : 'bip'; },
      list: () => SOUND_LIST.map(([key, label]) => ({ key, label })),
      signals: SIGNALS,
      get enabled() { return enabled; },
      get state() { return ctx ? ctx.state : 'locked'; },
    };
  })();

  // ---------- small helpers ----------

  function fmtDur(ms, { signed = false, ceil = false } = {}) {
    if (ms == null || !Number.isFinite(ms)) return '–';
    const neg = ms < 0;
    let s = Math.abs(ms) / 1000;
    s = ceil ? Math.ceil(s) : Math.floor(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const body = h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
    return (neg ? '−' : signed ? '+' : '') + body;
  }

  function fmtDev(ms) {
    if (ms == null || !Number.isFinite(ms)) return '–';
    const s = Math.round(ms / 1000);
    if (Math.abs(s) >= 60) return (s > 0 ? '+' : '−') + fmtDur(Math.abs(s) * 1000);
    return (s > 0 ? '+' : s < 0 ? '−' : '±') + Math.abs(s) + 's';
  }

  const fmtTime = (t) => {
    const d = new Date(t);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  /* DOM builder that only ever sets text (never HTML), so config text from a URL can't inject markup. */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }

  function download(filename, text, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  window.Fries = {
    APP_VERSION, KEYS, FRYERS, sid,
    defaultConfig, friesProgram, normalizeConfig, normalizeStep,
    loadConfig, loadStoredConfig, saveConfig, configFromHash, configHash, stripHash, shareUrl,
    loadState, saveState, log, readDay, listDays, deleteDay, storageBytes, dayKey,
    get storageError() { return storageError; },
    Sound, fmtDur, fmtDev, fmtTime, pad, h, download,
  };
})();
