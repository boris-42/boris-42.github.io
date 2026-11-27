/* Fries timer: settings panel (iOS Settings style), shown in a window over the fryer screen.
   Every change is validated and saved right away; the fryer screen applies it live.
   Usage: const panel = FriesSettings.mount(element, { onSaved(cfg), onStatus(text, isError) }); panel.flush(); */
(function () {
  'use strict';
  const F = window.Fries;
  const { h } = F;

  const showDur = (sec) => F.fmtDur(sec * 1000);
  const STEP_ADJUST = [-15, -5, 5, 15]; // step times change with buttons only (no typing on the iPad); new steps start at 1:00

  function mount(root, { onSaved, onStatus, onStatsCleared } = {}) {
    let draft = F.loadStoredConfig();
    let active = null; // the step row showing its controls (tapped on the iPad; hover on a computer): "L:0"
    let timer = null;
    let changedSinceOpen = false;
    const status = (msg, isError) => { if (onStatus) onStatus(msg, isError); };

    function validate() {
      if (draft.soundL === draft.soundR) return 'Left and right need different sounds';
      return null;
    }

    function save() {
      timer = null;
      const cfg = F.normalizeConfig(draft);
      if (!F.saveConfig(cfg, 'settings', false)) {
        status('Storage is full: export & delete old days in Stats', true);
        return;
      }
      if (onSaved) onSaved(cfg);
      status('Saved');
    }

    // every edit: validate, then save shortly after (so typing doesn't write on every key)
    function changed() {
      changedSinceOpen = true;
      clearTimeout(timer);
      timer = null;
      const err = validate();
      if (err) { status(err, true); return; }
      timer = setTimeout(save, 250);
    }

    // ---------- building blocks ----------

    const row = (label, ...right) => h('div', { class: 's-row' }, h('span', { class: 'lbl' }, label), ...right);
    const group = (...rows) => h('div', { class: 's-group' }, rows);
    const head = (text, action) => h('div', { class: 's-head' }, h('span', null, text), action || null);
    const foot = (...kids) => h('div', { class: 's-foot' }, kids);

    function numberIn(obj, key, min, max, unit) {
      return h('span', { class: 'num' },
        h('input', {
          class: 'plain', type: 'number', inputmode: 'numeric', min, max, step: 1, value: obj[key],
          oninput: (e) => { const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v)) { obj[key] = v; changed(); } },
        }),
        unit ? h('span', { class: 'unit' }, unit) : null);
    }

    function hear(soundKey, side) {
      F.Sound.setVolume(draft.volume);
      F.Sound.preview(soundKey, side, 'now');
    }

    // ---------- one fryer ----------

    function soundRow(id) {
      const key = id === 'L' ? 'soundL' : 'soundR';
      const otherKey = id === 'L' ? 'soundR' : 'soundL';
      const otherName = id === 'L' ? 'right' : 'left';
      const sel = h('select', {
        class: 'plain',
        onchange: (e) => { draft[key] = e.target.value; changed(); hear(draft[key], id); build(); },
      }, F.Sound.list().map((s) => {
        const taken = draft[otherKey] === s.key; // the sides must never sound alike
        return h('option', { value: s.key, selected: draft[key] === s.key ? true : null, disabled: taken ? true : null },
          taken ? `${s.label} (${otherName})` : s.label);
      }));
      return row('Sound', sel, h('button', { class: 'play', type: 'button', title: 'Play', onclick: () => hear(draft[key], id) }, '▶'));
    }

    // Step row controls: with a mouse they show on hover only; on the iPad (no hover) a tap opens the row
    // and touching anything else closes it.
    let lastPointer = 'touch';
    const disarm = (r) => {
      const del = r.querySelector('.del');
      if (del && del.classList.contains('armed')) { del.classList.remove('armed'); del.textContent = '−'; }
    };
    function activate(rowEl, open) {
      root.querySelectorAll('.s-row.step').forEach((r) => {
        if (r === rowEl) return;
        r.classList.remove('active');
        disarm(r);
      });
      if (rowEl) rowEl.classList.toggle('active', open);
      active = rowEl && open ? rowEl.dataset.key : null;
    }
    const rowOf = (el) => (el && el.closest ? el.closest('.s-row.step') : null);
    const onPointer = (e) => {
      lastPointer = e.pointerType || 'mouse';
      activate(rowOf(e.target), lastPointer !== 'mouse');
    };
    const onFocus = (e) => activate(rowOf(e.target), lastPointer !== 'mouse');
    // listen on the whole document (window, footer, backdrop) so leaving a row always closes it
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('focusin', onFocus, true);

    function stepRow(id, prog, s, i, updateTotal) {
      const key = `${id}:${i}`;
      const timeEl = h('span', { class: 'time' }, showDur(s.duration));
      const adj = (delta) => h('button', {
        class: 'adj', type: 'button', title: `${delta > 0 ? '+' : '−'}${Math.abs(delta)} s`,
        onclick: () => {
          s.duration = Math.max(1, Math.min(3600, s.duration + delta));
          timeEl.textContent = showDur(s.duration);
          updateTotal();
          changed();
        },
      }, `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`);
      // delete: first tap arms it ("Delete"), second tap removes the step
      const del = h('button', {
        class: 'del', type: 'button', title: 'Delete step', disabled: prog.steps.length === 1 ? true : null,
        onclick: () => {
          if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'Delete'; return; }
          prog.steps.splice(i, 1);
          active = null;
          changed();
          build();
        },
      }, '−');
      const rowEl = h('div', { class: 's-row step' + (active === key ? ' active' : ''), 'data-key': key },
        del,
        h('input', {
          class: 'plain name', type: 'text', maxlength: 40, value: s.name, 'aria-label': 'Step name',
          oninput: (e) => { s.name = e.target.value; changed(); },
        }),
        s.auto ? h('span', { class: 'tag' }, 'auto') : null,
        h('span', { class: 'adjs' }, STEP_ADJUST.slice(0, 2).map(adj), timeEl, STEP_ADJUST.slice(2).map(adj)));
      rowEl.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') disarm(rowEl); });
      return rowEl;
    }

    function fryerColumn(id) {
      const f = draft.fryers[id];
      const prog = f.program;
      const other = id === 'L' ? 'R' : 'L';
      const totalEl = h('span');
      const updateTotal = () => {
        totalEl.textContent = `One round ${showDur(prog.steps.reduce((a, s) => a + (Number(s.duration) || 0), 0))}`;
      };
      updateTotal();

      return h('section', { class: `s-col side-${id}` },
        h('h2', { class: 's-colhead' }, h('i', { class: 'dot' }), id === 'L' ? 'Left fryer' : 'Right fryer'),
        group(
          soundRow(id),
          row('Waiting text', h('input', {
            class: 'plain', type: 'text', maxlength: 40, value: prog.startPrompt, placeholder: 'Drop fries in',
            oninput: (e) => { prog.startPrompt = e.target.value; changed(); },
          }))),
        head('Steps'),
        group(...prog.steps.map((s, i) => stepRow(id, prog, s, i, updateTotal)), h('button', {
          class: 's-row add', type: 'button',
          onclick: () => {
            prog.steps.push({ name: 'New step', duration: 60, auto: false });
            active = lastPointer === 'mouse' ? null : `${id}:${prog.steps.length - 1}`; // touch: open the new row
            changed();
            build();
          },
        }, '+ Add step')),
        foot(totalEl,
          h('button', { type: 'button', onclick: () => { prog.steps = F.friesProgram().steps; active = null; changed(); build(); } }, 'Fries preset'),
          h('button', {
            type: 'button',
            onclick: () => { f.program = JSON.parse(JSON.stringify(draft.fryers[other].program)); active = null; changed(); build(); },
          }, `Copy from ${other === 'L' ? 'left' : 'right'}`)));
    }

    // ---------- shared ----------

    function sharedSection() {
      return h('section', { class: 's-cols' },
        h('div', null,
          head('Timing'),
          group(
            row('Pedal unlocks early', numberIn(draft, 'earlySeconds', 0, 120, 's')),
            row('Late after', numberIn(draft, 'lateSeconds', 0, 120, 's')),
            row('Warn before due', numberIn(draft, 'warnSeconds', 0, 120, 's'))),
          foot('A press before the unlock is refused. A press later than “late after” counts as a mistake.')),
        h('div', null,
          head('Volume & pedals'),
          group(
            row('Volume', h('input', {
              class: 'range', type: 'range', min: 0, max: 1, step: 0.05, value: draft.volume,
              oninput: (e) => { draft.volume = Number(e.target.value); F.Sound.setVolume(draft.volume); changed(); },
            })),
            row('Hold pedal', numberIn(draft, 'holdResetSeconds', 2, 60, 's')),
            row('Ignore double press', numberIn(draft, 'pressGuardMs', 0, 5000, 'ms'))),
          foot('Holding the pedal resets a running round, or starts a break when Ready.')));
    }

    // delete every recorded round/break/event on this device (two taps, like Reset)
    function statsSection() {
      let disarmTimer = null;
      const btn = h('button', {
        class: 's-row danger', type: 'button',
        onclick: () => {
          if (!btn.classList.contains('armed')) {
            btn.classList.add('armed');
            btn.textContent = 'Tap again to delete all stats';
            disarmTimer = setTimeout(() => { btn.classList.remove('armed'); btn.textContent = 'Delete all stats'; }, 4000);
            return;
          }
          clearTimeout(disarmTimer);
          const days = F.listDays();
          days.forEach(F.deleteDay);
          F.log('stats_cleared', null, { days: days.length });
          btn.classList.remove('armed');
          btn.textContent = 'Delete all stats';
          status('All stats deleted');
          if (onStatsCleared) onStatsCleared();
        },
      }, 'Delete all stats');
      return h('div', { class: 's-stats' },
        head('Stats'),
        group(btn),
        foot('Removes every round, break and event recorded on this device. Export them on the Stats page first if you need them.'));
    }

    function build() {
      root.textContent = '';
      root.append(h('div', { class: 's-cols' }, fryerColumn('L'), fryerColumn('R')), sharedSection(), statsSection());
    }

    build();
    return {
      // save anything still pending (call before closing); returns true if anything changed while open
      flush() {
        if (timer) { clearTimeout(timer); save(); }
        document.removeEventListener('pointerdown', onPointer, true);
        document.removeEventListener('focusin', onFocus, true);
        return changedSinceOpen;
      },
    };
  }

  window.FriesSettings = { mount };
})();
