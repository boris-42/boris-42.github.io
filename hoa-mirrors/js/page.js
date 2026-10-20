// The install cards (from js/data.js) and the renders (from js/renders.js).
(function () {
  'use strict';
  const H = window.HOA, P = window.HOAplan;
  const ftin = ft => { const i = Math.round(Math.abs(ft) * 12), f = Math.floor(i / 12), r = i % 12; return r ? `${f} ft ${r} in` : `${f} ft`; };
  const TURN_CORNER = (() => { // the corner building's corner at the turn: the end wall's point nearest the origin
    const I = H.install.A.hit; const a = I.a, b = I.b; return Math.hypot(a[0], a[1]) < Math.hypot(b[0], b[1]) ? a : b; })();
  function landmark(hit) {
    const along = Math.abs(hit.b[1] - hit.a[1]) > Math.abs(hit.b[0] - hit.a[0]);
    const d = Math.hypot(hit.point[0] - TURN_CORNER[0], hit.point[1] - TURN_CORNER[1]);
    return along ? `the garage wall of the corner building along A1, about ${ftin(d)} from its corner at the turn`
      : `the end wall of the corner building (the wall facing the turn), about ${ftin(d)} from its corner at A1`;
  }
  function mini(m, k, inst) {
    const svg = P.el('svg', { class: 'mini', role: 'img', 'aria-label': `Plan around mirror ${k} with its facing arrow` });
    const c = m.rim, half = 30, vb = [c[0] - half, -(c[1] + half), 2 * half, 2 * half];
    svg.setAttribute('viewBox', vb.join(' '));
    const g = P.el('g', {}, svg); P.drawBase(g);
    const t = P.el('g', {}, svg); P.drawTop(t, { labels: false });
    const f = H.fixtures.hydrant; P.text(t, f[0] + 1.4, f[1] - 0.6, 'hydrant', 2.4, 'start');
    // the facing arrow to the landmark
    const e = inst.hit ? inst.hit.point : [c[0] + m.ax[0] * 30, c[1] + m.ax[1] * 30];
    const col = P.MCOL[k];
    P.el('line', { x1: c[0], y1: -c[1], x2: e[0], y2: -e[1], stroke: col, 'stroke-width': 0.7, 'stroke-dasharray': '2 1' }, t);
    const dx = e[0] - c[0], dy = e[1] - c[1], l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l, ah = [e[0] - ux * 2.6, e[1] - uy * 2.6];
    P.el('polygon', { points: P.pts([e, [ah[0] - uy * 1.3, ah[1] + ux * 1.3], [ah[0] + uy * 1.3, ah[1] - ux * 1.3]]), fill: col }, t);
    P.drawMirror(t, m, k, false, 0.8);
    P.text(t, c[0] - half + 2, c[1] + half - 4, `faces ${inst.yaw} deg`, 3, 'start', 650);
    return svg;
  }
  function card(title, k, m, inst, extra) {
    const div = document.createElement('div'); div.className = 'card';
    const pole = m.mount === 'pole';
    const where = pole
      ? `<li><b>Where:</b> in the island lawn by the hydrant. From the hydrant's center, go ${ftin(inst.alongCurbFromHydrantFt)} along the island's curb toward A2, then ${ftin(inst.curbFt)} in from the curb face. That keeps the post ${ftin(inst.hydrantFt)} from the hydrant (keep at least 3 ft clear).</li>
         <li><b>Post:</b> 8 ft, 2 in galvanized round post, 2 ft deep in concrete, so 6 ft stands above the lawn. Call 811 before digging: the hydrant's water line runs under this island.</li>
         <li><b>Height:</b> center 4 ft 6 in over the lawn, so the frame runs from 3 ft 6 in to 5 ft 6 in (visor about 5 ft 8 in), under the post top at 6 ft. Collar clamp on the post.</li>`
      : `<li><b>Where:</b> on the garage wall of the building across the turn, on the wall between its first two garage doors (counting from A1): center ${ftin(inst.door1EdgeFt)} past the edge of the first door and ${ftin(inst.door2EdgeFt)} before the second (that wall section is about ${ftin(inst.pierFt)} wide), ${ftin(inst.cornerFt)} from the building's corner at A1. Measure on site and center it on that wall section.</li>
         <li><b>Bracket:</b> the L wall plate with four anchors into the framing behind the stucco, holes sealed. Needs the owner's and the HOA's OK.</li>
         <li><b>Height:</b> center 4 ft 6 in over the pavement, frame from 3 ft 6 in to 5 ft 6 in.</li>`;
    div.innerHTML = `<h4>${title}</h4><ul>${where}
      <li><b>Facing:</b> compass bearing ${inst.yaw} deg (true north). Its center points at ${inst.hit ? landmark(inst.hit) : 'the turn'}.</li>
      <li><b>Tilt:</b> ${Math.abs(inst.tilt)} deg down: the top edge sits about ${inst.topForwardIn} in further out than the bottom edge.</li>${extra || ''}</ul>`;
    div.insertBefore(mini(m, k, inst), div.querySelector('ul'));
    return div;
  }
  const ic = document.getElementById('install-cards');
  if (ic) {
    const S = H.mirrors.single, J = H.mirrors.joint, I = H.install;
    const tree = '<li><b>Clearance:</b> keep the post on the lawn just east of the hedge end. The maple\'s lowest limbs pass about 1 to 2 ft above the mirror\'s top edge; check on site.</li>';
    const sec = (h, p, cards) => { const w = document.createElement('div'); w.innerHTML = `<h3>${h}</h3><p>${p}</p>`; const g = document.createElement('div'); g.className = 'cards'; cards.forEach(c => g.appendChild(c)); w.appendChild(g); ic.appendChild(w); };
    sec('Option A alone: post on the island', 'One mirror that serves both approaches, aimed between them.', [card('Mirror A (post)', 'A', S.A, I.A, tree)]);
    sec('Option B alone: on the garage wall across the turn', 'One mirror that serves both approaches, aimed between them.', [card('Mirror B (wall)', 'B', S.B, I.B)]);
    sec('Both mirrors, aimed together', 'With two mirrors each one can favor one approach, so together they leave no approach spot hidden in the plan. Use these aims, not the single-mirror ones.', [card('Mirror A (post), with B', 'A', J.A, I.bothA, tree), card('Mirror B (wall), with A', 'B', J.B, I.bothB)]);
  }
  // coverage summary
  const cs = document.getElementById('cov-sum'), C = window.HOA_COVERAGE;
  if (cs && C) {
    const f = (d, s) => `${C[d][s].n} of ${C[d][s].of}`;
    cs.textContent = `Driving up A1: ${f('a1', 'none')} spots with no mirror, ${f('a1', 'A')} with A, ${f('a1', 'B')} with B, ${f('a1', 'both')} with both. Driving down A2: ${f('a2', 'none')}, ${f('a2', 'A')}, ${f('a2', 'B')}, ${f('a2', 'both')}.`;
  }
  // renders
  const rl = document.getElementById('render-list'), R = window.HOA_RENDERS;
  if (rl) {
    if (!R || !R.situations.length) { rl.innerHTML = '<div class="placeholder">The renders are still being made. This section fills in when they are done.</div>'; return; }
    if (!R.complete) rl.insertAdjacentHTML('beforeend', '<p class="note">Some renders are still being made; more will appear here.</p>');
    const NAMES = { none: 'No mirror', A: 'Mirror A only (post)', B: 'Mirror B only (wall)', both: 'Both mirrors (aimed together)' };
    for (const s of R.situations) {
      const d = document.createElement('div'); d.className = 'sit';
      let h = `<h3>${s.title}</h3><p>${s.text}</p><div class="opts">`;
      for (const o of ['none', 'A', 'B', 'both']) {
        const v = s.opts[o]; if (!v || !v.wide) continue;
        h += `<div class="opt"><h4>${NAMES[o]}</h4><a href="${v.wide.full}"><img loading="lazy" src="${v.wide.src}" alt="${s.title}: ${NAMES[o]}" width="1400" height="788"></a>`;
        const z = Object.keys(v.zoom).sort();
        if (z.length) h += '<div class="zooms">' + z.map(k => `<figure><a href="${v.zoom[k].full}"><img loading="lazy" src="${v.zoom[k].src}" alt="Close-up of mirror ${k}" width="800" height="800"></a><figcaption>Mirror ${k}${v.zoom[k].distFt ? ', ' + Math.round(v.zoom[k].distFt) + ' ft away' : ''}</figcaption></figure>`).join('') + '</div>';
        h += '</div>';
      }
      d.innerHTML = h + '</div>'; rl.appendChild(d);
    }
  }
})();
