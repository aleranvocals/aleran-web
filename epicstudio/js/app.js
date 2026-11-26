/* EpicStudio Lite · aplicación (estado, pantallas y flujo de trabajo). */
(function () {
  'use strict';
  const D = window.VoxDSP, { h, icon, fmt, num, tiempo, Knob, Bar, Seg, Switch, Select, toast, modal, ask } = window.UI;
  const VERSION = '1.1';
  const motor = new window.Motor();
  const DEF = D.defaultParams();

  // ───────────────────────── estado ─────────────────────────
  const PRESETS = (window.VOX_PRESETS_ALERAN || []).map((p) => Object.assign({ origen: 'aleran' }, p));
  const LS = 'voxlite.ajustes', LS_MIS = 'voxlite.mispresets', LS_MAN = 'voxlite.manual', LS_GUIA = 'voxlite.guia';
  const S = {
    modo: 'sencillo', paso: 1,
    params: D.defaultParams(), presetId: PRESETS[0] ? PRESETS[0].id : '',
    macros: { delante: 0, brillo: 0, cuerpo: 0, compresion: 0, reverb: 0, eco: 0, ancho: 0, realce: 0, suavizar: 0, armonicos: 0, pausas: 0 },
    objetivo: -14, formato: 'wav24', que: 'mezcla',
    tomas: [], tomaSel: -1, auto: null, bpmManual: false,
    ab: { A: null, B: null, cur: 'A' }, modificado: false,
  };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* almacenamiento lleno o bloqueado */ } };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const getP = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const setP = (o, path, v) => { const ks = path.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]]; a[ks[ks.length - 1]] = v; };

  function presetPorId(id) { return PRESETS.find((p) => p.id === id) || misPresets().find((p) => p.id === id) || null; }
  function misPresets() { return lsGet(LS_MIS, []); }
  function paramsDePreset(pr) { const p = D.prepararParams(pr ? pr.params : {}); p.bpm = S.params.bpm; p._delante = delanteDe(pr); return p; }
  // dB de la voz frente a la base del estilo; los presets sin dato van como la definitiva de Áleran (24/11)
  function delanteDe(pr) { return pr && typeof pr.delante === 'number' && isFinite(pr.delante) ? D.clamp(pr.delante, -12, 6) : -2.5; }

  // Las correcciones de la mezcla automática se conservan al cambiar de estilo.
  function aplicarAuto(p) {
    const a = S.auto; if (!a) return p;
    p.entrada.ganancia = a.entrada.ganancia; p.limpieza = clone(a.limpieza);
    [0, 3, 5].forEach((i) => { p.eq.bandas[i] = clone(a.eq.bandas[i]); });
    if (a.eq.bandas[2].on) { p.eq.bandas[2].f = a.eq.bandas[2].f; p.eq.bandas[2].g = Math.min(p.eq.bandas[2].g, a.eq.bandas[2].g); }
    p.deesser.fMin = a.deesser.fMin; p.deesser.fMax = a.deesser.fMax; if (a.deesser.on) p.deesser.on = true;
    if (a.corrector) p.corrector = clone(a.corrector); // «Voz de móvil» es de tu micro, no del estilo
    const ex = S.autoExtra || {}; if (ex.pres) p.eq.bandas[4].g = Math.min(6, p.eq.bandas[4].g + ex.pres); if (ex.aire && !p.realce.on) p.eq.bandas[6].g = Math.min(6, p.eq.bandas[6].g + ex.aire);
    p.voz.volumen = a.voz.volumen; p.base.volumen = a.base.volumen; p.base.huecoFreq = a.base.huecoFreq;
    return p;
  }

  // Parámetros que suenan: en el modo sencillo, los «ajustes a tu gusto» se suman al estilo.
  function efectivos() {
    const p = clone(S.params), m = S.macros;
    if (S.modo !== 'sencillo') return p;
    p.voz.volumen += m.delante; p.base.hueco = Math.max(0, p.base.hueco + Math.max(0, m.delante) * 0.4);
    const B = p.eq.bandas;
    B[6].g += m.brillo; B[4].g += m.brillo * 0.35;
    if (m.cuerpo) { if (!B[1].on) { B[1].on = true; B[1].g = 0; } B[1].g += m.cuerpo; }
    const c = m.compresion / 100; // −1..+1
    for (const k of ['comp1', 'comp2']) {
      const q = p[k];
      if (q.tipo === 'fet') { q.entrada += c * 6; q.salida -= c * 3; }
      else if (q.tipo === 'optico') { q.reduccion = D.clamp(q.reduccion + c * 25, 0, 100); q.salida += c * 2; }
      else { q.umbral -= c * 8; q.salida += c * 3; }
    }
    if (m.reverb) { p.reverb.envio += m.reverb; if (m.reverb > 0) p.reverb.on = true; }
    if (m.eco) { p.delay.envio += m.eco; if (m.eco > 0) p.delay.on = true; }
    if (m.realce > 0) { const base = p.realce.on ? p.realce.cantidad : 0; if (!p.realce.on && S.auto && S.autoExtra && S.autoExtra.aire) B[6].g -= S.autoExtra.aire; /* el Realce ya da aire: no se suma dos veces */ p.realce.on = true; p.realce.cantidad = D.clamp(base + m.realce, 0, 100); } // se suma a lo que traiga el estilo
    if (m.suavizar > 0) { const b0 = p.suavizador.on ? p.suavizador.cantidad : 0; p.suavizador.on = true; p.suavizador.cantidad = D.clamp(b0 + m.suavizar, 0, 100); }
    if (m.armonicos > 0) { const b0 = p.armonicos.on ? p.armonicos.ganancia : 0; p.armonicos.on = true; p.armonicos.ganancia = D.clamp(b0 + m.armonicos * 0.12, 0, 12); }
    if (m.pausas) { p.delay.ducking = D.clamp(p.delay.ducking + m.pausas * 0.6, 0, 100); p.reverb.ducking = D.clamp(p.reverb.ducking + m.pausas * 0.6, 0, 100); }
    if (m.ancho > 0) { const d = p.doblador; if (!d.on) { d.on = true; d.cantidad = 0; d.variacion = 50; } d.cantidad = D.clamp(d.cantidad + m.ancho * 0.6, 0, 100); d.ancho = 100; }
    return p;
  }

  let pushPend = false;
  function push() {
    guardarEstado(); programarAfinado(); // fuera del rAF: con la pestaña oculta el rAF no salta
    if (pushPend) return; pushPend = true;
    requestAnimationFrame(() => { pushPend = false; motor.setParams(efectivos()); dibujarEq(); dibujarCurvas(); reponerVoz(); });
  }

  // ───────────────────────── afinador (25/11) ─────────────────────────
  // No es en directo: la toma principal se afina entera en un Worker y la afinada sustituye a la original al
  // sonar y al exportar. Se recalcula solo al cambiar sus ajustes, la toma o la base (la referencia sale de la base).
  const AF = { ref: null, refDe: null, refProm: null, trabajando: null, error: '', reponiendo: false };
  let afT = 0;
  const afClave = (p, ref) => JSON.stringify([p.cantidad, p.velocidad, p.escala, p.tonica, ref ? Math.round(ref.cents * 10) : null, ref ? Math.round(ref.fuerza * 100) : null]);
  const claveActual = () => afClave(S.params.afinador, AF.ref);
  // caché de la toma: las 3 últimas afinadas (A/B y deshacer no recalculan), válida mientras la toma no cambie
  const afCache = (t) => (t && t._af && t._af.buf === t.buffer ? t._af.mapa : null);
  const afHecho = (t, clave) => { const m = afCache(t); return m ? m.get(clave) || null : null; };
  function programarAfinado() { clearTimeout(afT); afT = setTimeout(() => { asegurarAfinado().catch((e) => { console.warn('Afinador:', e); }); }, 350); }
  // si lo que debe sonar (afinada / original) no es lo que suena, se relanza en el mismo punto (una sola vez)
  function reponerVoz() {
    if (AF.reponiendo || !motor.playing || recState) return;
    const mal = (motor.toma && motor.srcV && motor.srcV.buffer !== motor.vozBuf(motor.toma, S.params)) ||
      motor.coros.some((c, i) => motor.srcC[i] && motor.srcC[i].s.buffer !== motor.vozBuf(c, S.params));
    if (mal) { AF.reponiendo = true; Promise.resolve(motor.play(motor.position())).catch(() => {}).then(() => { AF.reponiendo = false; }); }
  }
  // la afinación de la base se mide una vez por base; todas las llamadas esperan la misma medida
  function refDeBase() {
    const b = motor.base;
    if (b !== AF.refDe) { AF.refDe = b; AF.ref = null; AF.refProm = b ? motor.refBase(b).then((ref) => { if (AF.refDe === b) AF.ref = ref; }, () => { /* sin referencia: La = 440 */ }) : null; }
    return AF.refProm || Promise.resolve();
  }
  // coros (26/11): se afinan igual que la principal, con los mismos ajustes y la misma referencia
  const corosDeTomas = () => S.tomas.filter((x, i) => x.coro && i !== S.tomaSel);
  // coloca en el motor las afinadas ya calculadas con esta clave (principal y coros)
  function aplicarAfinadas(clave) {
    const t = S.tomas[S.tomaSel], h = afHecho(t, clave);
    if (h && motor.toma && t && motor.toma.buffer === t.buffer) { motor.toma.afinado = h.out; motor.toma.afinadoClave = clave; }
    const cs = corosDeTomas();
    for (const c of motor.coros) { const tt = cs.find((x) => x.buffer === c.buffer), hh = tt ? afHecho(tt, clave) : null; if (hh) { c.afinado = hh.out; c.afinadoClave = clave; } }
  }
  async function asegurarAfinado() {
    const t = S.tomas[S.tomaSel], p = S.params.afinador;
    if (!p.on || !t || !motor.toma) { pintarAfInfo(); return; }
    await refDeBase();
    const clave = afClave(p, AF.ref);
    aplicarAfinadas(clave);
    const falta = [t, ...corosDeTomas()].find((x) => !afHecho(x, clave));
    if (!falta) { AF.error = ''; pintarAfInfo(); reponerVoz(); return; }
    if (falta !== t) reponerVoz(); // la principal ya está: que suene mientras se afinan los coros
    // un solo cálculo a la vez: si hay otro en marcha, se espera y se vuelve a mirar con los ajustes de ese momento
    if (AF.trabajando) { await AF.trabajando.catch(() => {}); return asegurarAfinado(); }
    pintarAfInfo(falta === t ? 'Afinando tu toma…' : 'Afinando los coros…');
    const ft = falta, buf = ft.buffer, prom = (async () => {
      const an = ft._an && ft._an.buf === buf ? ft._an.an : null;
      const res = await motor.afinar(buf, an, Object.assign({ refBase: AF.ref }, p));
      ft._an = { buf, an: res.an };
      if (!ft._af || ft._af.buf !== buf) ft._af = { buf, mapa: new Map() };
      const m = ft._af.mapa; m.set(clave, { out: res.buffer, plan: res.plan }); while (m.size > 3) m.delete(m.keys().next().value);
    })();
    AF.trabajando = prom;
    try { await prom; AF.error = ''; } catch (e) {
      AF.error = e.message || String(e);
      // nunca suena (ni se exporta) una afinada con otros ajustes: mejor la original
      const ca = claveActual();
      if (motor.toma && motor.toma.afinadoClave !== ca) motor.toma.afinado = null;
      for (const c of motor.coros) if (c.afinadoClave !== ca) c.afinado = null;
      pintarAfInfo(); reponerVoz(); throw e;
    } finally { if (AF.trabajando === prom) AF.trabajando = null; }
    return asegurarAfinado(); // los ajustes pueden haber cambiado mientras tanto
  }
  // antes de exportar o de la mezcla automática: la toma afinada tiene que estar lista
  async function afinadoListo() { if (!S.params.afinador.on || !motor.toma) return; try { await asegurarAfinado(); } catch (e) { toast('No se pudo afinar la toma (' + e.message + '). Se usa sin afinar.', 'warn'); } }
  function pintarAfInfo(txt) {
    const el = document.getElementById('afInfo'); if (!el) return;
    if (txt) { el.textContent = txt; return; }
    const p = S.params.afinador, t = S.tomas[S.tomaSel];
    if (!p.on) { el.textContent = ''; return; }
    if (AF.error) { el.textContent = 'No se pudo afinar: ' + AF.error + ' Suena sin afinar.'; return; }
    const hecho = t ? afHecho(t, claveActual()) : null;
    if (!hecho) { el.textContent = t ? 'Afinando tu toma…' : 'Graba o carga tu voz.'; return; }
    const pl = hecho.plan, la = 440 * Math.pow(2, pl.ref / 1200);
    let s2;
    if (pl.dudosa) s2 = 'Tu toma entera está a casi un cuarto de tono de la base y no se puede saber si subirla o bajarla: no se toca, porque afinarla nota a nota la alejaría más de la base. ¿Grabaste con la base en otra afinación? Si vuelves a grabar sobre esta base, el Afinador podrá trabajar.';
    else if (pl.deBase) {
      s2 = 'Afinada a la base (La = ' + num(la, 1) + ' Hz).';
      if (Math.abs(pl.global) >= 5) s2 += ' Tu toma entera estaba unos ' + Math.round(Math.abs(pl.desplaz)) + ' cents más ' + (pl.desplaz > 0 ? 'baja' : 'alta') + ' que la base: se mueve junta ' + Math.round(Math.abs(pl.global)) + ' cents' + (Math.abs(pl.global) < Math.abs(pl.desplaz) - 1 ? (p.cantidad < 50 ? ' (del todo a partir del 50 %)' : ' (no del todo: no está claro en todas las notas)') : '') + '.';
    } else s2 = 'Afinada respecto a tu propia voz' + (motor.base ? ' (la base no deja medir su afinación).' : ' (sin base).');
    el.textContent = s2;
  }
  let saveT = 0;
  const escribirEstado = () => lsSet(LS, { modo: S.modo, params: S.params, presetId: S.presetId, macros: S.macros, objetivo: S.objetivo, formato: S.formato, que: S.que, auto: S.auto, autoExtra: S.autoExtra, bpmManual: S.bpmManual });
  // Los ajustes NO se guardan solos: solo con «Guardar ajustes». Cada cambio entra en el historial de deshacer.
  function guardarEstado() { clearTimeout(saveT); saveT = setTimeout(registrarHistorial, 450); }
  const foto = () => JSON.stringify({ params: S.params, macros: S.macros, presetId: S.presetId, auto: S.auto, autoExtra: S.autoExtra, bpmManual: S.bpmManual, objetivo: S.objetivo, modificado: !!S.modificado });
  const HIST = { atras: [], adelante: [], ultimo: null, guardado: null };
  function registrarHistorial() {
    const f = foto();
    if (HIST.ultimo === null) HIST.ultimo = f;
    else if (f !== HIST.ultimo) { HIST.atras.push(HIST.ultimo); if (HIST.atras.length > 100) HIST.atras.shift(); HIST.adelante = []; HIST.ultimo = f; }
    pintarHistorial();
  }
  function aplicarFoto(f) {
    const o = JSON.parse(f);
    S.params = D.prepararParams(sanear(o.params)); S.macros = o.macros; S.presetId = o.presetId; S.auto = o.auto ? D.prepararParams(sanear(o.auto)) : null;
    S.autoExtra = o.autoExtra; S.bpmManual = o.bpmManual; S.objetivo = o.objetivo; S.modificado = o.modificado;
    HIST.ultimo = f; refresh(); sincObjetivo(); push(); pintarHistorial();
  }
  function deshacer() { clearTimeout(saveT); registrarHistorial(); if (!HIST.atras.length) return; HIST.adelante.push(HIST.ultimo); aplicarFoto(HIST.atras.pop()); toast('Deshecho', 'info', 900); }
  function rehacer() { clearTimeout(saveT); registrarHistorial(); if (!HIST.adelante.length) return; HIST.atras.push(HIST.ultimo); aplicarFoto(HIST.adelante.pop()); toast('Rehecho', 'info', 900); }
  function guardarAjustes() { clearTimeout(saveT); registrarHistorial(); escribirEstado(); HIST.guardado = foto(); pintarHistorial(); toast('Ajustes guardados. Se cargarán la próxima vez que abras EpicStudio.', 'ok'); }
  const btnDeshacer = h('button', { class: 'btn iconbtn', 'aria-label': 'Deshacer', ayuda: 'Deshacer el último cambio de la mezcla (Ctrl+Z)', onclick: () => deshacer() }, icon('undo'));
  const btnRehacer = h('button', { class: 'btn iconbtn', 'aria-label': 'Rehacer', ayuda: 'Rehacer lo deshecho (Ctrl+Y)', onclick: () => rehacer() }, icon('redo'));
  const btnGuardarAj = h('button', { class: 'btn', ayuda: 'Guarda la mezcla tal como está ahora. Si no la guardas, al recargar la página vuelve a la última que guardaste.', onclick: () => guardarAjustes() }, icon('save'), h('span', { class: 'lbltxt' }, 'Guardar ajustes'));
  const histBar = h('div', { class: 'histbar' }, btnDeshacer, btnRehacer, btnGuardarAj);
  function pintarHistorial() {
    btnDeshacer.disabled = !HIST.atras.length; btnRehacer.disabled = !HIST.adelante.length;
    const sin = HIST.guardado !== null && HIST.ultimo !== HIST.guardado;
    btnGuardarAj.classList.toggle('pendiente', sin); btnGuardarAj.dataset.ayuda = sin ? 'Tienes cambios sin guardar. Si recargas la página se pierden.' : 'Guarda la mezcla tal como está ahora.';
  }
  window.addEventListener('beforeunload', (e) => { if (HIST.guardado !== null && foto() !== HIST.guardado && S.modificado) { e.preventDefault(); e.returnValue = ''; } });

  // ───────────────────────── registro de controles ─────────────────────────
  const REG = []; const VIS = [];
  function bind(src, path, w, after) { REG.push({ src, path, w }); return w; }
  const val = (src, path) => getP(src === 'm' ? S.macros : S.params, path);
  function cambio(src, path, v, after) {
    if (src === 'm') S.macros[path] = v; else setP(S.params, path, v);
    S.modificado = true; push(); if (after) after(v);
    if (/tipo|estilo|ratioFet|optoModo|sync|modo|escala|\.on$/.test(path)) visibilidad();
  }
  function K(path, label, min, max, o = {}) {
    const src = o.src || 'p';
    const w = (o.mas ? Bar : Knob)(Object.assign({ label, min, max, def: o.def !== undefined ? o.def : (src === 'm' ? 0 : getP(DEF, path)), value: val(src, path), onChange: (v) => cambio(src, path, v, o.after) }, o));
    if (o.mas) w.el.classList.add('mas-item'); // lo secundario va como barra en «Más ajustes» (24/11)
    return bind(src, path, w).el;
  }
  function SG(path, options, o = {}) { const w = Seg(Object.assign({ options, value: val('p', path), onChange: (v) => cambio('p', path, v, o.after) }, o)); return bind('p', path, w).el; }
  function SLP(path, label, options, o = {}) { const w = Select(Object.assign({ label, options, value: val('p', path), onChange: (v) => cambio('p', path, v, o.after) }, o)); bind('p', path, w); return h('div', { class: 'field' }, h('label', null, label), w.el); }
  function SW(path, label, o = {}) { const w = Switch(Object.assign({ label, value: val('p', path), onChange: (v) => cambio('p', path, v, o.after) }, o)); return bind('p', path, w).el; }
  document.addEventListener('click', (e) => { if (!e.target.closest || !e.target.closest('.qwrap')) document.querySelectorAll('.qpop.on').forEach((x) => x.classList.remove('on')); });
  function MASI(el) { el.classList.add('mas-item'); return el; } // a «Más ajustes»
  function when(el, fn) { VIS.push({ el, fn }); return el; }
  function refresh() {
    for (const r of REG) { const v = val(r.src, r.path); if (v !== undefined) r.w.set(v); }
    visibilidad(); dibujarEq(); dibujarCurvas(); actualizarPresetUI(); actualizarCabecera(); infoMovil(); pintarAfInfo();
  }
  // qué ha medido la mezcla automática de tu micro (tarjeta «Voz de móvil»)
  function limpiarInfoMovil(i) { if (!i || typeof i !== 'object') return undefined; return { movil: !!i.movil, corte: D.clamp(+i.corte || 0, 0, 24000), ruidoRel: D.clamp(+i.ruidoRel || -99, -99, 0), texto: String(i.texto || '').slice(0, 300) }; }
  function infoMovil() {
    const el = document.getElementById('corInfo'); if (!el) return; const i = S.autoExtra && S.autoExtra.corrector, c = S.params.corrector;
    if (!i) { el.textContent = 'Haz la mezcla automática (se hace sola al grabar) para que mida tu micro.'; return; }
    const curva = (c.curva || []).map((v, k) => [v, [160, 226, 320, 453, 640, 905, 1280, 1810, 2560, 3620, 5120, 7241, 10240][k]]).filter((q) => Math.abs(q[0]) >= 1).map((q) => (q[0] > 0 ? '+' : '') + num(q[0]) + ' dB en ' + fmt.hz(q[1]));
    el.textContent = (i.movil ? 'Parece un móvil o un micro sencillo. ' : 'Tu micro suena a estudio: no hace falta (puedes encenderlo igual). ') + 'Agudos hasta ' + fmt.hz(i.corte) + ' · ' + (i.ruidoRel > -98 ? 'ruido de fondo ' + i.ruidoRel + ' dB bajo tu voz' : 'sin silencios para medir el ruido') + (curva.length ? ' · EQ: ' + curva.join(', ') : '') + '.';
  }
  function visibilidad() { for (const v of VIS) v.el.classList.toggle('hidden', !v.fn(S.params)); for (const c of CARDS) c.upd(); }

  // ───────────────────────── esqueleto ─────────────────────────
  const app = document.getElementById('app');
  const status = h('div', { class: 'grow', id: 'ayuda' });
  const AYUDA_DEF = 'Pasa el ratón sobre cualquier control para ver qué hace · Espacio: reproducir · R: grabar';

  // barra superior
  const clock = h('div', { class: 'clock mono' }, '0:00,0 / 0:00');
  const infoLine = h('div', { class: 'infoline' }, 'Sin base · sin voz');
  const bpmIn = h('input', { type: 'number', min: 40, max: 240, value: S.params.bpm, 'aria-label': 'Tempo', ayuda: 'Tempo de la canción (BPM). Los ecos van a tempo. Se detecta solo con la mezcla automática; si lo escribes tú, se respeta.' });
  const btnPlay = h('button', { class: 'tbtn play', 'aria-label': 'Reproducir', ayuda: 'Reproducir / pausa (barra espaciadora)', onclick: () => togglePlay() }, icon('play'));
  const btnRec = h('button', { class: 'tbtn rec', 'aria-label': 'Grabar', ayuda: 'Grabar tu voz con la base sonando (tecla R)', onclick: () => abrirGrabacion() }, icon('rec'));
  const btnLoop = h('button', { class: 'tbtn loop', 'aria-label': 'Bucle', ayuda: 'Repetir un trozo: arrastra sobre la regla del visor para elegirlo; este botón lo quita o lo pone', onclick: () => toggleLoop() }, icon('loop'));
  const topbar = h('div', { class: 'topbar' },
    h('button', { class: 'btn', ayuda: 'Carga tu voz ya grabada (WAV, MP3, M4A…). Se coloca al principio de la canción.', onclick: () => elegirArchivo('voz') }, icon('mic'), h('span', { class: 'lbltxt' }, 'Cargar voz')),
    h('button', { class: 'btn', ayuda: 'Carga la base instrumental (karaoke, pista o instrumental) sobre la que cantas.', onclick: () => elegirArchivo('base') }, icon('music'), h('span', { class: 'lbltxt' }, 'Cargar base')),
    h('div', { class: 'transport' }, h('button', { class: 'tbtn', 'aria-label': 'Al principio', ayuda: 'Volver al principio (tecla Inicio)', onclick: () => { if (!grabando()) motor.seek(0); } }, icon('home')), btnPlay,
      h('button', { class: 'tbtn', 'aria-label': 'Parar', ayuda: 'Parar', onclick: () => pararTodo() }, icon('stop')), btnRec, btnLoop, clock),
    h('div', { class: 'grow' }, infoLine),
    h('div', { class: 'bpmbox', ayuda: bpmIn.dataset.ayuda }, h('span', { class: 'caps' }, 'BPM'), bpmIn),
    h('button', { class: 'btn', ayuda: 'Micrófono, latencia y calibración', onclick: () => abrirAudio() }, icon('gear'), h('span', { class: 'lbltxt' }, 'Audio')),
    h('button', { class: 'btn primary', ayuda: 'Exportar tu canción terminada (WAV o MP3)', onclick: () => abrirExportar() }, icon('download'), h('span', { class: 'lbltxt' }, 'Exportar')),
    h('img', { class: 'emblem', src: 'assets/aleran_emblem.png', alt: 'Áleran Vocals' }));
  bpmIn.addEventListener('change', () => { const v = D.clamp(parseFloat(bpmIn.value) || 120, 40, 240); bpmIn.value = v; S.params.bpm = v; S.bpmManual = true; push(); });

  // barra de pasos / pestañas
  const tabsS = h('div', { class: 'tabs', role: 'tablist' });
  const btnModo = h('button', { class: 'btn', onclick: () => cambiarModo(S.modo === 'sencillo' ? 'avanzado' : 'sencillo') });
  const subbar = h('div', { class: 'subbar' }, tabsS, h('div', { class: 'grow' }),
    histBar, h('button', { class: 'btn', ayuda: 'Manual paso a paso y guía de prueba', onclick: () => abrirManual() }, icon('book'), h('span', { class: 'lbltxt' }, 'Manual')), btnModo);

  // visor de la canción
  const cvWave = h('canvas'), cvTop = h('canvas');
  const visorEmpty = h('div', { class: 'empty' }, 'Arrastra aquí tu base y tu voz, o pulsa «Cargar base» y luego ● para grabar');
  const visor = h('div', { class: 'visor well', ayuda: 'Visor de la canción: arriba la base, abajo tu voz. Haz clic para ir a un punto. Arrastra sobre la franja de arriba para repetir un trozo.' }, cvWave, cvTop, visorEmpty);
  const recBadge = h('div', { class: 'recbadge hidden' }, h('span', { class: 'dot' }), h('span', null, 'GRABANDO'));
  const visorInfo = h('div', { class: 'dim', style: { fontSize: '12px' } });
  const visorBox = h('div', { class: 'panel', style: { padding: '10px', marginBottom: '12px' } }, visor, h('div', { class: 'visorbar' }, recBadge, visorInfo));

  const content = h('div', { class: 'content' });
  const sidebar = h('div', { class: 'sidebar' });
  const main = h('div', { class: 'main' }, content, sidebar);
  // tamaño de la interfaz (24/11): «Auto» se ajusta al ancho; o a mano 80–110 %. Se recuerda en cada navegador.
  const TAMS = [{ v: 'auto', label: 'Tamaño: auto' }, { v: '0.8', label: 'Tamaño: 80 %' }, { v: '0.9', label: 'Tamaño: 90 %' }, { v: '1', label: 'Tamaño: 100 %' }, { v: '1.1', label: 'Tamaño: 110 %' }];
  let tam = 'auto'; try { tam = localStorage.getItem('voxlite.tamano') || 'auto'; } catch (e) { /* sin almacenamiento */ }
  function aplicarTam() {
    const safari = /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent); // Safari trata el zoom distinto: en «Auto» no se toca
    const w = window.innerWidth, z = tam === 'auto' ? (!safari && w >= 1000 && w < 1280 ? 0.9 : 1) : D.clamp(+tam || 1, 0.7, 1.3);
    document.documentElement.style.zoom = z === 1 ? '' : String(z);
  }
  const tamSel = Select({ value: tam, options: TAMS, ayuda: 'Tamaño de toda la interfaz. «Auto» la ajusta a tu pantalla; si en un portátil pequeño no te cabe, prueba 80 o 90 %.', onChange: (v) => { tam = v; try { localStorage.setItem('voxlite.tamano', v); } catch (e) { /* sin almacenamiento */ } aplicarTam(); requestAnimationFrame(() => { dibujarEq(); dibujarCurvas(); }); } });
  tamSel.el.classList.add('tamsel'); aplicarTam(); window.addEventListener('resize', () => { if (tam === 'auto') { aplicarTam(); requestAnimationFrame(() => { dibujarEq(); dibujarCurvas(); }); } });
  const statusbar = h('div', { class: 'statusbar' }, icon('help'), status, h('span', { class: 'marca' }, 'Áleran Vocals · EpicStudio Lite v' + VERSION),
    tamSel.el, h('button', { class: 'btn sm ghost', onclick: () => acercaDe() }, 'Acerca de'));
  app.append(topbar, subbar, h('div'), main, statusbar);
  status.textContent = AYUDA_DEF; UI.bindHelp(status, AYUDA_DEF);
  [...topbar.querySelectorAll('svg')].forEach((s) => s.style.pointerEvents = 'none');

  // ───────────────────────── modo sencillo ─────────────────────────
  const simple = h('div', { class: 'simple' });
  const vozOk = h('div', { class: 'okline' }), baseOk = h('div', { class: 'okline' });
  const listaTomasS = h('div', { class: 'list' });
  const selBases = Select({ label: 'Bases de Áleran', options: [], onChange: (v) => { if (v !== '') cargarBaseAleran(+v); } });
  const presetSel = Select({ label: 'Estilo', options: [], ayuda: 'El estilo de mezcla. Los ha preparado Áleran; «Mis presets» son los que guardas tú.', onChange: (id) => elegirPreset(id) });
  const presetDesc = h('div', { class: 'presetdesc' });
  const autoBtnS = h('button', { class: 'btn block', ayuda: 'Analiza tu voz (nivel, barro, resonancias, eses, tempo) y ajusta la mezcla para ti. Se hace sola al grabar.', onclick: () => mezclaAuto() }, icon('wand'), 'Mezcla automática');
  const autoNotas = h('div', { class: 'report' });
  const objSelS = Select({ label: 'Volumen final', value: String(S.objetivo), options: OBJETIVOS(), ayuda: 'Lo fuerte que sonará la canción exportada. Streaming (−14) es lo normal para Spotify y YouTube.', onChange: (v) => { S.objetivo = v === 'none' ? null : +v; sincObjetivo(); guardarEstado(); } });
  const expRes = h('div', { class: 'report' });

  function OBJETIVOS() {
    return [{ v: '-14', label: 'Streaming (Spotify, YouTube) · −14 LUFS' }, { v: '-16', label: 'Apple Music / podcast · −16 LUFS' }, { v: '-11', label: 'Fuerte (rock, pop actual) · −11 LUFS' },
      { v: '-9', label: 'Muy fuerte (metal, EDM) · −9 LUFS' }, { v: '-23', label: 'Televisión / radio · −23 LUFS' }, { v: 'none', label: 'Sin normalizar (tal cual suena)' }];
  }

  // perilla del modo sencillo: 0 = Afinador apagado; más = encendido con esa cantidad
  function afinacionKnob() {
    const a0 = S.params.afinador;
    const w = Knob({ label: 'Afinación', min: 0, max: 100, def: 0, value: a0.on ? a0.cantidad : 0, fmt: fmt.pct, step: 1,
      ayuda: 'Afina tu voz con suavidad hacia las notas de la base, respetando tu vibrato y tus deslizamientos. 30–60 % suena natural; 100 % es afinación marcada. Se calcula cuando dejas la perilla quieta (no es en directo).',
      onChange: (v) => { const a = S.params.afinador; a.on = v > 0; if (v > 0) a.cantidad = v; S.modificado = true; push(); visibilidad(); } });
    REG.push({ src: 'p', path: 'afinador', w: { set: (a) => w.set(a.on ? a.cantidad : 0) } });
    return w.el;
  }
  function colSimple() {
    const movilSw = Switch({ value: S.params.corrector.on, ayuda: 'Encender «Voz de móvil»', onChange: (v) => cambio('p', 'corrector.on', v) }); bind('p', 'corrector.on', movilSw);
    const c1 = h('div', { class: 'panel stack' },
      h('div', { class: 'phead' }, h('div', { class: 'stepnum', id: 'st1' }, '1'), h('div', null, h('h2', null, 'Graba tu voz'), h('div', { class: 'sub' }, 'Carga la base y graba encima. O arrastra tus archivos.'))),
      h('button', { class: 'btn lg block', ayuda: 'Carga la base instrumental sobre la que vas a cantar.', onclick: () => elegirArchivo('base') }, icon('music'), 'Cargar la base'),
      baseOk,
      (window.VOX_BASES_ALERAN || []).length ? h('div', { class: 'field' }, h('label', null, 'O elige una base de Áleran'), selBases.el) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary lg grow', ayuda: 'Grabar tu voz mientras suena la base. Usa auriculares.', onclick: () => abrirGrabacion() }, icon('rec'), 'Grabar'),
        h('button', { class: 'btn lg', ayuda: 'Si ya grabaste tu voz en otro sitio, cárgala aquí.', onclick: () => elegirArchivo('voz') }, icon('mic'), 'Cargar voz')),
      vozOk, listaTomasS,
      h('div', { class: 'row', style: { alignItems: 'center', gap: '8px' }, ayuda: 'Si grabaste con el móvil o un micro sencillo: quita el ruido de fondo, acerca tu voz al sonido de un micro de estudio y recupera agudos. La mezcla automática lo enciende sola si lo detecta.' }, movilSw.el, h('span', null, 'Voz de móvil → estudio')),
      h('div', { class: 'tip' }, 'Consejo: graba con auriculares y canta a un palmo del micro. Si te equivocas, graba otra toma: se guardan todas y eliges la mejor.'));
    const c2 = h('div', { class: 'panel stack' },
      h('div', { class: 'phead' }, h('div', { class: 'stepnum', id: 'st2' }, '2'), h('div', null, h('h2', null, 'Escucha y elige estilo'), h('div', { class: 'sub' }, 'Dale play: la mezcla suena en directo mientras tocas.'))),
      h('div', { class: 'bigplay' }, h('button', { 'aria-label': 'Reproducir', onclick: () => togglePlay() }, icon('play')), h('div', null, h('div', { class: 'caps', style: { color: 'var(--text)', fontSize: '12px' } }, 'Dale play'), h('div', { class: 'dim', style: { fontSize: '12px' } }, 'Cambia de estilo mientras suena.'))),
      h('div', { class: 'field' }, h('label', null, 'Estilo'), presetSel.el), presetDesc,
      autoBtnS, autoNotas,
      h('div', { class: 'caps', style: { marginTop: '8px' } }, 'Ajustes a tu gusto (opcional)'),
      h('div', { class: 'knobrow' },
        K('realce', 'Realce', 0, 100, { src: 'm', fmt: fmt.pct, step: 1, ayuda: 'Voz de radio en un mando: comprime en tres bandas hacia abajo y hacia arriba (lo flojo sube, lo fuerte baja), quita golpes de «p» y le da presencia y aire. Se suma a lo que traiga el estilo; 0 % = como viene el estilo.' }),
        K('delante', 'Voz delante', -6, 6, { src: 'm', fmt: fmt.db, step: 0.1, ayuda: 'Más a la derecha: tu voz más alta respecto a la base (y la base le hace hueco).' }),
        K('brillo', 'Brillo', -6, 6, { src: 'm', fmt: fmt.db, step: 0.1, ayuda: 'Agudos y aire de la voz. A la izquierda, más oscura; a la derecha, más brillante.' }),
        K('cuerpo', 'Cuerpo', -6, 6, { src: 'm', fmt: fmt.db, step: 0.1, ayuda: 'Graves de la voz (180 Hz). Da peso; si te pasas, suena a «bola».' }),
        K('compresion', 'Compresión', -100, 100, { src: 'm', fmt: (v) => (v > 0 ? '+' : '') + Math.round(v) + ' %', step: 1, ayuda: 'Cuánto se igualan las partes flojas y fuertes. Más = voz más pegada y constante.' }),
        K('reverb', 'Reverb', -20, 20, { src: 'm', fmt: fmt.db, step: 0.5, ayuda: 'Cantidad de sala/placa (va en paralelo: tu voz seca no se toca). A la izquierda, voz más seca y cercana.' }),
        K('eco', 'Eco', -20, 20, { src: 'm', fmt: fmt.db, step: 0.5, ayuda: 'Cantidad de eco (delay) a tempo, en paralelo a tu voz.' }),
        K('ancho', 'Anchura', 0, 100, { src: 'm', fmt: fmt.pct, step: 1, ayuda: 'Abre la voz en estéreo con copias muy cercanas (doblador). En el centro sigue estando tu voz.' }),
        K('pausas', 'Efecto en pausas', -100, 100, { src: 'm', fmt: (v) => (v > 0 ? '+' : '') + Math.round(v) + ' %', step: 1, ayuda: 'A la derecha: el eco y la reverb se apartan mientras cantas y florecen en los huecos entre frases. A la izquierda: el efecto se queda pegado a la voz también al cantar.' }),
        K('suavizar', 'Suavizar', 0, 100, { src: 'm', fmt: fmt.pct, step: 1, ayuda: 'Quita lo estridente: baja en cada momento solo las frecuencias que pinchan o raspan (como Soothe), sin apagar la voz.' }),
        K('armonicos', 'Armónicos', 0, 100, { src: 'm', fmt: fmt.pct, step: 1, ayuda: 'Hace brillar la nota que cantas y todas sus octavas (como subir 220, 440, 880… a mano en Audition). Solo en las notas agudas; ideal para gritos y notas largas.' }),
        afinacionKnob()));
    const c3 = h('div', { class: 'panel stack' },
      h('div', { class: 'phead' }, h('div', { class: 'stepnum', id: 'st3' }, '3'), h('div', null, h('h2', null, 'Exporta'), h('div', { class: 'sub' }, 'Tu canción terminada, lista para escuchar o subir.'))),
      h('div', { class: 'field' }, h('label', null, 'Volumen final'), objSelS.el),
      h('button', { class: 'btn primary lg block', onclick: () => abrirExportar() }, icon('download'), 'Exportar mi canción'),
      h('div', { class: 'tip' }, 'En la ventana de exportar eliges formato (WAV o MP3) y qué exportar: la mezcla completa, solo tus voces con efectos (principal y coros, sin la base) o tu voz sin tocar.'),
      expRes,
      h('div', { class: 'caps', style: { marginTop: '10px' } }, 'Comparte tu sonido'),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', ayuda: 'Guarda estos ajustes como un preset tuyo.', onclick: () => guardarPreset() }, icon('save'), 'Guardar preset'),
        h('button', { class: 'btn sm', ayuda: 'Copia un enlace con tus ajustes para mandárselo a Áleran o a un compañero.', onclick: () => compartirPreset() }, icon('share'), 'Copiar enlace')));
    simple.append(c1, c2, c3);
  }

  // ───────────────────────── modo avanzado ─────────────────────────
  const adv = h('div');
  const CARDS = [];
  const presetSelA = Select({ label: 'Preset', options: [], onChange: (id) => elegirPreset(id) });
  const abBtns = {};
  // El «aire» de la mezcla automática solo va sin Realce (el Realce ya da aire). Al encender o apagar el Realce a mano
  // en el avanzado, se quita o se devuelve ese aire en la banda «Aire» (24/11).
  function aireConRealce(enciende) {
    const ai = S.auto && S.autoExtra ? +S.autoExtra.aire || 0 : 0; if (!ai || !!S.params.realce.on === !!enciende) return;
    const B6 = S.params.eq.bandas[6]; B6.g = Math.round(D.clamp(B6.g + (enciende ? -ai : ai), -18, 18) * 10) / 10;
  }
  function card(o) {
    const sw = o.on ? Switch({ value: getP(S.params, o.on), label: '', ayuda: 'Encender o apagar este módulo', onChange: (v) => { const rz = o.on === 'realce.on'; if (rz) aireConRealce(v); cambio('p', o.on, v); if (rz) refresh(); } }) : null;
    if (sw) bind('p', o.on, sw);
    const items = o.body ? [...o.body.querySelectorAll('.mas-item')] : [];
    if (items.length) {
      const grid = h('div', { class: 'masgrid' });
      for (const it of items) {
        const fns = VIS.filter((v) => v.el !== it && v.el.contains(it)).map((v) => v.fn); // si su grupo solo se ve en un modo, el ajuste también
        if (fns.length) VIS.push({ el: it, fn: (P) => fns.every((f) => f(P)) });
        grid.appendChild(it);
      }
      o.body.appendChild(h('details', { class: 'mas' }, h('summary', null, 'Más ajustes'), grid));
    }
    // las explicaciones largas no ocupan sitio: van a un (?) pequeño en la esquina (pasar el ratón o tocar) (24/11)
    const descs = o.body ? [...o.body.querySelectorAll('.desc, #corInfo')] : [];
    let q = null;
    if (descs.length) {
      const pop = h('div', { class: 'qpop' }, descs);
      const btn = h('button', { class: 'qbtn', 'aria-label': '¿Qué hace ' + o.title + '?', ayuda: descs[0].textContent, onclick: (e) => { e.stopPropagation(); pop.classList.toggle('on'); } }, '?');
      q = h('span', { class: 'qwrap' }, btn, pop);
    }
    const el = h('div', { class: 'panel card' + (o.w2 ? ' w2' : ''), id: 'card-' + o.id },
      h('div', { class: 'chead' }, h('h3', null, h('span', { class: 'led' }), o.title), o.extra || null, q, sw ? sw.el : null),
      h('div', { class: 'body' }, o.body));
    const upd = () => el.classList.toggle('isOn', o.on ? !!getP(S.params, o.on) : true);
    CARDS.push({ id: o.id, title: o.chip || o.title, el, on: o.on, upd });
    return el;
  }
  function grMeter(id) { return h('div', { class: 'grm', id }, h('span', { class: 'caps' }, 'Reducción'), h('div', { class: 'gtrack' }, h('div', { class: 'gfill' })), h('span', { class: 'v' }, '0,0 dB')); }

  const eqCanvas = h('canvas'); const eqBox = h('div', { class: 'canvasbox eq well', ayuda: 'Arrastra los puntos: izquierda-derecha cambia la frecuencia, arriba-abajo la ganancia. Rueda del ratón: anchura (Q). Doble clic en un punto: encender/apagar la banda.' }, eqCanvas);
  const bandTabs = h('div', { class: 'bandtabs' });
  const bandPanel = h('div');
  let bandSel = 4;
  const BCOL = ['#3fb6c6', '#5fcf9a', '#f2c14e', '#b48ce0', '#e3a99c', '#ff7a59', '#7fb3ff', '#c0c0c0'];

  function compCard(k, title) {
    const p = (x) => k + '.' + x;
    const tf = h('canvas');
    const isT = (t) => (P) => P[k].tipo === t;
    const body = h('div', null,
      h('div', { class: 'row', style: { marginBottom: '10px' } }, SG(p('tipo'), [
        { v: 'fet', label: 'FET', ayuda: 'Compresor FET: rapidísimo y con mordida. Ataque en microsegundos. Ideal para controlar picos y dar agresividad.' },
        { v: 'optico', label: 'Óptico', ayuda: 'Compresor óptico: lento y suave, muy musical. Relajación en dos etapas que depende de lo que cantes. Ideal para igualar frases.' },
        { v: 'vca', label: 'VCA', ayuda: 'Compresor VCA: limpio y preciso, sin color. Detector RMS.' },
        { v: 'moderno', label: 'Moderno', ayuda: 'Compresor moderno de estudio: todos los controles (rodilla, anticipo, retención, rango) y cuatro estilos.' }], { after: (t) => {
          // tiempos razonables al cambiar de tipo (cada uno usa su escala)
          const q = S.params[k], dt = { fet: [0.25, 120], vca: [3, 200], moderno: [10, 150] }[t];
          if (dt) { q.ataque = dt[0]; q.relajacion = dt[1]; }
          if (t === 'moderno' || t === 'vca') { if (q.umbral > -6) q.umbral = -20; }
          if (t === 'vca') { q.umbral = Math.max(q.umbral, -50); q.rodilla = Math.min(q.rodilla, 24); }
          refresh(); push();
        } })),
      h('div', { class: 'canvasbox tf well', ayuda: 'Curva del compresor: cómo sale la voz (vertical) según cómo entra (horizontal). La línea recta de puntos es «sin comprimir».' }, tf),
      grMeter('gr-' + k),
      h('div', { class: 'sect grid' },
        when(h('div', { class: 'grid' },
          K(p('entrada'), 'Entrada', 0, 24, { fmt: fmt.db, step: 0.1, ayuda: 'Cuánto empujas la voz contra el compresor FET (su umbral es fijo, como el original). Más entrada = más compresión.' }),
          K(p('ataque'), 'Ataque', 0.02, 0.8, { mas: true, curve: 'log', fmt: fmt.ms, ayuda: 'De 20 µs a 0,8 ms: muy rápido. Más lento deja pasar el golpe de la consonante.' }),
          K(p('relajacion'), 'Relajación', 50, 1100, { mas: true, curve: 'log', fmt: fmt.ms, ayuda: 'Lo que tarda en soltar (50 ms a 1,1 s). Rápido = más «pumping» y energía.' }),
          h('div', { class: 'field', style: { width: '100%' } }, h('label', null, 'Relación'), SG(p('ratioFet'), [{ v: '4', label: '4' }, { v: '8', label: '8' }, { v: '12', label: '12' }, { v: '20', label: '20' }, { v: 'todos', label: 'TODOS', ayuda: '«Todos los botones»: compresión extrema, sucia y con mucho carácter (truco clásico de rock y metal).' }], { ayuda: 'Relación de compresión. 4 = compresor, 20 = limitador.' }))), isT('fet')),
        when(h('div', { class: 'grid' },
          K(p('reduccion'), 'Reducción de pico', 0, 100, { fmt: fmt.int, step: 1, ayuda: 'Cuánto comprime (como el mando grande del original). Mira la barra de reducción: 3–6 dB es lo normal en voz.' }),
          K(p('enfasis'), 'Énfasis agudos', 0, 100, { mas: true, fmt: fmt.pct, step: 1, ayuda: 'Hace que comprima más con los agudos (sibilancias, notas altas chillonas).' }),
          h('div', { class: 'field' }, h('label', null, 'Modo'), SG(p('optoModo'), [{ v: 'comprimir', label: 'Comprimir' }, { v: 'limitar', label: 'Limitar' }], { ayuda: 'Comprimir ≈ 3:1 muy suave. Limitar ≈ 12:1.' }))), isT('optico')),
        when(h('div', { class: 'grid' },
          K(p('umbral'), 'Umbral', -50, 0, { fmt: fmt.db, step: 0.5, ayuda: 'A partir de qué nivel empieza a comprimir.' }),
          K(p('ratio'), 'Relación', 1, 30, { curve: 2, fmt: fmt.ratio, step: 0.1, ayuda: 'Cuánto comprime lo que pasa del umbral. 2–4:1 en voz; 30 = ∞:1 (limitador).' }),
          K(p('rodilla'), 'Rodilla', 0, 24, { mas: true, fmt: fmt.db, step: 0.5, ayuda: 'Rodilla suave: empieza a comprimir poco a poco antes del umbral. Más natural.' }),
          K(p('ataque'), 'Ataque', 0.1, 30, { mas: true, curve: 'log', fmt: fmt.ms, ayuda: 'Velocidad a la que empieza a comprimir.' }),
          K(p('relajacion'), 'Relajación', 30, 1500, { mas: true, curve: 'log', fmt: fmt.ms, ayuda: 'Velocidad a la que deja de comprimir.' }),
          MASI(SW(p('autoRel'), 'Relajación auto', { ayuda: 'La relajación se adapta sola a lo que cantas (más lenta tras frases largas).' }))), isT('vca')),
        when(h('div', { class: 'grid' },
          h('div', { class: 'field', style: { width: '100%' } }, h('label', null, 'Estilo'), SG(p('estilo'), [
            { v: 'limpio', label: 'Limpio', ayuda: 'Detector de picos, transparente.' }, { v: 'vocal', label: 'Vocal', ayuda: 'Detector RMS y relajación que depende de la frase: suena natural en voz.' },
            { v: 'pegamento', label: 'Pegamento', ayuda: 'RMS lento: une y redondea.' }, { v: 'impacto', label: 'Impacto', ayuda: 'Picos rápidos: más pegada y control de consonantes.' }])),
          K(p('umbral'), 'Umbral', -60, 0, { fmt: fmt.db, step: 0.5, ayuda: 'A partir de qué nivel empieza a comprimir.' }),
          K(p('ratio'), 'Relación', 1, 30, { curve: 2, fmt: fmt.ratio, step: 0.1, ayuda: 'Cuánto comprime. 30 = ∞:1.' }),
          K(p('rodilla'), 'Rodilla', 0, 72, { mas: true, curve: 1.6, fmt: fmt.db, step: 0.5, ayuda: 'De 0 (dura) a 72 dB (suavísima).' }),
          K(p('ataque'), 'Ataque', 0.005, 250, { mas: true, curve: 'log', fmt: fmt.ms, ayuda: 'De 5 µs a 250 ms.' }),
          K(p('relajacion'), 'Relajación', 10, 2500, { mas: true, curve: 'log', fmt: fmt.ms, ayuda: 'De 10 ms a 2,5 s.' }),
          K(p('retencion'), 'Retención', 0, 500, { mas: true, curve: 2, fmt: fmt.ms, ayuda: 'Espera antes de soltar (hold). Evita que «respire» entre sílabas.' }),
          K(p('anticipo'), 'Anticipo', 0, 10, { mas: true, fmt: fmt.ms, step: 0.1, ayuda: 'Mira el audio unos milisegundos antes (lookahead) para no dejar escapar ningún golpe. No cambia la sincronía con la base.' }),
          K(p('rango'), 'Rango', 0, 40, { mas: true, fmt: (v) => (v <= 0 ? 'sin límite' : num(v) + ' dB'), step: 0.5, ayuda: 'Máximo de reducción. 0 = sin límite.' })), isT('moderno')),
        K(p('salida'), 'Salida', -12, 24, { mas: true, fmt: fmt.db, step: 0.1, ayuda: 'Volumen de salida. Con «Ganancia auto» encendida es solo un retoque.' }),
        MASI(SW(p('autoGan'), 'Ganancia auto', { ayuda: 'Compensa sola el volumen que quita la compresión, para que al comprimir más no suene más flojo (y no te engañe el oído).' })),
        K(p('mezcla'), 'Mezcla', 0, 100, { mas: true, fmt: fmt.pct, step: 1, ayuda: 'Compresión en paralelo («New York»): mezcla la voz comprimida con la original. 100 % = todo comprimido.' }),
        when(K(p('scHpf'), 'Filtro detector', 0, 300, { mas: true, fmt: (v) => (v < 21 ? 'apagado' : Math.round(v) + ' Hz'), step: 1, ayuda: 'El compresor ignora los graves por debajo de esta frecuencia (no se dispara con golpes de micro o notas graves).' }), (P) => P[k].tipo !== 'optico')));
    { const kids = [...body.children]; body.replaceChildren(h('div', { class: 'complay' }, h('div', { class: 'compizq' }, kids.slice(0, 3)), h('div', { class: 'compder' }, kids.slice(3)))); } // curva a un lado, mandos al otro
    CURVAS.push({ k, tf });
    return card({ id: k, title, on: p('on'), body, w2: false });
  }
  const CURVAS = [];

  function colAvanzado() {
    // fila superior
    const top = h('div', { class: 'panel adv-top' },
      h('div', { class: 'brand' }, h('div', { class: 'v' }, 'E'), h('div', null, h('div', { class: 't1' }, 'EPICSTUDIO'), h('div', { class: 't2' }, 'Lite · Áleran Vocals'))),
      h('div', { class: 'vsep' }),
      K('entrada.ganancia', 'Entrada', -24, 36, { fmt: fmt.db, step: 0.1, size: 'sm', ayuda: 'Nivel de tu voz al entrar a la cadena. La mezcla automática lo pone para que la voz cantada entre a −20 dBFS.' }),
      h('div', { class: 'field', style: { minWidth: '220px', flex: '1' } }, h('label', null, 'Estilo / preset'), h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, presetSelA.el,
        h('button', { class: 'btn iconbtn', 'aria-label': 'Guardar preset', ayuda: 'Guardar como preset tuyo', onclick: () => guardarPreset() }, icon('save')),
        h('button', { class: 'btn iconbtn', 'aria-label': 'Compartir', ayuda: 'Copiar enlace con estos ajustes', onclick: () => compartirPreset() }, icon('share')),
        h('button', { class: 'btn iconbtn', 'aria-label': 'Importar preset', ayuda: 'Abrir un archivo de preset (.json)', onclick: () => importarPreset() }, icon('upload')))),
      h('button', { class: 'btn primary', ayuda: 'Analiza tu voz y ajusta nivel, EQ correctiva, de-esser, tempo y volumen frente a la base.', onclick: () => mezclaAuto() }, icon('wand'), 'Mezcla auto'),
      h('div', { class: 'vsep' }),
      h('div', { class: 'stack', style: { gap: '6px' } }, h('div', { class: 'row', style: { gap: '4px' } },
        abBtns.A = h('button', { class: 'btn sm on', ayuda: 'Ajustes A. Compara dos versiones de tu mezcla.', onclick: () => cambiarAB('A') }, 'A'),
        abBtns.B = h('button', { class: 'btn sm', ayuda: 'Ajustes B. La primera vez copia los de A.', onclick: () => cambiarAB('B') }, 'B'),
        abBtns.by = h('button', { class: 'btn sm', ayuda: 'Escuchar la voz sin ningún efecto (para comparar). No afecta a la exportación.', onclick: () => { S.params.bypass = !S.params.bypass; abBtns.by.classList.toggle('on', S.params.bypass); push(); } }, 'Bypass'))));
    REG.push({ src: 'p', path: 'bypass', w: { set: (v) => abBtns.by.classList.toggle('on', !!v) } });

    // EQ
    const eqCard = card({ id: 'eq', title: 'EQ paramétrica', chip: 'EQ', on: 'eq.on', w2: true, body: h('div', null, h('div', { class: 'eqlay' }, eqBox, h('div', { class: 'eqside' }, bandTabs, bandPanel))) }); // apaisada: gráfica a la izquierda, controles a la derecha
    // limpieza
    const gateCard = card({ id: 'gate', title: 'Limpieza', on: 'limpieza.on', body: h('div', null,
      h('div', { class: 'desc' }, 'Baja el ruido de fondo entre frases (ordenador, ventilador, respiraciones flojas).'),
      grMeter('gr-gate'), h('div', { class: 'grid sect' },
        K('limpieza.umbral', 'Umbral', -80, -20, { fmt: fmt.db, step: 0.5, ayuda: 'Por debajo de este nivel se considera silencio y se baja.' }),
        K('limpieza.rango', 'Cuánto baja', 0, 40, { fmt: fmt.db, step: 0.5, ayuda: 'Cuántos dB se baja el ruido entre frases. 10–15 dB suena natural.' }),
        K('limpieza.relajacion', 'Relajación', 20, 1000, { mas: true, curve: 'log', fmt: fmt.ms, ayuda: 'Lo que tarda en cerrar al acabar la frase. Demasiado rápido corta los finales.' }))) });
    const rzCard = card({ id: 'rz', title: 'Realce vocal', on: 'realce.on', body: h('div', null,
      h('div', { class: 'desc' }, 'Voz «de radio» en un solo paso: micro de locución (calidez, menos caja, presencia y aire), sin rumble ni golpes de «p», y compresión en tres bandas que baja lo fuerte y sube lo flojo. La voz queda densa y siempre delante.'),
      grMeter('gr-rz'), h('div', { class: 'grid sect' },
        SG('realce.perfil', [{ v: 'grave', label: 'Voz grave (hombre)' }, { v: 'aguda', label: 'Voz aguda (mujer)' }], { ayuda: 'Ajusta los cortes y la calidez al tipo de voz.' }),
        K('realce.cantidad', 'Cantidad', 0, 100, { fmt: fmt.pct, step: 1, ayuda: 'Cuánto se nota. 40–70 % es lo habitual; a 100 % es muy de radio. Con la mezcla automática hecha, el volumen se mantiene igual al subirlo. Si tu grabación tiene ruido de fondo, enciende también la Limpieza.' }))) });
    const notaVista = h('span', { class: 'mono', id: 'arNota' }, '—');
    const arCard = card({ id: 'ar', title: 'Armónicos', on: 'armonicos.on', body: h('div', null,
      h('div', { class: 'desc' }, 'Sube la nota que cantas y todas sus octavas (por ejemplo, La: 440, 880, 1760…): la nota brilla y destaca, como en los gritos y agudos de metal.'),
      h('div', { class: 'dim', style: { fontSize: '12px', marginBottom: '8px' } }, 'Nota ahora: ', notaVista),
      h('div', { class: 'grid sect' },
        SG('armonicos.modo', [{ v: 'sigue', label: 'Sigue tu nota' }, { v: 'fija', label: 'Nota fija' }], { ayuda: '«Sigue tu nota»: detecta lo que cantas y mueve los filtros contigo. «Nota fija»: siempre la misma nota, como haces en Audition con un trozo.' }),
        when(SLP('armonicos.nota', 'Nota', D.NOTAS.map((n) => ({ v: n, label: n }))), (p) => p.armonicos.modo === 'fija'),
        K('armonicos.ganancia', 'Cuánto sube', 0, 12, { fmt: fmt.db, step: 0.5, ayuda: 'dB que se suben la nota y sus octavas. 4–6 dB es lo habitual.' }),
        K('armonicos.ancho', 'Estrechez', 1, 30, { mas: true, curve: 'log', fmt: (v) => 'Q ' + num(v, 1), ayuda: 'Más alto = solo la nota exacta; más bajo = también lo de alrededor.' }),
        K('armonicos.desde', 'A partir de', 60, 1500, { curve: 'log', fmt: (v) => { const n = 12 * Math.log2(v / 440) + 57, i = Math.round(n); return D.NOTAS[((i % 12) + 12) % 12] + Math.floor(i / 12) + ' · ' + fmt.hz(v); }, ayuda: 'Solo actúa en notas a partir de esta (en «Nota fija», sube las octavas desde aquí). Para gritos y agudos: a partir de Mi4–La4.' }))) });
    const afCard = card({ id: 'af', title: 'Afinador', on: 'afinador.on', body: h('div', null,
      h('div', { class: 'desc' }, 'Afina tu voz con suavidad, como un efecto más. No es en directo: analiza la toma entera y lleva el centro de cada nota a su sitio, respetando el vibrato, los deslizamientos y los ataques; el timbre no cambia. Afina respecto a la base (mide en qué afinación está) y, si toda tu toma está desplazada, primero la mueve entera para no cambiar tu melodía.'),
      h('div', { class: 'dim mono', id: 'afInfo', style: { fontSize: '11px', marginBottom: '8px' } }, ''),
      h('div', { class: 'grid sect' },
        K('afinador.cantidad', 'Cantidad', 0, 100, { fmt: fmt.pct, step: 1, ayuda: 'Cuánto se acerca cada nota a su sitio. 30–60 % suena natural; 100 % la deja clavada.' }),
        K('afinador.velocidad', 'Velocidad', 0, 100, { fmt: fmt.pct, step: 1, ayuda: 'Lo rápido que llega a la nota. Bajo = más suave y natural; alto = más firme. El vibrato se respeta siempre.' }),
        SLP('afinador.escala', 'Notas', [{ v: 'cromatica', label: 'Todas (lo más seguro)' }, { v: 'mayor', label: 'Escala mayor' }, { v: 'menor', label: 'Escala menor' }], { ayuda: '«Todas» lleva cada nota al semitono más cercano. Si sabes la tonalidad de la canción, elige su escala: así nunca afina hacia una nota que no está en ella.' }),
        when(SLP('afinador.tonica', 'Tonalidad', D.NOTAS.map((n) => ({ v: n, label: n }))), (p) => p.afinador.escala !== 'cromatica'))) });
    const corCard = card({ id: 'cor', title: 'Voz de móvil', on: 'corrector.on', body: h('div', null,
      h('div', { class: 'desc' }, 'Para tomas grabadas con el móvil o un micro sencillo: quita el ruido de fondo aprendido en tus silencios, acerca el color de tu voz al de un micro de estudio (solo lo que se sale de lo normal: tu timbre se respeta) y recupera agudos que el móvil corta. La mezcla automática lo mide y lo enciende sola si hace falta. Lo que el móvil no captó no se recupera del todo.'),
      h('div', { class: 'dim mono', id: 'corInfo', style: { fontSize: '11px', marginBottom: '8px' } }, ''),
      grMeter('gr-cor'), h('div', { class: 'grid sect' },
        K('corrector.cantidad', 'Hacia estudio', 0, 100, { fmt: fmt.pct, step: 1, ayuda: 'Cuánto se acerca el color de tu voz a un micro de estudio. 70 % es lo normal; 100 % aplica toda la corrección medida.' }),
        K('corrector.ruido', 'Quitar ruido', 0, 100, { fmt: fmt.pct, step: 1, ayuda: 'Cuánto baja el ruido de fondo (hasta 20 dB) cuando cantas flojo o no cantas. Aprende el ruido de los silencios de tu toma.' }),
        K('corrector.brillo', 'Agudos', 0, 100, { fmt: fmt.pct, step: 1, ayuda: 'Recupera los agudos que el móvil corta (por encima de su «corte»), generándolos a partir de tu voz. No hace nada si tu toma ya tiene agudos.' }))) });
    const svCard = card({ id: 'sv', title: 'Suavizador', on: 'suavizador.on', body: h('div', null,
      h('div', { class: 'desc' }, 'Quita lo estridente sin apagar la voz: en cada momento baja solo las frecuencias que sobresalen (lo que pincha, silba o raspa) y solo mientras sobresalen. Idea de los suavizadores tipo Soothe.'),
      grMeter('gr-sv'), h('div', { class: 'grid sect' },
        K('suavizador.cantidad', 'Cantidad', 0, 100, { fmt: fmt.pct, step: 1, ayuda: 'Cuánto baja lo que sobresale. 30–60 % suele bastar.' }),
        K('suavizador.nitidez', 'Nitidez', 0, 100, { fmt: fmt.pct, step: 1, ayuda: 'Alto = solo picos estrechos (silbidos, resonancias); bajo = también zonas anchas ásperas.' }),
        K('suavizador.desde', 'Desde', 200, 16000, { mas: true, curve: 'log', fmt: fmt.hz, ayuda: 'Frecuencia más baja en la que trabaja.' }),
        K('suavizador.hasta', 'Hasta', 400, 20000, { mas: true, curve: 'log', fmt: fmt.hz, ayuda: 'Frecuencia más alta en la que trabaja.' }),
        K('suavizador.relajacion', 'Relajación', 20, 500, { mas: true, curve: 'log', fmt: fmt.ms, ayuda: 'Lo que tarda en soltar. Rápido = más transparente; lento = más suave.' }))) });
    // de-esser
    const dsCard = card({ id: 'ds', title: 'De-esser', on: 'deesser.on', body: h('div', null,
      h('div', { class: 'row', style: { marginBottom: '8px' } }, SG('deesser.modo', [{ v: 'voz', label: 'Voz sola', ayuda: 'Detección inteligente: solo actúa cuando la «s» domina sobre la voz.' }, { v: 'general', label: 'General', ayuda: 'Actúa siempre que la banda supere el umbral.' }])),
      MASI(h('div', { class: 'field' }, h('label', null, 'Banda'), SG('deesser.proceso', [{ v: 'partida', label: 'Banda partida', ayuda: 'Solo baja los agudos durante la «s». Más transparente.' }, { v: 'ancha', label: 'Banda ancha', ayuda: 'Baja toda la voz durante la «s». A veces más natural.' }]))),
      MASI(h('div', { class: 'field' }, h('label', null, 'Posición'), SG('deesser.posicion', [{ v: 'antes', label: 'Antes de comprimir' }, { v: 'despues', label: 'Después', ayuda: 'Después de los compresores: recoge las eses que la compresión ha subido.' }]))),
      grMeter('gr-ds'),
      h('div', { class: 'grid sect' },
        K('deesser.umbral', 'Umbral', -60, 0, { fmt: fmt.db, step: 0.5, ayuda: 'Más bajo = actúa más. Mira la barra: 3–6 dB en cada «s» es lo normal.' }),
        K('deesser.rango', 'Rango', 0, 20, { fmt: fmt.db, step: 0.5, ayuda: 'Máximo que baja cada «s».' }),
        K('deesser.fMin', 'Desde', 2000, 12000, { mas: true, curve: 'log', fmt: fmt.hz, ayuda: 'Frecuencia más grave que vigila.' }),
        K('deesser.fMax', 'Hasta', 4000, 18000, { mas: true, curve: 'log', fmt: fmt.hz, ayuda: 'Frecuencia más aguda que vigila.' }),
        K('deesser.anticipo', 'Anticipo', 0, 5, { mas: true, fmt: fmt.ms, step: 0.1, ayuda: 'Detecta la «s» un poco antes para no dejar pasar el principio.' }),
        MASI(SW('deesser.escuchar', 'Escuchar eses', { ayuda: 'Escucha solo lo que detecta (para afinar Desde/Hasta). Acuérdate de apagarlo.' })))) });
    const c1 = compCard('comp1', 'Compresor 1');
    const c2 = compCard('comp2', 'Compresor 2');
    const satCard = card({ id: 'sat', title: 'Saturación', on: 'sat.on', body: h('div', null,
      h('div', { class: 'row', style: { marginBottom: '8px' } }, SG('sat.tipo', [{ v: 'cinta', label: 'Cinta', ayuda: 'Cinta magnética: comprime los picos con suavidad, armónicos impares, los agudos saturan antes y un poco de «golpe» de graves.' }, { v: 'valvula', label: 'Válvula', ayuda: 'Triodo: armónicos pares, calidez y brillo suave.' }, { v: 'transistor', label: 'Transistor', ayuda: 'Más duro y con mordida.' }])),
      h('div', { class: 'grid' },
        K('sat.drive', 'Cantidad', 0, 30, { fmt: fmt.db, step: 0.1, ayuda: 'Cuánto se empuja. El volumen se compensa solo.' }),
        K('sat.tono', 'Tono', -6, 6, { mas: true, fmt: fmt.db, step: 0.1, ayuda: 'Más oscuro (izquierda) o más brillante (derecha).' }),
        K('sat.mezcla', 'Mezcla', 0, 100, { fmt: fmt.pct, step: 1, ayuda: 'Saturación en paralelo.' }),
        K('sat.salida', 'Salida', -12, 12, { mas: true, fmt: fmt.db, step: 0.1, ayuda: 'Volumen de salida.' }))) });
    const dblCard = card({ id: 'dbl', title: 'Doblador', on: 'doblador.on', body: h('div', null,
      h('div', { class: 'desc' }, 'Crea dos copias ligeramente desafinadas y retrasadas, a izquierda y derecha: voz más ancha y gorda.'),
      h('div', { class: 'grid' },
        K('doblador.cantidad', 'Cantidad', 0, 100, { fmt: fmt.pct, step: 1, ayuda: 'Volumen de las copias.' }),
        K('doblador.ancho', 'Ancho', 0, 100, { fmt: fmt.pct, step: 1, ayuda: 'Separación estéreo de las copias.' }),
        K('doblador.variacion', 'Variación', 0, 100, { mas: true, fmt: fmt.pct, step: 1, ayuda: 'Cuánto se mueven en tiempo y afinación (más = más «coro»).' }))) });
    const riderCard = card({ id: 'rider', title: 'Vocal rider', on: 'rider.on', body: h('div', null,
      h('div', { class: 'desc' }, 'Sube y baja tu voz sola, como un técnico moviendo el fader, para que siempre se entienda sobre la base.'),
      h('div', { class: 'lufsbig', id: 'riderVal' }, '+0,0 dB'),
      h('div', { class: 'grid' },
        K('rider.objetivo', 'Objetivo', -6, 6, { mas: true, fmt: fmt.db, step: 0.1, ayuda: 'El rider aprende cómo está tu voz frente a la base en tu mezcla y mantiene esa relación frase a frase. 0 dB = la de tu mezcla; más = un poco más alta.' }),
        K('rider.rango', 'Rango', 0, 12, { fmt: fmt.db, step: 0.5, ayuda: 'Lo máximo que puede subir una frase floja. Las fuertes las baja como mucho un tercio de esto: no te quita la expresión.' }),
        K('rider.velocidad', 'Lentitud', 0.1, 5, { curve: 'log', fmt: fmt.s, ayuda: 'Más lento = más natural; más rápido = más igualado.' }))) });
    const dlyCard = card({ id: 'dly', title: 'Delay (eco)', chip: 'Delay', on: 'delay.on', body: h('div', null,
      h('div', { class: 'row', style: { marginBottom: '8px' } }, SW('delay.sync', 'A tempo', { ayuda: 'El eco va sincronizado con el BPM de la canción.' }), SW('delay.pingpong', 'Ping-pong', { ayuda: 'El eco salta de izquierda a derecha.' })),
      when(h('div', { class: 'field', style: { marginBottom: '8px' } }, h('label', null, 'Figura'), SG('delay.division', [{ v: '1/2', label: '1/2' }, { v: '1/4', label: '1/4' }, { v: '1/4.', label: '1/4·' }, { v: '1/4t', label: '1/4T' }, { v: '1/8', label: '1/8' }, { v: '1/8.', label: '1/8·' }, { v: '1/8t', label: '1/8T' }, { v: '1/16', label: '1/16' }], { ayuda: '1/4 = negra, 1/8 = corchea, · = con puntillo, T = tresillo.' })), (P) => P.delay.sync),
      h('div', { class: 'grid' },
        K('delay.envio', 'Envío', -40, 12, { fmt: fmt.db0, step: 0.5, ayuda: 'Cantidad de eco. Va en paralelo: tu voz seca sigue igual y el eco se suma encima.' }),
        when(K('delay.ms', 'Tiempo', 20, 2000, { mas: true, curve: 'log', fmt: fmt.ms, ayuda: 'Tiempo del eco en milisegundos.' }), (P) => !P.delay.sync),
        K('delay.feedback', 'Repeticiones', 0, 90, { fmt: fmt.pct, step: 1, ayuda: 'Cuántas veces se repite.' }),
        K('delay.ducking', 'Al cantar', 0, 100, { fmt: (v) => (v >= 99.5 ? '−∞ dB' : (v < 0.5 ? '0 dB' : 'hasta −' + num(-20 * Math.log10(1 - v / 100), 1) + ' dB')), step: 1, ayuda: 'Cuánto baja el eco mientras cantas (ducking). En los huecos suena con su «Envío» completo. 0 dB = igual en frases y huecos; más bajo = la voz limpia y el eco florece en las pausas.' }),
        K('delay.hpf', 'Quita graves', 20, 2000, { mas: true, curve: 'log', fmt: fmt.hz, ayuda: 'Filtra los graves del eco.' }),
        K('delay.lpf', 'Quita agudos', 1000, 20000, { mas: true, curve: 'log', fmt: fmt.hz, ayuda: 'Filtra los agudos del eco (más oscuro = más «analógico» y discreto).' }),
        K('delay.mod', 'Modulación', 0, 100, { mas: true, fmt: fmt.pct, step: 1, ayuda: 'Ligero vaivén, como un eco de cinta.' }),
        K('delay.ancho', 'Ancho', 0, 100, { mas: true, fmt: fmt.pct, step: 1, ayuda: 'Anchura estéreo del eco.' }))) });
    const revCard = card({ id: 'rev', title: 'Reverb', on: 'reverb.on', body: h('div', null,
      h('div', { class: 'row', style: { marginBottom: '8px' } }, SG('reverb.tipo', [{ v: 'placa', label: 'Placa', ayuda: 'Placa: densa y brillante desde el primer instante. La reverb clásica de voz.' }, { v: 'sala', label: 'Sala', ayuda: 'Habitación: reflexiones tempranas y cola corta. Cercana.' }, { v: 'hall', label: 'Hall', ayuda: 'Gran sala de conciertos: amplia y envolvente.' }])),
      h('div', { class: 'grid' },
        K('reverb.envio', 'Envío', -40, 12, { fmt: fmt.db0, step: 0.5, ayuda: 'Cantidad de reverb. Va en paralelo: tu voz seca sigue igual y la reverb se suma encima.' }),
        K('reverb.decay', 'Duración', 0.3, 8, { curve: 'log', fmt: fmt.s, ayuda: 'Tiempo de reverberación (RT60): lo que tarda la cola en apagarse.' }),
        K('reverb.predelay', 'Predelay', 0, 200, { mas: true, curve: 1.5, fmt: fmt.ms, ayuda: 'Espera antes de la reverb: separa la voz de su cola y la deja delante.' }),
        K('reverb.amort', 'Oscuridad', 0, 100, { mas: true, fmt: fmt.pct, step: 1, ayuda: 'Cuánto se apagan los agudos en la cola.' }),
        K('reverb.hpf', 'Quita graves', 20, 1000, { mas: true, curve: 'log', fmt: fmt.hz, ayuda: 'Filtra los graves de la reverb (la deja limpia). 250–400 Hz es lo típico en voz.' }),
        K('reverb.lpf', 'Quita agudos', 2000, 20000, { mas: true, curve: 'log', fmt: fmt.hz, ayuda: 'Filtra los agudos de la reverb (menos eses en la cola).' }),
        K('reverb.ancho', 'Ancho', 0, 150, { mas: true, fmt: fmt.pct, step: 1, ayuda: 'Anchura estéreo.' }),
        K('reverb.mod', 'Modulación', 0, 100, { mas: true, fmt: fmt.pct, step: 1, ayuda: 'Movimiento interno que evita sonido metálico.' }),
        K('reverb.ducking', 'Al cantar', 0, 100, { fmt: (v) => (v >= 99.5 ? '−∞ dB' : (v < 0.5 ? '0 dB' : 'hasta −' + num(-20 * Math.log10(1 - v / 100), 1) + ' dB')), step: 1, ayuda: 'Cuánto baja la reverb mientras cantas (ducking). En los huecos suena con su «Envío» completo. 0 dB = igual en frases y huecos.' }))) });
    const mixCard = card({ id: 'mix', title: 'Voz y base', body: h('div', { class: 'grid' },
      K('voz.volumen', 'Voz', -30, 12, { fmt: fmt.db, step: 0.1, ayuda: 'Volumen de tu voz en la mezcla.' }),
      K('voz.pan', 'Panorama', -100, 100, { mas: true, fmt: fmt.pan, step: 1, ayuda: 'Posición izquierda-derecha de la voz. La principal va en el centro (C).' }),
      K('base.volumen', 'Base', -30, 12, { fmt: fmt.db, step: 0.1, ayuda: 'Volumen de la base.' }),
      K('base.hueco', 'Hueco voz', 0, 9, { fmt: fmt.db, step: 0.1, ayuda: 'La base se aparta un poco en la zona de la voz SOLO cuando cantas y SOLO en el centro, donde va tu voz (lo de los lados queda entero). La voz se entiende sin subirla.' }),
      K('base.huecoFreq', 'Zona', 500, 8000, { mas: true, curve: 'log', fmt: fmt.hz, ayuda: 'Frecuencia del hueco. La mezcla automática la pone donde tu voz tiene más energía.' })) });
    const coroCard = card({ id: 'coros', title: 'Coros', on: 'coros.on', body: h('div', null,
      h('div', { class: 'desc' }, 'Las tomas marcadas como «Coro» (en Tomas) suenan con tu voz principal. Aquí va su cadena común: más metidas, abiertas a los lados y con más reverb que la principal.'),
      h('div', { class: 'grid sect' },
        K('coros.volumen', 'Volumen', -40, 12, { fmt: fmt.db, step: 0.5, ayuda: 'Volumen de todos los coros juntos (cada toma tiene además el suyo en Tomas).' }),
        K('coros.ancho', 'Ancho', 0, 100, { fmt: fmt.pct, step: 1, ayuda: 'Cuánto se abren los coros en estéreo. 0 % = todos en el centro; 75 % = como los dejas con el panorama; 100 % = un poco más abiertos.' }),
        K('coros.reverb', 'Más reverb', -24, 12, { fmt: fmt.db, step: 0.5, ayuda: 'Reverb de los coros respecto a la de tu voz principal. Más = coros más al fondo.' }),
        K('coros.eco', 'Más eco', -24, 12, { mas: true, fmt: fmt.db, step: 0.5, ayuda: 'Eco de los coros respecto al de tu voz principal.' }),
        K('coros.corteGraves', 'Quita graves', 20, 1000, { mas: true, curve: 'log', fmt: fmt.hz, ayuda: 'Los coros con menos graves dejan sitio a tu voz principal y a la base.' }),
        K('coros.brillo', 'Brillo', -12, 12, { mas: true, fmt: fmt.db, step: 0.5, ayuda: 'Agudos de los coros. Un poco menos que la principal los mete detrás.' }),
        K('coros.compresion', 'Compresión', 0, 100, { mas: true, fmt: fmt.pct, step: 1, ayuda: 'Iguala los coros para que no salte ninguno.' }))) });
    const pistaCard = card({ id: 'pista', title: 'Pista (base)', chip: 'Pista', on: 'pista.on', body: h('div', null,
      h('div', { class: 'desc' }, 'Retoca la base: graves, medios y agudos, cortes y una compresión suave que la «pega». El hueco para tu voz está en «Voz y base».'),
      grMeter('gr-pista'), h('div', { class: 'grid sect' },
        K('pista.graves', 'Graves', -12, 12, { fmt: fmt.db, step: 0.5, ayuda: 'Graves de la base (120 Hz). Bájalos si tapan tu voz o retumban.' }),
        K('pista.medios', 'Medios', -12, 12, { fmt: fmt.db, step: 0.5, ayuda: 'Medios de la base (en la frecuencia de «Más ajustes»). Bájalos para que tu voz se oiga sin subirla.' }),
        K('pista.agudos', 'Agudos', -12, 12, { fmt: fmt.db, step: 0.5, ayuda: 'Agudos de la base (8 kHz).' }),
        K('pista.medFreq', 'Frecuencia medios', 200, 5000, { mas: true, curve: 'log', fmt: fmt.hz, ayuda: 'Dónde actúa «Medios».' }),
        K('pista.corteGraves', 'Corte graves', 20, 500, { mas: true, curve: 'log', fmt: (v) => (v <= 21 ? 'apagado' : fmt.hz(v)), ayuda: 'Quita los graves por debajo de aquí.' }),
        K('pista.corteAgudos', 'Corte agudos', 2000, 20000, { mas: true, curve: 'log', fmt: (v) => (v >= 19999 ? 'apagado' : fmt.hz(v)), ayuda: 'Quita los agudos por encima de aquí (base más oscura, tipo «radio»).' }),
        K('pista.pegamento', 'Pegamento', 0, 100, { mas: true, fmt: fmt.pct, step: 1, ayuda: 'Compresión suave de toda la base: la une y la iguala.' }))) });
    const limCard = card({ id: 'lim', title: 'Limitador final', chip: 'Limitador', on: 'master.on', body: h('div', null,
      h('div', { class: 'desc' }, 'Último paso: sube el volumen general sin que nada pase del techo, medido en pico real (true peak), como piden Spotify y compañía.'),
      grMeter('gr-lim'),
      h('div', { class: 'grid sect' },
        K('master.ganancia', 'Ganancia', -24, 24, { fmt: fmt.db, step: 0.1, ayuda: 'Cuánto empujas la mezcla contra el limitador. Al exportar con «Volumen final» se ajusta solo.' }),
        K('master.techo', 'Techo', -6, 0, { fmt: (v) => num(v) + ' dBTP', step: 0.1, ayuda: 'Nivel máximo de pico real. −1 dBTP es lo recomendado para que no distorsione al convertir a MP3/AAC.' }),
        K('master.liberacion', 'Liberación', 10, 1000, { mas: true, curve: 'log', fmt: fmt.ms, ayuda: 'Lo que tarda en soltar.' }),
        MASI(SW('master.autoRel', 'Liberación auto', { ayuda: 'Liberación automática según la música (recomendado).' })))) });
    // tomas
    const tomasA = h('div', { class: 'list', id: 'tomasA' });
    const tomasCard = card({ id: 'tomas', title: 'Tomas', w2: false, body: h('div', null, tomasA, h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn sm primary', onclick: () => abrirGrabacion() }, icon('rec'), 'Grabar toma'), h('button', { class: 'btn sm', onclick: () => elegirArchivo('voz') }, icon('mic'), 'Cargar voz'))) });

    // ── por etapas, siguiendo el camino de la voz (24/11): cada etapa en su cuadrícula de tarjetas iguales ──
    const ETAPAS = [
      { id: 'voz', t: 'Voz', sub: 'Tomas, afinación y limpieza', cards: [tomasCard, afCard, corCard, gateCard, dsCard] },
      { id: 'color', t: 'Color', sub: 'EQ y tono', cards: [eqCard, rzCard, arCard, svCard] },
      { id: 'din', t: 'Dinámica', sub: 'Compresión', cards: [c1, c2, satCard, riderCard] },
      { id: 'esp', t: 'Espacio', sub: 'Ancho, eco y reverb', cards: [dblCard, dlyCard, revCard] },
      { id: 'mez', t: 'Mezcla', sub: 'Coros, pista y máster', cards: [mixCard, coroCard, pistaCard, limCard] },
    ];
    const nav = h('div', { class: 'etapas', role: 'tablist' });
    const secciones = ETAPAS.map((e, n) => {
      const leds = h('span', { class: 'leds' }, e.cards.map((el) => { const c = CARDS.find((x) => x.el === el); const d = h('i'); const u = c.upd; c.upd = () => { u(); d.classList.toggle('on', c.on ? !!getP(S.params, c.on) : true); }; return d; }));
      e.btn = h('button', { class: 'etapa', role: 'tab', ayuda: e.sub, onclick: () => verEtapa(e.id) }, h('b', null, (n + 1) + ' · ' + e.t), h('small', null, e.sub), leds);
      nav.appendChild(e.btn);
      return e.sec = h('section', { class: 'seccion', 'data-e': e.id }, h('h2', { class: 'sectit' }, (n + 1) + ' · ' + e.t, h('small', null, e.sub)), h('div', { class: 'cards ' + (e.id === 'color' ? 'color' : 'n' + e.cards.length) }, e.cards));
    });
    const btnTodo = h('button', { class: 'btn sm ghost etapa-todo', ayuda: 'Ver todas las etapas a la vez, una debajo de otra (para pantallas grandes).', onclick: () => verEtapa(S.etapa === 'todo' ? (S.etapaAnt || 'voz') : 'todo') }, icon('list'), 'Ver todo');
    nav.appendChild(btnTodo);
    function verEtapa(id) {
      if (id !== 'todo') S.etapaAnt = id; S.etapa = id; try { localStorage.setItem('voxlite.etapa', id); } catch (e) { /* sin almacenamiento */ }
      for (const e of ETAPAS) { e.btn.classList.toggle('on', id === e.id); e.sec.classList.toggle('hidden', id !== 'todo' && id !== e.id); }
      btnTodo.classList.toggle('on', id === 'todo'); adv.classList.toggle('todo', id === 'todo');
      requestAnimationFrame(() => { dibujarEq(); dibujarCurvas(); });
    }
    adv.append(top, nav, h('div', { class: 'secciones' }, secciones));
    let et0 = 'voz'; try { et0 = localStorage.getItem('voxlite.etapa') || 'voz'; } catch (e) { /* sin almacenamiento */ }
    verEtapa(ETAPAS.some((e) => e.id === et0) || et0 === 'todo' ? et0 : 'voz');
    construirBandas();
    eqEventos();
  }

  // ── EQ: pestañas y controles de la banda elegida ──
  function construirBandas() {
    bandTabs.innerHTML = '';
    S.params.eq.bandas.forEach((b, i) => {
      const t = h('button', { class: (i === bandSel ? 'sel' : '') + (b.on ? '' : ' off'), ayuda: (b.nombre || 'Banda ' + (i + 1)) + ' · clic para editarla', onclick: () => { bandSel = i; construirBandas(); dibujarEq(); } },
        h('span', { class: 'dot', style: { background: BCOL[i] } }), String(i + 1));
      bandTabs.appendChild(t);
    });
    const i = bandSel, P = (x) => 'eq.bandas.' + i + '.' + x, b = S.params.eq.bandas[i];
    // los controles de banda se rehacen: quitamos sus registros anteriores
    for (let k = REG.length - 1; k >= 0; k--) if (REG[k].path.startsWith('eq.bandas.')) REG.splice(k, 1);
    for (let k = VIS.length - 1; k >= 0; k--) if (VIS[k].eqb) VIS.splice(k, 1);
    const after = () => { construirBandasLigero(); };
    const isBell = (P2) => ['campana', 'graves', 'agudos'].includes(P2.eq.bandas[i].tipo);
    const w = (el, fn) => { const v = when(el, fn); VIS[VIS.length - 1].eqb = true; return v; };
    bandPanel.innerHTML = '';
    bandPanel.append(
      h('div', { class: 'row', style: { marginBottom: '8px' } },
        h('span', { class: 'caps', style: { color: BCOL[i] } }, (i + 1) + ' · ' + (b.nombre || '')),
        SW(P('on'), 'Encendida', { after }),
        SG(P('tipo'), [{ v: 'pasaaltos', label: 'Corte grave' }, { v: 'graves', label: 'Estante grave' }, { v: 'campana', label: 'Campana' }, { v: 'muesca', label: 'Muesca' }, { v: 'agudos', label: 'Estante agudo' }, { v: 'pasabajos', label: 'Corte agudo' }], { after, ayuda: 'Forma de la banda.' })),
      h('div', { class: 'grid' },
        K(P('f'), 'Frecuencia', 20, 20000, { curve: 'log', fmt: fmt.hz, after: dibujarEq, ayuda: 'Frecuencia central o de corte.' }),
        w(K(P('g'), 'Ganancia', -18, 18, { fmt: fmt.db, step: 0.1, def: 0, after: dibujarEq, ayuda: 'Subir o bajar esa zona.' }), isBell),
        w(K(P('q'), 'Anchura Q', 0.1, 18, { curve: 'log', fmt: fmt.q, def: 0.71, after: dibujarEq, ayuda: 'Q alta = banda estrecha (para resonancias). Q baja = ancha y musical.' }), (P2) => P2.eq.bandas[i].tipo !== 'pasaaltos' && P2.eq.bandas[i].tipo !== 'pasabajos'),
        w(h('div', { class: 'field' }, h('label', null, 'Pendiente'), SG(P('pendiente'), [6, 12, 18, 24, 36, 48].map((s) => ({ v: s, label: String(s) })), { after: dibujarEq, ayuda: 'dB por octava: cuánto corta.' })), (P2) => P2.eq.bandas[i].tipo === 'pasaaltos' || P2.eq.bandas[i].tipo === 'pasabajos')),
      w(h('div', { class: 'sect' },
        h('div', { class: 'row', style: { marginBottom: '6px' } }, SW(P('din.on'), 'Dinámica', { after, ayuda: 'La banda solo actúa cuando esa zona suena fuerte (como un compresor en esa frecuencia). Ideal para durezas y resonancias que van y vienen.' })),
        w(h('div', { class: 'grid' },
          K(P('din.umbral'), 'Umbral', -60, 0, { fmt: fmt.db, step: 0.5, def: -30, ayuda: 'Nivel de esa zona a partir del cual actúa.' }),
          K(P('din.rango'), 'Rango', -18, 18, { fmt: fmt.db, step: 0.5, def: -6, ayuda: 'Cuánto baja (negativo) o sube (positivo) como máximo.' }),
          K(P('din.ataque'), 'Ataque', 0.5, 200, { curve: 'log', fmt: fmt.ms, def: 5, ayuda: 'Velocidad de reacción.' }),
          K(P('din.relajacion'), 'Relajación', 10, 2000, { curve: 'log', fmt: fmt.ms, def: 120, ayuda: 'Velocidad de vuelta.' })), (P2) => P2.eq.bandas[i].din.on)), isBell));
    visibilidad();
  }
  function construirBandasLigero() { construirBandas(); dibujarEq(); }

  // ── EQ: dibujo con analizador de espectro ──
  let eqDyn = null, specBuf = null;
  const EQ = { fmin: 20, fmax: 20000, gmax: 18 };
  const fx = (f, w) => Math.log(f / EQ.fmin) / Math.log(EQ.fmax / EQ.fmin) * w;
  const xf = (x, w) => EQ.fmin * Math.pow(EQ.fmax / EQ.fmin, x / w);
  const gy = (g, hh) => hh / 2 - g / EQ.gmax * (hh / 2 - 10);
  const yg = (y, hh) => (hh / 2 - y) / (hh / 2 - 10) * EQ.gmax;
  function dibujarEq() {
    if (S.modo !== 'avanzado' || !eqCanvas.isConnected) return;
    const { g, w, h: hh } = UI.fitCanvas(eqCanvas); const sr = motor.sr;
    g.clearRect(0, 0, w, hh);
    g.font = '10px JetBrains Mono, monospace'; g.textBaseline = 'top';
    for (const f of [30, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) { const x = fx(f, w); g.strokeStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hh); g.stroke(); g.fillStyle = '#6e5d58'; g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x + 3, hh - 13); }
    for (const db of [-12, -6, 0, 6, 12]) { const y = gy(db, hh); g.strokeStyle = db === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.fillStyle = '#6e5d58'; g.fillText((db > 0 ? '+' : '') + db, 4, y + 2); }
    // espectro de la voz procesada
    if (motor.anVoz && motor.playing) {
      const an = motor.anVoz; if (!specBuf || specBuf.length !== an.frequencyBinCount) specBuf = new Float32Array(an.frequencyBinCount);
      an.getFloatFrequencyData(specBuf);
      g.beginPath(); g.moveTo(0, hh);
      for (let x = 0; x <= w; x += 2) {
        const f = xf(x, w), k = f / (sr / 2) * specBuf.length; const k0 = Math.floor(k), k1 = Math.min(specBuf.length - 1, Math.floor(xf(x + 2, w) / (sr / 2) * specBuf.length));
        let m = -200; for (let j = k0; j <= Math.max(k0, k1); j++) m = Math.max(m, specBuf[j] || -200);
        const db = m + 4.5 * Math.log2(Math.max(f, 20) / 1000); // pendiente de 4,5 dB/oct, como en los analizadores de estudio
        g.lineTo(x, D.clamp(hh - (db + 115) / 80 * hh, 0, hh)); // de −115 a −35 dB por banda
      }
      g.lineTo(w, hh); g.closePath();
      const gr = g.createLinearGradient(0, 0, 0, hh); gr.addColorStop(0, 'rgba(63,182,198,0.30)'); gr.addColorStop(1, 'rgba(63,182,198,0.02)');
      g.fillStyle = gr; g.fill();
    }
    const eq = S.modo === 'sencillo' ? efectivos().eq : S.params.eq;
    // banda elegida, sombreada
    const b = eq.bandas[bandSel];
    if (b && b.on) {
      g.beginPath(); g.moveTo(0, gy(0, hh));
      for (let x = 0; x <= w; x += 2) g.lineTo(x, gy(D.clamp(D.eqResponseDb({ on: true, bandas: [b] }, xf(x, w), sr), -EQ.gmax, EQ.gmax), hh));
      g.lineTo(w, gy(0, hh)); g.closePath(); g.fillStyle = BCOL[bandSel] + '33'; g.fill();
    }
    // curva total (y la dinámica en vivo)
    const curve = (dyn, color, lw) => {
      g.beginPath();
      for (let x = 0; x <= w; x += 2) { const db = D.eqResponseDb(eq, xf(x, w), sr, dyn); const y = gy(D.clamp(db, -EQ.gmax - 2, EQ.gmax + 2), hh); if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.strokeStyle = color; g.lineWidth = lw; g.stroke(); g.lineWidth = 1;
    };
    if (eqDyn && eq.bandas.some((bb) => bb.on && bb.din && bb.din.on)) curve(eqDyn, 'rgba(242,193,78,0.85)', 1.5);
    curve(null, eq.on ? '#f8ddd4' : '#6e5d58', 2.2);
    // puntos
    eq.bandas.forEach((bb, i) => {
      const x = fx(bb.f, w), isG = ['campana', 'graves', 'agudos'].includes(bb.tipo);
      const y = isG ? gy(bb.g, hh) : gy(0, hh);
      g.beginPath(); g.arc(x, y, i === bandSel ? 8 : 6.5, 0, Math.PI * 2);
      g.fillStyle = bb.on ? BCOL[i] : 'rgba(110,93,88,0.6)'; g.fill();
      g.strokeStyle = i === bandSel ? '#fff' : 'rgba(0,0,0,0.7)'; g.lineWidth = 2; g.stroke(); g.lineWidth = 1;
      g.fillStyle = '#0e0909'; g.font = 'bold 9px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x, y + 0.5); g.textAlign = 'left'; g.textBaseline = 'top';
    });
  }
  function eqEventos() {
    let drag = -1;
    const near = (e) => {
      const r = eqCanvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = -1, bd = 22;
      S.params.eq.bandas.forEach((b, i) => { const isG = ['campana', 'graves', 'agudos'].includes(b.tipo); const bx = fx(b.f, r.width), by = isG ? gy(b.g, r.height) : gy(0, r.height); const d = Math.hypot(bx - x, by - y); if (d < bd) { bd = d; best = i; } });
      return { best, x, y, r };
    };
    eqCanvas.addEventListener('pointerdown', (e) => { const n = near(e); if (n.best >= 0) { drag = n.best; bandSel = n.best; eqCanvas.setPointerCapture(e.pointerId); construirBandas(); dibujarEq(); } });
    eqCanvas.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      const r = eqCanvas.getBoundingClientRect(), b = S.params.eq.bandas[drag];
      b.f = Math.round(D.clamp(xf(e.clientX - r.left, r.width), 20, 20000));
      if (['campana', 'graves', 'agudos'].includes(b.tipo)) b.g = Math.round(D.clamp(yg(e.clientY - r.top, r.height), -18, 18) * 10) / 10;
      if (!b.on) b.on = true;
      S.modificado = true; push(); for (const rg of REG) if (rg.path.startsWith('eq.bandas.' + drag + '.')) rg.w.set(getP(S.params, rg.path));
    });
    const up = () => { if (drag >= 0) { drag = -1; construirBandas(); } };
    eqCanvas.addEventListener('pointerup', up); eqCanvas.addEventListener('pointercancel', up);
    eqCanvas.addEventListener('wheel', (e) => { const n = near(e); if (n.best < 0) return; /* solo encima de un punto: si no, la página se desplaza */ const i = n.best; const b = S.params.eq.bandas[i]; if (b.tipo === 'pasaaltos' || b.tipo === 'pasabajos') return; e.preventDefault(); b.q = Math.round(D.clamp(b.q * Math.pow(1.1, -Math.sign(e.deltaY)), 0.1, 18) * 100) / 100; bandSel = i; push(); construirBandas(); }, { passive: false });
    eqCanvas.addEventListener('dblclick', (e) => { const n = near(e); if (n.best >= 0) { const b = S.params.eq.bandas[n.best]; b.on = !b.on; push(); construirBandas(); } });
  }

  // ── curvas de los compresores ──
  const grNow = { c1: 0, c2: 0 };
  function dibujarCurvas() {
    if (S.modo !== 'avanzado') return;
    for (const { k, tf } of CURVAS) {
      if (!tf.isConnected) continue;
      const { g, w, h: hh } = UI.fitCanvas(tf), p = S.params[k];
      const X = (db) => (db + 60) / 66 * w, Y = (db) => hh - (db + 60) / 66 * hh;
      g.clearRect(0, 0, w, hh);
      g.strokeStyle = 'rgba(255,255,255,0.05)'; for (let d = -60; d <= 0; d += 12) { g.beginPath(); g.moveTo(X(d), 0); g.lineTo(X(d), hh); g.stroke(); g.beginPath(); g.moveTo(0, Y(d)); g.lineTo(w, Y(d)); g.stroke(); }
      g.setLineDash([3, 4]); g.strokeStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(X(-60), Y(-60)); g.lineTo(X(6), Y(6)); g.stroke(); g.setLineDash([]);
      g.beginPath(); for (let d = -60; d <= 6; d += 0.5) { const y = Y(D.clamp(D.compTransfer(p, d), -60, 6)); if (d === -60) g.moveTo(X(d), y); else g.lineTo(X(d), y); }
      g.strokeStyle = p.on ? '#d0202e' : '#6e5d58'; g.lineWidth = 2.2; g.shadowColor = 'rgba(208,32,46,0.6)'; g.shadowBlur = p.on ? 6 : 0; g.stroke(); g.shadowBlur = 0; g.lineWidth = 1;
      const s = D.compStatic(p);
      g.fillStyle = '#6e5d58'; g.font = '10px JetBrains Mono, monospace'; g.fillText('umbral ' + num(s.T) + ' dB · ' + (s.R >= 30 ? '∞' : num(s.R)) + ':1', 6, 14);
      // estela y bola: dónde está trabajando ahora mismo (entrada → salida); se apaga con la voz en silencio
      const hist = CINH[k] || [];
      if (p.on && hist.length) {
        hist.forEach((x, i) => { if (x < -60) return; const t = (i + 1) / hist.length, xx = Math.min(6, x); g.fillStyle = 'rgba(255,150,120,' + (0.08 + 0.35 * t * t) + ')'; g.beginPath(); g.arc(X(xx), Y(D.clamp(D.compTransfer(p, xx), -60, 6)), 2 + 1.5 * t, 0, Math.PI * 2); g.fill(); });
        const x = hist[hist.length - 1];
        if (x > -60) { const xx = Math.min(6, x), yy = D.clamp(D.compTransfer(p, xx), -60, 6), red = xx - yy;
          if (red > 0.3) { g.strokeStyle = 'rgba(255,190,90,0.7)'; g.beginPath(); g.moveTo(X(xx), Y(xx)); g.lineTo(X(xx), Y(yy)); g.stroke(); } // lo que baja
          g.fillStyle = '#fff'; g.shadowColor = '#ff5a4a'; g.shadowBlur = 10; g.beginPath(); g.arc(X(xx), Y(yy), 4.5, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0; }
      }
    }
  }

  // ───────────────────────── barra lateral ─────────────────────────
  const meters = {};
  function fader(nombre, path, min, max, ayuda) {
    const lvl = h('div', { class: 'lvl' }), cap = h('div', { class: 'cap' });
    const f = h('div', { class: 'fader', ayuda }, h('div', { class: 'slot' }), lvl, cap);
    const db = h('div', { class: 'db' });
    const m = UI.mapper({ min, max, curve: 1 });
    const set = (v) => { const t = m.to(v); cap.style.top = (6 + (1 - t) * (f.clientHeight - 12 || 288)) + 'px'; db.textContent = (v > 0 ? '+' : '') + num(v) + ' dB'; };
    let dn = false;
    const fromY = (e) => { const r = f.getBoundingClientRect(); const t = D.clamp(1 - (e.clientY - r.top - 6) / (r.height - 12), 0, 1); const v = Math.round(m.from(t) * 10) / 10; setP(S.params, path, v); set(v); S.modificado = true; push(); for (const rg of REG) if (rg.path === path) rg.w.set(v); };
    f.addEventListener('pointerdown', (e) => { dn = true; f.setPointerCapture(e.pointerId); fromY(e); });
    f.addEventListener('pointermove', (e) => { if (dn) fromY(e); });
    f.addEventListener('pointerup', () => { dn = false; });
    f.addEventListener('dblclick', () => { setP(S.params, path, 0); set(0); push(); refresh(); });
    REG.push({ src: 'p', path, w: { set } });
    const strip = h('div', { class: 'strip' }, h('div', { class: 'nm' }, nombre), f, db);
    return { strip, lvl, set };
  }
  function construirSidebar() {
    const fv = fader('VOZ', 'voz.volumen', -30, 12, 'Volumen de tu voz. Doble clic: 0 dB.');
    const fb = fader('BASE', 'base.volumen', -30, 12, 'Volumen de la base. Doble clic: 0 dB.');
    const fm = fader('MASTER', 'master.ganancia', -24, 24, 'Ganancia general antes del limitador. Al exportar con «Volumen final» se ajusta sola.');
    const ms = (path, cls, txt, ayuda) => { const b = h('button', { class: cls, ayuda }, txt); b.addEventListener('click', () => { setP(S.params, path, !getP(S.params, path)); b.classList.toggle('on', getP(S.params, path)); push(); }); REG.push({ src: 'p', path, w: { set: (v) => b.classList.toggle('on', !!v) } }); return b; };
    fv.strip.appendChild(h('div', { class: 'ms' }, ms('voz.mute', 'm', 'M', 'Silenciar la voz'), ms('voz.solo', 's', 'S', 'Solo la voz (silencia la base)')));
    fb.strip.appendChild(h('div', { class: 'ms' }, ms('base.mute', 'm', 'M', 'Silenciar la base')));
    fm.strip.appendChild(h('div', { class: 'ms' }, h('span', { style: { height: '18px' } })));
    meters.voz = fv.lvl; meters.base = fb.lvl; meters.master = fm.lvl;
    const objSel = Select({ label: 'Objetivo', value: String(S.objetivo), options: OBJETIVOS().map((o) => ({ v: o.v, label: o.v === 'none' ? 'Sin normalizar' : o.v + ' LUFS' })), ayuda: 'Volumen final de la exportación.', onChange: (v) => { S.objetivo = v === 'none' ? null : +v; sincObjetivo(); guardarEstado(); } });
    meters.objSel = objSel;
    const masterBtn = h('button', { class: 'btn primary block', ayuda: 'Limitador final encendido / apagado (mastering).', onclick: () => { S.params.master.on = !S.params.master.on; push(); refresh(); } }, 'Mastering');
    REG.push({ src: 'p', path: 'master.on', w: { set: (v) => { masterBtn.classList.toggle('primary', !!v); masterBtn.textContent = v ? 'Mastering' : 'Mastering apagado'; } } });
    meters.lufsM = h('b', null, '—'); meters.lufsS = h('b', null, '—'); meters.lufsI = h('div', { class: 'lufsbig' }, '— LUFS'); meters.tp = h('b', null, '—'); meters.lim = h('b', null, '0,0');
    meters.rider = h('div', { class: 'lufsbig' }, '+0,0 dB');
    const riderSw = Switch({ value: S.params.rider.on, ayuda: 'Encender el vocal rider', onChange: (v) => { S.params.rider.on = v; push(); refresh(); } });
    sidebar.append(
      h('div', { class: 'caps', style: { textAlign: 'center', color: 'var(--text)', fontSize: '11px' } }, 'Mezcla'),
      h('div', { class: 'mixer' }, fv.strip, fb.strip, fm.strip),
      h('div', { class: 'panel sbox', ayuda: 'Sonoridad (LUFS) de lo que suena: Momentáneo, Corto (3 s) e Integrado (desde que diste play). Pico = pico más alto de la salida.' },
        h('div', { class: 't' }, h('span', null, 'Salida'), h('span', { class: 'mono' }, 'LUFS')), meters.lufsI,
        h('div', { class: 'lufsrow' }, h('span', null, 'M ', meters.lufsM), h('span', null, 'C ', meters.lufsS)),
        h('div', { class: 'lufsrow' }, h('span', null, 'Pico ', meters.tp), h('span', null, 'Lim ', meters.lim))),
      masterBtn, objSel.el,
      h('div', { class: 'panel sbox', ayuda: 'Vocal rider: cuánto está moviendo ahora tu voz para mantenerla sobre la base.' },
        h('div', { class: 't' }, h('span', null, 'Vocal rider'), riderSw.el), meters.rider));
    REG.push({ src: 'p', path: 'rider.on', w: riderSw });
    requestAnimationFrame(() => { fv.set(S.params.voz.volumen); fb.set(S.params.base.volumen); fm.set(S.params.master.ganancia); });
  }
  const pk = { voz: -90, base: -90, mL: -90, mR: -90, tp: -90 };
  // gráfica del compresor en directo: últimos niveles de entrada (≈1,5 s) como estela sobre la curva (24/11)
  const CINH = { comp1: [], comp2: [] };
  motor.onMeters = (m) => {
    if (m.cin) { for (const [k, c] of [['comp1', 'c1'], ['comp2', 'c2']]) { const a = CINH[k]; a.push(m.cin[c]); if (a.length > 45) a.shift(); } if (S.modo === 'avanzado') dibujarCurvas(); }
    const fall = (old, nw) => (nw > old ? nw : old - 1.2);
    pk.voz = fall(pk.voz, m.voz); pk.base = fall(pk.base, m.base); pk.mL = fall(pk.mL, Math.max(m.mL, m.mR));
    if (m.mL > pk.tp || m.mR > pk.tp) pk.tp = Math.max(m.mL, m.mR);
    const H = (db) => D.clamp((db + 60) / 66, 0, 1) * 100 + '%';
    if (meters.voz) { meters.voz.style.height = H(pk.voz); meters.base.style.height = H(pk.base); meters.master.style.height = H(pk.mL); }
    const L = (v) => (isFinite(v) && v > -70 ? num(v) : '—');
    if (meters.lufsM) { meters.lufsM.textContent = L(m.lufsM); meters.lufsS.textContent = L(m.lufsS); meters.tp.textContent = pk.tp > -80 ? num(pk.tp) : '—'; meters.tp.classList.toggle('tpwarn', pk.tp > -0.9); meters.lim.textContent = num(m.gr.lim); }
    const setGr = (id, v) => { const el = document.getElementById(id); if (!el) return; el.querySelector('.gfill').style.width = D.clamp(-v / 20, 0, 1) * 100 + '%'; el.querySelector('.v').textContent = num(v) + ' dB'; };
    setGr('gr-comp1', m.gr.c1); setGr('gr-comp2', m.gr.c2); setGr('gr-ds', m.gr.deesser); setGr('gr-gate', m.gr.puerta); setGr('gr-rz', m.gr.realce); setGr('gr-sv', m.gr.suavizador); setGr('gr-cor', m.gr.corrector); setGr('gr-pista', m.gr.pista);
    { const el = document.getElementById('arNota'); if (el) el.textContent = m.nota > 0 ? (() => { const n = 12 * Math.log2(m.nota / 440) + 57, i = Math.round(n); return D.NOTAS[((i % 12) + 12) % 12] + Math.floor(i / 12) + ' · ' + fmt.hz(m.nota); })() : '—'; } setGr('gr-lim', m.gr.lim);
    const rv = (m.rider >= 0 ? '+' : '') + num(m.rider) + ' dB'; if (meters.rider) meters.rider.textContent = rv; const r2 = document.getElementById('riderVal'); if (r2) r2.textContent = rv;
    eqDyn = m.eqDin;
    if (recState && recState.meter) recState.meter(m.entrada);
  };
  setInterval(() => { if (motor.playing && motor.node) { motor.node.port.postMessage({ type: 'lufs-get' }); } }, 1000);
  motor._lufsRes = null;
  const lufsPoll = () => new Promise((res) => { motor._lufsRes = res; });
  (async function bucleLufs() { // el integrado llega por el mismo puerto
    for (;;) { const d = await lufsPoll(); if (meters.lufsI) meters.lufsI.textContent = (isFinite(d.integrado) ? num(d.integrado) : '—') + ' LUFS'; }
  })();

  // ───────────────────────── visor ─────────────────────────
  let wavePeaks = { base: null, voz: null, w: 0 };
  function calcPicos() {
    const r = visor.getBoundingClientRect(); const w = Math.max(50, Math.round(r.width)); const dur = motor.duracion();
    wavePeaks = { base: null, voz: null, w, dur };
    if (!dur) return;
    const sr = motor.sr;
    if (motor.base) {
      const n = Math.round(motor.base.duration / dur * w);
      const ch = [motor.base.getChannelData(0)]; if (motor.base.numberOfChannels > 1) ch.push(motor.base.getChannelData(1));
      wavePeaks.base = Object.assign(Analisis.picos(ch, Math.max(1, n)), { x0: 0, n });
    }
    if (motor.toma) {
      const t = motor.toma, n = Math.max(1, Math.round(t.buffer.duration / dur * w));
      wavePeaks.voz = Object.assign(Analisis.picos([t.buffer.getChannelData(0)], n), { x0: Math.round(t.inicio / dur * w), n });
    }
    dibujarOnda();
  }
  function dibujarOnda() {
    const { g, w, h: hh } = UI.fitCanvas(cvWave); g.clearRect(0, 0, w, hh);
    const dur = motor.duracion() || (recState && recState.len) || 0;
    visorEmpty.classList.toggle('hidden', !!dur || !!recState);
    const lane = (pkz, y0, y1, c1, c2) => {
      if (!pkz) return; const mid = (y0 + y1) / 2; let top = 0.05; for (let i = 0; i < pkz.n; i++) top = Math.max(top, -pkz.mn[i], pkz.mx[i]); const amp = (y1 - y0) / 2 / top;
      const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, c1); gr.addColorStop(0.5, c2); gr.addColorStop(1, c1);
      g.fillStyle = gr;
      for (let i = 0; i < pkz.n; i++) { const x = pkz.x0 + i * (w / wavePeaks.w); const a = Math.max(-pkz.mn[i], pkz.mx[i]); const hgt = Math.max(1, a * amp * 0.95); g.fillRect(x, mid - hgt, Math.max(1, w / wavePeaks.w), hgt * 2); }
    };
    g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(0, 0, w, 16);
    g.fillStyle = '#6e5d58'; g.font = '10px JetBrains Mono, monospace'; g.textBaseline = 'top';
    if (dur) { const stepS = dur > 240 ? 30 : dur > 90 ? 15 : dur > 30 ? 5 : 1; for (let t = 0; t < dur; t += stepS) { const x = t / dur * w; g.fillRect(x, 0, 1, 5); g.fillText(tiempo(t).replace(/,\d$/, ''), x + 3, 3); } }
    lane(wavePeaks.base, 20, hh * 0.56, 'rgba(126,63,61,0.55)', 'rgba(227,169,156,0.75)');
    lane(wavePeaks.voz, hh * 0.6, hh - 4, 'rgba(159,21,34,0.6)', 'rgba(255,120,130,0.95)');
    g.fillStyle = '#a8968f'; g.font = '600 9.5px Inter, sans-serif';
    if (wavePeaks.base) g.fillText('BASE', 6, 22);
    if (wavePeaks.voz) g.fillText('VOZ · ' + (S.tomas[S.tomaSel] ? S.tomas[S.tomaSel].nombre : ''), 6, hh * 0.6 + 2);
  }
  function dibujarCabezal() {
    const { g, w, h: hh } = UI.fitCanvas(cvTop); g.clearRect(0, 0, w, hh);
    const dur = Math.max(motor.duracion(), recState ? recState.pos + 1 : 0); if (!dur) return;
    if (motor.loop) { const a = motor.loop.a / dur * w, b = motor.loop.b / dur * w; g.fillStyle = 'rgba(63,182,198,0.12)'; g.fillRect(a, 0, b - a, hh); g.fillStyle = 'rgba(63,182,198,0.8)'; g.fillRect(a, 0, b - a, 3); }
    if (recState && recState.pos !== undefined) { const a = recState.desde / dur * w, b = recState.pos / dur * w; g.fillStyle = 'rgba(208,32,46,0.18)'; g.fillRect(a, hh * 0.58, b - a, hh * 0.42); }
    const x = motor.position() / dur * w;
    g.fillStyle = '#fff'; g.fillRect(x - 0.5, 0, 1.5, hh); g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 7); g.fill();
  }
  (function visorEventos() {
    let dn = null;
    visor.addEventListener('pointerdown', (e) => {
      const dur = motor.duracion(); if (!dur || recState) return;
      const r = visor.getBoundingClientRect(); const t = (e.clientX - r.left) / r.width * dur;
      dn = { t, ruler: e.clientY - r.top < 18, x: e.clientX }; visor.setPointerCapture(e.pointerId);
    });
    visor.addEventListener('pointermove', (e) => {
      if (!dn || !dn.ruler) return; const r = visor.getBoundingClientRect(), dur = motor.duracion();
      const t = D.clamp((e.clientX - r.left) / r.width * dur, 0, dur);
      if (Math.abs(e.clientX - dn.x) > 4) { motor.loop = { a: Math.min(dn.t, t), b: Math.max(dn.t, t) }; btnLoop.classList.add('on'); }
    });
    visor.addEventListener('pointerup', (e) => {
      if (!dn) return; const moved = Math.abs(e.clientX - dn.x) > 4;
      if (!moved) motor.seek(dn.t); else if (motor.loop && motor.loop.b - motor.loop.a < 0.3) { motor.loop = null; btnLoop.classList.remove('on'); }
      dn = null;
    });
  })();
  function toggleLoop() {
    if (grabando()) return;
    if (motor.loop) { S.loopGuard = motor.loop; motor.loop = null; btnLoop.classList.remove('on'); }
    else if (S.loopGuard) { motor.loop = S.loopGuard; btnLoop.classList.add('on'); }
    else toast('Arrastra sobre la regla del visor (la franja de arriba con los tiempos) para elegir el trozo que se repite.', 'info');
  }

  // bucle de animación: reloj, cabezal, EQ en vivo
  let lastEq = 0, lastIcon = '';
  function frame(ts) {
    const pos = motor.position(), dur = motor.duracion();
    clock.textContent = tiempo(pos) + ' / ' + tiempo(dur).replace(/,\d$/, '');
    const ic = motor.playing && !recState ? 'pause' : 'play';
    if (ic !== lastIcon) { lastIcon = ic; btnPlay.replaceChildren(icon(ic)); }
    dibujarCabezal();
    if (S.modo === 'avanzado' && motor.playing && ts - lastEq > 50) { lastEq = ts; dibujarEq(); }
    requestAnimationFrame(frame);
  }

  // ───────────────────────── archivos ─────────────────────────
  function elegirArchivo(tipo) {
    const inp = h('input', { type: 'file', accept: 'audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.webm' });
    inp.addEventListener('change', () => { if (inp.files[0]) cargarArchivo(inp.files[0], tipo); });
    inp.click();
  }
  // mientras se graba no se puede cambiar de canción, de toma ni de punto
  function grabando() { if (recState) { toast('Estás grabando: para primero la grabación (■).', 'warn', 2500); return true; } return false; }
  async function cargarArchivo(file, tipo) {
    if (grabando()) return;
    if (file.size > 400 * 1024 * 1024) { toast('Ese archivo es demasiado grande (más de 400 MB).', 'err'); return; }
    const espera = toast2('Leyendo ' + file.name + '…');
    try {
      const ab = await file.arrayBuffer();
      const buf = await motor.decode(ab);
      if (buf.duration > 20 * 60) throw new Error('El audio dura más de 20 minutos.');
      if (tipo === 'base') ponerBase(buf, file.name);
      else { const t = nuevaToma(motor.toMono(buf), 0, file.name.replace(/\.[^.]+$/, '')); toast('Voz cargada: <b>' + escapar(file.name) + '</b>', 'ok'); if (S.modo === 'sencillo' || !S.auto) mezclaAuto(true); }
    } catch (e) {
      toast('No he podido abrir <b>' + escapar(file.name) + '</b>. Prueba con WAV o MP3. (' + escapar(e.message || String(e)) + ')', 'err');
    } finally { espera(); }
  }
  function ponerBase(buf, nombre, bpm) {
    S.tocado = true;
    if (motor.base && motor.playing) motor.stop();
    S.bpmManual = !!bpm; if (bpm) { S.params.bpm = bpm; bpmIn.value = bpm; push(); }
    motor.base = buf; motor.baseNombre = nombre; S.baseNombre = nombre; programarAfinado();
    motor.loop = null; S.loopGuard = null; btnLoop.classList.remove('on');
    toast('Base cargada: <b>' + escapar(nombre) + '</b> (' + tiempo(buf.duration).replace(/,\d$/, '') + ')', 'ok');
    if (!S.bpmManual) { setTimeout(() => { const b = Analisis.tempo(buf); if (b) { S.params.bpm = b; bpmIn.value = b; push(); } }, 30); }
    actualizarCabecera(); calcPicos(); guardarSesion();
  }
  async function cargarBaseAleran(i) {
    if (grabando()) return;
    const b = (window.VOX_BASES_ALERAN || [])[i]; if (!b) return;
    const espera = toast2('Descargando la base…');
    try {
      const r = await fetch(b.archivo); if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = await motor.decode(await r.arrayBuffer());
      ponerBase(buf, b.nombre, b.bpm);
    } catch (e) { toast('No se pudo cargar la base de Áleran (' + escapar(e.message) + '). Si abriste la página desde tu ordenador, esto solo funciona ya subida a la web.', 'err'); }
    finally { espera(); }
  }
  function toast2(msg) { let box = document.getElementById('toasts'); if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(box); } const t = h('div', { class: 'toast' }, msg); box.appendChild(t); return () => t.remove(); }
  const escapar = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // arrastrar y soltar
  (function dnd() {
    let zone = null, cnt = 0;
    window.addEventListener('dragenter', (e) => { if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return; cnt++; if (!zone) { zone = h('div', { class: 'dropzone' }, 'Suelta aquí tu base o tu voz'); document.body.appendChild(zone); } });
    window.addEventListener('dragleave', () => { cnt--; if (cnt <= 0 && zone) { zone.remove(); zone = null; cnt = 0; } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault(); cnt = 0; if (zone) { zone.remove(); zone = null; }
      const files = [...(e.dataTransfer.files || [])].filter((f) => /^audio\//.test(f.type) || /\.(wav|mp3|m4a|aac|flac|ogg|opus|webm)$/i.test(f.name));
      if (!files.length) { toast('Eso no parece un archivo de audio.', 'warn'); return; }
      const esVoz = (f) => /(voz|vocal|voice|acapella|a.capella|lead|toma)/i.test(f.name);
      files.sort((a, b) => esVoz(a) - esVoz(b));
      (async () => { for (const f of files) await cargarArchivo(f, esVoz(f) || (motor.base && files.length === 1 && !/(base|inst|karaoke|beat|pista|backing)/i.test(f.name)) ? 'voz' : 'base'); })();
    });
  })();

  // ───────────────────────── tomas ─────────────────────────
  let tomaId = 0;
  function nuevaToma(buffer, inicio, nombre) {
    S.tocado = true;
    const t = { id: ++tomaId, nombre: nombre || 'Toma ' + (S.tomas.length + 1), buffer, inicio, fecha: Date.now() };
    S.tomas.push(t); elegirToma(S.tomas.length - 1); guardarSesion();
    return t;
  }
  function nuevoCoro(buffer, inicio) { // toma grabada «como coro»: no pasa a ser la principal
    S.tocado = true;
    const n = S.tomas.filter((x) => x.coro).length;
    const t = { id: ++tomaId, nombre: 'Coro ' + (n + 1), buffer, inicio, fecha: Date.now(), coro: true, cVol: -4, cPan: n % 2 ? 40 : -40 };
    S.tomas.push(t); sincCoros(); pintarTomas(); guardarSesion(); return t;
  }
  function elegirToma(i) {
    if (recState) return;
    S.tomaSel = i; const t = S.tomas[i];
    const pos = motor.position(), was = motor.playing;
    motor.toma = t ? { buffer: t.buffer, inicio: t.inicio, afinado: (afHecho(t, claveActual()) || {}).out || null, afinadoClave: claveActual() } : null; // la afinada ya calculada suena al momento
    sincCoros(true);
    if (was) motor.play(pos);
    pintarTomas(); actualizarCabecera(); calcPicos(); guardarSesion(); programarAfinado();
  }
  // coros (24/11): tomas marcadas como «coro» que suenan a la vez que la principal, cada una con su volumen y panorama
  function sincCoros(sinReiniciar) {
    const antes = motor.coros.map((c) => c.buffer), lista = S.tomas.filter((t, i) => t.coro && i !== S.tomaSel);
    const ca = claveActual();
    motor.coros = lista.map((t) => { const h = afHecho(t, ca); return { buffer: t.buffer, inicio: t.inicio, vol: t.cVol, pan: t.cPan, afinado: h ? h.out : null, afinadoClave: h ? ca : null }; });
    const cambia = antes.length !== lista.length || antes.some((b, i) => b !== lista[i].buffer);
    if (cambia && !sinReiniciar && motor.playing) motor.play(motor.position()); else if (!cambia) motor.mezclaCoros();
    if (cambia) programarAfinado(); // un coro nuevo también se afina
  }
  function marcarCoro(i, si) {
    if (recState) return; // grabando: no se cambia nada de lo que suena
    const t = S.tomas[i]; if (!t || i === S.tomaSel) return;
    t.coro = !!si; if (t.coro && t.cVol === undefined) { const n = S.tomas.filter((x) => x.coro).length; t.cVol = -4; t.cPan = n % 2 ? -40 : 40; }
    sincCoros(); pintarTomas(); guardarSesion();
  }
  function pintarTomas() {
    for (const box of [listaTomasS, document.getElementById('tomasA')]) {
      if (!box) continue; box.innerHTML = '';
      if (!S.tomas.length) { box.appendChild(h('div', { class: 'tip' }, 'Aún no hay tomas. Pulsa Grabar.')); continue; }
      S.tomas.forEach((t, i) => {
        const nudge = h('input', { type: 'number', step: 5, value: 0, style: { width: '64px' }, class: 'input', 'aria-label': 'Mover toma (ms)', ayuda: 'Mueve la toma unos milisegundos si la oyes adelantada (negativo) o retrasada (positivo) respecto a la base. Escribe y pulsa Intro.' });
        nudge.addEventListener('change', () => {
          const ms = D.clamp(parseFloat(nudge.value) || 0, -500, 500); nudge.value = 0; if (!ms || recState) return;
          let ini = t.inicio - ms / 1000;
          if (ini < 0) { // adelantar más allá del principio: se recorta el comienzo de la toma
            const sr = t.buffer.sampleRate, k = Math.round(-ini * sr);
            if (k >= t.buffer.length - sr * 0.5) { toast('No se puede mover tanto.', 'warn'); return; }
            const nb = motor.ctx.createBuffer(1, t.buffer.length - k, sr); nb.copyToChannel(t.buffer.getChannelData(0).subarray(k), 0); t.buffer = nb; ini = 0;
          }
          t.inicio = ini; if (S.tomaSel === i) elegirToma(i); else { sincCoros(); if (t.coro && motor.playing) motor.play(motor.position()); pintarTomas(); guardarSesion(); }
          toast('Toma movida ' + Math.abs(ms) + ' ms ' + (ms > 0 ? 'antes (adelantada)' : 'después (retrasada)') + '.', 'ok');
        });
        box.appendChild(h('div', { class: 'item' + (i === S.tomaSel ? ' sel' : '') },
          h('input', { type: 'radio', name: 'toma' + (box === listaTomasS ? 's' : 'a'), checked: i === S.tomaSel, 'aria-label': 'Usar ' + t.nombre, onchange: () => elegirToma(i), style: { accentColor: 'var(--accent)' } }),
          h('div', { class: 'grow' }, h('div', { class: 'nm' }, t.nombre), h('div', { class: 'meta' }, tiempo(t.buffer.duration).replace(/,\d$/, '') + ' · empieza en ' + tiempo(t.inicio))),
          S.modo === 'avanzado' ? nudge : null,
          h('button', { class: 'btn sm iconbtn ghost', 'aria-label': 'Renombrar', ayuda: 'Cambiar el nombre de la toma', onclick: async () => { const n = await ask('Nombre de la toma', 'Nombre', t.nombre); if (n) { t.nombre = n; pintarTomas(); calcPicos(); guardarSesion(); } } }, icon('list')),
          i === S.tomaSel ? h('span', { class: 'tag principal', ayuda: 'Esta es tu voz principal (la que lleva toda la cadena). Elige otra con el círculo.' }, 'Principal')
            : h('button', { class: 'btn sm coro' + (t.coro ? ' on' : ''), ayuda: t.coro ? 'Quitar del coro' : 'Que esta toma suene como coro junto a la principal (dobles, armonías, voces de fondo).', onclick: () => marcarCoro(i, !t.coro) }, 'Coro'),
          h('button', { class: 'btn sm iconbtn ghost', 'aria-label': 'Borrar toma', ayuda: 'Borrar esta toma', onclick: () => borrarToma(i) }, icon('trash'))));
        if (t.coro && i !== S.tomaSel) {
          const vol = Bar({ label: 'Volumen', min: -30, max: 6, def: -4, value: t.cVol, fmt: fmt.db, step: 0.5, ayuda: 'Volumen de este coro (la cadena de coros tiene además su volumen general).', onChange: (v) => { t.cVol = v; sincCoros(); }, onEnd: () => guardarSesion() });
          const pan = Bar({ label: 'Panorama', min: -100, max: 100, def: 0, value: t.cPan, fmt: fmt.pan, step: 1, ayuda: 'Izquierda o derecha. Abre los coros a los lados y deja el centro para tu voz principal.', onChange: (v) => { t.cPan = v; sincCoros(); }, onEnd: () => guardarSesion() });
          box.appendChild(h('div', { class: 'coromix' }, vol.el, pan.el));
        }
      });
    }
    const ok = S.tomas.length > 0;
    vozOk.replaceChildren(...(ok ? [icon('check'), S.tomas[S.tomaSel] ? S.tomas[S.tomaSel].nombre + ' (' + S.tomas.length + (S.tomas.length === 1 ? ' toma)' : ' tomas)') : ''] : []));
    actualizarPasos();
  }
  function borrarToma(i) {
    if (grabando()) return;
    const t = S.tomas[i];
    if (!confirm('¿Borrar «' + t.nombre + '»? No se puede deshacer.')) return;
    S.tomas.splice(i, 1);
    let sel = S.tomaSel; if (sel > i) sel--; else if (sel === i) sel = Math.min(i, S.tomas.length - 1);
    elegirToma(S.tomas.length ? Math.max(0, sel) : -1);
    guardarSesion();
  }

  // ───────────────────────── reproducción ─────────────────────────
  async function togglePlay() {
    if (recState) { pararGrabacion(); return; }
    try {
      if (motor.playing) { motor.stop(); return; }
      if (!motor.duracion()) { toast('Primero carga una base o graba tu voz.', 'warn'); return; }
      if (motor.position() >= motor.duracion()) motor.pos = 0;
      motor.resetLufs(); pk.tp = -90;
      await motor.play();
    } catch (e) { errorAudio(e); }
  }
  function pararTodo() { if (recState) { pararGrabacion(); return; } if (!motor.playing) motor.pos = 0; motor.stop(); }
  motor.onEnd = () => {};
  function errorAudio(e) { console.error(e); toast('Problema de audio: ' + escapar(e.message || String(e)), 'err'); }

  // ───────────────────────── grabación ─────────────────────────
  let recState = null;
  async function abrirGrabacion() {
    if (recState) { pararGrabacion(); return; }
    try { await motor.resume(); } catch (e) { errorAudio(e); return; }
    let stream = null, stopMon = null, clipT = 0;
    const lvl = h('div', { class: 'f' }), clip = h('div', { class: 'clip' }), lvlTxt = h('span', { class: 'mono dim' }, '—');
    const dev = Select({ label: 'Micrófono', options: [{ v: '', label: 'Micrófono predeterminado' }], ayuda: 'Elige tu micrófono o tu interfaz de audio.' });
    const desdeSel = Seg({ options: [{ v: 'inicio', label: 'Desde el principio' }, { v: 'cursor', label: 'Desde el cursor (' + tiempo(motor.position()).replace(/,\d$/, '') + ')' }], value: motor.position() > 0.5 ? 'cursor' : 'inicio' });
    const cuenta = Seg({ options: [{ v: 0, label: 'Sin cuenta' }, { v: 1, label: '1 compás' }, { v: 2, label: '2 compases' }], value: lsGet('voxlite.cuenta', motor.base ? 1 : 1) });
    const metro = Switch({ label: 'Metrónomo mientras grabo', value: lsGet('voxlite.metro', !motor.base) });
    const comoCoro = Switch({ label: 'Grabar como coro (oigo mi voz principal)', value: false, ayuda: 'Para grabar dobles y armonías: mientras grabas suenan tu voz principal y los coros, y la toma nueva se queda como coro (tu principal y tu mezcla no cambian).' });
    const escuchar = Switch({ label: 'Escucharme con los efectos', value: lsGet('voxlite.escuchar', false), ayuda: 'Te oyes con la reverb y la compresión mientras cantas. Tiene un pequeño retraso: si te molesta, apágalo y usa la escucha directa de tu interfaz.' });
    const latTxt = h('span');
    const pintaLat = () => { const L = motor.latInfo; latTxt.textContent = 'Compensación de latencia: ' + Math.round(motor.latenciaTotal() * 1000) + ' ms (' + (L.calibrada !== null ? 'calibrada' : 'estimada') + (L.ajuste ? ', ajuste ' + L.ajuste + ' ms' : '') + ')'; };
    const grabarBtn = h('button', { class: 'btn primary lg', disabled: true }, icon('rec'), 'Empezar a grabar');
    let token = 0;
    const info = h('div', { class: 'callout' }, 'Ponte ', h('b', null, 'auriculares'), ' para que la base no se cuele en el micro. Canta fuerte: la barra debe moverse por el verde y el amarillo, sin tocar el rojo.');
    const body = h('div', { class: 'stack' }, info,
      h('div', { class: 'field' }, h('label', null, 'Micrófono'), dev.el),
      h('div', { class: 'field' }, h('label', null, 'Nivel de entrada'), h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('div', { class: 'meterh grow', style: { flex: 1 } }, lvl, clip), lvlTxt)),
      h('div', { class: 'field' }, h('label', null, 'Dónde empieza'), desdeSel.el),
      h('div', { class: 'field' }, h('label', null, 'Cuenta atrás'), cuenta.el),
      metro.el, escuchar.el, S.tomas.length ? comoCoro.el : null,
      h('div', { class: 'row dim', style: { fontSize: '12px' } }, latTxt, h('button', { class: 'btn sm ghost', onclick: () => { cerrar(); abrirAudio(); } }, 'Calibrar')),
      h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => cerrar() }, 'Cancelar'), grabarBtn));
    let arrancando = false, cerrado = false;
    const avisoLatencia = () => { const c = motor.latInfo.calSalida, now = (motor.ctx.outputLatency || 0) + (motor.ctx.baseLatency || 0); if (motor.latInfo.calibrada !== null && typeof c === 'number' && Math.abs(now - c) > 0.02) latTxt.innerHTML = '<span style="color:var(--amber)">Tu salida de audio ha cambiado desde que calibraste (¿auriculares Bluetooth?). Vuelve a calibrar o usa auriculares de cable.</span>'; };
    const m = modal({ title: 'Grabar tu voz', sub: motor.base ? 'Sonará la base y grabaremos tu micro a la vez.' : 'No hay base cargada: grabarás a capela (con metrónomo si quieres).', icon: 'mic', body, onClose: () => { cerrado = true; if (!arrancando) soltar(); } });
    const cerrar = () => m.close();
    const soltar = () => { if (stopMon) { stopMon(); stopMon = null; } if (stream && !recState && !arrancando) stream.getTracks().forEach((t) => t.stop()); };
    const meter = (pk2) => { const db = 20 * Math.log10(pk2 + 1e-9); lvl.style.width = D.clamp((db + 60) / 60, 0, 1) * 100 + '%'; lvlTxt.textContent = db > -90 ? Math.round(db) + ' dB' : '—'; if (pk2 > 0.98) { clip.classList.add('on'); clearTimeout(clipT); clipT = setTimeout(() => clip.classList.remove('on'), 1500); } };
    pintaLat();
    async function abrir() {
      soltar(); grabarBtn.disabled = true; const yo = ++token;
      try {
        const st = await motor.abrirMicro();
        if (yo !== token || cerrado) { st.getTracks().forEach((t) => t.stop()); return; } // la ventana ya se cerró o se cambió de micro
        stream = st; pintaLat();
        stopMon = await motor.monitorizarNivel(stream, meter);
        grabarBtn.disabled = false;
        avisoLatencia();
        const ins = await motor.listarEntradas();
        dev.fill([{ v: '', label: 'Micrófono predeterminado' }].concat(ins.map((d, k) => ({ v: d.deviceId, label: d.label || 'Micrófono ' + (k + 1) }))));
        dev.set(motor.inputDevice || '');
      } catch (e) {
        info.className = 'callout'; info.style.borderColor = 'var(--accent)';
        info.innerHTML = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? '<b>El navegador no deja usar el micrófono.</b> Pulsa el candado de la barra de direcciones → Micrófono → Permitir, y vuelve a abrir esta ventana.' : (e && e.name === 'NotFoundError' ? '<b>No encuentro ningún micrófono.</b> Conéctalo y vuelve a abrir esta ventana.' : 'No se pudo abrir el micrófono: ' + escapar(e.message || String(e)));
        grabarBtn.disabled = true;
      }
    }
    dev.el.addEventListener('change', () => { motor.inputDevice = dev.get(); motor.guardarAjustes(); abrir(); });
    grabarBtn.addEventListener('click', async () => {
      lsSet('voxlite.cuenta', cuenta.get()); lsSet('voxlite.metro', metro.get()); lsSet('voxlite.escuchar', escuchar.get());
      if (!stream || recState) return;
      if (stopMon) { stopMon(); stopMon = null; }
      const desde = desdeSel.get() === 'cursor' ? motor.position() : 0;
      arrancando = true; m.close();
      try { await empezarGrabacion({ stream, desde, compases: +cuenta.get(), metronomo: metro.get(), escucharme: escuchar.get(), oirVoces: S.tomas.length > 0 && comoCoro.get(), comoCoro: S.tomas.length > 0 && comoCoro.get() }); }
      catch (e) { if (stream) stream.getTracks().forEach((t) => t.stop()); errorAudio(e); }
    });
    abrir();
  }
  async function empezarGrabacion(o) {
    if (recState) return;
    recState = { desde: o.desde, pos: o.desde, len: 0, stream: o.stream, arrancando: true, comoCoro: !!o.comoCoro };
    let r;
    try { r = await motor.grabar(o); }
    catch (e) { recState = null; throw e; }
    recState.arrancando = false;
    if (recState.cancelar) { await pararGrabacion(true); return; }
    btnRec.classList.add('armed'); recBadge.classList.remove('hidden');
    // panel flotante con el nivel mientras se graba
    const lvl = h('div', { class: 'f' }), clip = h('div', { class: 'clip' });
    let clipT = 0;
    const meter = (pk2) => { const db = 20 * Math.log10(pk2 + 1e-9); lvl.style.width = D.clamp((db + 60) / 60, 0, 1) * 100 + '%'; if (pk2 > 0.98) { clip.classList.add('on'); clearTimeout(clipT); clipT = setTimeout(() => clip.classList.remove('on'), 1500); } };
    motor.onRecLevel = meter;
    recState.panel = h('div', { class: 'meterh', style: { width: '180px' } }, lvl, clip);
    recBadge.appendChild(recState.panel);
    recState.timer = setInterval(() => { recState.pos = motor.position(); recState.len = recState.pos; const t = recBadge.querySelector('span:nth-child(2)'); const pre = motor.ctx.currentTime < r.T0; t.textContent = pre ? 'PREPÁRATE…' : 'GRABANDO ' + tiempo(recState.pos - o.desde).replace(/,\d$/, ''); }, 100);
    status.textContent = 'Grabando: pulsa ■, ● o la barra espaciadora para parar.';
  }
  async function pararGrabacion(forzar) {
    if (!recState || (recState.parando && !forzar)) return;
    if (recState.arrancando) { recState.cancelar = true; return; } // se para en cuanto termine de arrancar
    const st = recState; st.parando = true; clearInterval(st.timer);
    btnRec.classList.remove('armed'); recBadge.classList.add('hidden'); if (st.panel) st.panel.remove();
    recBadge.querySelector('span:nth-child(2)').textContent = 'GRABANDO';
    motor.onRecLevel = null; motor.onRecChunk = null;
    let res = null;
    try { res = await motor.pararGrabacion(); } catch (e) { errorAudio(e); }
    if (st.stream) st.stream.getTracks().forEach((t) => t.stop());
    recState = null;
    if (st.cancelar) { dibujarOnda(); return; }
    if (!res || res.buffer.duration < 0.5) { toast('La grabación era demasiado corta y no se ha guardado.', 'warn'); dibujarOnda(); return; }
    let pk2 = 0; const d = res.buffer.getChannelData(0); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > pk2) pk2 = a; }
    const t = st.comoCoro ? nuevoCoro(res.buffer, res.inicio) : nuevaToma(res.buffer, res.inicio);
    motor.pos = res.inicio;
    if (pk2 < 0.003) toast('<b>' + t.nombre + '</b> está casi en silencio. ¿Está bien elegido el micrófono?', 'warn', 8000);
    else if (pk2 > 0.99) toast('<b>' + t.nombre + '</b> guardada, pero <b>ha saturado</b> (rojo). Baja la ganancia del micro o aléjate un poco y repite.', 'warn', 9000);
    else toast('<b>' + t.nombre + '</b> guardada (' + tiempo(res.buffer.duration).replace(/,\d$/, '') + '). Dale ▶ para escucharla mezclada.', 'ok');
    if (st.comoCoro) toast('<b>' + t.nombre + '</b> se ha quedado como <b>coro</b>. Ajusta su volumen y su lado en la lista de tomas.', 'info', 6000);
    else if (S.modo === 'sencillo' || !S.auto) mezclaAuto(true);
    else toast('Tus ajustes del modo avanzado se mantienen. Si quieres que vuelva a analizar tu voz, pulsa «Mezcla auto».', 'info', 6000);
  }

  // ───────────────────────── mezcla automática ─────────────────────────
  let autoBusy = false;
  async function mezclaAuto(silenciosa) {
    if (autoBusy) return; if (!motor.toma) { if (!silenciosa) toast('Primero graba o carga tu voz.', 'warn'); return; }
    autoBusy = true; const espera = toast2('Analizando tu voz…');
    try {
      await afinadoListo();
      const base = presetPorId(S.presetId);
      const antes = JSON.stringify(S.params);
      const pBase = clone(S.params); pBase.bypass = false; pBase._delante = delanteDe(base); pBase._bpmManual = S.bpmManual;
      const r = await Analisis.autoMezcla(motor, pBase);
      delete r.params._delante; delete r.params._bpmManual;
      if (JSON.stringify(S.params) !== antes) { toast('Has cambiado ajustes mientras analizaba: no he aplicado la mezcla automática. Pulsa «Mezcla auto» otra vez cuando quieras.', 'warn', 6000); return; }
      r.params.bypass = S.params.bypass;
      S.params = r.params; S.auto = clone(r.params); S.autoExtra = r.extra || null;
      bpmIn.value = S.params.bpm;
      refresh(); push();
      autoNotas.innerHTML = '<div class="caps" style="margin:6px 0">Lo que he ajustado</div>' + r.notas.map((n) => '· ' + escapar(n)).join('<br>');
      if (!silenciosa || S.modo === 'sencillo') toast('Mezcla automática hecha. ' + (S.modo === 'sencillo' ? 'Mira «Lo que he ajustado».' : 'Revisa la EQ, el de-esser y el volumen.'), 'ok');
    } catch (e) { toast(escapar(e.message || String(e)), 'err'); }
    finally { espera(); autoBusy = false; }
  }

  // ───────────────────────── presets ─────────────────────────
  function opcionesPresets() {
    const mis = misPresets();
    const o = [{ group: 'Estilos de Áleran', items: PRESETS.map((p) => ({ v: p.id, label: p.nombre })) }];
    if (mis.length) o.push({ group: 'Mis presets', items: mis.map((p) => ({ v: p.id, label: p.nombre })) });
    return o;
  }
  function actualizarPresetUI() {
    const o = opcionesPresets(); presetSel.fill(o); presetSelA.fill(o);
    presetSel.set(S.presetId); presetSelA.set(S.presetId);
    const pr = presetPorId(S.presetId);
    presetDesc.textContent = pr ? (pr.descripcion || '') : 'Ajustes personalizados.';
  }
  function elegirPreset(id) {
    const pr = presetPorId(id); if (!pr) return;
    const bpm = S.params.bpm, baseVol = S.params.base.volumen;
    // tus faders se respetan, pero la voz se mueve lo que cambia el «delante» de un estilo a otro
    const vozVol = D.clamp(S.params.voz.volumen + (S.auto ? delanteDe(pr) - delanteDe(presetPorId(S.presetId)) : 0), -60, 12);
    let p = paramsDePreset(pr); delete p._delante;
    p.bpm = bpm;
    p = aplicarAuto(p);
    p.corrector = clone(S.params.corrector); // «Voz de móvil» es de tu micro: cambiar de estilo no toca lo que hayas ajustado
    p.afinador = clone(S.params.afinador); // el Afinador es de tu voz, no del estilo
    p.pista = clone(S.params.pista); p.coros = clone(S.params.coros); // la pista y los coros son de tu canción
    p.voz.volumen = vozVol; p.base.volumen = baseVol; // cambiar de estilo no toca tus faders
    S.presetId = id; S.params = p; S.modificado = false;
    refresh(); push();
    toast('Estilo: <b>' + escapar(pr.nombre) + '</b>', 'ok', 2200);
  }
  async function guardarPreset() {
    const n = await ask('Guardar preset', 'Nombre del preset', (presetPorId(S.presetId) || {}).nombre ? (presetPorId(S.presetId).nombre + ' (mío)') : 'Mi sonido');
    if (!n) return;
    const p = clone(efectivos()); delete p.bypass;
    const mis = misPresets(); const id = 'mio-' + Date.now().toString(36);
    mis.push({ id, nombre: n, descripcion: 'Preset guardado por ti el ' + new Date().toLocaleDateString('es-ES') + '.', origen: 'mio', delante: delanteDe(presetPorId(S.presetId)), params: p });
    lsSet(LS_MIS, mis);
    if (S.modo === 'sencillo') { S.params = p; S.macros = { delante: 0, brillo: 0, cuerpo: 0, compresion: 0, reverb: 0, eco: 0, ancho: 0, realce: 0, suavizar: 0, armonicos: 0, pausas: 0 }; }
    S.presetId = id; refresh(); push();
    const dl = h('button', { class: 'btn sm', onclick: () => descargarPreset(n, p) }, icon('download'), 'Descargar archivo');
    const m = modal({ title: 'Preset guardado', icon: 'check', body: h('div', { class: 'stack' }, h('div', null, '«' + n + '» está en «Mis presets» de este navegador.'),
      h('div', { class: 'tip' }, 'Para pasarlo a otro ordenador o a Áleran, descarga el archivo o copia el enlace.'),
      h('div', { class: 'foot' }, dl, h('button', { class: 'btn sm', onclick: () => { compartirPreset(); } }, icon('share'), 'Copiar enlace'), h('button', { class: 'btn primary sm', onclick: () => m.close() }, 'Hecho'))) });
  }
  function descargarPreset(nombre, p) {
    const blob = new Blob([JSON.stringify({ app: 'EpicStudio Lite', version: 1, nombre, params: p }, null, 2)], { type: 'application/json' });
    Exportar.descargar(blob, 'Preset EpicStudio - ' + Exportar.limpiarNombre(nombre) + '.json');
  }
  // diferencias con los valores por defecto (enlaces cortos)
  function diff(a, b) {
    if (Array.isArray(a)) { const o = a.map((x, i) => diff(x, b ? b[i] : undefined)); return o.every((x) => x === undefined) ? undefined : o.map((x) => (x === undefined ? {} : x)); }
    if (a && typeof a === 'object') { const o = {}; let any = false; for (const k of Object.keys(a)) { if (k === 'nombre') continue; const d = diff(a[k], b ? b[k] : undefined); if (d !== undefined) { o[k] = d; any = true; } } return any ? o : undefined; }
    return a === b ? undefined : a;
  }
  const b64u = { enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))) };
  async function compartirPreset() {
    const p = clone(efectivos()); delete p.bypass;
    const pr = presetPorId(S.presetId);
    sinPersonales(p);
    const data = { n: (pr ? pr.nombre : 'Preset') + (S.modificado ? ' (ajustado)' : ''), p: diff(p, DEF) || {} };
    const url = location.href.split('#')[0] + '#preset=' + b64u.enc(JSON.stringify(data));
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado. Pégalo en WhatsApp o en un correo: quien lo abra cargará tus ajustes (no se envía tu voz).', 'ok', 6000); }
    catch (e) { modal({ title: 'Copia este enlace', body: h('div', null, h('textarea', { class: 'input', style: { height: '110px', width: '100%', padding: '8px' }, readonly: true }, url)) }); }
  }
  function importarPreset() {
    const inp = h('input', { type: 'file', accept: '.json,application/json' });
    inp.addEventListener('change', async () => {
      try {
        const j = JSON.parse(await inp.files[0].text());
        if (!j || typeof j.params !== 'object') throw new Error('no es un preset de EpicStudio Lite');
        recibirPreset(j.nombre || inp.files[0].name.replace(/\.json$/i, ''), j.params);
      } catch (e) { toast('No he podido leer ese preset: ' + escapar(e.message), 'err'); }
    });
    inp.click();
  }
  // nivel de entrada, limpieza, volúmenes y bpm dependen de cada voz y cada canción: no viajan en un preset
  function sinPersonales(p) { const d = D.defaultParams(); p.entrada = d.entrada; p.limpieza = d.limpieza; p.corrector = d.corrector; p.afinador = d.afinador; p.pista = d.pista; p.coros = d.coros; p.voz.volumen = 0; p.base.volumen = 0; p.voz.mute = p.voz.solo = p.base.mute = false; p.bpm = 120; delete p.bypass; return p; }
  function recibirPreset(nombre, params) {
    const p = sinPersonales(D.prepararParams(sanear(params)));
    const mis = misPresets(); const id = 'mio-' + Date.now().toString(36);
    mis.push({ id, nombre: String(nombre).slice(0, 60), descripcion: 'Preset recibido el ' + new Date().toLocaleDateString('es-ES') + '.', origen: 'mio', params: p });
    lsSet(LS_MIS, mis); actualizarPresetUI();
    elegirPreset(id); // se aplica como un estilo más: respeta tu nivel y tu mezcla automática
    toast('Preset «' + escapar(nombre) + '» añadido a Mis presets.', 'ok');
  }
  // solo números, textos cortos y booleanos: un enlace no puede meter nada raro
  function sanear(o, depth = 0) {
    if (depth > 6) return undefined;
    if (Array.isArray(o)) return o.slice(0, 16).map((x) => sanear(x, depth + 1));
    if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o).slice(0, 80)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; r[k] = sanear(o[k], depth + 1); } return r; }
    if (typeof o === 'number') return isFinite(o) ? o : 0;
    if (typeof o === 'string') return o.slice(0, 40);
    if (typeof o === 'boolean') return o;
    return undefined;
  }
  function leerHash() {
    const m = location.hash.match(/preset=([A-Za-z0-9_-]+)/); if (!m) return;
    try {
      const d = JSON.parse(b64u.dec(m[1]));
      history.replaceState(null, '', location.pathname + location.search);
      const box = modal({ title: 'Te han pasado un preset', icon: 'share', body: h('div', { class: 'stack' }, h('div', null, '¿Quieres cargar «', h('b', null, String(d.n || 'Preset').slice(0, 60)), '» y guardarlo en Mis presets?'),
        h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => box.close() }, 'No'), h('button', { class: 'btn primary', onclick: () => { box.close(); recibirPreset(d.n || 'Preset', D.prepararParams(sanear(d.p || {}))); } }, 'Cargar'))) });
    } catch (e) { toast('El enlace del preset está roto.', 'err'); }
  }

  // A/B
  function cambiarAB(k) {
    if (S.ab.cur === k) return;
    S.ab[S.ab.cur] = clone(S.params); S.ab[S.ab.cur + 'id'] = S.presetId;
    if (!S.ab[k]) { S.ab[k] = clone(S.params); S.ab[k + 'id'] = S.presetId; }
    const af = clone(S.params.afinador); // el Afinador es de tu voz: A/B compara la mezcla, no la afinación
    S.params = clone(S.ab[k]); S.params.afinador = af; S.presetId = S.ab[k + 'id'] || S.presetId; S.ab.cur = k;
    abBtns.A.classList.toggle('on', k === 'A'); abBtns.B.classList.toggle('on', k === 'B');
    refresh(); push(); toast('Ajustes ' + k, 'info', 1200);
  }

  // ───────────────────────── exportar ─────────────────────────
  function sincObjetivo() { const v = S.objetivo === null ? 'none' : String(S.objetivo); objSelS.set(v); if (meters.objSel) meters.objSel.set(v); }
  async function abrirExportar() {
    if (grabando()) return;
    if (!motor.duracion()) { toast('No hay nada que exportar todavía: carga una base o graba tu voz.', 'warn'); return; }
    const que = Seg({ options: [{ v: 'mezcla', label: 'Mezcla completa' }, { v: 'voz', label: 'Solo mis voces con efectos' }, { v: 'seca', label: 'Mi voz sin efectos' }], value: S.que, ayuda: '«Mi voz sin efectos» es la toma tal cual, en su sitio de la canción: útil para mandársela a Áleran o mezclar en otro programa.' });
    const forma = Seg({ options: [{ v: 'wav24', label: 'WAV 24 bits' }, { v: 'wav16', label: 'WAV 16 bits' }, { v: 'mp3-320', label: 'MP3 320' }, { v: 'mp3-192', label: 'MP3 192' }], value: S.formato, ayuda: 'WAV = máxima calidad (archivo grande). MP3 = para mandar por WhatsApp o subir rápido.' });
    const obj = Select({ options: OBJETIVOS(), value: S.objetivo === null ? 'none' : String(S.objetivo) });
    const nombre = h('input', { class: 'input', value: (Exportar.limpiarNombre(S.baseNombre || 'Mi canción') || 'Mi canción') + ' - ' + ((presetPorId(S.presetId) || {}).nombre || 'mezcla') });
    const prog = h('div', { class: 'f' }), progTxt = h('div', { class: 'dim', style: { fontSize: '12px' } }), res = h('div', { class: 'report' });
    const go = h('button', { class: 'btn primary lg' }, icon('download'), 'Exportar');
    const body = h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('label', null, 'Qué exportar'), que.el),
      h('div', { class: 'field' }, h('label', null, 'Formato'), forma.el),
      h('div', { class: 'field' }, h('label', null, 'Volumen final (solo mezcla completa)'), obj.el),
      h('div', { class: 'field' }, h('label', null, 'Nombre del archivo'), nombre),
      h('div', { class: 'progress' }, prog), progTxt, res,
      h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cerrar'), go));
    const m = modal({ title: 'Exportar', sub: 'Se calcula aquí, en tu navegador: no se sube nada a internet.', icon: 'download', body });
    go.addEventListener('click', async () => {
      S.que = que.get(); S.formato = forma.get(); S.objetivo = obj.get() === 'none' ? null : +obj.get(); sincObjetivo(); guardarEstado();
      go.disabled = true; res.innerHTML = '';
      const was = motor.playing; if (was) motor.stop();
      try {
        const out = await exportar({ que: S.que, formato: S.formato, objetivo: S.objetivo, nombre: Exportar.limpiarNombre(nombre.value) || 'EpicStudio', onProgress: (f, txt) => { prog.style.width = Math.round(f * 100) + '%'; if (txt) progTxt.textContent = txt; } });
        prog.style.width = '100%'; progTxt.textContent = 'Listo. El archivo se ha descargado.';
        res.innerHTML = out.html; expRes.innerHTML = out.html;
        actualizarPasos(true);
      } catch (e) { console.error(e); progTxt.textContent = ''; res.innerHTML = '<span style="color:var(--accent)">No se pudo exportar: ' + escapar(e.message || String(e)) + '</span>'; }
      finally { go.disabled = false; }
    });
  }
  async function exportar(o) {
    const sr = motor.sr; let chans, info = '', p = efectivos(); delete p._delante; p.bypass = false;
    if (o.que !== 'voz' && o.que !== 'seca') { p.voz.solo = false; p.voz.mute = false; p.base.mute = false; }
    if (o.que !== 'seca' && S.params.afinador.on) { o.onProgress(0.01, 'Afinando tu voz…'); await afinadoListo(); }
    if (o.que === 'seca') { if (!motor.toma) throw new Error('No hay voz grabada.'); chans = motor.vozSeca(); }
    else if (o.que === 'voz') { if (!motor.toma) throw new Error('No hay voz grabada.'); o.onProgress(0.05, 'Procesando tu voz…'); chans = await motor.render({ params: p, modo: 'voz', onProgress: (f) => o.onProgress(f * 0.85) }); }
    else {
      const pasos = o.objetivo === null ? 1 : 3;
      for (let it = 0; it < pasos; it++) {
        o.onProgress(0.02, it === 0 ? 'Mezclando…' : 'Ajustando el volumen final (pasada ' + (it + 1) + ')…');
        chans = await motor.render({ params: p, modo: 'mezcla', onProgress: (f) => o.onProgress((it + f) / pasos * 0.85) });
        if (o.objetivo === null) break;
        const I = D.analyzeLoudness(chans, sr).integrado; if (!isFinite(I)) break;
        const d = o.objetivo - I; if (Math.abs(d) < 0.25) break;
        const ng = D.clamp(p.master.ganancia + d, -24, 24); if (ng === p.master.ganancia) break; p.master.ganancia = ng;
        if (!p.master.on) { p.master.on = true; info += 'Se ha encendido el limitador para llegar al volumen final. '; }
      }
    }
    o.onProgress(0.88, 'Midiendo…');
    const a = D.analyzeLoudness(chans, sr);
    o.onProgress(0.9, 'Guardando el archivo…');
    let blob, ext;
    if (o.formato.startsWith('mp3')) {
      let mc = chans, msr = sr;
      if (sr > 48000) { o.onProgress(0.9, 'Pasando a 48 kHz para el MP3…'); mc = await motor.remuestrear(chans, sr, 48000); msr = 48000; }
      blob = await Exportar.mp3(mc, msr, +o.formato.split('-')[1], (f) => o.onProgress(0.9 + f * 0.1, 'Codificando MP3…')); ext = 'mp3';
    }
    else { blob = Exportar.wav(chans, sr, o.formato === 'wav16' ? 16 : 24); ext = 'wav'; }
    const sufijo = o.que === 'voz' ? ' (voz)' : o.que === 'seca' ? ' (voz sin efectos)' : '';
    Exportar.descargar(blob, o.nombre + sufijo + '.' + ext);
    const mb = (blob.size / 1048576).toFixed(1).replace('.', ',');
    const html = `<div class="caps" style="margin:8px 0 4px">Resultado</div>Volumen (sonoridad) <b>${isFinite(a.integrado) ? num(a.integrado) : '—'} LUFS</b> · pico más alto <b>${num(a.truePeak)} dB</b> · diferencia entre partes suaves y fuertes <b>${num(a.lra)} dB</b><br>${tiempo(chans[0].length / sr).replace(/,\d$/, '')} · ${mb} MB · ${ext.toUpperCase()}${info ? '<br>' + info : ''}`;
    return { html, analisis: a };
  }

  // ───────────────────────── ajustes de audio ─────────────────────────
  async function abrirAudio() {
    if (grabando()) return;
    try { await motor.resume(); } catch (e) { errorAudio(e); return; }
    const L = motor.latInfo;
    const out = h('div', { class: 'report' });
    const pinta = () => { out.innerHTML = `Frecuencia de muestreo: <b>${motor.sr} Hz</b> · latencia de salida del navegador: <b>${Math.round(((motor.ctx.outputLatency || 0) + (motor.ctx.baseLatency || 0)) * 1000)} ms</b><br>Compensación que se aplica al grabar: <b>${Math.round(motor.latenciaTotal() * 1000)} ms</b> (${L.calibrada !== null ? 'medida con la calibración' : 'estimada; calibra para afinarla'}).`; };
    const ajuste = Knob({ label: 'Ajuste fino', min: -100, max: 100, def: 0, value: L.ajuste, step: 1, fmt: (v) => (v > 0 ? '+' : '') + Math.round(v) + ' ms', onChange: (v) => { L.ajuste = v; motor.guardarAjustes(); pinta(); }, ayuda: 'Si tus tomas suenan retrasadas respecto a la base, súbelo; si suenan adelantadas, bájalo.' });
    const calTxt = h('div', { class: 'dim', style: { fontSize: '12px' } });
    const calBtn = h('button', { class: 'btn primary' }, icon('clock'), 'Calibrar latencia');
    calBtn.addEventListener('click', async () => {
      calBtn.disabled = true; calTxt.textContent = 'Preparando…';
      try { const r = await motor.calibrar((t) => { calTxt.textContent = t; }); calTxt.innerHTML = '<span style="color:var(--teal)">Medido: ' + Math.round(r.latencia * 1000) + ' ms (' + r.medidas + ' clics, variación ' + num(r.variacion * 1000) + ' ms). Guardado.</span>'; pinta(); }
      catch (e) { calTxt.innerHTML = '<span style="color:var(--accent)">' + escapar(e.message || String(e)) + '</span>'; }
      finally { calBtn.disabled = false; }
    });
    const proc = (k, label, ay) => Switch({ label, value: motor.proc[k], ayuda: ay, onChange: (v) => { motor.proc[k] = v; motor.guardarAjustes(); } }).el;
    modal({ title: 'Audio y latencia', icon: 'gear', wide: false, body: h('div', { class: 'stack' }, out,
      h('div', { class: 'callout info' }, h('b', null, 'Calibrar: '), 'quítate los auriculares, sube los altavoces a volumen normal y acerca el micro. Sonarán 8 clics; EpicStudio mide cuánto tardan en ir y volver y lo descuenta de cada toma para que tu voz caiga exacta sobre la base. Hazlo una vez por equipo.'),
      h('div', { class: 'row' }, calBtn, h('button', { class: 'btn', onclick: () => { L.calibrada = null; motor.guardarAjustes(); pinta(); calTxt.textContent = 'Calibración borrada: se usa la estimación.'; } }, 'Borrar calibración')), calTxt,
      h('div', { class: 'row' }, ajuste.el, h('div', { class: 'tip grow' }, 'Después de calibrar no suele hacer falta. Si aun así notas la voz desplazada, mueve el ajuste fino y graba otra toma. Para mover una toma ya grabada, usa «Tomas» en el modo avanzado.')),
      h('div', { class: 'caps' }, 'Procesado del navegador (mejor apagado para cantar)'),
      proc('echoCancellation', 'Cancelación de eco', 'Pensado para videollamadas: estropea la voz cantada. Apágalo.'),
      proc('noiseSuppression', 'Supresión de ruido', 'Quita ruido pero también matices de la voz. Apágalo salvo que estés en un sitio muy ruidoso.'),
      proc('autoGainControl', 'Control automático de ganancia', 'Sube y baja tu micro solo: arruina la dinámica. Apágalo.')) });
    pinta();
  }

  // ───────────────────────── manual y guía de prueba ─────────────────────────
  function abrirManual(tab) {
    const est = lsGet(LS_MAN, {});
    const paso = (id, titulo, txt, mirar) => {
      const cb = h('input', { type: 'checkbox', checked: !!est[id] });
      const el = h('div', { class: 'paso' + (est[id] ? ' hecho' : '') }, cb, h('div', null, h('b', null, titulo), h('div', { html: txt }), mirar ? h('div', { class: 'callout', style: { marginTop: '8px' }, html: '<b>Qué mirar:</b> ' + mirar }) : null));
      cb.addEventListener('change', () => { est[id] = cb.checked; lsSet(LS_MAN, est); el.classList.toggle('hecho', cb.checked); });
      return el;
    };
    const man = h('div', { class: 'manual' },
      h('p', null, 'EpicStudio Lite mezcla tu voz como en un estudio, directamente en el navegador. Nada se sube a internet: tu voz se queda en tu ordenador. Ve marcando los pasos; las casillas se quedan guardadas.'),
      h('h3', null, '1 · Prepara'),
      paso('m1', 'Usa Chrome o Edge (o Safari en Mac/iPhone).', 'Ponte <b>auriculares</b>. Conecta tu micro o tu interfaz antes de abrir la página.', 'si el navegador pregunta por el micrófono, pulsa «Permitir».'),
      paso('m2', 'Calibra la latencia una vez por equipo.', 'Botón <b>Audio</b> → <b>Calibrar latencia</b>, sin auriculares y con los altavoces encendidos. Así tu voz cae exacta sobre la base.', 'debe salir una cifra entre 10 y 300 ms con poca variación.'),
      h('h3', null, '2 · Carga y graba'),
      paso('m3', 'Carga la base.', 'Botón <b>Cargar base</b> o arrastra el archivo a la ventana. El tempo (BPM) se detecta solo.'),
      paso('m4', 'Graba.', 'Botón <b>●</b> o <b>Grabar</b>. Elige el micro, mira que la barra no toque el rojo y pulsa <b>Empezar a grabar</b>. Hay cuenta atrás de 1 compás. Para parar: <b>■</b> o barra espaciadora.', 'si la barra se queda en verde muy flojo, sube la ganancia de tu interfaz; si toca el rojo, bájala.'),
      paso('m5', 'Haz varias tomas y quédate con la mejor.', 'Cada grabación es una toma nueva. Elige la buena en la lista (la principal). Las demás puedes marcarlas como <b>Coro</b>: suenan con la principal, cada una con su volumen y su lado. Para grabar solo un trozo, pon el cursor en el visor y elige «Desde el cursor».'),
      h('h3', null, '3 · Mezcla'),
      paso('m6', 'Elige estilo y escucha.', 'Al grabar se hace sola la <b>mezcla automática</b> (nivel, barro, resonancias, eses y volumen frente a la base). Cambia de estilo mientras suena. Los estilos de Áleran dejan tu voz <b>metida en la pista</b>, como en un disco, con los efectos floreciendo entre frases; casi todos llevan el <b>vocal rider</b>, que sube solo las frases que cantas más flojas.', 'lee «Lo que he ajustado»: te explica qué ha hecho con tu voz.'),
      paso('m6b', 'Afina tu voz (opcional).', 'Perilla <b>Afinación</b> en «Ajustes a tu gusto»: 0 % = apagada. Al soltarla, EpicStudio analiza tu toma entera y en un momento suena afinada (no es en directo). Lleva el centro de cada nota a su sitio respetando tu vibrato y tus deslizamientos, y afina respecto a la <b>base</b>. 30–60 % suena natural; 100 % deja las notas clavadas. En el modo avanzado (<b>1 · Voz → Afinador</b>) eliges la velocidad y la escala de la canción.', 'compara con <b>Bypass</b>: la voz debe sonar igual de natural, solo más afinada. Si oyes voz «robótica», baja la Cantidad o la Velocidad. Si la tarjeta dice que tu toma entera estaba más alta o más baja que la base, puede que grabaras con la base en otra afinación.'),
      paso('m7', 'Retoca a tu gusto.', '<b>Realce</b> (voz de radio: densa y siempre delante), voz delante, brillo, cuerpo, compresión, reverb, eco y <b>anchura</b>. Reverb y eco van en paralelo: tu voz seca no se toca, solo se suma más efecto. Doble clic en una perilla la deja como estaba.', 'si quieres mucho efecto pegado a la voz, en el modo avanzado baja el <b>ducking</b> del delay y de la reverb: el ducking aparta el efecto mientras cantas y lo deja sonar en los huecos.'),
      paso('m8', 'Modo avanzado (opcional).', 'Ordenado por etapas, siguiendo el camino de tu voz: <b>1 Voz</b> (tomas y limpieza), <b>2 Color</b> (EQ y tono), <b>3 Dinámica</b> (compresión), <b>4 Espacio</b> (ancho, eco y reverb) y <b>5 Mezcla</b> (voz y base, <b>coros</b>, <b>pista</b> y máster). En cada tarjeta, lo importante va en perillas y lo fino en «Más ajustes». «Ver todo» enseña todas las etapas a la vez. Todos los parámetros de estudio: Afinador, Voz de móvil (corrector de micro), Realce vocal, Armónicos, Suavizador, EQ de 8 bandas con dinámica, de-esser, dos compresores (FET, óptico, VCA y moderno), saturación, doblador, vocal rider, delay, reverb y limitador. Pasa el ratón por cada control y abajo verás qué hace.', 'la barra «Reducción» de cada compresor: 3–6 dB en las frases fuertes es lo normal en voz.'),
      h('h3', null, '4 · Exporta y comparte'),
      paso('m9', 'Exporta.', 'Botón <b>Exportar</b>: mezcla completa, solo tu voz con efectos o tu voz sin tocar; WAV o MP3; y el volumen final (Streaming −14 LUFS para Spotify/YouTube).', 'al terminar verás el volumen (LUFS) y el pico más alto. Con un «Volumen final» elegido, el pico nunca pasa de −1 dB.'),
      paso('m10', 'Guarda o comparte tu sonido.', '<b>Guardar preset</b> lo guarda en este navegador. <b>Copiar enlace</b> crea un enlace con tus ajustes (sin tu voz) para mandárselo a Áleran o a un compañero.'),
      h('h3', null, 'Atajos'),
      h('p', { html: '<b>Espacio</b> reproducir/parar · <b>R</b> grabar · <b>Inicio</b> volver al principio · arrastrar en la regla del visor: bucle · rueda sobre una perilla: mover · <b>Mayús</b> + arrastrar: ajuste fino.' }),
      h('h3', null, 'Si algo falla'),
      h('p', { html: '· <b>No se oye nada:</b> mira el volumen del sistema y que la pestaña no esté silenciada.<br>· <b>No me deja usar el micro:</b> candado de la barra de direcciones → Micrófono → Permitir.<br>· <b>Mi voz va retrasada:</b> calibra (Audio) o mueve la toma en Tomas (modo avanzado).<br>· <b>Se oye entrecortado:</b> cierra otras pestañas y apaga «Escucharme con los efectos».<br>· <b>He perdido mi trabajo:</b> la sesión se guarda sola en este navegador; si borras los datos del navegador, se pierde. Exporta lo importante.' }));
    const guia = construirGuia();
    const tabs = Seg({ options: [{ v: 'man', label: 'Manual' }, { v: 'guia', label: 'Guía de prueba (Áleran)' }], value: tab || 'man', onChange: (v) => { man.classList.toggle('hidden', v !== 'man'); guia.classList.toggle('hidden', v !== 'guia'); } });
    man.classList.toggle('hidden', (tab || 'man') !== 'man'); guia.classList.toggle('hidden', (tab || 'man') !== 'guia');
    modal({ title: 'Manual', sub: 'EpicStudio Lite paso a paso', icon: 'book', wide: true, body: h('div', null, h('div', { style: { marginBottom: '12px' } }, tabs.el), man, guia) });
  }
  const FICHAS = [
    ['g1', 'Abre en Chrome/Edge y carga una base', 'Arrastra un MP3 a la ventana. Debe aparecer en el visor y detectarse el BPM.'],
    ['g2', 'Calibrar latencia', 'Audio → Calibrar (sin auriculares). Anota la cifra.'],
    ['g3', 'Grabar una toma con auriculares', 'Graba 30 s. ¿La voz cae a tiempo con la base al reproducir?'],
    ['g4', 'Mezcla automática', '¿Las notas de «Lo que he ajustado» tienen sentido? ¿Suena mejor que en bypass?'],
    ['g5', 'Estilos', 'Prueba Pop, Rock, Metal moderno y Épico con la misma toma. ¿Cada uno suena como su nombre?'],
    ['g6', 'Ajustes a tu gusto', 'Mueve Voz delante, Brillo, Compresión, Reverb y Eco. ¿Responden como esperas?'],
    ['g7', 'Compresor FET', 'Modo avanzado: Compresor 1 en FET, relación 4 y luego TODOS. ¿Se nota el carácter?'],
    ['g8', 'Compresor óptico', 'Compresor 2 en Óptico. ¿Iguala las frases de forma suave y musical?'],
    ['g9', 'EQ y analizador', 'Arrastra puntos de la EQ con la música sonando. ¿El espectro y la curva se ven bien?'],
    ['g10', 'De-esser', '¿Baja las eses sin dejar la voz con «lengua de trapo»? Prueba «Escuchar eses».'],
    ['g11', 'Delay y reverb', '¿El eco va a tempo? ¿El ducking deja la voz limpia y florece en los huecos?'],
    ['g12', 'Exportar WAV y MP3', 'Exporta las dos cosas. ¿Se descargan, suenan igual que en la página y el pico es ≤ −1 dBTP?'],
    ['g13', 'Guardar y compartir preset', 'Guarda un preset, copia el enlace y ábrelo en otro navegador.'],
    ['g14', 'Recuperar sesión', 'Cierra la pestaña y vuelve a abrir: ¿siguen la base, las tomas y tus ajustes?'],
    ['g15', 'Móvil o tablet', 'Ábrela en el móvil (Safari o Chrome) con auriculares de cable. ¿Se puede grabar y exportar?'],
    ['g17', 'Realce vocal', 'Sube «Realce» de 0 a 70 % con tu voz sonando. ¿Queda densa, pegada y delante como con el Amplificador vocal de Audition? ¿El volumen se mantiene?'],
    ['g18', 'Anchura y efectos a tope', 'Sube Anchura, Reverb y Eco al máximo y baja el ducking en el avanzado. ¿Llegan hasta donde te gusta? ¿La voz sigue en el centro?'],
    ['g19', 'Suavizador', 'Con una voz estridente, sube «Suavizar» a 40–60 %. ¿Desaparece lo que pincha sin que la voz se apague?'],
    ['g20', 'Armónicos', 'Canta una nota aguda larga o un grito y sube «Armónicos». ¿La nota brilla más, como con tu EQ de octavas en Audition? En avanzado, mira «Nota ahora».'],
    ['g21', 'Efecto en pausas', 'Mueve «Efecto en pausas»: a la derecha, ¿el eco y la reverb florecen en los huecos y se apartan al cantar?'],
    ['g22', 'Vocal rider', 'En el avanzado, enciende y apaga el «Vocal rider» con una toma donde cantes unas frases más flojas que otras. ¿Sube las flojas sin que se note? ¿Al empezar cada frase NO sube y luego baja? Al apagarlo, ¿el volumen vuelve sin salto?'],
    ['g23', 'Estilos equilibrados', 'Prueba los 9 estilos con la misma toma. ¿La voz va metida en la pista (ni encima ni tapada)? ¿Cada estilo suena a lo que dice su nombre?'],
    ['g24', 'Voz de móvil', 'Graba con el móvil (o carga una toma de móvil). ¿La mezcla automática enciende «Voz de móvil» y lo explica? Apágalo y enciéndelo: ¿suena más a micro de estudio, con menos ruido y más agudos, sin cambiar quién eres?'],
    ['g25', 'Realce y brillo', 'En el avanzado, con la mezcla automática hecha, enciende y apaga el Realce. ¿La banda «Aire» de la EQ baja al encenderlo y vuelve al apagarlo (sin brillo de más)?'],
    ['g26', 'Modo avanzado ordenado', 'Pasa por las 5 etapas en tu pantalla y en el móvil. ¿Las tarjetas encajan sin huecos? ¿Encuentras lo que buscas? Abre «Más ajustes» en alguna y prueba «Ver todo».'],
    ['g27', 'Compresor en directo', 'Dale play y mira la gráfica de los compresores: ¿la bola recorre la curva y se ve cuánto comprime?'],
    ['g31', 'Afinador', 'Con una toma cargada, sube «Afinación» (modo sencillo) al 50 % y suelta: en un momento suena afinada. ¿Suena natural, sin voz robótica? ¿El vibrato sigue igual? Prueba 100 % y compara con Bypass. Exporta y comprueba que la exportación suena afinada.'],
    ['g28', 'Coros', 'Graba dos o más tomas. Deja una como principal y pulsa «Coro» en otra. ¿Suenan juntas? Mueve su Volumen y Panorama mientras suena. En «5 · Mezcla → Coros», ¿Más reverb los mete al fondo? ¿Se exportan?'],
    ['g29', 'Pista (base)', 'En «5 · Mezcla → Pista», enciéndela y baja los Medios o los Graves. ¿La base cambia y tu voz se entiende mejor? ¿Se exporta así?'],
    ['g30', 'Tamaño y pantallas', 'Prueba «Tamaño» (abajo a la derecha) y abre la app en otra pantalla y en el móvil. ¿Todo cabe sin barras raras?'],
    ['g16', 'Tu oído', 'Compara una mezcla de EpicStudio Lite con la del programa de escritorio con la misma toma.'],
  ];
  function construirGuia() {
    const g = lsGet(LS_GUIA, {});
    const wrap = h('div');
    wrap.appendChild(h('div', { class: 'tip', style: { marginBottom: '10px' } }, 'Para Áleran: marca Bien / Mal / No aplica y escribe una nota. Al terminar pulsa «Descargar resultados» y pásale el archivo a Claude.'));
    for (const [id, q, how] of FICHAS) {
      const st = g[id] || {};
      const ta = h('textarea', { placeholder: 'Tu nota…' }, st.nota || '');
      const seg = Seg({ options: [{ v: 'bien', label: 'Bien' }, { v: 'mal', label: 'Mal' }, { v: 'na', label: 'No aplica' }], value: st.res || '', onChange: (v) => { g[id] = Object.assign(g[id] || {}, { res: v }); lsSet(LS_GUIA, g); } });
      ta.addEventListener('input', () => { g[id] = Object.assign(g[id] || {}, { nota: ta.value }); lsSet(LS_GUIA, g); });
      wrap.appendChild(h('div', { class: 'ficha' }, h('div', { class: 'q' }, q), h('div', { class: 'how' }, how), seg.el, ta, st.respuesta ? h('div', { class: 'resp' }, 'Respuesta: ' + st.respuesta) : null));
    }
    wrap.appendChild(h('div', { class: 'foot' }, h('button', { class: 'btn primary', onclick: () => { const out = FICHAS.map(([id, q]) => Object.assign({ id, prueba: q }, lsGet(LS_GUIA, {})[id] || {})); Exportar.descargar(new Blob([JSON.stringify({ app: 'EpicStudio Lite ' + VERSION, fecha: new Date().toISOString(), navegador: navigator.userAgent, fichas: out }, null, 2)], { type: 'application/json' }), 'Guia de prueba EpicStudio Lite.json'); } }, icon('download'), 'Descargar resultados')));
    return wrap;
  }
  function acercaDe() {
    modal({ title: 'EpicStudio Lite', sub: 'Versión ' + VERSION + ' · Áleran Vocals', body: h('div', { class: 'stack' },
      h('img', { src: 'assets/aleran_logo.png', alt: 'Áleran Vocals', style: { width: '220px', alignSelf: 'center' } }),
      h('p', { class: 'dim' }, 'La versión web de EpicStudio para los alumnos de Áleran. Todo el procesado (compresores, ecualizador, de-esser, saturación, reverb, delay, limitador y medidor de sonoridad) está escrito desde cero y funciona dentro de tu navegador: tu voz no sale de tu ordenador.'),
      h('p', { class: 'faint', style: { fontSize: '12px' } }, 'Uso exclusivo para alumnos de Áleran Vocals. Codificador MP3: LAME (lamejs, LGPL). Tipografías Inter, Cinzel y JetBrains Mono (OFL).')) });
  }

  // ───────────────────────── sesión (IndexedDB) ─────────────────────────
  const DB = { name: 'voxstudio-lite', store: 'sesion' };
  function idb() { return new Promise((res, rej) => { const r = indexedDB.open(DB.name, 1); r.onupgradeneeded = () => r.result.createObjectStore(DB.store); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  let sesT = 0;
  function guardarSesion() {
    clearTimeout(sesT);
    sesT = setTimeout(async () => {
      try {
        const db = await idb();
        const base = motor.base ? { nombre: S.baseNombre || '', sr: motor.base.sampleRate, ch: [...Array(motor.base.numberOfChannels)].map((_, c) => motor.base.getChannelData(c)) } : null;
        const tomas = S.tomas.map((t) => ({ nombre: t.nombre, inicio: t.inicio, sr: t.buffer.sampleRate, d: t.buffer.getChannelData(0), fecha: t.fecha, coro: !!t.coro, cVol: t.cVol, cPan: t.cPan }));
        await new Promise((res, rej) => { const tx = db.transaction(DB.store, 'readwrite'); tx.objectStore(DB.store).put({ base, tomas, tomaSel: S.tomaSel }, 'actual'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('abort')); }).finally(() => db.close());
      } catch (e) { console.warn('No se pudo guardar la sesión', e); if (e && e.name === 'QuotaExceededError') toast('El navegador no tiene espacio para guardar la sesión. Exporta tu trabajo.', 'warn'); }
    }, 1200);
  }
  async function recuperarSesion() {
    try {
      const db = await idb();
      const d = await new Promise((res, rej) => { const tx = db.transaction(DB.store, 'readonly'); const r = tx.objectStore(DB.store).get('actual'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      db.close();
      if (!d || (!d.base && !(d.tomas || []).length)) return;
      await motor.init();
      if (S.tocado) return; // el alumno ya ha cargado algo nuevo: no se pisa
      const mk = async (chs, sr) => { if (sr !== motor.sr) chs = await motor.remuestrear(chs, sr, motor.sr); const b = motor.ctx.createBuffer(chs.length, chs[0].length, motor.sr); chs.forEach((c, i) => b.copyToChannel(c, i)); return b; };
      const base = d.base ? await mk(d.base.ch, d.base.sr) : null;
      const tomas = []; for (const t of d.tomas || []) tomas.push({ id: ++tomaId, nombre: t.nombre, inicio: t.inicio, buffer: await mk([t.d], t.sr), fecha: t.fecha, coro: !!t.coro, cVol: isFinite(t.cVol) ? D.clamp(+t.cVol, -30, 6) : undefined, cPan: isFinite(t.cPan) ? D.clamp(+t.cPan, -100, 100) : undefined });
      if (S.tocado) return;
      if (base) { motor.base = base; S.baseNombre = d.base.nombre; motor.baseNombre = d.base.nombre; }
      S.tomas = tomas;
      if (S.tomas.length) elegirToma(D.clamp(d.tomaSel, 0, S.tomas.length - 1)); else pintarTomas();
      actualizarCabecera(); calcPicos();
      toast('Sesión recuperada: ' + (d.base ? 'base «' + escapar(S.baseNombre) + '»' : 'sin base') + ' y ' + S.tomas.length + (S.tomas.length === 1 ? ' toma.' : ' tomas.'), 'ok');
    } catch (e) { console.warn('Sin sesión anterior', e); }
  }
  async function empezarDeCero() {
    if (grabando()) return;
    if (!confirm('¿Empezar de cero? Se quitan la base y todas las tomas de este navegador (tus presets se conservan).')) return;
    AF.ref = AF.refDe = AF.refProm = null; AF.error = '';
    motor.stop(); motor.loop = null; S.loopGuard = null; btnLoop.classList.remove('on'); motor.base = null; motor.toma = null; motor.coros = []; S.tomas = []; S.tomaSel = -1; S.auto = null; S.autoExtra = null; S.baseNombre = ''; S.bpmManual = false; S.macros = { delante: 0, brillo: 0, cuerpo: 0, compresion: 0, reverb: 0, eco: 0, ancho: 0, realce: 0, suavizar: 0, armonicos: 0, pausas: 0 };
    elegirPreset(S.presetId); pintarTomas(); calcPicos(); actualizarCabecera(); guardarSesion(); autoNotas.innerHTML = ''; expRes.innerHTML = '';
  }

  // ───────────────────────── cabecera, pasos y modos ─────────────────────────
  function actualizarCabecera() {
    const t = S.tomas[S.tomaSel];
    infoLine.textContent = (motor.base ? 'Base: ' + (S.baseNombre || '') + ' (' + tiempo(motor.base.duration).replace(/,\d$/, '') + ')' : 'Sin base') + ' · ' + (t ? 'Voz: ' + t.nombre : 'sin voz');
    baseOk.replaceChildren(...(motor.base ? [icon('check'), (S.baseNombre || 'Base') + ' · ' + (S.params.bpm || 120) + ' BPM'] : []));
    visorInfo.textContent = motor.base || t ? 'Clic: ir a ese punto · arrastrar en la regla: repetir un trozo' : '';
    bpmIn.value = S.params.bpm;
    actualizarPasos();
  }
  function actualizarPasos(exportado) {
    if (exportado) S.exportado = true;
    const st = (id, ok) => { const e = document.getElementById(id); if (e) { e.classList.toggle('ok', ok); e.innerHTML = ''; e.appendChild(ok ? icon('check') : document.createTextNode(id.slice(2))); } };
    st('st1', !!(motor.base || S.tomas.length) && S.tomas.length > 0); st('st2', !!S.auto || S.modificado); st('st3', !!S.exportado);
    pintarTabs();
  }
  function pintarTabs() {
    tabsS.innerHTML = '';
    if (S.modo === 'sencillo') {
      const ok = [S.tomas.length > 0, !!S.auto || S.modificado, !!S.exportado];
      ['Graba tu voz', 'Escucha y elige estilo', 'Exporta'].forEach((t, i) => tabsS.appendChild(h('button', { class: 'tab' + (ok[i] ? ' done' : '') + (!ok[i] && (i === 0 || ok[i - 1]) ? ' on' : ''), onclick: () => { const c = simple.children[i]; if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, h('span', { class: 'n' }, ok[i] ? '✓' : String(i + 1)), t)));
      btnModo.replaceChildren(icon('sliders'), h('span', { class: 'lbltxt' }, 'Modo avanzado')); btnModo.dataset.ayuda = 'Todos los parámetros de estudio, módulo a módulo.';
    } else {
      tabsS.appendChild(h('button', { class: 'tab on' }, h('span', { class: 'n' }, 'E'), 'Cadena de voz'));
      tabsS.appendChild(h('button', { class: 'tab', onclick: () => document.getElementById('card-tomas').scrollIntoView({ behavior: 'smooth', block: 'center' }) }, h('span', { class: 'n' }, String(S.tomas.length)), 'Tomas'));
      btnModo.replaceChildren(icon('check'), h('span', { class: 'lbltxt' }, 'Modo sencillo')); btnModo.dataset.ayuda = 'Volver a los tres pasos sencillos.';
    }
  }
  function cambiarModo(m) {
    if (m === 'avanzado' && S.modo === 'sencillo') {
      const tocado = Object.values(S.macros).some((v) => Math.abs(v) > 0.01);
      if (tocado) { S.params = efectivos(); S.macros = { delante: 0, brillo: 0, cuerpo: 0, compresion: 0, reverb: 0, eco: 0, ancho: 0, realce: 0, suavizar: 0, armonicos: 0, pausas: 0 }; toast('Tus «ajustes a tu gusto» se han pasado a los controles avanzados.', 'info'); }
    }
    if (m === 'sencillo') S.params.bypass = false;
    S.modo = m;
    content.replaceChildren(visorBox, m === 'sencillo' ? simple : adv);
    refresh(); push(); pintarTomas(); calcPicos(); guardarEstado();
    window.scrollTo({ top: 0 });
  }

  // ───────────────────────── teclado ─────────────────────────
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal')) return;
    if (e.target.closest && e.target.closest('input, textarea, select, .modal')) return;
    if (e.target.closest && e.target.closest('[role="switch"], button') && (e.code === 'Space' || e.key === 'Enter')) return; // el interruptor o botón usa su propia tecla
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) rehacer(); else deshacer(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); rehacer(); return; }
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); abrirGrabacion(); }
    else if (e.key === 'Home') { if (!grabando()) motor.seek(0); }
  });
  // el navegador puede suspender el audio al cambiar de pestaña en móviles
  document.addEventListener('visibilitychange', () => { if (!document.hidden && motor.ctx && motor.ctx.state === 'suspended' && motor.playing) motor.ctx.resume(); });
  window.addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => { calcPicos(); dibujarEq(); dibujarCurvas(); }, 120); });
  window.addEventListener('beforeunload', (e) => { if (recState) { e.preventDefault(); e.returnValue = ''; } });

  // ───────────────────────── arranque ─────────────────────────
  function arrancar() {
    const st = lsGet(LS, null);
    if (st && st.params) {
      S.params = D.prepararParams(sanear(st.params));
      S.presetId = st.presetId || S.presetId; const RANGO = { delante: [-6, 6], brillo: [-6, 6], cuerpo: [-6, 6], compresion: [-100, 100], reverb: [-20, 20], eco: [-20, 20], ancho: [0, 100], realce: [0, 100], suavizar: [0, 100], armonicos: [0, 100], pausas: [-100, 100] };
      for (const k of Object.keys(S.macros)) { const v = st.macros && st.macros[k]; if (typeof v === 'number' && isFinite(v)) S.macros[k] = D.clamp(v, RANGO[k][0], RANGO[k][1]); }
      S.autoExtra = st.autoExtra && typeof st.autoExtra === 'object' ? { pres: D.clamp(+st.autoExtra.pres || 0, 0, 4), aire: D.clamp(+st.autoExtra.aire || 0, 0, 4), corrector: limpiarInfoMovil(st.autoExtra.corrector) } : null;
      S.objetivo = st.objetivo === undefined ? -14 : st.objetivo; S.formato = st.formato || S.formato; S.que = st.que || S.que;
      S.auto = st.auto ? D.prepararParams(sanear(st.auto)) : null; S.bpmManual = !!st.bpmManual; S.modo = st.modo === 'avanzado' ? 'avanzado' : 'sencillo';
    } else if (PRESETS[0]) { S.params = paramsDePreset(PRESETS[0]); delete S.params._delante; }
    S.params.bypass = false; S.params.voz.solo = false;
    colSimple(); colAvanzado(); construirSidebar();
    if ((window.VOX_BASES_ALERAN || []).length) selBases.fill([{ v: '', label: 'Elegir…' }].concat(window.VOX_BASES_ALERAN.map((b, i) => ({ v: String(i), label: b.nombre }))));
    sincObjetivo();
    cambiarModo(S.modo);
    pintarTomas(); actualizarCabecera();
    requestAnimationFrame(frame);
    motor.init().then(() => { motor.setParams(efectivos()); recuperarSesion(); }).catch(errorAudio);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* opcional */ }
    leerHash();
    window.addEventListener('hashchange', leerHash);
    clearTimeout(saveT); HIST.ultimo = foto(); HIST.guardado = HIST.ultimo; pintarHistorial();
    // botón «empezar de cero» discreto en la barra de estado
    statusbar.insertBefore(h('button', { class: 'btn sm ghost', ayuda: 'Quitar la base y las tomas y empezar otra canción.', onclick: () => empezarDeCero() }, icon('refresh'), 'Nueva canción'), statusbar.lastChild);
    // ganchos para las pruebas automáticas
    window.VoxApp = { S, motor, efectivos, refresh, push, nuevaToma, ponerBase, mezclaAuto, exportar, elegirPreset, cambiarModo, empezarGrabacion, pararGrabacion, recibirPreset, cambiarAB, guardarSesion, get recState() { return recState; } };
  }
  arrancar();
})();
