// The interactive visibility map: what an eye at the turn sees directly, in mirror A, in mirror B, and what stays
// hidden. Plan geometry from js/data.js (feet, origin at the turn). Reflections off the real sphere in plan: for a
// target T the mirror shows it at the lens point whose normal bisects the directions to the eye and to T; that point
// must be on the lens (within its edge angle of the axis) and both sight lines must clear the walls; island shrubs
// (about 3 ft) block a line that passes through them lower than their top (a small child, not a car roof).
(function () {
  'use strict';
  const H = window.HOA, NS = 'http://www.w3.org/2000/svg';
  const [X0, Y0, X1, Y1] = H.view, W = X1 - X0, HT = Y1 - Y0;
  const R = H.mirror.R, COSA = Math.cos(H.mirror.alpha);
  const COL = { direct: [245, 217, 90, 120], A: [43, 111, 214, 165], B: [232, 137, 12, 175], AB: [138, 63, 191, 165] };

  // ---- geometry
  const edges = [];
  H.buildings.forEach(b => { const P = b.poly; for (let i = 0; i < P.length; i++) { const a = P[i], c = P[(i + 1) % P.length]; edges.push([a[0], a[1], c[0], c[1], Math.min(a[0], c[0]), Math.max(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[1], c[1])]); } });
  function hitsBuilding(px, py, qx, qy) {
    const mnx = Math.min(px, qx), mxx = Math.max(px, qx), mny = Math.min(py, qy), mxy = Math.max(py, qy), rx = qx - px, ry = qy - py;
    for (const e of edges) {
      if (e[5] < mnx || e[4] > mxx || e[7] < mny || e[6] > mxy) continue;
      const sx = e[2] - e[0], sy = e[3] - e[1], den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((e[0] - px) * sy - (e[1] - py) * sx) / den, u = ((e[0] - px) * ry - (e[1] - py) * rx) / den;
      if (t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1) return true;
    }
    return false;
  }
  const inPoly = (P, x, y) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  // rasters at 0.5 ft: inside a building, shrub top height
  const GS = 0.5, GW = Math.ceil(W / GS), GH = Math.ceil(HT / GS), bldR = new Uint8Array(GW * GH), shrR = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const x = X0 + (i + 0.5) * GS, y = Y0 + (j + 0.5) * GS, k = j * GW + i;
    for (const b of H.buildings) if (inPoly(b.poly, x, y)) { bldR[k] = 1; break; }
    for (const s of H.islands) if (inPoly(s.poly, x, y)) { shrR[k] = s.top; break; }
  }
  const cellAt = (x, y) => { const i = Math.floor((x - X0) / GS), j = Math.floor((y - Y0) / GS); return i < 0 || j < 0 || i >= GW || j >= GH ? -1 : j * GW + i; };
  const inBuilding = (x, y) => { const c = cellAt(x, y); return c >= 0 && bldR[c] === 1; };
  const SHR_MAX = Math.max(...H.islands.map(s => s.top));
  function shrubBlocks(px, py, ph, qx, qy, qh) {
    if (ph >= SHR_MAX && qh >= SHR_MAX) return false;
    const n = Math.max(2, Math.ceil(Math.hypot(qx - px, qy - py) / 0.5));
    for (let k = 1; k < n; k++) { const t = k / n, c = cellAt(px + (qx - px) * t, py + (qy - py) * t); if (c >= 0 && shrR[c] > 0 && ph + (qh - ph) * t < shrR[c]) return true; }
    return false;
  }
  // tree trunks on the islands with their low branches (1.2 ft across; the canopy is above the lens)
  const TRUNKS = H.trees.filter(t => t.trunk);
  function hitsTrunk(px, py, qx, qy) {
    for (const c of TRUNKS) { const dx = qx - px, dy = qy - py, L2 = dx * dx + dy * dy || 1e-9, t = Math.max(0, Math.min(1, ((c.p[0] - px) * dx + (c.p[1] - py) * dy) / L2)); if (Math.hypot(px + dx * t - c.p[0], py + dy * t - c.p[1]) < 0.6) return true; }
    return false;
  }
  const clear = (p, ph, q, qh) => !hitsBuilding(p[0], p[1], q[0], q[1]) && !hitsTrunk(p[0], p[1], q[0], q[1]) && !shrubBlocks(p[0], p[1], ph, q[0], q[1], qh);
  // the lens point that reflects T to the eye E (plan), or null
  function reflect(m, ex, ey, tx, ty) {
    const cx = m.c[0], cy = m.c[1];
    let ax = ex - cx, ay = ey - cy, l = Math.hypot(ax, ay); ax /= l; ay /= l;
    let bx = tx - cx, by = ty - cy; l = Math.hypot(bx, by); bx /= l; by /= l;
    let nx = ax + bx, ny = ay + by; l = Math.hypot(nx, ny); if (l < 1e-9) return null; nx /= l; ny /= l;
    for (let k = 0; k < 5; k++) {
      const px = cx + nx * R, py = cy + ny * R;
      ax = ex - px; ay = ey - py; l = Math.hypot(ax, ay); ax /= l; ay /= l;
      bx = tx - px; by = ty - py; l = Math.hypot(bx, by); bx /= l; by /= l;
      nx = ax + bx; ny = ay + by; l = Math.hypot(nx, ny); if (l < 1e-9) return null; nx /= l; ny /= l;
    }
    return [cx + nx * R, cy + ny * R, nx, ny];
  }
  // per eye and mirror: can the eye see the lens at all
  function prepMirror(m, E, he) {
    const front = (E[0] - m.rim[0]) * m.ax[0] + (E[1] - m.rim[1]) * m.ax[1] > 0;
    return Object.assign({}, m, { ok: front && clear(E, he, m.rim, m.h) });
  }
  function viaMirror(m, E, tx, ty, th) {
    if (!m.ok) return null;
    const r = reflect(m, E[0], E[1], tx, ty); if (!r) return null;
    if (r[2] * m.ax[0] + r[3] * m.ax[1] < COSA) return null;
    if ((tx - r[0]) * r[2] + (ty - r[1]) * r[3] <= 0 || (E[0] - r[0]) * r[2] + (E[1] - r[1]) * r[3] <= 0) return null;
    if (hitsBuilding(r[0], r[1], tx, ty) || hitsTrunk(r[0], r[1], tx, ty) || shrubBlocks(r[0], r[1], m.h, tx, ty, th)) return null;
    return r;
  }
  function mirrorsFor(setup) {
    if (setup === 'none') return [];
    if (setup === 'both') return [Object.assign({ k: 'A' }, H.mirrors.joint.A), Object.assign({ k: 'B' }, H.mirrors.joint.B)];
    return [Object.assign({ k: setup }, H.mirrors.single[setup])];
  }
  // what an eye sees at T: { direct, A, B } (A and B: the lens point or null)
  function seeAt(E, he, ms, T, th) {
    const out = { direct: clear(E, he, T, th) };
    for (const m of ms) out[m.k] = viaMirror(m, E, T[0], T[1], th);
    return out;
  }
  // how big a 4 ft kid at T looks in mirror m from E: image height on the lens (in) and the distance a kid would have
  // to be at to look that small directly (plan magnification, the sphere is the same both ways)
  function mirrorSize(m, E, T) {
    const d = [T[0] - m.rim[0], T[1] - m.rim[1]], l = Math.hypot(d[0], d[1]), p = [-d[1] / l * 0.5, d[0] / l * 0.5];
    const r1 = reflect(m, E[0], E[1], T[0] + p[0], T[1] + p[1]), r2 = reflect(m, E[0], E[1], T[0] - p[0], T[1] - p[1]);
    if (!r1 || !r2) return null;
    const imgFt = Math.hypot(r1[0] - r2[0], r1[1] - r2[1]) * 4, eyeFt = Math.hypot(r1[0] - E[0], r1[1] - E[1]);
    return { imageIn: imgFt * 12, eyeFt, looksFt: 4 / (imgFt / eyeFt) };
  }

  // ---- drawing helpers (also used by the install diagrams)
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const pts = P => P.map(p => p[0].toFixed(2) + ',' + (-p[1]).toFixed(2)).join(' ');
  function drawBase(g) {
    el('rect', { x: X0 - 200, y: -Y1 - 200, width: W + 400, height: HT + 400, fill: '#dfe6d3' }, g);
    el('polygon', { points: pts(H.fill), fill: '#eceae4', stroke: '#c9c5bb', 'stroke-width': 0.3 }, g);
    el('polyline', { points: pts(H.walk), fill: 'none', stroke: '#e3dfd5', 'stroke-width': H.walkWidth, 'stroke-linecap': 'butt' }, g);
    for (const s of H.islands) el('polygon', { points: pts(s.poly), fill: '#a9c28f', stroke: '#b5382a', 'stroke-width': 0.5 }, g);
  }
  function drawTop(g, opts) {
    opts = opts || {};
    for (const t of H.trees) el('circle', { cx: t.p[0], cy: -t.p[1], r: 0.9, fill: '#5d4a36' }, g);
    for (const b of H.buildings) {
      el('polygon', { points: pts(b.upper), fill: 'none', stroke: '#8d939b', 'stroke-width': 0.3, 'stroke-dasharray': '1 1' }, g);
      el('polygon', { points: pts(b.poly), fill: '#a3a8ae', stroke: '#6c727a', 'stroke-width': 0.4 }, g);
    }
    for (const d of H.doors) el('line', { x1: d[0][0], y1: -d[0][1], x2: d[1][0], y2: -d[1][1], stroke: '#ffffff', 'stroke-width': 1.1 }, g);
    const f = H.fixtures;
    el('circle', { cx: f.hydrant[0], cy: -f.hydrant[1], r: 0.8, fill: '#e9dfc9', stroke: '#6b5e4a', 'stroke-width': 0.3 }, g);
    if (opts.labels !== false) {
      text(g, f.hydrant[0] + 1.4, f.hydrant[1] - 0.4, 'hydrant', 2.6, 'start');
      for (const L of H.labels) { text(g, L.p[0], L.p[1], L.t, 5, 'middle', 700); if (L.sub) text(g, L.p[0], L.p[1] - 4, L.sub, 2.8, 'middle'); }
    }
  }
  function text(g, x, y, s, size, anchor, weight) {
    const t = el('text', { x, y: -y, 'font-size': size, 'text-anchor': anchor || 'start', 'font-weight': weight || 400, fill: '#2a2f36', 'paint-order': 'stroke', stroke: 'rgba(255,255,255,0.85)', 'stroke-width': size * 0.25, 'font-family': 'system-ui, sans-serif' }, g);
    t.textContent = s; return t;
  }
  const MCOL = { A: '#2b6fd6', B: '#e8890c' };
  function drawMirror(g, m, k, faded, scale) {
    scale = scale || 1;
    const col = faded ? '#8d939b' : MCOL[k], a = Math.atan2(m.ax[1], m.ax[0]), al = H.mirror.alpha, Rv = R * 2.2 * scale;
    // the lens arc, drawn 2.2 times its size so it shows
    const cx = m.rim[0] - m.ax[0] * Rv, cy = m.rim[1] - m.ax[1] * Rv, p1 = [cx + Rv * Math.cos(a - al), cy + Rv * Math.sin(a - al)], p2 = [cx + Rv * Math.cos(a + al), cy + Rv * Math.sin(a + al)];
    if (m.mount === 'pole') el('circle', { cx: m.post[0], cy: -m.post[1], r: 0.5 * scale, fill: '#444' }, g);
    el('path', { d: `M${p1[0]},${-p1[1]} A${Rv},${Rv} 0 0 0 ${p2[0]},${-p2[1]}`, fill: 'none', stroke: col, 'stroke-width': 1.3 * scale, 'stroke-linecap': 'round' }, g);
    const lx = m.rim[0] - m.ax[0] * 4.2 * scale, ly = m.rim[1] - m.ax[1] * 4.2 * scale;
    el('circle', { cx: lx, cy: -ly, r: 2.3 * scale, fill: col, stroke: '#fff', 'stroke-width': 0.5 * scale }, g);
    const t = el('text', { x: lx, y: -ly + 1.05 * scale, 'font-size': 3 * scale, 'text-anchor': 'middle', 'font-weight': 700, fill: '#fff', 'font-family': 'system-ui, sans-serif' }, g); t.textContent = k;
  }
  window.HOAplan = { el, pts, drawBase, drawTop, drawMirror, text, inBuilding, MCOL };

  // ---- the page's map
  const host = document.getElementById('map'); if (!host) return;
  const st = { setup: 'both', driver: H.drivers[0], E: H.drivers[0].p.slice(), he: H.drivers[0].eye, kind: 'kid', T: null };
  const base = el('svg', { viewBox: `${X0} ${-Y1} ${W} ${HT}`, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' }, host);
  drawBase(base);
  const cv = document.createElement('canvas'); host.appendChild(cv);
  const top = el('svg', { viewBox: `${X0} ${-Y1} ${W} ${HT}`, preserveAspectRatio: 'xMidYMid meet', class: 'top', role: 'img', 'aria-label': 'Plan of the turn with the visibility shading' }, host);
  drawTop(top);
  // north arrow and scale bar
  { const g = el('g', {}, top), nx = X1 - 7, ny = Y1 - 9, n = H.north;
    el('line', { x1: nx - n[0] * 4, y1: -(ny - n[1] * 4), x2: nx + n[0] * 4, y2: -(ny + n[1] * 4), stroke: '#2a2f36', 'stroke-width': 0.6, 'marker-end': '' }, g);
    el('polygon', { points: pts([[nx + n[0] * 5.5, ny + n[1] * 5.5], [nx + n[0] * 3 - n[1] * 1.4, ny + n[1] * 3 + n[0] * 1.4], [nx + n[0] * 3 + n[1] * 1.4, ny + n[1] * 3 - n[0] * 1.4]]), fill: '#2a2f36' }, g);
    text(g, nx + n[0] * 8, ny + n[1] * 8 - 1, 'N', 3.2, 'middle', 700);
    const sx = X0 + 5, sy = Y0 + 5; el('line', { x1: sx, y1: -sy, x2: sx + 30, y2: -sy, stroke: '#2a2f36', 'stroke-width': 0.8 }, g);
    for (const k of [0, 10, 20, 30]) el('line', { x1: sx + k, y1: -sy + 0.9, x2: sx + k, y2: -sy - 0.9, stroke: '#2a2f36', 'stroke-width': 0.5 }, g);
    text(g, sx + 15, sy + 2, '30 ft', 2.8, 'middle'); }
  const gMir = el('g', {}, top), gLines = el('g', {}, top), gHandles = el('g', {}, top);
  const ctx = cv.getContext('2d');

  function field(res) {
    const w = Math.ceil(W / res), h = Math.ceil(HT / res), small = document.createElement('canvas'); small.width = w; small.height = h;
    const sc = small.getContext('2d'), img = sc.createImageData(w, h), D = img.data;
    const mask = document.createElement('canvas'); mask.width = w; mask.height = h; const mc = mask.getContext('2d'), mi = mc.createImageData(w, h), M = mi.data;
    const th = H.heights[st.kind], E = st.E, ms = mirrorsFor(st.setup).map(m => prepMirror(m, E, st.he));
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = X0 + (i + 0.5) * res, y = Y1 - (j + 0.5) * res, o = (j * w + i) * 4;
      if (inBuilding(x, y)) continue;
      let c;
      if (clear(E, st.he, [x, y], th)) c = COL.direct;
      else {
        let a = false, b = false;
        for (const m of ms) if (viaMirror(m, E, x, y, th)) { if (m.k === 'A') a = true; else b = true; }
        c = a && b ? COL.AB : a ? COL.A : b ? COL.B : null;
      }
      if (c) { D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2]; D[o + 3] = c[3]; } else { M[o + 3] = 255; }
    }
    sc.putImageData(img, 0, 0); mc.putImageData(mi, 0, 0);
    return { small, mask };
  }
  let hatch = null;
  function paint(res) {
    const r = host.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    const { small, mask } = field(res);
    ctx.clearRect(0, 0, cw, ch); ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, cw, ch);
    // hidden: dark diagonal hatching through the mask
    if (!hatch || hatch.width !== cw || hatch.height !== ch) { hatch = document.createElement('canvas'); hatch.width = cw; hatch.height = ch; }
    const hc = hatch.getContext('2d'); hc.globalCompositeOperation = 'source-over'; hc.clearRect(0, 0, cw, ch);
    hc.fillStyle = 'rgba(42,47,54,0.50)'; hc.fillRect(0, 0, cw, ch);
    hc.strokeStyle = 'rgba(20,22,26,0.55)'; hc.lineWidth = 2 * dpr; const step = 9 * dpr; hc.beginPath();
    for (let k = -ch; k < cw; k += step) { hc.moveTo(k, ch); hc.lineTo(k + ch, 0); } hc.stroke();
    hc.globalCompositeOperation = 'destination-in'; hc.imageSmoothingEnabled = true; hc.drawImage(mask, 0, 0, cw, ch);
    ctx.drawImage(hatch, 0, 0);
  }
  function drawMirrors() {
    gMir.textContent = '';
    const show = mirrorsFor(st.setup), shown = new Set(show.map(m => m.k));
    for (const k of ['A', 'B']) if (!shown.has(k)) drawMirror(gMir, H.mirrors.single[k], k, true);
    for (const m of show) drawMirror(gMir, m, m.k, false);
  }
  const status = document.getElementById('status');
  const KIND = { kid: 'A small child', car: 'A car' };
  function drawLines() {
    gLines.textContent = ''; gHandles.textContent = '';
    const E = st.E, T = st.T, th = H.heights[st.kind], ms = mirrorsFor(st.setup).map(m => prepMirror(m, E, st.he)), s = seeAt(E, st.he, ms, T, th);
    if (s.direct) el('line', { x1: E[0], y1: -E[1], x2: T[0], y2: -T[1], stroke: '#2a2f36', 'stroke-width': 0.6 }, gLines);
    const seenIn = [];
    for (const m of ms) { const r = s[m.k]; if (!r) continue; seenIn.push(m); el('polyline', { points: pts([E, [r[0], r[1]], T]), fill: 'none', stroke: MCOL[m.k], 'stroke-width': 0.7, 'stroke-dasharray': '2 1.2' }, gLines); }
    // handles: the eye and the target
    const eyeG = el('g', { class: 'handle', 'data-h': 'E' }, gHandles);
    el('circle', { cx: E[0], cy: -E[1], r: 6, fill: 'transparent' }, eyeG);
    el('circle', { cx: E[0], cy: -E[1], r: 2.2, fill: '#ffffff', stroke: '#111', 'stroke-width': 0.9 }, eyeG);
    el('circle', { cx: E[0], cy: -E[1], r: 0.9, fill: '#111' }, eyeG);
    text(gHandles, E[0], E[1] + 3.6, st.driver.id === 'kid' ? 'child (eye)' : 'driver (eye)', 2.8, 'middle', 650);
    const tg = el('g', { class: 'handle', 'data-h': 'T' }, gHandles);
    el('circle', { cx: T[0], cy: -T[1], r: 6, fill: 'transparent' }, tg);
    if (st.kind === 'car') el('rect', { x: T[0] - 2.2, y: -T[1] - 2.2, width: 4.4, height: 4.4, rx: 1, fill: '#d0312d', stroke: '#fff', 'stroke-width': 0.6 }, tg);
    else el('circle', { cx: T[0], cy: -T[1], r: 1.7, fill: '#d0312d', stroke: '#fff', 'stroke-width': 0.6 }, tg);
    text(gHandles, T[0], T[1] - 4.6, st.kind === 'car' ? 'car' : 'child', 2.8, 'middle', 650);
    // the status line
    let msg = `<b>${KIND[st.kind]} at the red marker:</b> `;
    if (s.direct) msg += 'seen directly.';
    else if (seenIn.length) {
      msg += 'hidden directly, seen in mirror ' + seenIn.map(m => m.k).join(' and ') + '.';
      if (st.kind === 'kid') { const z = mirrorSize(seenIn[0], E, T); if (z) msg += ` In the mirror it is a speck about ${z.imageIn.toFixed(1)} in tall seen from ${Math.round(z.eyeFt)} ft, as small as a child about ${Math.round(z.looksFt / 50) * 50} ft away.`; }
    } else msg += '<b>hidden</b>' + (st.setup === 'none' ? ' (no mirror).' : ' from this eye, even with ' + (st.setup === 'both' ? 'both mirrors' : 'mirror ' + st.setup) + '.');
    status.innerHTML = msg + ` <span class="muted">Driver: ${st.driver.what}.</span>`;
  }
  let pending = 0;
  function update(fast) {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; paint(fast ? 1.6 : 0.6); drawLines(); });
  }
  // controls
  function seg(id, fn) { const box = document.getElementById(id); box.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; box.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); fn(b.dataset.v); }); }
  const DEF_T = { a1: ['kid', [-49.6, 2.0]], a2: ['kid', null], gar: ['car', null], kid: ['car', null] };
  function setDriver(id) {
    const d = H.drivers.find(x => x.id === id); st.driver = d; st.E = d.p.slice(); st.he = d.eye;
    const tg = H.targets;
    if (id === 'a1') { st.kind = 'kid'; st.T = tg.w4[0].p.slice(); }
    if (id === 'a2') { st.kind = 'kid'; st.T = tg.a1[2 * 3 + 0].p.slice(); }       // a child by the corner row's garages, 30 ft down A1
    if (id === 'gar') { st.kind = 'car'; st.T = tg.a2[3 * 3 + 2].p.slice(); }     // a car 40 ft down A2
    if (id === 'kid') { st.kind = 'car'; st.T = tg.a1cars[3].p.slice(); }        // a car 40 ft down A1
    document.querySelectorAll('#ctl-kind button').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === st.kind ? 'true' : 'false'));
    update();
  }
  seg('ctl-setup', v => { st.setup = v; drawMirrors(); update(); });
  seg('ctl-driver', v => setDriver(v));
  seg('ctl-kind', v => { st.kind = v; update(); });
  // dragging
  let drag = null;
  const toLocal = ev => { const p = top.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; const q = p.matrixTransform(top.getScreenCTM().inverse()); return [Math.max(X0 + 1, Math.min(X1 - 1, q.x)), Math.max(Y0 + 1, Math.min(Y1 - 1, -q.y))]; };
  top.addEventListener('pointerdown', ev => { const h = ev.target.closest('.handle'); if (!h) return; drag = h.dataset.h; top.setPointerCapture(ev.pointerId); ev.preventDefault(); });
  top.addEventListener('pointermove', ev => { if (!drag) return; const p = toLocal(ev); if (inBuilding(p[0], p[1])) return; if (drag === 'E') st.E = p; else st.T = p; update(drag === 'E'); });
  const end = () => { if (drag) { drag = null; update(); } };
  top.addEventListener('pointerup', end); top.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => update());
  drawMirrors(); setDriver('a1');

  // ---- coverage table: per driver preset and mirror setup, the share of the approach spots seen (directly or in a mirror)
  const tb = document.getElementById('cov');
  if (tb) {
    const setups = [['none', 'No mirror'], ['A', 'A only'], ['B', 'B only'], ['both', 'A + B']];
    let html = '<thead><tr><th>Who is looking</th>' + setups.map(s => `<th>${s[1]}</th>`).join('') + '</tr></thead><tbody>';
    const cov = {};
    for (const d of H.drivers) {
      const T = d.looks.flatMap(k => H.targets[k]);
      html += `<tr><td>${d.label}<br><span class="note">${T.length} spots</span></td>`;
      cov[d.id] = {};
      for (const [s] of setups) {
        const ms = mirrorsFor(s).map(m => prepMirror(m, d.p, d.eye));
        let n = 0; for (const t of T) { const r = seeAt(d.p, d.eye, ms, t.p, H.heights[t.kind]); if (r.direct || r.A || r.B) n++; }
        const pc = Math.round(100 * n / T.length); cov[d.id][s] = { n, of: T.length };
        html += `<td class="${n === T.length ? 'full' : ''}">${pc}%<span class="bar"><span style="width:${pc}%"></span></span></td>`;
      }
      html += '</tr>';
    }
    tb.innerHTML = html + '</tbody>';
    window.HOA_COVERAGE = cov;
  }
})();
