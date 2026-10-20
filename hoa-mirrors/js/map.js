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
  // mirror A and mirror B are two see-through layers (blue and yellow) multiplied together, so where both show it reads green
  const COL = { A: [110, 165, 245, 215], B: [255, 214, 60, 215] };

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
      for (const L of H.labels) { const t = text(g, L.p[0], L.p[1], L.t, L.t.length > 6 ? 3.8 : 5, 'middle', 700); if (L.rot) t.setAttribute('transform', `rotate(${L.rot} ${L.p[0]} ${-L.p[1]})`); if (L.sub) text(g, L.p[0], L.p[1] - 4, L.sub, 2.8, 'middle'); }
    }
  }
  function text(g, x, y, s, size, anchor, weight) {
    const t = el('text', { x, y: -y, 'font-size': size, 'text-anchor': anchor || 'start', 'font-weight': weight || 400, fill: '#2a2f36', 'paint-order': 'stroke', stroke: 'rgba(255,255,255,0.85)', 'stroke-width': size * 0.25, 'font-family': 'system-ui, sans-serif' }, g);
    t.textContent = s; return t;
  }
  const MCOL = { A: '#3d7fe6', B: '#f2c200' }, MLINE = { A: '#2f6fd8', B: '#b98f00' };
  function drawMirror(g, m, k, faded, scale) {
    scale = scale || 1;
    const col = faded ? '#8d939b' : MCOL[k], a = Math.atan2(m.ax[1], m.ax[0]), al = H.mirror.alpha, Rv = R * 2.2 * scale;
    // the lens arc, drawn 2.2 times its size so it shows
    const cx = m.rim[0] - m.ax[0] * Rv, cy = m.rim[1] - m.ax[1] * Rv, p1 = [cx + Rv * Math.cos(a - al), cy + Rv * Math.sin(a - al)], p2 = [cx + Rv * Math.cos(a + al), cy + Rv * Math.sin(a + al)];
    if (m.mount === 'pole') el('circle', { cx: m.post[0], cy: -m.post[1], r: 0.5 * scale, fill: '#444' }, g);
    el('path', { d: `M${p1[0]},${-p1[1]} A${Rv},${Rv} 0 0 0 ${p2[0]},${-p2[1]}`, fill: 'none', stroke: col, 'stroke-width': 1.3 * scale, 'stroke-linecap': 'round' }, g);
    const lx = m.rim[0] - m.ax[0] * 4.2 * scale, ly = m.rim[1] - m.ax[1] * 4.2 * scale;
    el('circle', { cx: lx, cy: -ly, r: 2.3 * scale, fill: col, stroke: '#fff', 'stroke-width': 0.5 * scale }, g);
    const t = el('text', { x: lx, y: -ly + 1.05 * scale, 'font-size': 3 * scale, 'text-anchor': 'middle', 'font-weight': 700, fill: k === 'B' && !faded ? '#2a2200' : '#fff', 'font-family': 'system-ui, sans-serif' }, g); t.textContent = k;
  }
  window.HOAplan = { el, pts, drawBase, drawTop, drawMirror, text, inBuilding, MCOL, MLINE };

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
    const w = Math.ceil(W / res), h = Math.ceil(HT / res), mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); return { c, x, img: x.createImageData(w, h) }; };
    const LA = mk(), LB = mk(), LH = mk(), DA = LA.img.data, DB = LB.img.data, M = LH.img.data;
    const th = H.heights[st.kind], E = st.E, ms = mirrorsFor(st.setup).map(m => prepMirror(m, E, st.he));
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = X0 + (i + 0.5) * res, y = Y1 - (j + 0.5) * res, o = (j * w + i) * 4;
      if (inBuilding(x, y) || clear(E, st.he, [x, y], th)) continue;   // seen directly: left plain
      let a = false, b = false;
      for (const m of ms) if (viaMirror(m, E, x, y, th)) { if (m.k === 'A') a = true; else b = true; }
      if (a) { DA[o] = COL.A[0]; DA[o + 1] = COL.A[1]; DA[o + 2] = COL.A[2]; DA[o + 3] = COL.A[3]; }
      if (b) { DB[o] = COL.B[0]; DB[o + 1] = COL.B[1]; DB[o + 2] = COL.B[2]; DB[o + 3] = COL.B[3]; }
      if (!a && !b) M[o + 3] = 255;
    }
    LA.x.putImageData(LA.img, 0, 0); LB.x.putImageData(LB.img, 0, 0); LH.x.putImageData(LH.img, 0, 0);
    return { a: LA.c, b: LB.c, mask: LH.c };
  }
  let hatch = null;
  function paint(res) {
    const r = host.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    const { a, b, mask } = field(res);
    ctx.clearRect(0, 0, cw, ch); ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(a, 0, 0, cw, ch);
    ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(b, 0, 0, cw, ch);
    ctx.globalCompositeOperation = 'source-over';
    // hidden: red diagonal hatching through the mask (the problem)
    if (!hatch || hatch.width !== cw || hatch.height !== ch) { hatch = document.createElement('canvas'); hatch.width = cw; hatch.height = ch; }
    const hc = hatch.getContext('2d'); hc.globalCompositeOperation = 'source-over'; hc.clearRect(0, 0, cw, ch);
    hc.fillStyle = 'rgba(225,60,50,0.42)'; hc.fillRect(0, 0, cw, ch);
    hc.strokeStyle = 'rgba(175,25,20,0.75)'; hc.lineWidth = 2 * dpr; const step = 9 * dpr; hc.beginPath();
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
  // ---- icons: a car seen from above (pointing along its lane) and a child pictogram, hand-made SVG in feet
  function carIcon(g, P, hd, col, driverSeat) {
    const ang = Math.atan2(-hd[1], hd[0]) * 180 / Math.PI;
    const c = el('g', { transform: `translate(${P[0]},${-P[1]}) rotate(${ang.toFixed(1)})` }, g);
    // the frame's origin is the point; with driverSeat it is the driver's eye (front left of the cabin)
    const cx = driverSeat ? -1 : 0, cy = driverSeat ? 1.4 : 0, L = 15, Wd = 6.2;
    el('rect', { x: cx - L / 2 - 0.3, y: cy - Wd / 2 - 0.3, width: L + 0.6, height: Wd + 0.6, rx: 2.3, fill: 'rgba(0,0,0,0.25)' }, c);
    el('rect', { x: cx - L / 2, y: cy - Wd / 2, width: L, height: Wd, rx: 2, fill: col, stroke: '#fff', 'stroke-width': 0.5 }, c);
    el('path', { d: `M${cx + 2.4},${cy - 2.5} L${cx + 4.2},${cy - 2.1} L${cx + 4.2},${cy + 2.1} L${cx + 2.4},${cy + 2.5} Z`, fill: '#cfe3f5' }, c);
    el('path', { d: `M${cx - 4.6},${cy - 2.4} L${cx - 5.8},${cy - 2.1} L${cx - 5.8},${cy + 2.1} L${cx - 4.6},${cy + 2.4} Z`, fill: '#cfe3f5' }, c);
    el('rect', { x: cx - 4.6, y: cy - 2.5, width: 7, height: 5, rx: 0.8, fill: 'rgba(255,255,255,0.18)' }, c);
    for (const sy of [-2.2, 2.2]) el('rect', { x: cx + L / 2 - 0.9, y: cy + sy - 0.6, width: 0.8, height: 1.2, rx: 0.3, fill: '#ffe9a0' }, c);
    return c;
  }
  function childIcon(g, P, col) {
    const c = el('g', { transform: `translate(${P[0]},${-P[1]}) scale(1.35)` }, g);
    const limbs = 'M-1.2,-1 L-2.5,0.9 M1.2,-1 L2.6,-2.2 M-0.6,1.1 L-1.3,3.3 M0.6,1.1 L1.5,3.2';
    const body = 'M-1.25,-1.5 L1.25,-1.5 L0.95,1.3 L-0.95,1.3 Z';
    el('path', { d: limbs, stroke: '#fff', 'stroke-width': 2, 'stroke-linecap': 'round', fill: 'none' }, c);
    el('path', { d: body, fill: '#fff', stroke: '#fff', 'stroke-width': 1.1, 'stroke-linejoin': 'round' }, c);
    el('circle', { cx: 0, cy: -2.75, r: 1.65, fill: '#fff' }, c);
    el('path', { d: limbs, stroke: col, 'stroke-width': 0.95, 'stroke-linecap': 'round', fill: 'none' }, c);
    el('path', { d: body, fill: col, stroke: col, 'stroke-width': 0.4, 'stroke-linejoin': 'round' }, c);
    el('circle', { cx: 0, cy: -2.75, r: 1.15, fill: col }, c);
    return c;
  }
  const dirOf = tr => { const dx = tr[1][0] - tr[0][0], dy = tr[1][1] - tr[0][1], l = Math.hypot(dx, dy); return [dx / l, dy / l]; };
  const UP_A1 = dirOf(H.drivers.find(d => d.id === 'a1').track), DOWN_A2 = dirOf(H.drivers.find(d => d.id === 'a2').track);
  const EYE_HD = { a1: UP_A1, a2: DOWN_A2, gar: [-1, 0] };
  const carHeading = T => (T[0] < -6 ? DOWN_A2 : UP_A1);   // a car on A2 heads down it to the turn, on A1 up it
  const VIEW_COL = '#1d2230', STATE_COL = { hidden: '#d0312d', direct: '#7a8290', a: '#2f6fd8', b: '#c99a00', ab: '#5f8a1c' };

  // ---- the drag hint: pulsing rings and a "drag me" tag on both handles until the first drag
  let hinted = false;
  const tags = { E: null, T: null };
  const ARROWS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1 L5.5 4 H7.2 V7.2 H4 V5.5 L1 8 L4 10.5 V8.8 H7.2 V12 H5.5 L8 15 L10.5 12 H8.8 V8.8 H12 V10.5 L15 8 L12 5.5 V7.2 H8.8 V4 H10.5 Z" fill="currentColor"/></svg>';
  function placeTag(k, P, label) {
    if (hinted) return;
    if (!tags[k]) { tags[k] = document.createElement('div'); tags[k].className = 'dragtag'; host.appendChild(tags[k]); }
    const t = tags[k], lx = (P[0] - X0) / W * 100, ly = (Y1 - P[1]) / HT * 100, right = lx < 62;
    t.innerHTML = ARROWS + label;
    t.style.left = lx + '%'; t.style.top = ly + '%';
    t.classList.toggle('left', !right);
  }
  function endHint() {
    if (hinted) return; hinted = true;
    for (const k in tags) if (tags[k]) { tags[k].remove(); tags[k] = null; }
    host.classList.add('hinted');
  }

  const status = document.getElementById('status');
  const KIND = { kid: 'Child', car: 'Car' };
  function drawLines() {
    gLines.textContent = ''; gHandles.textContent = '';
    const E = st.E, T = st.T, th = H.heights[st.kind], ms = mirrorsFor(st.setup).map(m => prepMirror(m, E, st.he)), s = seeAt(E, st.he, ms, T, th);
    if (s.direct) el('line', { x1: E[0], y1: -E[1], x2: T[0], y2: -T[1], stroke: '#2a2f36', 'stroke-width': 0.6 }, gLines);
    const seenIn = [];
    for (const m of ms) { const r = s[m.k]; if (!r) continue; seenIn.push(m.k); el('polyline', { points: pts([E, [r[0], r[1]], T]), fill: 'none', stroke: MLINE[m.k], 'stroke-width': 0.9, 'stroke-dasharray': '2 1.2' }, gLines); }
    // handles: the viewer (a car, or a child at the walk) and the target (a child or a car); big invisible grab circles
    const eyeIsKid = st.driver.id === 'kid';
    const eyeG = el('g', { class: 'handle', 'data-h': 'E' }, gHandles);
    el('circle', { cx: E[0], cy: -E[1], r: 10, fill: 'transparent' }, eyeG);
    if (!hinted) el('circle', { class: 'pulse', cx: E[0], cy: -E[1], r: 8 }, eyeG);
    if (eyeIsKid) childIcon(eyeG, E, VIEW_COL); else carIcon(eyeG, E, EYE_HD[st.driver.id] || UP_A1, VIEW_COL, true);
    el('circle', { cx: E[0], cy: -E[1], r: 0.9, fill: '#fff', stroke: VIEW_COL, 'stroke-width': 0.4 }, eyeG);
    const tg = el('g', { class: 'handle', 'data-h': 'T' }, gHandles);
    el('circle', { cx: T[0], cy: -T[1], r: 10, fill: 'transparent' }, tg);
    if (!hinted) el('circle', { class: 'pulse', cx: T[0], cy: -T[1], r: 8 }, tg);
    const cls = s.direct ? 'direct' : seenIn.length === 2 ? 'ab' : seenIn.length ? seenIn[0].toLowerCase() : 'hidden';
    const tcol = STATE_COL[cls];
    if (st.kind === 'car') carIcon(tg, T, carHeading(T), tcol, false); else childIcon(tg, T, tcol);
    if (!tour.playing) { placeTag('E', E, 'drag me'); placeTag('T', T, 'drag me'); }
    // the status line
    const what = s.direct ? 'seen directly' : seenIn.length === 2 ? 'seen in mirrors A and B' : seenIn.length ? 'seen in mirror ' + seenIn[0] : 'hidden';
    status.innerHTML = `<i class="dot sw-${cls}"></i><b>${KIND[st.kind]}:</b> ${what}`;
    status.dataset.state = cls;
  }
  let pending = 0;
  function update(fast) {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; paint(fast ? 1.6 : 0.6); drawLines(); });
  }
  // controls (and a small API so the 3D viewer can follow the map and the other way round)
  const press = (id, v) => document.querySelectorAll(`#${id} button`).forEach(x => x.setAttribute('aria-pressed', x.dataset.v === v ? 'true' : 'false'));
  const api = window.HOAmap = { onchange: null, state: () => ({ driver: st.driver.id, setup: st.setup }) };
  const tell = () => { if (api.onchange) api.onchange(api.state()); };
  function seg(id, fn) { const box = document.getElementById(id); box.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; stopTour(); press(id, b.dataset.v); fn(b.dataset.v); tell(); }); }
  function setDriver(id) {
    const d = H.drivers.find(x => x.id === id); if (!d) return; st.driver = d; st.E = d.p.slice(); st.he = d.eye;
    const tg = H.targets;
    if (id === 'a1') { st.kind = 'kid'; st.T = tg.w4[0].p.slice(); }
    if (id === 'a2') { st.kind = 'kid'; st.T = tg.a1[2 * 3 + 0].p.slice(); }       // a child by the corner row's garages, 30 ft down A1
    if (id === 'gar') { st.kind = 'car'; st.T = tg.a2[3 * 3 + 2].p.slice(); }     // a car 40 ft down A2
    if (id === 'kid') { st.kind = 'car'; st.T = tg.a1cars[3].p.slice(); }        // a car 40 ft down A1
    press('ctl-driver', id); press('ctl-kind', st.kind);
    update();
  }
  function setSetup(v) { st.setup = v; press('ctl-setup', v); drawMirrors(); update(); }
  api.setDriver = id => { if (id !== st.driver.id) { stopTour(); setDriver(id); } };
  api.setSetup = v => { if (v !== st.setup) { stopTour(); setSetup(v); } };
  seg('ctl-setup', v => setSetup(v));
  seg('ctl-driver', v => setDriver(v));
  seg('ctl-kind', v => { st.kind = v; update(); });
  // dragging
  let drag = null;
  const toLocal = ev => { const p = top.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; const q = p.matrixTransform(top.getScreenCTM().inverse()); return [Math.max(X0 + 1, Math.min(X1 - 1, q.x)), Math.max(Y0 + 1, Math.min(Y1 - 1, -q.y))]; };
  top.addEventListener('pointerdown', ev => { const h = ev.target.closest('.handle'); if (!h) return; stopTour(); drag = h.dataset.h; host.classList.add('dragging'); top.setPointerCapture(ev.pointerId); ev.preventDefault(); });
  top.addEventListener('pointermove', ev => { if (!drag) return; endHint(); const p = toLocal(ev); if (inBuilding(p[0], p[1])) return; if (drag === 'E') st.E = p; else st.T = p; update(drag === 'E'); });
  const end = () => { if (drag) { drag = null; host.classList.remove('dragging'); update(); } };
  top.addEventListener('pointerup', end); top.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => update());

  // ---- the tour: per viewpoint, the viewer and the target move toward the turn with no mirror, then A, B and both.
  // Any press or drag by the reader stops it and leaves them in control; "Replay tour" starts it again.
  const TOUR = {
    a1: { kind: 'kid', who: 'Car from the street', V: 'the driver', E: [[11, -84], [10.9, -42]], T: [[-66.6, -26], [-66.3, -4.4], [-63.5, 3]] },
    a2: { kind: 'kid', who: 'Car from the back alley', V: 'the driver', E: [[-74, 1], [-30, 7]], T: [[-2.6, -64], [-2.7, -26]] },
    gar: { kind: 'car', who: 'Car backing out', V: 'the driver', E: [[-3.5, -28], [3, -28]], T: [[-84, -1], [-32, 6]] },
    kid: { kind: 'car', who: 'Kid from the walk', V: 'the kid', E: [[-66.6, -26], [-66.3, -6]], T: [[10.9, -104], [10.85, -50]] },
  };
  const STEPS = [];
  for (const d of ['a1', 'a2', 'gar', 'kid']) for (const s of ['none', 'A', 'B', 'both']) STEPS.push({ d, s });
  const MOVE = 3000, HOLD = 1100, SETUP_NAME = { none: 'No mirror', A: 'Mirror A', B: 'Mirror B', both: 'Both mirrors' };
  const tour = { playing: false, i: 0, t: 0, last: 0, lastPaint: 0, done: false, started: false };
  const along = (P, u) => {
    const L = []; let tot = 0; for (let k = 1; k < P.length; k++) { const l = Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]); L.push(l); tot += l; }
    let d = u * tot; for (let k = 1; k < P.length; k++) { if (d <= L[k - 1] || k === P.length - 1) { const f = Math.min(1, d / L[k - 1]); return [P[k - 1][0] + (P[k][0] - P[k - 1][0]) * f, P[k - 1][1] + (P[k][1] - P[k - 1][1]) * f]; } d -= L[k - 1]; }
    return P[P.length - 1].slice();
  };
  const ease = u => u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  function caption(step) {
    // sample the motion: is the target ever seen directly, or in a mirror while hidden directly
    const P = TOUR[step.d], d = H.drivers.find(x => x.id === step.d), th = H.heights[P.kind], TN = P.kind === 'kid' ? 'the child' : 'the car';
    let direct = 0; const via = new Set();
    for (let k = 0; k <= 24; k++) {
      const E = along(P.E, k / 24), T = along(P.T, k / 24), ms = mirrorsFor(step.s).map(m => prepMirror(m, E, d.eye)), r = seeAt(E, d.eye, ms, T, th);
      if (r.direct) direct++; else for (const m of ms) if (r[m.k]) via.add(m.k);
    }
    const name = SETUP_NAME[step.s];
    if (step.s === 'none') return direct === 0 ? `${name}: ${P.V} can't see ${TN}.` : `${name}: ${P.V} sees ${TN} only at the last moment.`;
    if (via.size) return `${name}: ${P.V} sees ${TN} in ${via.size > 1 ? 'mirrors A and B' : 'mirror ' + [...via][0]}.`;
    return `${name}: ${TN} is still hidden.`;
  }
  const tbar = { play: document.getElementById('tour-play'), step: document.getElementById('tour-step'), cap: document.getElementById('tour-cap'), dots: document.getElementById('tour-dots') };
  function tourUI() {
    if (!tbar.play) return;
    const label = tour.playing ? 'Pause' : tour.done ? 'Replay tour' : tour.started ? 'Play' : 'Play tour';
    tbar.play.dataset.state = tour.playing ? 'pause' : tour.done ? 'replay' : 'play';
    tbar.play.querySelector('span').textContent = label; tbar.play.setAttribute('aria-label', label);
    host.classList.toggle('touring', tour.playing);
    if (tbar.dots) [...tbar.dots.children].forEach((c, k) => c.className = tour.done ? '' : k < Math.floor(tour.i / 4) ? 'past' : k === Math.floor(tour.i / 4) && tour.started ? 'now' : '');
  }
  function beginStep() {
    const step = STEPS[tour.i], P = TOUR[step.d], d = H.drivers.find(x => x.id === step.d);
    st.driver = d; st.he = d.eye; st.kind = P.kind; st.setup = step.s;
    press('ctl-driver', step.d); press('ctl-kind', P.kind); press('ctl-setup', step.s); drawMirrors();
    if (tbar.step) tbar.step.textContent = `${Math.floor(tour.i / 4) + 1} of 4: ${P.who}`;
    if (tbar.cap) tbar.cap.textContent = caption(step);
    tour.lastPaint = 0; tour.final = false; tourUI();
  }
  function tick(now) {
    if (!tour.playing) return;
    tour.t += Math.min(100, now - tour.last); tour.last = now;
    if (tour.t >= MOVE + HOLD) {
      tour.i++; tour.t = 0;
      if (tour.i >= STEPS.length) { finishTour(); return; }
      beginStep();
    }
    const P = TOUR[STEPS[tour.i].d], u = Math.min(1, tour.t / MOVE), e = ease(u);
    st.E = along(P.E, e); st.T = along(P.T, e);
    if (u >= 1 && !tour.final) { tour.final = true; paint(0.6); }
    else if (u < 1 && now - tour.lastPaint > 130) { tour.lastPaint = now; paint(1.4); }
    drawLines();
    requestAnimationFrame(tick);
  }
  function playTour() {
    if (tour.done || !tour.started) { tour.i = 0; tour.t = 0; tour.done = false; tour.started = true; beginStep(); }
    tour.playing = true; tour.last = performance.now(); tourUI(); requestAnimationFrame(tick);
  }
  function pauseTour() { tour.playing = false; tourUI(); update(); }
  function finishTour() {
    tour.playing = false; tour.done = true;
    if (tbar.step) tbar.step.textContent = 'Your turn';
    if (tbar.cap) tbar.cap.textContent = 'Drag the car or the child, or pick below.';
    setSetup('both'); setDriver('a1'); tourUI(); tell();
  }
  function stopTour() {
    tour.started = true;
    if (!tour.playing && tour.done) return;
    if (tour.playing || tour.i || tour.t) { tour.playing = false; tour.done = true; if (tbar.step) tbar.step.textContent = 'Your turn'; if (tbar.cap) tbar.cap.textContent = 'Drag the car or the child.'; tourUI(); }
    else { tour.done = true; tourUI(); }
  }
  if (tbar.play) tbar.play.addEventListener('click', () => { if (tour.playing) pauseTour(); else { playTour(); } });
  api.play = () => { if (!tour.playing) playTour(); };
  api.tourCaptions = () => STEPS.map(x => TOUR[x.d].who + ' | ' + caption(x));
  // start on its own when the map comes into view, unless the reader prefers less motion
  const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!calm && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting && !tour.started) { io.disconnect(); playTour(); } }, { threshold: 0.55 });
    io.observe(host);
  }
  drawMirrors(); setDriver('a1'); tourUI();

  // ---- coverage table: per driver preset and mirror setup, the share of the approach spots seen (directly or in a mirror)
  const tb = document.getElementById('cov');
  if (tb) {
    const setups = [['none', 'None'], ['A', 'A'], ['B', 'B'], ['both', 'Both']];
    const SHORT = { a1: 'Car from the street', a2: 'Car from the back alley', gar: 'Car backing out', kid: 'Kid from the walk' };
    let html = '<thead><tr><th></th>' + setups.map(s => `<th>${s[1]}</th>`).join('') + '</tr></thead><tbody>';
    const cov = {};
    for (const d of H.drivers) {
      const T = d.looks.flatMap(k => H.targets[k]);
      html += `<tr><td>${SHORT[d.id] || d.label}</td>`;
      cov[d.id] = {};
      for (const [s] of setups) {
        const ms = mirrorsFor(s).map(m => prepMirror(m, d.p, d.eye));
        let n = 0; for (const t of T) { const r = seeAt(d.p, d.eye, ms, t.p, H.heights[t.kind]); if (r.direct || r.A || r.B) n++; }
        const pc = Math.round(100 * n / T.length); cov[d.id][s] = { n, of: T.length };
        html += `<td class="${s === 'both' ? 'rec ' : ''}${pc >= 90 ? 'good' : pc < 20 ? 'bad' : ''}">${pc}%</td>`;
      }
      html += '</tr>';
    }
    tb.innerHTML = html + '</tbody>';
    window.HOA_COVERAGE = cov;
  }
})();
