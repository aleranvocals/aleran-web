/* VoxStudio Lite · piezas de la interfaz (perillas, barras, botones, ventanas, avisos). */
(function () {
  'use strict';

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'ayuda') el.dataset.ayuda = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) {
      if (c === undefined || c === null || c === false) continue;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  }

  // ── iconos (trazos propios, 24×24) ──
  const P = {
    mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    play: '<path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
    rec: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
    loop: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
    home: '<path d="M6 5v14M18 5l-9 7 9 7z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
    save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v6h8V3M7 21v-7h10v7"/>',
    wand: '<path d="M15 4V2M15 10V8M11 6h2M17 6h2M5 21L16 10"/><path d="M19 13l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    book: '<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>',
    headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>',
    ab: '<path d="M3 18l4-12 4 12M4.5 14h5M14 6h4a3 3 0 0 1 0 6h-4zM14 12h5a3 3 0 0 1 0 6h-5z"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  };
  const icon = (n) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.innerHTML = P[n] || ''; return s;
  };

  // ── formato de números en español ──
  const num = (v, d = 1) => (Object.is(v, -0) ? 0 : v).toFixed(d).replace('.', ',');
  const fmt = {
    db: (v) => (v > 0 ? '+' : '') + num(v, 1) + ' dB',
    db0: (v) => (v <= -59.9 ? '−∞' : (v > 0 ? '+' : '') + num(v, 1) + ' dB'),
    hz: (v) => (v >= 1000 ? num(v / 1000, v >= 10000 ? 1 : 2) + ' kHz' : Math.round(v) + ' Hz'),
    ms: (v) => (v < 1 ? Math.round(v * 1000) + ' µs' : v < 10 ? num(v, 1) + ' ms' : Math.round(v) + ' ms'),
    s: (v) => num(v, 1) + ' s',
    pct: (v) => Math.round(v) + ' %',
    q: (v) => num(v, 2),
    ratio: (v) => (v >= 30 ? '∞:1' : num(v, 1) + ':1'),
    pan: (v) => (Math.abs(v) < 1 ? 'C' : (v < 0 ? 'I ' : 'D ') + Math.round(Math.abs(v))),
    lu: (v) => (v > 0 ? '+' : '') + num(v, 1) + ' LU',
    plain: (v) => num(v, 1),
    int: (v) => String(Math.round(v)),
  };
  const tiempo = (s) => { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1).replace('.', ','); };

  // ── curvas de mapeo valor ↔ posición (0..1) ──
  function mapper(o) {
    const { min, max } = o; const c = o.curve || 'lin';
    if (c === 'log') return { to: (v) => Math.log(v / min) / Math.log(max / min), from: (t) => min * Math.pow(max / min, t) };
    if (typeof c === 'number') return { to: (v) => Math.pow((v - min) / (max - min), 1 / c), from: (t) => min + (max - min) * Math.pow(t, c) };
    return { to: (v) => (v - min) / (max - min), from: (t) => min + (max - min) * t };
  }
  const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

  // ── perilla ──
  function Knob(o) {
    const m = mapper(o); const step = o.step || 0;
    let value = o.value !== undefined ? o.value : o.def;
    const svgNS = 'http://www.w3.org/2000/svg';
    const el = h('div', { class: 'knob' + (o.size ? ' ' + o.size : ''), tabindex: 0, role: 'slider', 'aria-label': o.label, ayuda: o.ayuda });
    const lab = h('div', { class: 'lab' }, o.label);
    const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('viewBox', '-32 -32 64 64');
    const mk = (t, a) => { const e = document.createElementNS(svgNS, t); for (const k in a) e.setAttribute(k, a[k]); svg.appendChild(e); return e; };
    const id = 'kg' + Math.random().toString(36).slice(2, 8);
    const defs = mk('defs', {});
    defs.innerHTML = `<radialGradient id="${id}" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#6a5a58"/><stop offset="0.55" stop-color="#3a2e2d"/><stop offset="1" stop-color="#1e1717"/></radialGradient>`;
    const A0 = -135, A1 = 135, R = 27;
    const pt = (a, r) => [Math.sin(a * Math.PI / 180) * r, -Math.cos(a * Math.PI / 180) * r];
    const arc = (a, b, r) => { const [x0, y0] = pt(a, r), [x1, y1] = pt(b, r); return `M${x0} ${y0} A${r} ${r} 0 ${Math.abs(b - a) > 180 ? 1 : 0} ${b > a ? 1 : 0} ${x1} ${y1}`; };
    mk('path', { d: arc(A0, A1, R), stroke: '#2a1f1f', 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' });
    const va = mk('path', { d: '', stroke: '#d0202e', 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round', style: 'filter: drop-shadow(0 0 3px rgba(208,32,46,0.6))' });
    mk('circle', { cx: 0, cy: 1.6, r: 20.5, fill: 'rgba(0,0,0,0.55)' });
    mk('circle', { cx: 0, cy: 0, r: 20, fill: `url(#${id})`, stroke: 'rgba(255,255,255,0.12)', 'stroke-width': 1 });
    const ind = mk('line', { x1: 0, y1: -8, x2: 0, y2: -17, stroke: '#fff', 'stroke-width': 2.4, 'stroke-linecap': 'round' });
    const val = h('div', { class: 'val' }, '');
    el.append(lab, svg, val);
    const bip = o.min < 0 && o.max > 0 && o.bipolar !== false;
    function draw() {
      const t = clamp01(m.to(value)); const a = A0 + (A1 - A0) * t;
      const t0 = bip ? clamp01(m.to(0)) : 0; const a0 = A0 + (A1 - A0) * t0;
      va.setAttribute('d', Math.abs(a - a0) < 0.5 ? '' : arc(Math.min(a, a0), Math.max(a, a0), R));
      ind.setAttribute('transform', `rotate(${a})`);
      val.textContent = (o.fmt || fmt.plain)(value);
      el.setAttribute('aria-valuenow', value); el.setAttribute('aria-valuetext', val.textContent); el.setAttribute('aria-valuemin', o.min); el.setAttribute('aria-valuemax', o.max);
    }
    function set(v, emit) {
      v = Math.min(o.max, Math.max(o.min, v));
      if (step) v = Math.round(v / step) * step;
      if (v === value && !emit) { draw(); return; }
      value = v; draw();
      if (emit && o.onChange) o.onChange(value);
    }
    let drag = null;
    svg.addEventListener('pointerdown', (e) => { e.preventDefault(); svg.setPointerCapture(e.pointerId); drag = { y: e.clientY, t: clamp01(m.to(value)) }; el.focus({ preventScroll: true }); });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const fine = e.shiftKey ? 0.2 : 1;
      const t = clamp01(drag.t + (drag.y - e.clientY) / 220 * fine);
      set(m.from(t), true);
    });
    const end = () => { if (drag && o.onEnd) o.onEnd(value); drag = null; };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    svg.addEventListener('dblclick', () => { set(o.def, true); if (o.onEnd) o.onEnd(value); });
    // sin rueda del ratón: al bajar por la página no se mueven perillas sin querer (Áleran, 24/11)
    el.addEventListener('keydown', (e) => {
      const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key];
      if (d) {
        e.preventDefault(); const antes = value;
        set(m.from(clamp01(m.to(value) + d * (e.shiftKey ? 0.004 : 0.02))), true);
        if (value === antes && step) set(value + Math.sign(d) * step, true); // al menos un paso
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); set(o.def, true); }
    });
    draw();
    return { el, set: (v) => set(v, false), get: () => value, setEnabled: (b) => el.classList.toggle('off', !b) };
  }

  // ── barra deslizante (como «CANTIDAD 80 %» de VoxStudio) ──
  function Bar(o) {
    const m = mapper(o); let value = o.value !== undefined ? o.value : o.def;
    const fill = h('div', { class: 'fill' }), txt = h('div', { class: 'txt' });
    const track = h('div', { class: 'track', tabindex: 0, role: 'slider', 'aria-label': o.label }, fill, txt);
    const el = h('div', { class: 'bar', ayuda: o.ayuda }, h('div', { class: 'caps' }, o.label), track);
    const draw = () => { fill.style.width = (clamp01(m.to(value)) * 100) + '%'; txt.textContent = (o.fmt || fmt.plain)(value); };
    const set = (v, emit) => { v = Math.min(o.max, Math.max(o.min, v)); if (o.step) v = Math.round(v / o.step) * o.step; value = v; draw(); if (emit && o.onChange) o.onChange(v); };
    const fromX = (e) => { const r = track.getBoundingClientRect(); set(m.from(clamp01((e.clientX - r.left) / r.width)), true); };
    let dn = false;
    track.addEventListener('pointerdown', (e) => { dn = true; track.setPointerCapture(e.pointerId); fromX(e); });
    track.addEventListener('pointermove', (e) => { if (dn) fromX(e); });
    track.addEventListener('pointerup', () => { dn = false; if (o.onEnd) o.onEnd(value); });
    track.addEventListener('dblclick', () => set(o.def, true));
    track.addEventListener('keydown', (e) => { const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]; if (d) { e.preventDefault(); set(m.from(clamp01(m.to(value) + d * 0.02)), true); } });
    draw();
    return { el, set: (v) => set(v, false), get: () => value };
  }

  // ── selector segmentado ──
  function Seg(o) {
    let value = o.value;
    const el = h('div', { class: 'seg' + (o.vertical ? ' v' : ''), role: 'radiogroup', 'aria-label': o.label || '', ayuda: o.ayuda });
    const btns = o.options.map((op) => {
      const b = h('button', { type: 'button', role: 'radio', ayuda: op.ayuda || o.ayuda }, op.label);
      b.addEventListener('click', () => { set(op.v); if (o.onChange) o.onChange(op.v); });
      el.appendChild(b); return [op.v, b];
    });
    function set(v) { value = v; for (const [k, b] of btns) { b.classList.toggle('on', k === v); b.setAttribute('aria-checked', k === v); } }
    set(value);
    return { el, set, get: () => value };
  }

  // ── interruptor ──
  function Switch(o) {
    let value = !!o.value;
    const sw = h('div', { class: 'sw', role: 'switch', tabindex: 0, 'aria-label': o.label || '', ayuda: o.ayuda });
    const el = o.label ? h('label', { class: 'swrow', ayuda: o.ayuda }, sw, o.label) : sw;
    const set = (v) => { value = !!v; sw.classList.toggle('on', value); sw.setAttribute('aria-checked', value); };
    const toggle = (e) => { if (e) e.preventDefault(); set(!value); if (o.onChange) o.onChange(value); };
    el.addEventListener('click', toggle);
    sw.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') toggle(e); });
    set(value);
    return { el, set, get: () => value };
  }

  // ── desplegable ──
  function Select(o) {
    const el = h('select', { 'aria-label': o.label || '', ayuda: o.ayuda });
    const fill = (opts) => {
      el.innerHTML = '';
      for (const op of opts) {
        if (op.group) { const g = h('optgroup', { label: op.group }); for (const x of op.items) g.appendChild(h('option', { value: x.v }, x.label)); el.appendChild(g); }
        else el.appendChild(h('option', { value: op.v }, op.label));
      }
    };
    fill(o.options || []);
    if (o.value !== undefined) el.value = o.value;
    el.addEventListener('change', () => o.onChange && o.onChange(el.value));
    return { el, set: (v) => { el.value = v; }, get: () => el.value, fill };
  }

  // ── avisos ──
  function toast(msg, kind, ms) {
    let box = document.getElementById('toasts');
    if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(box); }
    const t = h('div', { class: 'toast ' + (kind || '') }); t.innerHTML = msg;
    box.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms || (kind === 'err' ? 7000 : 4200));
  }

  // ── ventana modal ──
  function modal(o) {
    const prev = document.activeElement;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus({ preventScroll: true }); if (o.onClose) o.onClose(); };
    const onKey = (e) => { const all = document.querySelectorAll('.modal'); if (all[all.length - 1] !== wrap) return; if (e.key === 'Escape' && o.dismiss !== false) close(); };
    const x = h('button', { class: 'btn iconbtn ghost', 'aria-label': 'Cerrar', onclick: close }, icon('x'));
    const dlg = h('div', { class: 'dialog' + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title },
      h('div', { class: 'dhead' }, o.icon ? h('div', { class: 'stepnum', style: { width: '40px', height: '40px' } }, icon(o.icon)) : null,
        h('div', { class: 'grow' }, h('h2', null, o.title), o.sub ? h('div', { class: 'dim', style: { fontSize: '12.5px', marginTop: '4px' } }, o.sub) : null),
        o.dismiss === false ? null : x),
      o.body);
    const wrap = h('div', { class: 'modal', onclick: (e) => { if (e.target === wrap && o.dismiss !== false) close(); } }, dlg);
    document.body.appendChild(wrap);
    document.addEventListener('keydown', onKey);
    dlg.setAttribute('tabindex', '-1'); setTimeout(() => dlg.focus({ preventScroll: true }), 0);
    return { close, el: dlg };
  }

  function ask(title, label, def) {
    return new Promise((res) => {
      const inp = h('input', { class: 'input', value: def || '', maxlength: 60 });
      // primero se entrega el valor y luego se cierra (al cerrar, onClose entrega null y ya no cuenta)
      const ok = () => { res(inp.value.trim() || null); m.close(); };
      const m = modal({ title, body: h('div', null, h('div', { class: 'field' }, h('label', null, label), inp),
        h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => { res(null); m.close(); } }, 'Cancelar'), h('button', { class: 'btn primary', onclick: ok }, 'Aceptar'))), onClose: () => res(null) });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      setTimeout(() => inp.focus(), 30);
    });
  }

  // ── ayuda en la barra de estado ──
  function bindHelp(statusEl, defText) {
    let cur = null;
    document.addEventListener('pointerover', (e) => {
      const t = e.target.closest && e.target.closest('[data-ayuda]');
      if (t === cur) return; cur = t;
      statusEl.textContent = t ? t.dataset.ayuda : defText;
    });
    document.addEventListener('focusin', (e) => { const t = e.target.closest && e.target.closest('[data-ayuda]'); if (t) statusEl.textContent = t.dataset.ayuda; });
  }

  // lienzo nítido en pantallas de alta densidad
  function fitCanvas(c) {
    const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * d)), hh = Math.max(1, Math.round(r.height * d));
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    return { g, w: r.width, h: r.height };
  }

  window.UI = { h, icon, fmt, num, tiempo, Knob, Bar, Seg, Switch, Select, toast, modal, ask, bindHelp, fitCanvas, mapper };
})();
