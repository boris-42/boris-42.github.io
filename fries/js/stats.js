/* Fries timer: stats page. Everything is computed from the raw telemetry events in localStorage. */
(function () {
  'use strict';
  const F = window.Fries;
  const { h, fmtDur, fmtDev } = F;
  const ALL = '__all__';

  const daySel = document.getElementById('day');
  const out = document.getElementById('out');
  const storageEl = document.getElementById('storage');

  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const lateOf = (s) => (s.lateMs != null ? s.lateMs : s.toleranceMs || 0);
  const windowText = (s) => s.lateMs != null
    ? `−${Math.round((s.earlyMs || 0) / 1000)}/+${Math.round(s.lateMs / 1000)}s`
    : `±${Math.round((s.toleranceMs || 0) / 1000)}s`;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '–');

  function loadEvents(day) {
    const days = day === ALL ? F.listDays() : [day];
    const evs = [];
    days.forEach((d) => evs.push(...F.readDay(d)));
    return evs.sort((a, b) => a.t - b.t);
  }

  function fryerNames() {
    const cfg = F.loadStoredConfig();
    return { L: cfg.fryers.L.name, R: cfg.fryers.R.name };
  }

  function analyze(events) {
    const acc = {};
    F.FRYERS.forEach((id) => {
      acc[id] = { cycles: [], resets: [], cancelled: [], breaks: [], blocked: 0, presses: 0, taps: 0, ignored: 0, holdMs: [], lateAlerts: 0 };
    });
    for (const e of events) {
      const a = acc[e.fryer];
      if (!a) continue;
      if (e.type === 'cycle_end') a.cycles.push(e);
      else if (e.type === 'cycle_reset') (e.startedByThisPress ? a.cancelled : a.resets).push(e);
      else if (e.type === 'idle_reset') a.cancelled.push(e);
      else if (e.type === 'break_end') a.breaks.push(e);
      else if (e.type === 'cycle_cancelled') a.cancelledStarts = (a.cancelledStarts || 0) + 1;
      else if (e.type === 'press_blocked') a.blocked++;
      else if (e.type === 'pedal_down') { if (e.source === 'pedal') a.presses++; else a.taps++; }
      else if (e.type === 'pedal_up' && typeof e.heldMs === 'number') a.holdMs.push(e.heldMs);
      else if (e.type === 'press_ignored') a.ignored++;
      else if (e.type === 'alert' && e.level === 'late') a.lateAlerts++;
    }
    for (const id of F.FRYERS) {
      const a = acc[id];
      const c = a.cycles;
      a.totals = c.map((x) => x.totalMs);
      a.devs = c.map((x) => x.devMs);
      a.stepsAll = c.flatMap((x) => x.steps || []);
      a.onTime = a.stepsAll.filter((s) => s.status === 'on_time').length;
      a.early = a.stepsAll.filter((s) => s.status === 'early').length;
      a.late = a.stepsAll.filter((s) => s.status === 'late').length;
      a.perfect = c.filter((x) => x.onTimeSteps === x.stepCount).length;
      // waiting between batches vs. waiting before the first batch of a session
      a.idleBetween = c.filter((x) => x.idleReason !== 'session_start' && x.idleBeforeMs != null).map((x) => x.idleBeforeMs);
      a.idleFirst = c.filter((x) => x.idleReason === 'session_start' && x.idleBeforeMs != null).map((x) => x.idleBeforeMs);
      if (c.length) {
        a.first = c[0].cycleStart || c[0].t - c[0].totalMs;
        a.lastEnd = c[c.length - 1].t;
        a.busyMs = a.totals.reduce((x, y) => x + y, 0);
        a.utilization = a.lastEnd > a.first ? a.busyMs / (a.lastEnd - a.first) : null;
      }
      // per step (grouped by position + name)
      const groups = new Map();
      for (const s of a.stepsAll) {
        const k = `${s.step}|${s.name}`;
        if (!groups.has(k)) groups.set(k, { step: s.step, name: s.name, targetMs: s.targetMs, win: s, list: [] });
        groups.get(k).list.push(s);
      }
      a.perStep = [...groups.values()].sort((x, y) => x.step - y.step || x.name.localeCompare(y.name));
    }
    return acc;
  }

  function kv(pairs) {
    return h('dl', { class: 'kv' }, pairs.map(([k, v, cls]) => [h('dt', null, k), h('dd', { class: cls || null }, v)]));
  }

  function fryerCard(id, a, name) {
    const n = a.cycles.length;
    const breakMs = a.breaks.map((b) => b.durationMs || 0);
    const side = id === 'L' ? 'left' : 'right';
    const title = name.toLowerCase().includes(side) ? name : `${name} (${side})`;
    return h('div', { class: `card side-${id}` },
      h('h3', null, title),
      kv([
        ['Rounds done', String(n)],
        ['Steps in time', `${pct(a.onTime, a.stepsAll.length)}  (${a.onTime}/${a.stepsAll.length})`, a.stepsAll.length && a.onTime === a.stepsAll.length ? 'good' : null],
        ['Mistakes per round (late steps)', n ? ((a.stepsAll.length - a.onTime) / n).toFixed(2) : '–', a.late ? 'bad' : null],
        ['Average miss per step', a.stepsAll.length ? (avg(a.stepsAll.map((s) => Math.abs(s.devMs))) / 1000).toFixed(1) + 's' : '–'],
        ['Early tries (pedal refused)', String(a.blocked), a.blocked ? 'warn' : null],
        ['Perfect rounds', `${pct(a.perfect, n)}  (${a.perfect}/${n})`],
        ['Round time avg / median', `${fmtDur(avg(a.totals))} / ${fmtDur(median(a.totals))}`],
        ['Wait between rounds avg / median / max', `${fmtDur(avg(a.idleBetween))} / ${fmtDur(median(a.idleBetween))} / ${fmtDur(a.idleBetween.length ? Math.max(...a.idleBetween) : null)}`],
        ['Wait before first round', a.idleFirst.length ? a.idleFirst.map((x) => fmtDur(x)).join(', ') : '–'],
        ['Breaks: count / total / avg', a.breaks.length ? `${a.breaks.length} / ${fmtDur(breakMs.reduce((x, y) => x + y, 0))} / ${fmtDur(avg(breakMs))}` : '0'],
        ['First start / last end', n ? `${F.fmtTime(a.first)} / ${F.fmtTime(a.lastEnd)}` : '–'],
        ['Frying busy time', n ? `${fmtDur(a.busyMs)} (${a.utilization != null ? Math.round(a.utilization * 100) + '% of span' : '–'})` : '–'],
        ['Rounds reset / aborted', String(a.resets.length), a.resets.length ? 'warn' : null],
        ['Idle resets', String(a.cancelled.length)],
        ['Pedal presses / button presses', `${a.presses} / ${a.taps}`],
        ['Ignored double presses', String(a.ignored), a.ignored ? 'warn' : null],
        ['Late alarms', String(a.lateAlerts), a.lateAlerts ? 'bad' : null],
      ])
    );
  }

  function perStepTable(a) {
    if (!a.perStep.length) return h('p', { class: 'muted' }, 'No completed rounds.');
    return h('table', null,
      h('thead', null, h('tr', null, ['#', 'Step', 'Target', 'n', 'Avg actual', 'Avg deviation', 'Avg |deviation|', 'On time', 'Early', 'Late', 'Worst late'].map((x) => h('th', null, x)))),
      h('tbody', null, a.perStep.map((g) => {
        const devs = g.list.map((s) => s.devMs);
        const ok = g.list.filter((s) => s.status === 'on_time').length;
        const early = g.list.filter((s) => s.status === 'early').length;
        const late = g.list.filter((s) => s.status === 'late').length;
        const worst = Math.max(...devs);
        return h('tr', null,
          h('td', null, String(g.step + 1)),
          h('td', null, g.name),
          h('td', null, `${fmtDur(g.targetMs)} ${windowText(g.win)}`),
          h('td', null, String(g.list.length)),
          h('td', null, fmtDur(avg(g.list.map((s) => s.actualMs)))),
          h('td', null, fmtDev(avg(devs))),
          h('td', null, fmtDev(avg(devs.map(Math.abs))).replace(/^[+±]/, '')),
          h('td', { class: ok === g.list.length ? 'good' : null }, pct(ok, g.list.length)),
          h('td', { class: early ? 'warn' : null }, String(early)),
          h('td', { class: late ? 'bad' : null }, String(late)),
          h('td', { class: worst > lateOf(g.win) ? 'bad' : null }, worst > 0 ? fmtDev(worst) : '–'));
      })));
  }

  function hourly(acc) {
    const counts = {};
    for (const id of F.FRYERS) {
      for (const c of acc[id].cycles) {
        const d = new Date(c.cycleStart || c.t);
        const k = `${F.dayKey(d.getTime())} ${F.pad(d.getHours())}:00`;
        counts[k] = counts[k] || { L: 0, R: 0 };
        counts[k][id]++;
      }
    }
    const keys = Object.keys(counts).sort();
    if (!keys.length) return h('p', { class: 'muted' }, 'No completed rounds.');
    const max = Math.max(...keys.flatMap((k) => [counts[k].L, counts[k].R]));
    const multiDay = new Set(keys.map((k) => k.slice(0, 10))).size > 1;
    return h('div', null,
      h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background:#4fd2f0' }), 'Left'), h('span', null, h('i', { style: 'background:#a99dff' }), 'Right')),
      h('div', { class: 'bars' }, keys.map((k) => h('div', { class: 'row' },
        h('span', { class: 'muted' }, multiDay ? k.slice(5) : k.slice(11)),
        h('div', { class: 'pair' }, F.FRYERS.map((id) => h('div', {
          class: `bar ${id}`, title: `${id}: ${counts[k][id]} batches`,
          style: `width:${(counts[k][id] / max) * 100}%`,
        })))))));
  }

  function cyclesTable(events, names) {
    const rows = events.filter((e) => e.type === 'cycle_end' || e.type === 'cycle_reset' || e.type === 'break_end').reverse();
    if (!rows.length) return h('p', { class: 'muted' }, 'No rounds yet.');
    return h('div', { class: 'scroll' }, h('table', null,
      h('thead', null, h('tr', null, ['Start', 'Fryer', 'Waited before', 'Steps (actual, deviation)', 'Total', 'Result'].map((x) => h('th', null, x)))),
      h('tbody', null, rows.map((e) => {
        if (e.type === 'break_end') {
          return h('tr', { class: 'muted' },
            h('td', null, F.fmtTime(e.breakStart || e.t - e.durationMs)),
            h('td', null, names[e.fryer] || e.fryer),
            h('td', null, '–'),
            h('td', null, 'Break'),
            h('td', null, fmtDur(e.durationMs)),
            h('td', null, `break (ended by ${e.how})`));
        }
        const reset = e.type === 'cycle_reset';
        const start = reset ? e.t - e.cycleElapsedMs : (e.cycleStart || e.t - e.totalMs);
        return h('tr', null,
          h('td', null, F.fmtTime(start)),
          h('td', null, names[e.fryer] || e.fryer),
          h('td', null, reset ? '–' : `${fmtDur(e.idleBeforeMs)}${e.idleReason === 'session_start' ? ' (first)' : ''}`),
          h('td', null, (e.steps || []).map((s) => h('span', { class: `pill ${s.status}`, title: `target ${fmtDur(s.targetMs)} ${windowText(s)}` },
            `${s.name} ${fmtDur(s.actualMs)} (${fmtDev(s.devMs)})`))),
          h('td', null, reset ? fmtDur(e.cycleElapsedMs) : `${fmtDur(e.totalMs)} (${fmtDev(e.devMs)})`),
          h('td', { class: reset ? 'warn' : e.onTimeSteps === e.stepCount ? 'good' : 'bad' },
            reset ? (e.startedByThisPress ? 'idle reset (hold while waiting)' : `reset (${e.how}) at step ${e.step + 1}`) : `${e.onTimeSteps}/${e.stepCount} on time`));
      }))));
  }

  function rawLog(events, names) {
    const MAX = 2000;
    const list = events.slice(-MAX).reverse();
    const skip = new Set(['t', 'iso', 'local', 'type', 'fryer', 'sid', 'v']);
    return h('details', null,
      h('summary', null, `Raw events: ${events.length}${events.length > MAX ? ` (newest ${MAX} shown, export for all)` : ''}`),
      h('div', { class: 'scroll' }, h('table', null,
        h('thead', null, h('tr', null, ['Time', 'Fryer', 'Event', 'Details'].map((x) => h('th', null, x)))),
        h('tbody', null, list.map((e) => {
          const rest = {};
          for (const [k, v] of Object.entries(e)) if (!skip.has(k)) rest[k] = v;
          let txt = JSON.stringify(rest);
          if (txt.length > 300) txt = txt.slice(0, 300) + '…';
          return h('tr', null,
            h('td', null, (e.local || '').slice(11) || F.fmtTime(e.t)),
            h('td', null, e.fryer ? names[e.fryer] || e.fryer : ''),
            h('td', null, e.type),
            h('td', null, h('code', null, txt)));
        })))));
  }

  function render() {
    const day = daySel.value;
    const events = loadEvents(day);
    const names = fryerNames();
    const acc = analyze(events);
    out.textContent = '';
    if (!events.length) {
      out.append(h('p', { class: 'muted' }, 'No telemetry for this day yet. Use the fryer screen and come back.'));
    } else {
      out.append(
        h('div', { class: 'cards' }, F.FRYERS.map((id) => fryerCard(id, acc[id], names[id]))),
        h('h2', null, 'Rounds per hour'), hourly(acc),
        ...F.FRYERS.flatMap((id) => [h('h2', null, `Per step: ${names[id]}`), perStepTable(acc[id])]),
        h('h2', null, 'Rounds and breaks (newest first)'), cyclesTable(events, names),
        h('h2', null, 'Telemetry'), rawLog(events, names)
      );
    }
    const kb = Math.round(F.storageBytes() / 1024);
    storageEl.textContent = `Browser storage used: ${kb} KB of roughly 5,000 KB. Export and delete old days when it gets near the limit.`;
  }

  function fillDays(keep) {
    const days = F.listDays();
    const today = F.dayKey(Date.now());
    if (!days.includes(today)) days.unshift(today);
    daySel.textContent = '';
    days.forEach((d) => daySel.append(h('option', { value: d }, d === today ? `${d} (today)` : d)));
    daySel.append(h('option', { value: ALL }, 'All days'));
    daySel.value = keep && [...daySel.options].some((o) => o.value === keep) ? keep : today;
  }

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCsv() {
    const day = daySel.value;
    const events = loadEvents(day);
    const names = fryerNames();
    const head = ['date', 'batch_start', 'fryer', 'fryer_name', 'batch_id', 'waited_before_s', 'wait_kind', 'step_no', 'step_name',
      'target_s', 'early_ok_s', 'late_after_s', 'actual_s', 'deviation_s', 'status', 'source', 'batch_total_s', 'batch_deviation_s', 'batch_result'];
    const lines = [head.join(',')];
    for (const e of events) {
      if (e.type !== 'cycle_end' && e.type !== 'cycle_reset') continue;
      const reset = e.type === 'cycle_reset';
      const start = reset ? e.t - e.cycleElapsedMs : (e.cycleStart || e.t - e.totalMs);
      const steps = e.steps && e.steps.length ? e.steps : [null];
      for (const s of steps) {
        lines.push([
          F.dayKey(start), F.fmtTime(start), e.fryer, names[e.fryer], e.cycleId,
          reset ? '' : e.idleBeforeMs != null ? (e.idleBeforeMs / 1000).toFixed(1) : '', reset ? '' : e.idleReason,
          s ? s.step + 1 : '', s ? s.name : '',
          s ? (s.targetMs / 1000).toFixed(1) : '',
          s ? (((s.earlyMs != null ? s.earlyMs : s.toleranceMs) || 0) / 1000).toFixed(1) : '',
          s ? (lateOf(s) / 1000).toFixed(1) : '',
          s ? (s.actualMs / 1000).toFixed(2) : '', s ? (s.devMs / 1000).toFixed(2) : '', s ? s.status : '', s ? s.source : '',
          ((reset ? e.cycleElapsedMs : e.totalMs) / 1000).toFixed(2), reset ? '' : (e.devMs / 1000).toFixed(2),
          reset ? `reset:${e.how}` : `${e.onTimeSteps}/${e.stepCount}`,
        ].map(csvCell).join(','));
      }
    }
    F.download(`fries-steps-${day === ALL ? 'all' : day}.csv`, lines.join('\n'), 'text/csv');
  }

  function exportJson() {
    const day = daySel.value;
    const payload = { exportedAt: new Date().toISOString(), app: F.APP_VERSION, day, config: F.loadStoredConfig(), events: loadEvents(day) };
    F.download(`fries-events-${day === ALL ? 'all' : day}.json`, JSON.stringify(payload, null, 1));
  }

  document.getElementById('refresh').addEventListener('click', () => { fillDays(daySel.value); render(); });
  document.getElementById('exportCsv').addEventListener('click', exportCsv);
  document.getElementById('exportJson').addEventListener('click', exportJson);
  document.getElementById('deleteDay').addEventListener('click', () => {
    const day = daySel.value;
    const label = day === ALL ? 'ALL days' : day;
    if (!confirm(`Delete all telemetry for ${label}? Export it first if you need it. This cannot be undone.`)) return;
    (day === ALL ? F.listDays() : [day]).forEach(F.deleteDay);
    fillDays();
    render();
  });
  daySel.addEventListener('change', render);
  // live update while the fryer screen runs in another tab
  let pending = null;
  addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(F.KEYS.eventsPrefix)) return;
    clearTimeout(pending);
    pending = setTimeout(() => {
      const open = [...document.querySelectorAll('details')].map((d) => d.open);
      fillDays(daySel.value);
      render();
      document.querySelectorAll('details').forEach((d, i) => { d.open = !!open[i]; });
    }, 500);
  });

  fillDays();
  render();
})();
