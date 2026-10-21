// ZigzagLayout: where the tunnel's arch units, turns, floors and fiberglass hoops go, in plan, from a few numbers.
// Used by plan2d.html (the fast 2D plan) and tunnel3d.html, so both draw the same layout and cloth.
//
// Frame: feet, x along the baseline from the In end, z to the right when walking In to Out (tunnel3d.html's frame).
// Each unit is a W x W square (5.9 ft: an arch set to its max width, as deep as it is wide). The walk turns at the
// 4 turns, right at odd turns and left at even ones (as in the build plan: the entrance is on the right side of
// unit 1). Parameters:
//   angle  the angle between two neighboring units' walk lines, degrees (90 = the old layout's square turns; 120 turns
//          the walk by only 60 degrees). The walk turns by 180 - angle.
//   gap    feet between the two units' inner corners at each turn (0 = they touch, as in the old layout). A fiberglass
//          hoop stands in the middle of each turn, from the middle of that gap across to the outer wall, strapped to
//          both units so it is pulled two ways.
//   gaps   per-turn gaps, keyed by turn number like bends ({ 2: 1.5 }); turns not listed use gap.
//   hoopMin the least span of a turn's fiberglass hoop (feet, 0 = none): where the outer wall is closer to the gap, the
//          hoop's outer foot stands out at this distance on the turn's middle line and the outer wall bends out to it
//          (wallPts: Po, the foot, Qo), so the passage under the hoop keeps the tunnel's width (W).
//   bends  extra turning per turn, degrees, positive to the right: { 3: 12 } turns everything after turn 3 by 12
//          degrees to the right.
//   anchor 'in' (default): the In end at [0, 0], unit 1 on the baseline. 'middle': the middle unit (3 of 5) stays put
//          at [0, 0], heading as it does with no bends, so bends at turns 1 and 2 swing the entrance side, bends at 3 and
//          4 the exit side, and a bearing turns the whole tunnel around the middle.
// With angle 90 and gap 0 it reproduces the old layout exactly (unit k's middle at x = HALF + DIAG * k, z = 0).
(function () {
  const W = 5.9, H = 7.2;
  const rad = d => d * Math.PI / 180;
  const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // a hoop of the given span, ends in sleeves at sleeveH, top at H: half an ellipse (Ramanujan)
  const hoopRod = (span, sleeveH = 3.42) => {
    const a = span / 2, b = H - sleeveH;
    return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))) / 2;
  };
  function build(o = {}) {
    const angle = o.angle != null ? o.angle : 120, gap = o.gap != null ? o.gap : 1.25, bends = o.bends || {}, n = o.units || 5, hoopMin = o.hoopMin || 0;
    const tau = 180 - angle;
    const dirOf = a => [Math.cos(rad(a)), Math.sin(rad(a))], rightOf = a => [-Math.sin(rad(a)), Math.cos(rad(a))];
    const units = [], turns = [];
    let a = -tau / 2;                                      // unit 1 heads forward-left, so turn 1 is to the right
    let d = dirOf(a), r = rightOf(a);
    let entry = add([0, 0], r, W / 2);                      // the In end is unit 1's entry-left corner, on the baseline
    for (let k = 0; k < n; k++) {
      const center = add(entry, d, W / 2), exit = add(entry, d, W);
      const corners = [add(entry, r, -W / 2), add(entry, r, W / 2), add(exit, r, W / 2), add(exit, r, -W / 2)];   // entry left, entry right, exit right, exit left
      units.push({ k: k + 1, angle: a, dir: d, right: r, center, entry, exit, corners });
      if (k === n - 1) break;
      const side = k % 2 === 0 ? 1 : -1;                    // turn k + 1: right (1) or left (-1)
      const turnDeg = side * tau + (bends[k + 1] || 0);
      const a2 = a + turnDeg, d2 = dirOf(a2), r2 = rightOf(a2);
      const b = [d[0] + d2[0], d[1] + d2[1]], bl = Math.hypot(b[0], b[1]);
      const gk = o.gaps && o.gaps[k + 1] != null ? o.gaps[k + 1] : gap;
      const P = add(exit, r, side * W / 2), Q = add(P, [b[0] / bl, b[1] / bl], gk);
      const entry2 = add(Q, r2, -side * W / 2);
      const Po = add(exit, r, -side * W / 2), Qo = add(entry2, r2, -side * W / 2);
      const hoopIn = mid(P, Q), mo = mid(Po, Qo), nat = dist(hoopIn, mo);
      const foot = hoopMin > nat ? add(hoopIn, [(mo[0] - hoopIn[0]) / nat, (mo[1] - hoopIn[1]) / nat], hoopMin) : mo;
      const wallPts = foot === mo ? [Po, Qo] : [Po, foot, Qo], span = dist(hoopIn, foot);
      turns.push({
        k: k + 1, side, turnDeg, inner: [P, Q], outer: [Po, Qo], wallPts, foot, floor: [P, ...wallPts, Q],
        gap: dist(P, Q), wall: wallPts.reduce((l, q, i) => i ? l + dist(wallPts[i - 1], q) : 0, 0), hoop: [hoopIn, foot], hoopSpan: span, hoopRod: hoopRod(span)
      });
      a = a2; d = d2; r = r2; entry = entry2;
    }
    // the walk line: through the units' entry and exit middles, across each turn
    const walk = [];
    units.forEach(u => { walk.push(u.entry, u.exit); });
    let walkLen = 0;
    for (let i = 1; i < walk.length; i++) walkLen += dist(walk[i - 1], walk[i]);
    const last = units[n - 1], outEnd = add(last.exit, last.right, ((n - 1) % 2 === 0 ? 1 : -1) * W / 2);   // its exit corner on the inner side of the turns like unit 1
    const L = { W, H, angle, gap, anchor: 'in', units, turns, walk, walkLen, inEnd: [0, 0], outEnd, runLen: dist([0, 0], outEnd) };
    return o.anchor === 'middle' ? toMiddle(L, tau) : L;
  }
  // the same layout moved so the middle unit sits at [0, 0] with its no-bend heading (a rigid move: sizes stay)
  function toMiddle(L, tau) {
    const i = Math.floor(L.units.length / 2), m = L.units[i], c = m.center;
    const phi = (i % 2 === 0 ? -tau / 2 : tau / 2) - m.angle, cs = Math.cos(rad(phi)), sn = Math.sin(rad(phi));
    const v = q => [q[0] * cs - q[1] * sn, q[0] * sn + q[1] * cs], p = q => v([q[0] - c[0], q[1] - c[1]]);
    L.units.forEach(u => {
      Object.assign(u, { angle: u.angle + phi, dir: v(u.dir), right: v(u.right), center: p(u.center), entry: p(u.entry), exit: p(u.exit), corners: u.corners.map(p) });
    });
    L.turns.forEach(t => { ['inner', 'outer', 'floor', 'hoop', 'wallPts'].forEach(k => { t[k] = t[k].map(p); }); t.foot = t.hoop[1]; });
    return Object.assign(L, { anchor: 'middle', middle: i + 1, walk: L.walk.map(p), inEnd: p(L.inEnd), outEnd: p(L.outEnd) });
  }
  // The cloth plan (2026-10-18): 6 ft x 50 ft frost-cloth rolls, laid as one roof strip along the top plus long side strips
  // that stand 6 ft tall around the outside (box sides, each turn's outer wall out to the hoop foot, and straight across
  // the gaps between inner corners). Side lengths are along the ground. Options:
  //   roll    roll length (50)
  //   double  the side with two layers (-1 left, 1 right, 0 none). One roll starts at the In end, the other ends at the
  //           Out end, so the side is double except for (length - roll) at each end.
  //   exit    { turn, half: 0 box k's half | 1 box k+1's half } the emergency exit: the strip on that turn's outer wall is
  //           cut at the hoop foot and the piece over the opening overlaps the other one by overlap ft (a flap).
  //   overlap ft that joined pieces overlap (1)
  //   roofPath 'outer' (default, the user's pick of 2026-10-19): at each turn the roof's outer edge runs the whole outer
  //           wall at the 6 ft cord and its inside is gathered into pleats toward the inner gap, so a turn takes as much
  //           roof as its outer wall is long (cloth doesn't stretch; the middle line over a turn is only 4.5 to 6.3 ft
  //           while the outer wall is 7 to 11 ft). The roof starts at the In end; where the roll runs out, the end
  //           roll finishes it ('roof end', lapping overlap ft under the roll's end).
  //   endRoll  length of the extra roll for the roof's end (25: the user buys a 6 x 25 ft piece for it, 2026-10-19)
  //           'middle': the roof follows the middle line (49'8" on the 2026-10-18 layout) and its outer edge lifts off
  //           over each turn, so each turn's outer top needs a cap from other cloth (caps below).
  //   capDepth, capLap  ('middle' only) the caps: how deep (4.5 ft) and how far past each end of the outer wall (1 ft).
  //           A cap hangs 6 in over the side strip's top at the 6 ft cord, runs up over the hoop's outer half and the two
  //           end arches' outer flanks and tucks 1 ft under the roof. caps[i] = { turn, along, depth, pts (plan) }.
  // The roof's pts are its middle line (plan); its marks' at and len are cloth length along it.
  // Returns { roof, sides: {'-1', '1'}, pieces, rolls, caps, ok }. Each strip has pts (plan polyline), len and marks
  // [{ name, at }] (distance from its In end); each piece { name, strip, from, to, len, layer, roll, marks } with marks
  // measured from the piece's own start.
  function cloth(L, o = {}) {
    const roll = o.roll || 50, dbl = o.double != null ? o.double : -1, ov = o.overlap != null ? o.overlap : 1;
    const outer = o.roofPath !== 'middle';
    const strip = pts => { let at = 0; pts.forEach((p, i) => { if (i) at += p.len != null ? p.len : dist(pts[i - 1].p, p.p); p.at = at; }); return { pts: pts.map(p => p.p), len: at, marks: pts.map(p => ({ name: p.name, at: p.at })) }; };
    function side(s) {
      const pts = [], push = (p, name) => { const q = pts[pts.length - 1]; if (q && dist(q.p, p) < 1e-6) q.name += ' / ' + name; else pts.push({ p, name }); };
      L.units.forEach((u, i) => {
        const [a, b] = s < 0 ? [u.corners[0], u.corners[3]] : [u.corners[1], u.corners[2]];
        push(a, `box ${u.k} start`); push(b, `box ${u.k} end`);
        const t = L.turns[i];
        if (t && t.side !== s) t.wallPts.slice(1, -1).forEach(p => push(p, `T${t.k} hoop foot`));
      });
      return strip(pts);
    }
    const rp = [];
    L.units.forEach((u, i) => {
      const t = L.turns[i - 1], w = t && t.wallPts, leg2 = !t ? 0 : w.length === 3 ? dist(w[1], w[2]) : t.wall / 2;
      rp.push({ p: u.entry, name: `box ${u.k} start`, len: outer && t ? leg2 : null }, { p: u.exit, name: `box ${u.k} end` });
      const n = L.turns[i], nw = n && n.wallPts;
      if (n) rp.push({ p: mid(n.hoop[0], n.hoop[1]), name: `T${n.k} hoop`, len: outer ? (nw.length === 3 ? dist(nw[0], nw[1]) : n.wall / 2) : null });
    });
    const roof = strip(rp), sides = { '-1': side(-1), '1': side(1) };
    const sideName = s => (s < 0 ? 'left' : 'right');
    // pieces: the roof; each side as one or more roll lengths (joined with an overlap), or two full layers on the double side
    let pieces = [];
    const run = (name, key, len, layer) => {
      const out = [];
      if (len <= roll + 1e-9) out.push({ name, strip: key, from: 0, to: len, layer });
      else for (let a = 0, i = 1; a < len - 1e-9; a += roll - ov, i++) out.push({ name: `${name} ${i}`, strip: key, from: a, to: Math.min(len, a + roll), layer });
      return out;
    };
    const endRoll = o.endRoll != null ? o.endRoll : 25;
    if (roof.len > roll && endRoll && roof.len - roll + ov <= endRoll) pieces.push({ name: 'roof', strip: 'roof', from: 0, to: roll, layer: 1 }, { name: 'roof end', strip: 'roof', from: roll - ov, to: roof.len, layer: 1, endRoll: true });
    else pieces.push(...run('roof', 'roof', roof.len, 1));
    [-1, 1].forEach(s => {
      const S = sides[s], n = sideName(s);
      if (s === dbl) {
        if (S.len > 2 * roll) pieces.push(...run(n, String(s), S.len, 1), ...run(n + ' outer', String(s), S.len, 2));
        else pieces.push({ name: n + ' inner layer', strip: String(s), from: 0, to: Math.min(roll, S.len), layer: 1 }, { name: n + ' outer layer', strip: String(s), from: Math.max(0, S.len - roll), to: S.len, layer: 2 });
      } else pieces.push(...run(n, String(s), S.len, 1));
    });
    // the emergency exit: cut every piece on that wall at the hoop foot; the piece over the opening laps over the other
    let exit = null;
    if (o.exit && o.exit.turn && L.turns[o.exit.turn - 1]) {
      const t = L.turns[o.exit.turn - 1], s = -t.side, S = sides[s];
      const m = S.marks.find(m => m.name.includes(`T${t.k} hoop foot`)) || S.marks.find(m => m.name.includes(`box ${t.k} end`));
      const at = m.at, half = o.exit.half ? 1 : 0;
      exit = { turn: t.k, side: s, at, half };
      pieces = pieces.flatMap(p => {
        if (p.strip !== String(s) || p.from >= at - 1e-6 || p.to <= at + 1e-6) return [p];
        return half ? [Object.assign({}, p, { name: p.name + ' A', to: at }), Object.assign({}, p, { name: p.name + ' B (exit flap)', from: Math.max(p.from, at - ov) })]
          : [Object.assign({}, p, { name: p.name + ' A (exit flap)', to: Math.min(p.to, at + ov) }), Object.assign({}, p, { name: p.name + ' B', from: at })];
      });
    }
    const all = { roof, '-1': sides[-1], '1': sides[1] };
    pieces.forEach(p => { p.len = p.to - p.from; p.marks = all[p.strip].marks.filter(m => m.at >= p.from - 1e-6 && m.at <= p.to + 1e-6).map(m => ({ name: m.name, at: m.at - p.from })); });
    // rolls: the longest pieces first, each into the first roll it still fits
    const rolls = [];
    [...pieces].filter(p => !p.endRoll).sort((a, b) => b.len - a.len).forEach(p => {
      if (p.len > roll + 1e-6) { p.roll = 0; return; }
      let r = rolls.find(r => r.used + p.len <= roll + 1e-6);
      if (!r) rolls.push(r = { n: rolls.length + 1, used: 0, pieces: [] });
      r.used += p.len; r.pieces.push(p.name); p.roll = r.n;
    });
    // numbered in the pieces' order (roof first, then left, then right)
    const first = r => Math.min(...r.pieces.map(n => pieces.findIndex(p => p.name === n)));
    pieces.filter(p => p.endRoll).forEach(p => rolls.push({ n: 0, size: endRoll, used: p.len, pieces: [p.name] }));
    rolls.sort((a, b) => (a.size ? 1 : 0) - (b.size ? 1 : 0) || first(a) - first(b)).forEach((r, i) => { r.n = i + 1; r.size = r.size || roll; r.spare = r.size - r.used; r.pieces.forEach(n => { pieces.find(p => p.name === n).roll = r.n; }); r.pieces.sort((a, b) => pieces.findIndex(p => p.name === a) - pieces.findIndex(p => p.name === b)); });
    const cd = o.capDepth || 4.5, cl = o.capLap != null ? o.capLap : 1;
    const caps = outer ? [] : L.turns.map((t, i) => {
      const u = L.units[i], v = L.units[i + 1], [Pi, Q] = t.inner, J = t.hoop[0], H = mid(J, t.hoop[1]);
      const to = (a, b, d) => { const l = dist(a, b) || 1; return [a[0] + (b[0] - a[0]) / l * d, a[1] + (b[1] - a[1]) / l * d]; };
      return { turn: t.k, along: t.wall + 2 * cl, depth: cd, pts: [...t.wallPts, to(v.entry, Q, cl), to(H, J, cl), to(u.exit, Pi, cl)] };
    });
    return { roll, double: dbl, overlap: ov, roofPath: outer ? 'outer' : 'middle', roof, sides, pieces, rolls, caps, exit, ok: pieces.every(p => p.roll) };
  }
  // local (x along, z right) to site feet (X east, Y north) for a tunnel placed at inEnd with the given bearing
  // (degrees clockwise from north, In to Out), as tunnel3d.html does
  function toSite(p, inEnd, bearing) {
    const t = rad(bearing), AL = [Math.sin(t), Math.cos(t)], RT = [Math.cos(t), -Math.sin(t)];
    return [inEnd[0] + p[0] * AL[0] + p[1] * RT[0], inEnd[1] + p[0] * AL[1] + p[1] * RT[1]];
  }
  const api = { W, H, build, cloth, toSite, hoopRod, VERSION: '1.6.0' };
  if (typeof window !== 'undefined') window.ZigzagLayout = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
