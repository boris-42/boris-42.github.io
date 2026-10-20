// The key number, the install cards (from js/data.js), the 3D viewer and its full-screen view (from js/renders.js),
// and the link between the map's "who is looking" and the viewer's situation.
(function () {
  'use strict';
  const H = window.HOA, P = window.HOAplan, C = window.HOA_COVERAGE, $ = id => document.getElementById(id);
  const ftin = ft => { const i = Math.round(Math.abs(ft) * 12), f = Math.floor(i / 12), r = i % 12; return r ? `${f} ft ${r} in` : `${f} ft`; };
  const total = s => { let n = 0, of = 0; for (const d in C) { n += C[d][s].n; of += C[d][s].of; } return Math.round(100 * n / of); };

  // ---- the key number: share of the approach spots seen, today and with both mirrors (all four viewpoints together)
  const kn = $('keynum');
  if (kn && C) kn.innerHTML = `<div class="kv"><b>${total('none')}%</b><span>seen today</span></div><div class="karrow" aria-hidden="true">&rarr;</div><div class="kv rec"><b>${total('both')}%</b><span>with both mirrors</span></div><p class="kcap">of the spots around the turn a driver or kid needs to see</p>`;

  // ---- install cards
  function mini(m, k, inst) {
    const svg = P.el('svg', { class: 'mini', role: 'img', 'aria-label': `Plan around mirror ${k} with its facing arrow` });
    const c = m.rim, half = 30, vb = [c[0] - half, -(c[1] + half), 2 * half, 2 * half];
    svg.setAttribute('viewBox', vb.join(' '));
    const g = P.el('g', {}, svg); P.drawBase(g);
    const t = P.el('g', {}, svg); P.drawTop(t, { labels: false });
    const f = H.fixtures.hydrant; P.text(t, f[0] + 1.4, f[1] - 0.6, 'hydrant', 3.2, 'start');
    const e = inst.hit ? inst.hit.point : [c[0] + m.ax[0] * 30, c[1] + m.ax[1] * 30];
    const col = P.MLINE[k];
    P.el('line', { x1: c[0], y1: -c[1], x2: e[0], y2: -e[1], stroke: col, 'stroke-width': 0.9, 'stroke-dasharray': '2 1' }, t);
    const dx = e[0] - c[0], dy = e[1] - c[1], l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l, ah = [e[0] - ux * 3, e[1] - uy * 3];
    P.el('polygon', { points: P.pts([e, [ah[0] - uy * 1.6, ah[1] + ux * 1.6], [ah[0] + uy * 1.6, ah[1] - ux * 1.6]]), fill: col }, t);
    P.drawMirror(t, m, k, false, 1);
    return svg;
  }
  function card(k, m, inst) {
    const div = document.createElement('div'); div.className = 'card';
    const pole = m.mount === 'pole';
    const rows = pole
      ? [['Where', `Island lawn: ${ftin(inst.alongCurbFromHydrantFt)} from the hydrant along the curb, ${ftin(inst.curbFt)} in from the curb`],
         ['Mount', '8 ft post, 2 ft in concrete. Call 811 first.']]
      : [['Where', `Garage wall across the turn, centered between its 1st and 2nd doors`],
         ['Mount', 'Wall bracket, 4 anchors. Needs the owner\'s OK.']];
    rows.push(['Height', '4 ft 6 in'], ['Facing', `${inst.yaw} deg`], ['Tilt', `${Math.abs(inst.tilt)} deg down`]);
    div.innerHTML = `<div class="card-h"><span class="mk mk-${k}">${k}</span><b>${pole ? 'Post on the island' : 'On the garage wall'}</b></div><dl>${rows.map(r => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('')}</dl>`;
    div.insertBefore(mini(m, k, inst), div.firstChild);
    return div;
  }
  const ic = $('install-cards');
  if (ic) {
    const S = H.mirrors.single, J = H.mirrors.joint, I = H.install;
    const sec = (h, cls, cards) => { const w = document.createElement('div'); w.className = cls; w.innerHTML = `<h3>${h}</h3>`; const g = document.createElement('div'); g.className = 'cards'; cards.forEach(c => g.appendChild(c)); w.appendChild(g); ic.appendChild(w); };
    sec(`Recommended: both mirrors <span class="pct">${C ? total('both') + '% seen' : ''}</span>`, 'opt-rec', [card('A', J.A, I.bothA), card('B', J.B, I.bothB)]);
    sec(`Or one mirror <span class="pct">${C ? 'A alone ' + total('A') + '%, B alone ' + total('B') + '%' : ''}</span>`, 'opt-one', [card('A', S.A, I.A), card('B', S.B, I.B)]);
  }

  // ---- the 3D viewer
  const R = window.HOA_RENDERS, host = $('viewer');
  if (!host) return;
  if (!R || !R.situations.length) { host.innerHTML = '<div class="placeholder">The 3D views are still being made.</div>'; return; }
  const SITS = R.situations;
  const NAME = { none: 'No mirror', A: 'Mirror A', B: 'Mirror B', both: 'Both mirrors' };
  const SETUPS = ['none', 'A', 'B', 'both'];
  const DRV_SIT = { a1: /^sedan-up-A1-30ft/, a2: /^car-down-A2-30ft/, gar: /^backing-out/, kid: /^kid-at-W4/ };
  const SIT_DRV = [[/up-A1/, 'a1'], [/down-A2/, 'a2'], [/^backing-out/, 'gar'], [/^kid-at-W4/, 'kid']];
  const st = { i: 0, setup: 'both', view: 'wide', split: 50 };
  const icon = {
    fs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    lr: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  host.innerHTML = `
    <div class="chips" id="v-sit" role="group" aria-label="Situation">${SITS.map((s, i) => `<button type="button" data-i="${i}" aria-pressed="false">${s.thumb ? `<img src="${s.thumb}" alt="" width="120" height="68" loading="lazy">` : ''}<span>${s.label}</span></button>`).join('')}</div>
    <div class="vctl">
      <div class="seg" id="v-setup" role="group" aria-label="Mirrors">${SETUPS.map(o => `<button type="button" data-v="${o}" aria-pressed="false">${{ none: 'No mirror', A: 'Mirror A', B: 'Mirror B', both: 'Both' }[o]}</button>`).join('')}</div>
      <div class="seg" id="v-view" role="group" aria-label="View"><button type="button" data-v="wide" aria-pressed="true">Driver's view</button><button type="button" data-v="zoom" aria-pressed="false">Mirror close-up</button></div>
    </div>
    <div class="stage" id="v-stage">
      <div class="layer after" id="v-after"></div>
      <div class="layer before" id="v-before"></div>
      <div class="split" id="v-split"><span class="knob">${icon.lr}</span></div>
      <span class="tag tl" id="v-tl"></span><span class="tag tr" id="v-tr"></span>
      <button type="button" class="fs" id="v-fs" aria-label="Full screen">${icon.fs}</button>
    </div>
    <p class="vcap" id="v-cap"></p>`;
  const stage = $('v-stage'), after = $('v-after'), before = $('v-before'), split = $('v-split');
  const sit = () => SITS[st.i];
  const hasZoom = (s, o) => !!(s.opts[o] && Object.keys(s.opts[o].zoom).length);
  const press = (id, v, attr) => host.querySelectorAll(`#${id} button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr || 'v'] === String(v))));
  // crossfade: the new content goes on top at opacity 0 and fades in once its images are decoded
  function show(layer, key, make) {
    if (layer.dataset.key === key) return;
    layer.dataset.key = key;
    const el = make(); el.classList.add('fade'); layer.appendChild(el);
    const imgs = [...el.querySelectorAll('img')];
    Promise.all(imgs.map(im => im.decode ? im.decode().catch(() => {}) : null)).then(() => {
      if (layer.dataset.key !== key) { el.remove(); return; }
      requestAnimationFrame(() => el.classList.add('in'));
      setTimeout(() => { for (const c of [...layer.children]) if (c !== el && layer.dataset.key === key) c.remove(); }, 320);
    });
  }
  const wideEl = (s, o) => { const d = document.createElement('div'); d.className = 'pane'; d.innerHTML = `<img src="${s.opts[o].wide.src}" alt="${s.label}: ${NAME[o]}, driver's view" width="1400" height="788">`; return d; };
  const zoomEl = (s, o) => {
    const d = document.createElement('div'); d.className = 'pane zgrid';
    d.innerHTML = Object.keys(s.opts[o].zoom).sort().map(k => { const z = s.opts[o].zoom[k]; return `<figure><img src="${z.src}" alt="${s.label}: close-up of mirror ${k}" width="800" height="800"><figcaption><span class="mk mk-${k}">${k}</span>${z.distFt ? Math.round(z.distFt) + ' ft away' : ''}</figcaption></figure>`; }).join('');
    return d;
  };
  const preloaded = new Set();
  const preload = src => { if (src && !preloaded.has(src)) { preloaded.add(src); const im = new Image(); im.src = src; } };
  function render() {
    const s = sit();
    if (!s.opts[st.setup]) st.setup = SETUPS.find(o => s.opts[o]) || 'none';
    if (st.view === 'zoom' && !hasZoom(s, st.setup)) st.view = 'wide';
    press('v-sit', st.i, 'i'); press('v-setup', st.setup); press('v-view', st.view);
    { const strip = $('v-sit'), cb = strip.children[st.i]; if (cb && strip.scrollWidth > strip.clientWidth) { const l = cb.offsetLeft - strip.offsetLeft, r = l + cb.offsetWidth; if (l < strip.scrollLeft || r > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: l - 8, behavior: 'smooth' }); } }
    const zb = host.querySelector('#v-view button[data-v="zoom"]'); zb.disabled = !hasZoom(s, st.setup);
    host.querySelectorAll('#v-setup button').forEach(b => { b.disabled = !s.opts[b.dataset.v]; });
    const compare = st.view === 'wide' && st.setup !== 'none' && !!(s.opts.none && s.opts.none.wide);
    if (st.view === 'wide') show(after, `${s.n}|${st.setup}|w`, () => wideEl(s, st.setup));
    else show(after, `${s.n}|${st.setup}|z`, () => zoomEl(s, st.setup));
    if (compare) show(before, `${s.n}|none|w`, () => wideEl(s, 'none'));
    stage.classList.toggle('compare', compare);
    stage.classList.toggle('zoomview', st.view === 'zoom');
    before.style.clipPath = `inset(0 ${100 - st.split}% 0 0)`; split.style.left = st.split + '%';
    $('v-tl').textContent = compare ? NAME.none : st.view === 'wide' ? NAME[st.setup] : '';
    $('v-tr').textContent = compare ? NAME[st.setup] : '';
    $('v-cap').textContent = s.caption;
    // preload the other mirror setups here and the same setup next door
    for (const o of SETUPS) if (s.opts[o]) { preload(s.opts[o].wide && s.opts[o].wide.src); if (st.view === 'zoom' || o === st.setup) for (const k in s.opts[o].zoom) preload(s.opts[o].zoom[k].src); }
    for (const j of [st.i - 1, st.i + 1]) { const n = SITS[j]; if (n && n.opts[st.setup]) { preload(n.opts[st.setup].wide.src); if (n.opts.none) preload(n.opts.none.wide.src); } }
  }
  const map = window.HOAmap;
  let syncing = false;
  function setSit(i, fromMap) { st.i = Math.max(0, Math.min(SITS.length - 1, i)); render(); if (!fromMap && map && !syncing) { const d = SIT_DRV.find(r => r[0].test(sit().slug)); if (d) { syncing = true; map.setDriver(d[1]); syncing = false; } } }
  function setSetup(o, fromMap) { st.setup = o; render(); if (!fromMap && map && !syncing) { syncing = true; map.setSetup(o); syncing = false; } }
  host.querySelector('#v-sit').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setSit(+b.dataset.i); });
  host.querySelector('#v-setup').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) setSetup(b.dataset.v); });
  host.querySelector('#v-view').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) { st.view = b.dataset.v; render(); } });
  if (map) {
    map.onchange = ({ driver, setup }) => {
      if (syncing) return;
      const i = SITS.findIndex(s => DRV_SIT[driver] && DRV_SIT[driver].test(s.slug));
      const cur = SIT_DRV.find(r => r[0].test(sit().slug));
      if (i >= 0 && !(cur && cur[1] === driver)) st.i = i;   // keep e.g. the 15 ft view if it is the same driver
      st.setup = setup; render();
    };
    const go = $('go3d');
    if (go) go.addEventListener('click', () => { map.onchange(map.state()); $('renders').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }
  // the compare slider: drag sideways anywhere on the picture; a tap opens the full-screen view
  let pd = null;
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('.fs') || e.button > 0) return;
    pd = { x: e.clientX, y: e.clientY, id: e.pointerId, sliding: false };
  });
  stage.addEventListener('pointermove', e => {
    if (!pd || e.pointerId !== pd.id) return;
    const dx = e.clientX - pd.x, dy = e.clientY - pd.y;
    if (!pd.sliding && stage.classList.contains('compare') && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) { pd.sliding = true; stage.setPointerCapture(e.pointerId); stage.classList.add('sliding'); }
    if (pd.sliding) { const r = stage.getBoundingClientRect(); st.split = Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)); before.style.clipPath = `inset(0 ${100 - st.split}% 0 0)`; split.style.left = st.split + '%'; stage.classList.add('slid'); }
  });
  stage.addEventListener('pointerup', e => {
    if (!pd || e.pointerId !== pd.id) return;
    const tap = !pd.sliding && Math.hypot(e.clientX - pd.x, e.clientY - pd.y) < 8; pd = null; stage.classList.remove('sliding');
    if (tap) openLB();
  });
  stage.addEventListener('pointercancel', () => { pd = null; stage.classList.remove('sliding'); });
  $('v-fs').addEventListener('click', () => openLB());

  // ---- full screen: every picture of the situation, arrows or swipe between them, click, wheel or pinch to zoom
  const lb = $('lb'), lbStage = $('lb-stage'), lbImg = $('lb-img'), lbCap = $('lb-cap');
  let frames = [], fi = 0, lastFocus = null;
  function framesOf(s) {
    const out = [];
    for (const o of SETUPS) {
      const v = s.opts[o]; if (!v) continue;
      if (v.wide) out.push({ o, view: 'wide', src: v.wide.src, full: v.wide.full, label: `${NAME[o]}, driver's view` });
      for (const k of Object.keys(v.zoom).sort()) out.push({ o, view: 'zoom', src: v.zoom[k].src, full: v.zoom[k].full, label: `${NAME[o]}, close-up of mirror ${k}` });
    }
    return out;
  }
  const z = { s: 1, x: 0, y: 0 };
  const applyZ = () => { lbImg.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`; lb.classList.toggle('zoomed', z.s > 1.01); };
  function zoomAt(px, py, s2) {
    s2 = Math.max(1, Math.min(6, s2));
    const r = lbStage.getBoundingClientRect(), ox = px - r.left, oy = py - r.top;
    z.x = ox - (ox - z.x) * (s2 / z.s); z.y = oy - (oy - z.y) * (s2 / z.s); z.s = s2;
    if (z.s <= 1.01) { z.s = 1; z.x = 0; z.y = 0; }
    applyZ();
  }
  function showFrame(k) {
    fi = (k + frames.length) % frames.length;
    const f = frames[fi]; z.s = 1; z.x = 0; z.y = 0; applyZ();
    lbImg.src = f.src; lbImg.alt = `${sit().label}: ${f.label}`;
    const big = new Image(); big.onload = () => { if (frames[fi] === f) lbImg.src = f.full; }; big.src = f.full;
    lbCap.innerHTML = `<b>${sit().label}</b> ${f.label} <span>${fi + 1} of ${frames.length}</span>`;
    preload(frames[(fi + 1) % frames.length].src); preload(frames[(fi - 1 + frames.length) % frames.length].src);
  }
  function openLB() {
    frames = framesOf(sit());
    let k = frames.findIndex(f => f.o === st.setup && f.view === st.view); if (k < 0) k = 0;
    lastFocus = document.activeElement; lb.hidden = false; document.documentElement.classList.add('lb-open');
    showFrame(k); $('lb-close').focus();
  }
  function closeLB() {
    if (lb.hidden) return;
    const f = frames[fi]; lb.hidden = true; document.documentElement.classList.remove('lb-open');
    if (f) { st.view = f.view; if (f.o !== st.setup) setSetup(f.o); else render(); }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $('lb-close').addEventListener('click', closeLB);
  $('lb-prev').addEventListener('click', () => showFrame(fi - 1));
  $('lb-next').addEventListener('click', () => showFrame(fi + 1));
  document.addEventListener('keydown', e => {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLB();
    else if (e.key === 'ArrowLeft') showFrame(fi - 1);
    else if (e.key === 'ArrowRight') showFrame(fi + 1);
  });
  lbStage.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, z.s * Math.exp(-e.deltaY * 0.0025)); }, { passive: false });
  const ptrs = new Map(); let g = null;
  lbStage.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, [e.clientX, e.clientY]); lbStage.setPointerCapture(e.pointerId);
    const p = [...ptrs.values()];
    g = p.length === 2 ? { pinch: true, d: Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]), s: z.s, moved: true }
      : { pinch: false, x: e.clientX, y: e.clientY, zx: z.x, zy: z.y, moved: false };
  });
  lbStage.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId) || !g) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    const p = [...ptrs.values()];
    if (g.pinch && p.length === 2) { const d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]); zoomAt((p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2, g.s * d / g.d); return; }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.hypot(dx, dy) > 6) g.moved = true;
    if (z.s > 1) { z.x = g.zx + dx; z.y = g.zy + dy; applyZ(); }
    else lbImg.style.transform = `translateX(${dx}px)`;
  });
  const lbUp = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (!g) return;
    if (g.pinch) { if (ptrs.size === 0) g = null; return; }
    const dx = e.clientX - g.x;
    if (!g.moved && e.type === 'pointerup') zoomAt(e.clientX, e.clientY, z.s > 1 ? 1 : 2.5);
    else if (z.s === 1) { applyZ(); if (Math.abs(dx) > 60) showFrame(fi + (dx < 0 ? 1 : -1)); }
    g = null;
  };
  lbStage.addEventListener('pointerup', lbUp); lbStage.addEventListener('pointercancel', lbUp);
  lb.addEventListener('click', e => { if (e.target === lb) closeLB(); });

  const cta = $('cta');
  if (cta) cta.addEventListener('click', () => { $('map-sec').scrollIntoView({ behavior: 'smooth', block: 'start' }); if (map && map.play) map.play(); });
  // start with the map's driver and setup
  if (map && map.onchange) map.onchange(map.state()); else render();
  window.HOAviewer = { state: () => Object.assign({}, st, { slug: sit().slug }), setSit, setSetup };
})();
