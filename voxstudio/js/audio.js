// Firefox no deja conectar un micro con otra frecuencia de muestreo que la del audio: aviso claro.
function micSource(ctx, stream) {
  try { return ctx.createMediaStreamSource(stream); } catch (e) {
    if (e && e.name === 'NotSupportedError') throw new Error('Tu micrófono y tu salida de audio funcionan a frecuencias distintas y este navegador no puede juntarlos. Ponlos los dos a 48 000 Hz en la configuración de sonido del ordenador, o usa Chrome o Edge.');
    throw e;
  }
}
/* VoxStudio Lite · motor de audio del navegador: reproducción, grabación con compensación de
 * latencia, calibración, render sin conexión (exportar) y medidores. */
(function () {
  'use strict';
  const D = window.VoxDSP;

  // El mismo código DSP se carga en el AudioWorklet como Blob (funciona también abriendo el archivo
  // local, sin servidor, y en cualquier ruta de la web).
  let workletURL = null;
  function getWorkletURL() {
    if (!workletURL) {
      const src = '(' + window.voxdspModule.toString() + ')();';
      workletURL = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    }
    return workletURL;
  }

  const LS_LAT = 'voxlite.latencia';
  const leerLat = () => { try { return JSON.parse(localStorage.getItem(LS_LAT) || '{}'); } catch (e) { return {}; } };
  const guardarLat = (o) => { try { localStorage.setItem(LS_LAT, JSON.stringify(o)); } catch (e) { /* sin almacenamiento */ } };

  class Motor {
    constructor() {
      this.ctx = null; this.node = null; this.ready = null;
      this.base = null; this.baseNombre = '';
      this.toma = null; // { buffer, inicio }
      this.coros = []; // [{ buffer, inicio, vol (dB), pan (−100…100) }]: tomas que suenan como coro (24/11)
      this.srcC = [];
      this.params = D.defaultParams();
      this.playing = false; this.pos = 0; this.t0 = 0; this.p0 = 0;
      this.srcV = null; this.srcB = null;
      this.loop = null; // {a, b}
      this.onMeters = null; this.onEnd = null; this.onRecLevel = null; this.onRecChunk = null;
      this.rec = null;
      this.latInfo = { auto: 0, calibrada: null, ajuste: 0 };
      const l = leerLat(); if (typeof l.calibrada === 'number') this.latInfo.calibrada = l.calibrada; if (typeof l.ajuste === 'number') this.latInfo.ajuste = l.ajuste; if (typeof l.calSalida === 'number') this.latInfo.calSalida = l.calSalida;
      this.inputDevice = l.inputDevice || '';
      this.proc = Object.assign({ echoCancellation: false, noiseSuppression: false, autoGainControl: false }, l.proc || {});
    }

    async init() {
      if (this.ready) return this.ready;
      this.ready = (async () => {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) throw new Error('Este navegador no tiene Web Audio. Usa Chrome, Edge o Safari actualizados.');
        this.ctx = new AC({ latencyHint: 'interactive' });
        if (!this.ctx.audioWorklet) throw new Error('Este navegador no tiene AudioWorklet. Actualiza Chrome, Edge o Safari (14.1 o más nuevo).');
        await this.ctx.audioWorklet.addModule(getWorkletURL());
        this.node = new AudioWorkletNode(this.ctx, 'vox-processor', { numberOfInputs: 3, numberOfOutputs: 2, outputChannelCount: [2, 1], processorOptions: { params: this.params } });
        this.node.connect(this.ctx.destination, 0);
        this.anVoz = this.ctx.createAnalyser(); this.anVoz.fftSize = 8192; this.anVoz.smoothingTimeConstant = 0.75;
        this.node.connect(this.anVoz, 1);
        this.latencia = new D.VoxEngine(this.ctx.sampleRate).latency; // muestras de la cadena
        this.node.port.onmessage = (e) => {
          const d = e.data;
          if (d.type === 'meters' && this.onMeters) this.onMeters(d.m);
          if (d.type === 'lufs' && this._lufsRes) { this._lufsRes(d); this._lufsRes = null; }
        };
        this.ctx.onstatechange = () => { if (this.onState) this.onState(this.ctx.state); };
      })();
      return this.ready;
    }
    async resume() { await this.init(); if (this.ctx.state !== 'running') await this.ctx.resume(); }
    get sr() { return this.ctx ? this.ctx.sampleRate : 48000; }

    setParams(p) { this.params = p; if (this.node) this.node.port.postMessage({ type: 'params', params: p }); }
    resetLufs() { if (this.node) this.node.port.postMessage({ type: 'lufs-reset' }); }

    // ── archivos ──
    async decode(arrayBuffer) {
      await this.init();
      return await new Promise((res, rej) => {
        const p = this.ctx.decodeAudioData(arrayBuffer, res, (e) => rej(e || new Error('No se pudo leer el audio')));
        if (p && p.then) p.then(res, rej);
      });
    }
    toMono(buf) {
      if (buf.numberOfChannels === 1) return buf;
      const n = buf.length, out = this.ctx.createBuffer(1, n, buf.sampleRate), o = out.getChannelData(0);
      for (let c = 0; c < buf.numberOfChannels; c++) { const x = buf.getChannelData(c); for (let i = 0; i < n; i++) o[i] += x[i] / buf.numberOfChannels; }
      return out;
    }
    duracion() {
      let d = this.base ? this.base.duration : 0;
      if (this.toma) d = Math.max(d, this.toma.inicio + this.toma.buffer.duration);
      for (const c of this.coros) d = Math.max(d, c.inicio + c.buffer.duration);
      return d;
    }

    // ── reproducción ──
    position() { return this.playing ? this.p0 + (this.ctx.currentTime - this.t0) : this.pos; }
    _sources(pos, when) {
      const ctx = this.ctx;
      if (this.base) {
        const s = ctx.createBufferSource(); s.buffer = this.base; s.connect(this.node, 0, 1);
        if (pos < this.base.duration) s.start(when, pos);
        this.srcB = s;
      }
      if (this.toma) {
        const t = this.toma, s = ctx.createBufferSource(); s.buffer = t.buffer; s.connect(this.node, 0, 0);
        if (pos < t.inicio) s.start(when + (t.inicio - pos), 0);
        else if (pos - t.inicio < t.buffer.duration) s.start(when, pos - t.inicio);
        this.srcV = s;
      }
      this.srcC = this.coros.map((c) => this._coroSrc(ctx, this.node, c, pos, when));
    }
    // una toma de coro: fuente → volumen → panorama → entrada 3 del motor (el bus de coros)
    _coroSrc(ctx, node, c, pos, when) {
      const s = ctx.createBufferSource(); s.buffer = c.buffer;
      const g = ctx.createGain(); g.gain.value = D.dbToLin(c.vol || 0);
      const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null; if (pn) pn.pan.value = D.clamp((c.pan || 0) / 100, -1, 1);
      s.connect(g); if (pn) { g.connect(pn); pn.connect(node, 0, 2); } else g.connect(node, 0, 2);
      if (pos < c.inicio) s.start(when + (c.inicio - pos), 0); else if (pos - c.inicio < c.buffer.duration) s.start(when, pos - c.inicio);
      return { s, g, pn };
    }
    // volumen y panorama de los coros mientras suena (sin cortar)
    mezclaCoros() { this.coros.forEach((c, i) => { const r = this.srcC[i]; if (!r) return; r.g.gain.setTargetAtTime(D.dbToLin(c.vol || 0), this.ctx.currentTime, 0.02); if (r.pn) r.pn.pan.setTargetAtTime(D.clamp((c.pan || 0) / 100, -1, 1), this.ctx.currentTime, 0.02); }); }
    _stopSources() {
      for (const s of [this.srcB, this.srcV, ...this.srcC.map((r) => r.s)]) if (s) { try { s.stop(); } catch (e) { /* ya parado */ } s.disconnect(); }
      for (const r of this.srcC) { r.g.disconnect(); if (r.pn) r.pn.disconnect(); }
      this.srcB = this.srcV = null; this.srcC = [];
    }
    async play(from) {
      await this.resume();
      if (this.node) this.node.port.postMessage({ type: 'rider-reset' }); // el rider aprende desde aquí, igual que al exportar
      clearTimeout(this._raf);
      if (this.playing) this._stopSources();
      const pos = from !== undefined ? from : this.pos;
      const when = this.ctx.currentTime + 0.05;
      this._sources(pos, when);
      this.playing = true; this.t0 = when; this.p0 = pos;
      this._tick();
    }
    _tick() {
      if (!this.playing) return;
      const p = this.position(), dur = this.duracion();
      if (this.loop && !this.rec && p >= this.loop.b) { this.play(this.loop.a); return; } // al grabar no se repite: la toma iría desfasada
      if (p > dur + 2.5 && !this.rec) { this.stop(); this.pos = 0; if (this.onEnd) this.onEnd(); return; }
      this._raf = setTimeout(() => this._tick(), 40);
    }
    stop() { if (this.playing) this.pos = this.position(); this.playing = false; this._stopSources(); clearTimeout(this._raf); }
    seek(t) { t = Math.max(0, t); if (this.playing) this.play(t); else this.pos = t; }

    // ── latencia ──
    latenciaTotal() {
      // ida (lo que oyes) + vuelta (lo que entra por el micro). Si se calibró, manda la medida.
      const L = this.latInfo;
      return (L.calibrada !== null ? L.calibrada : L.auto) + L.ajuste / 1000;
    }
    _estimar(track) {
      const ctx = this.ctx; let out = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
      if (!out) out = 0.02;
      let inp = 0; try { inp = (track.getSettings && track.getSettings().latency) || 0; } catch (e) { inp = 0; }
      if (!inp) inp = 0.01;
      this.latInfo.auto = out + inp;
    }
    guardarAjustes() { guardarLat({ calibrada: this.latInfo.calibrada, calSalida: this.latInfo.calSalida, ajuste: this.latInfo.ajuste, inputDevice: this.inputDevice, proc: this.proc }); }

    async listarEntradas() {
      try { const d = await navigator.mediaDevices.enumerateDevices(); return d.filter((x) => x.kind === 'audioinput'); } catch (e) { return []; }
    }
    async abrirMicro() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('El navegador no deja usar el micrófono aquí. La página debe abrirse con https:// (o desde tu ordenador).');
      await this.resume();
      const c = { echoCancellation: this.proc.echoCancellation, noiseSuppression: this.proc.noiseSuppression, autoGainControl: this.proc.autoGainControl, latency: 0 };
      if (this.inputDevice) c.deviceId = { exact: this.inputDevice };
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: c }); }
      catch (e) {
        if (e && e.name === 'OverconstrainedError') { delete c.deviceId; stream = await navigator.mediaDevices.getUserMedia({ audio: c }); }
        else throw e;
      }
      const track = stream.getAudioTracks()[0];
      this._estimar(track);
      return stream;
    }

    // Vigila el nivel del micro sin grabar (para la ventana de grabación).
    async monitorizarNivel(stream, onLevel) {
      const src = micSource(this.ctx, stream);
      const an = this.ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
      const buf = new Float32Array(an.fftSize); let on = true;
      const loop = () => { if (!on) return; an.getFloatTimeDomainData(buf); let m = 0; for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; } onLevel(m); requestAnimationFrame(loop); };
      loop();
      return () => { on = false; src.disconnect(); };
    }

    _click(when, acento) {
      // los clics van directos a la salida: se retrasan lo mismo que la cadena para sonar junto a la base
      when += this.latencia / this.ctx.sampleRate;
      const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = acento ? 1760 : 1175; o.type = 'sine';
      g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(acento ? 0.5 : 0.32, when + 0.002); g.gain.exponentialRampToValueAtTime(0.0008, when + 0.06);
      o.connect(g); g.connect(ctx.destination); o.start(when); o.stop(when + 0.08);
      this._clicks.push(o);
    }

    // ── grabación ──
    // opts: { desde, compases (cuenta atrás), metronomo, escucharme, stream, gananciaEntrada }
    async grabar(opts) {
      await this.resume();
      const ctx = this.ctx, sr = ctx.sampleRate;
      this.stop();
      const stream = opts.stream || await this.abrirMicro();
      const mic = micSource(ctx, stream);
      const recNode = new AudioWorkletNode(ctx, 'vox-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const mute = ctx.createGain(); mute.gain.value = 0; recNode.connect(mute); mute.connect(ctx.destination);
      mic.connect(recNode);
      const chunks = []; let first = -1; let total = 0;
      recNode.port.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'start') first = d.frame;
        else if (d.type === 'chunk') { chunks.push(d.data); total += d.data.length; if (this.onRecChunk) this.onRecChunk(d.data, total); }
        else if (d.type === 'level' && this.onRecLevel) this.onRecLevel(d.pk);
        else if (d.type === 'done' && this._recDone) this._recDone();
      };
      let monitor = null;
      if (opts.escucharme) { monitor = ctx.createGain(); monitor.gain.value = 1; mic.connect(monitor); monitor.connect(this.node, 0, 0); }
      const bpm = this.params.bpm || 120, beat = 60 / bpm;
      const pre = (opts.compases || 0) * 4 * beat;
      const desde = Math.max(0, opts.desde || 0);
      const T0 = ctx.currentTime + 0.25 + pre;
      this._clicks = [];
      if (opts.compases) for (let k = 1; k <= opts.compases * 4; k++) this._click(T0 - k * beat, (k - 1) % 4 === 3);
      if (opts.metronomo) {
        const fin = this.base ? this.base.duration - desde : 600;
        const primer = Math.ceil(desde / beat - 1e-9) * beat - desde;
        for (let t = primer; t < Math.min(fin, 1200); t += beat) this._click(T0 + t, Math.round((desde + t) / beat) % 4 === 0);
      }
      // la base suena por la cadena (el alumno oye la mezcla), sin su voz anterior
      if (this.base) { const s = ctx.createBufferSource(); s.buffer = this.base; s.connect(this.node, 0, 1); if (desde < this.base.duration) s.start(T0, desde); this.srcB = s; }
      // grabando un coro: también suenan tu voz principal y los coros (por el bus de coros, que pasa por la misma cadena: la latencia no cambia)
      if (opts.oirVoces) this.srcC = [...(this.toma ? [{ buffer: this.toma.buffer, inicio: this.toma.inicio, vol: 0, pan: 0 }] : []), ...this.coros].map((c) => this._coroSrc(ctx, this.node, c, desde, T0));
      this.playing = true; this.t0 = T0; this.p0 = desde; this._tick();
      this.rec = { stream, mic, recNode, mute, monitor, chunks, T0, desde, get first() { return first; }, get total() { return total; }, opts };
      return this.rec;
    }

    async pararGrabacion() {
      const r = this.rec; if (!r) return null;
      this.rec = null; // una segunda llamada (doble clic) ya no hace nada
      const ctx = this.ctx, sr = ctx.sampleRate;
      await new Promise((res) => { this._recDone = res; r.recNode.port.postMessage({ type: 'stop' }); setTimeout(res, 600); });
      this._recDone = null;
      this.stop();
      for (const o of this._clicks || []) { try { o.stop(); } catch (e) { /* ya parado */ } }
      r.mic.disconnect(); r.recNode.disconnect(); r.mute.disconnect(); if (r.monitor) r.monitor.disconnect();
      if (!r.opts.stream) r.stream.getTracks().forEach((t) => t.stop());
      if (r.first < 0 || r.total === 0) return null;
      const all = new Float32Array(r.total); let o = 0; for (const c of r.chunks) { all.set(c, o); o += c.length; }
      // posición en la canción de la muestra i: desde + (first + i)/sr − T0 − latencia.
      // La latencia incluye la de la cadena de efectos (la base que oyes pasa por ella).
      const lat = this.latenciaTotal() + this.latencia / sr;
      let inicio = r.desde + r.first / sr - r.T0 - lat;
      let skip = 0;
      if (inicio < r.desde) { skip = Math.round((r.desde - inicio) * sr); inicio = r.desde; } // fuera la cuenta atrás
      if (skip >= all.length) return null;
      const g = Math.pow(10, (r.opts.gananciaEntrada || 0) / 20);
      const buf = ctx.createBuffer(1, all.length - skip, sr), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = all[i + skip] * g;
      return { buffer: buf, inicio, latencia: lat };
    }

    // ── calibración: clics por los altavoces → micro, mide la ida y vuelta real ──
    async calibrar(onInfo) {
      await this.resume();
      const ctx = this.ctx, sr = ctx.sampleRate;
      this.stop();
      const stream = await this.abrirMicro();
      const mic = micSource(ctx, stream);
      const recNode = new AudioWorkletNode(ctx, 'vox-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const mute = ctx.createGain(); mute.gain.value = 0; recNode.connect(mute); mute.connect(ctx.destination); mic.connect(recNode);
      const chunks = []; let first = -1;
      const done = new Promise((res) => {
        recNode.port.onmessage = (e) => { const d = e.data; if (d.type === 'start') first = d.frame; else if (d.type === 'chunk') chunks.push(d.data); else if (d.type === 'done') res(); };
      });
      // tren de 8 golpes cortos y fuertes
      const T0 = ctx.currentTime + 0.6, gap = 0.45, N = 8;
      const clickBuf = ctx.createBuffer(1, Math.round(sr * 0.004), sr); const cb = clickBuf.getChannelData(0);
      for (let i = 0; i < cb.length; i++) cb[i] = (i % 2 ? -1 : 1) * 0.9 * (1 - i / cb.length);
      for (let k = 0; k < N; k++) { const s = ctx.createBufferSource(); s.buffer = clickBuf; s.connect(ctx.destination); s.start(T0 + k * gap); }
      if (onInfo) onInfo('Escuchando los clics…');
      await new Promise((r) => setTimeout(r, (0.6 + N * gap + 0.6) * 1000));
      recNode.port.postMessage({ type: 'stop' }); await Promise.race([done, new Promise((r) => setTimeout(r, 800))]);
      mic.disconnect(); recNode.disconnect(); mute.disconnect(); stream.getTracks().forEach((t) => t.stop());
      const total = chunks.reduce((a, c) => a + c.length, 0); const x = new Float32Array(total); let o = 0; for (const c of chunks) { x.set(c, o); o += c.length; }
      if (first < 0 || !total) throw new Error('No llegó audio del micrófono.');
      // detector de inicio: primera muestra que supera 8× el ruido en cada ventana
      let noise = 0; const nN = Math.min(x.length, Math.round(sr * 0.3)); for (let i = 0; i < nN; i++) noise = Math.max(noise, Math.abs(x[i]));
      const delays = [];
      for (let k = 0; k < N; k++) {
        const exp = Math.round((T0 + k * gap) * sr) - first;
        const a = Math.max(0, exp), b = Math.min(x.length, exp + Math.round(sr * 0.4));
        let pk = 0; for (let i = a; i < b; i++) pk = Math.max(pk, Math.abs(x[i]));
        if (pk < Math.max(noise * 6, 0.01)) continue;
        const thr = Math.max(noise * 4, pk * 0.35);
        for (let i = a; i < b; i++) if (Math.abs(x[i]) > thr) { delays.push((i - exp) / sr); break; }
      }
      if (delays.length < 4) throw new Error('No se oyeron bien los clics. Quita los auriculares, sube el volumen de los altavoces y acerca el micro.');
      delays.sort((p, q) => p - q);
      const med = delays[Math.floor(delays.length / 2)];
      const spread = delays[delays.length - 2] - delays[1];
      if (spread > 0.012) throw new Error('La medida no es estable (varía ' + Math.round(spread * 1000) + ' ms). Repite en silencio.');
      this.latInfo.calibrada = med; this.latInfo.calSalida = (ctx.outputLatency || 0) + (ctx.baseLatency || 0); this.guardarAjustes();
      return { latencia: med, medidas: delays.length, variacion: spread };
    }

    // ── render sin conexión (exportar) ──
    async render(o) {
      // o: { params, modo: 'mezcla'|'voz', onProgress }
      await this.init();
      const sr = this.sr;
      const p = JSON.parse(JSON.stringify(o.params));
      if (o.modo === 'voz') { p.base.mute = true; p.master.on = false; p.master.ganancia = 0; p.base.hueco = 0; }
      const lat = new D.VoxEngine(sr).latency;
      const fx = p.reverb.on ? p.reverb.decay * 1.6 : 0.3;
      const tail = Math.min(10, Math.max(fx, p.delay.on ? 2.5 : 0, 0.5));
      const t0 = Math.max(0, o.desde || 0); // trozo opcional (la mezcla automática solo mide un fragmento)
      const dur = (o.hasta ? Math.min(o.hasta, this.duracion()) : this.duracion()) - t0 + tail;
      const len = Math.ceil(dur * sr) + lat;
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const off = new OAC(2, len, sr);
      if (!off.audioWorklet) throw new Error('Este navegador es demasiado antiguo para exportar. Actualiza Safari (14.1 o más nuevo) o usa Chrome o Edge.');
      await off.audioWorklet.addModule(getWorkletURL());
      const node = new AudioWorkletNode(off, 'vox-processor', { numberOfInputs: 3, numberOfOutputs: 2, outputChannelCount: [2, 1], processorOptions: { params: p, offline: true } });
      node.connect(off.destination, 0);
      if (this.base && t0 < this.base.duration) { const s = off.createBufferSource(); s.buffer = this.base; s.connect(node, 0, 1); s.start(0, t0); }
      if (this.toma) {
        const t = this.toma, s = off.createBufferSource(); s.buffer = t.buffer; s.connect(node, 0, 0);
        if (t.inicio >= t0) s.start(t.inicio - t0); else if (t0 - t.inicio < t.buffer.duration) s.start(0, t0 - t.inicio);
      }
      if (!o.sinCoros) for (const c of this.coros) this._coroSrc(off, node, c, t0, 0); // la mezcla automática mide solo la principal
      // progreso: el render se detiene cada pocos segundos para avisar
      if (o.onProgress && off.suspend) {
        const step = Math.max(2, dur / 25);
        for (let t = step; t < len / sr; t += step) {
          off.suspend(t).then(() => { o.onProgress(t / (len / sr)); off.resume(); }).catch(() => {});
        }
      }
      const out = await off.startRendering();
      const n = out.length - lat;
      return [out.getChannelData(0).subarray(lat, lat + n), out.getChannelData(1).subarray(lat, lat + n)];
    }

    async remuestrear(chans, de, a) {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const n = Math.ceil(chans[0].length * a / de), off = new OAC(chans.length, n, a);
      const b = off.createBuffer(chans.length, chans[0].length, de); chans.forEach((c, i) => b.copyToChannel(c, i));
      const s = off.createBufferSource(); s.buffer = b; s.connect(off.destination); s.start(0);
      const r = await off.startRendering(); return [...Array(r.numberOfChannels)].map((_, i) => r.getChannelData(i));
    }

    // Voz sin efectos, colocada en su sitio de la canción (para el profesor o para otro programa)
    vozSeca() {
      const sr = this.sr, n = Math.ceil(this.duracion() * sr), x = new Float32Array(n);
      if (this.toma) { const d = this.toma.buffer.getChannelData(0), o = Math.round(this.toma.inicio * sr); for (let i = 0; i < d.length && o + i < n; i++) if (o + i >= 0) x[o + i] = d[i]; }
      return [x];
    }
  }

  window.Motor = Motor;
})();
