/* EpicStudio Lite · motor de audio (DSP) escrito desde cero.
 *
 * Un solo archivo sirve para tres sitios:
 *   1. el AudioWorklet del navegador (la página lo carga como Blob con voxdspModule.toString());
 *   2. la página principal (análisis, LUFS de la exportación, curvas de la EQ);
 *   3. las pruebas automáticas con Node (require).
 *
 * Cadena de la voz (mono): Entrada → Limpieza (puerta) → EQ paramétrica (8 bandas, dinámicas)
 *   → [De-esser] → Compresor 1 → Compresor 2 → [De-esser] → Saturación → Rider
 *   → Doblador/panorama (estéreo) → envíos a Delay y Reverb.
 * Base (estéreo): retardo de compensación → «hueco para la voz» (EQ dinámica) → volumen.
 * Bus final: suma → ganancia → Limitador true peak con anticipación → medidor LUFS.
 *
 * Toda la latencia de la cadena es CONSTANTE (los anticipos usan un retardo fijo máximo), así
 * que la base se retrasa siempre lo mismo y la voz nunca se desfasa, se toque lo que se toque.
 */
function voxdspModule() {
  'use strict';

  // ───────────────────────── utilidades ─────────────────────────
  const LN10_20 = Math.LN10 / 20;
  const dbToLin = (db) => Math.exp(db * LN10_20);
  const linToDb = (x) => (x > 1e-12 ? 20 * Math.log10(x) : -240);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  // número válido o valor por defecto (a diferencia de «x || d», respeta el 0)
  const num0 = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const coefFor = (tauSec, fs) => (tauSec <= 0 ? 0 : Math.exp(-1 / (tauSec * fs)));
  const DENORM = 1e-20;
  const REALCE_MAKEUP = 5.2; // dB: medido con voz cantada entrando a −20 dBFS RMS (lo que deja la mezcla automática)

  // ───────────────────────── biquads (RBJ) ─────────────────────────
  // Fórmulas del «Audio EQ Cookbook» de R. Bristow-Johnson (W3C Note). Devuelve coeficientes
  // normalizados {b0,b1,b2,a1,a2}. Tipos: peak, lowshelf, highshelf, lowpass, highpass,
  // notch, bandpass (0 dB en el centro), lp1, hp1 (primer orden, transformada bilineal).
  function design(type, f, q, gDb, fs) {
    f = clamp(f, 5, fs * 0.4999);
    q = Math.max(q, 0.025);
    const w0 = 2 * Math.PI * f / fs, cw = Math.cos(w0), sw = Math.sin(w0);
    const alpha = sw / (2 * q);
    const A = Math.pow(10, gDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'peak':
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
        a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
        a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break;
      }
      case 'lowpass':
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'highpass':
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'notch':
        b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'bandpass':
        b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'lp1': {
        const K = Math.tan(Math.PI * f / fs);
        return { b0: K / (1 + K), b1: K / (1 + K), b2: 0, a1: (K - 1) / (K + 1), a2: 0 };
      }
      case 'hp1': {
        const K = Math.tan(Math.PI * f / fs);
        return { b0: 1 / (1 + K), b1: -1 / (1 + K), b2: 0, a1: (K - 1) / (K + 1), a2: 0 };
      }
      default:
        return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  // Módulo (lineal) de un biquad en la frecuencia f.
  function biquadMag(c, f, fs) {
    const w = 2 * Math.PI * f / fs;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = c.b0 + c.b1 * c1 + c.b2 * c2, ni = -(c.b1 * s1 + c.b2 * s2);
    const dr = 1 + c.a1 * c1 + c.a2 * c2, di = -(c.a1 * s1 + c.a2 * s2);
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }

  class Biquad {
    constructor(c) { this.z1 = 0; this.z2 = 0; this.set(c || { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }); }
    set(c) { this.b0 = c.b0; this.b1 = c.b1; this.b2 = c.b2; this.a1 = c.a1; this.a2 = c.a2; }
    reset() { this.z1 = this.z2 = 0; }
    process(x) { // forma directa II transpuesta
      const y = this.b0 * x + this.z1;
      this.z1 = this.b1 * x - this.a1 * y + this.z2;
      this.z2 = this.b2 * x - this.a2 * y;
      return y;
    }
  }

  // Pasa-altos / pasa-bajos Butterworth de pendiente 6, 12, 18, 24, 36, 48 (y 72, 96) dB/oct.
  function butterworthStages(type, f, slope, fs) {
    const order = Math.max(1, Math.round(slope / 6));
    const st = [];
    for (let k = 0; k < Math.floor(order / 2); k++) {
      // ángulo de cada par de polos: par → (2k+1)π/2n ; impar → (k+1)π/n
      const ang = order % 2 ? Math.PI * (k + 1) / order : Math.PI * (2 * k + 1) / (2 * order);
      const q = 1 / (2 * Math.cos(ang));
      st.push(design(type === 'hp' ? 'highpass' : 'lowpass', f, q, 0, fs));
    }
    if (order % 2) st.push(design(type === 'hp' ? 'hp1' : 'lp1', f, 0.707, 0, fs));
    return st;
  }

  // Etapas (coeficientes) de una banda de la EQ.
  function bandStages(b, fs, gainOverride) {
    const g = gainOverride !== undefined ? gainOverride : b.g;
    switch (b.tipo) {
      case 'campana': return [design('peak', b.f, b.q, g, fs)];
      case 'graves': return [design('lowshelf', b.f, b.q, g, fs)];
      case 'agudos': return [design('highshelf', b.f, b.q, g, fs)];
      case 'pasaaltos': return butterworthStages('hp', b.f, b.pendiente || 12, fs);
      case 'pasabajos': return butterworthStages('lp', b.f, b.pendiente || 12, fs);
      case 'muesca': return [design('notch', b.f, b.q, 0, fs)];
      default: return [];
    }
  }

  // Respuesta (dB) de toda la EQ en f. La usa la interfaz para dibujar la curva y las pruebas.
  function eqResponseDb(eq, f, fs, dynGains) {
    if (!eq || !eq.on) return 0;
    let db = 0;
    eq.bandas.forEach((b, i) => {
      if (!b.on) return;
      const g = dynGains && dynGains[i] !== undefined ? dynGains[i] : undefined;
      for (const c of bandStages(b, fs, g)) db += 20 * Math.log10(biquadMag(c, f, fs) + 1e-30);
    });
    return db;
  }

  // ───────────────────────── línea de retardo ─────────────────────────
  class DelayLine {
    constructor(n) { this.size = 1; while (this.size < n + 4) this.size <<= 1; this.mask = this.size - 1; this.buf = new Float64Array(this.size); this.w = 0; }
    write(x) { this.buf[this.w] = x; this.w = (this.w + 1) & this.mask; }
    // d = 0 → la última muestra escrita
    read(d) { return this.buf[(this.w - 1 - d) & this.mask]; }
    readFrac(d) { // interpolación cúbica de Hermite
      const i = Math.floor(d), t = d - i;
      const xm1 = this.read(i - 1), x0 = this.read(i), x1 = this.read(i + 1), x2 = this.read(i + 2);
      const c1 = 0.5 * (x1 - xm1), c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
      return ((c3 * t + c2) * t + c1) * t + x0;
    }
    clear() { this.buf.fill(0); }
  }

  // ───────────────────────── sobremuestreo ×4 (FIR polifásico) ─────────────────────────
  // FIR de 97 coeficientes (sinc con ventana Kaiser β=7). Retardo de grupo: 48 muestras
  // sobremuestreadas = 12 muestras por cada paso (subir o bajar) → 24 muestras ida y vuelta.
  const OS = 4, OS_TAPS = 97, OS_GD = (OS_TAPS - 1) / 2 / OS;
  function kaiserLowpass(taps, fc, beta) {
    const h = new Float64Array(taps), M = taps - 1;
    const i0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; };
    let sum = 0;
    for (let n = 0; n <= M; n++) {
      const m = n - M / 2;
      const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
      const w = i0(beta * Math.sqrt(1 - (2 * n / M - 1) ** 2)) / i0(beta);
      h[n] = sinc * w; sum += h[n];
    }
    for (let n = 0; n <= M; n++) h[n] /= sum;
    return h;
  }
  const polyphase = (h) => { const P = []; for (let p = 0; p < OS; p++) { const a = []; for (let k = p; k < h.length; k += OS) a.push(h[k] * OS); P.push(Float64Array.from(a)); } return P; };
  const OS_H = kaiserLowpass(OS_TAPS, 0.5 / OS * 0.955, 7);
  const OS_PH = polyphase(OS_H); // fases del polifásico: OS_PH[p][j] = h[j*OS + p] * OS
  // Detector fino del limitador: 193 coeficientes, banda pasante casi hasta Nyquist (retardo 24 muestras).
  const TP_TAPS = 193, TP_GD = (TP_TAPS - 1) / 2 / OS;
  const TP_PH = polyphase(kaiserLowpass(TP_TAPS, 0.5 / OS * 0.985, 8));

  class Upsampler4 { // una muestra entra, cuatro salen (en out[0..3])
    constructor(ph) { this.ph = ph || OS_PH; this.x = new Float64Array(64); this.p = 0; this.out = new Float64Array(OS); }
    process(v) {
      this.p = (this.p + 1) & 63; this.x[this.p] = v;
      for (let ph = 0; ph < OS; ph++) {
        const c = this.ph[ph]; let s = 0;
        for (let j = 0; j < c.length; j++) s += c[j] * this.x[(this.p - j) & 63];
        this.out[ph] = s;
      }
      return this.out;
    }
  }
  class Downsampler4 { // cuatro muestras entran, una sale
    constructor() { this.y = new Float64Array(128); this.p = 0; }
    process(a) {
      // la salida se calcula en la fase 0 para que el retardo total sea un número entero (12 muestras)
      this.p = (this.p + 1) & 127; this.y[this.p] = a[0];
      let s = 0;
      for (let n = 0; n < OS_TAPS; n++) s += OS_H[n] * this.y[(this.p - n) & 127];
      for (let k = 1; k < OS; k++) { this.p = (this.p + 1) & 127; this.y[this.p] = a[k]; }
      return s;
    }
  }

  // ───────────────────────── K-weighting y LUFS (ITU-R BS.1770 / EBU R128) ─────────────────────────
  function kWeighting(fs) {
    // Etapa 1: estante (cabeza). Etapa 2: pasa-altos RLB. Fórmulas analógicas → bilineal (como libebur128).
    let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    let K = Math.tan(Math.PI * f0 / fs);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    const s1 = { b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0,
      a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
    f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs);
    a0 = 1 + K / Q + K * K;
    const s2 = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
    return [s1, s2];
  }

  class LufsMeter {
    constructor(fs, channels = 2) {
      this.fs = fs; this.ch = channels;
      const kw = kWeighting(fs);
      this.f = []; for (let c = 0; c < channels; c++) this.f.push([new Biquad(kw[0]), new Biquad(kw[1])]);
      this.sub = Math.round(fs * 0.1); // bloques de 100 ms
      this.ring = new Float64Array(30); this.ringN = 0; this.ringPos = 0;
      this.acc = 0; this.cnt = 0;
      this.blocks = []; // energía de bloques de 400 ms (solape 75 %) para el integrado
      this.st = []; // short-term cada 100 ms (para LRA)
      this.momentary = -Infinity; this.shortTerm = -Infinity; this.maxMomentary = -Infinity; this.maxShort = -Infinity;
    }
    reset() { this.ring.fill(0); this.ringN = 0; this.acc = 0; this.cnt = 0; this.blocks = []; this.st = []; this.momentary = this.shortTerm = this.maxMomentary = this.maxShort = -Infinity; this.f.forEach((a) => a.forEach((b) => b.reset())); }
    push(l, r) { // una muestra por canal
      let e = 0;
      const yl = this.f[0][1].process(this.f[0][0].process(l)); e += yl * yl;
      if (this.ch > 1) { const yr = this.f[1][1].process(this.f[1][0].process(r)); e += yr * yr; }
      this.acc += e; this.cnt++;
      if (this.cnt >= this.sub) {
        this.ring[this.ringPos] = this.acc / this.cnt; this.ringPos = (this.ringPos + 1) % 30; this.ringN = Math.min(30, this.ringN + 1);
        this.acc = 0; this.cnt = 0;
        const mean = (n) => { let s = 0; for (let k = 1; k <= n; k++) s += this.ring[(this.ringPos - k + 30) % 30]; return s / n; };
        if (this.ringN >= 4) {
          const m = mean(4); this.blocks.push(m);
          this.momentary = -0.691 + 10 * Math.log10(m + 1e-30);
          if (this.momentary > this.maxMomentary) this.maxMomentary = this.momentary;
        }
        if (this.ringN >= 30) {
          const s = mean(30); this.shortTerm = -0.691 + 10 * Math.log10(s + 1e-30);
          this.st.push(this.shortTerm); if (this.shortTerm > this.maxShort) this.maxShort = this.shortTerm;
        }
      }
    }
    integrated() {
      const L = (e) => -0.691 + 10 * Math.log10(e + 1e-30);
      const abs = this.blocks.filter((e) => L(e) > -70);
      if (!abs.length) return -Infinity;
      const relGate = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
      const g = abs.filter((e) => L(e) > relGate);
      if (!g.length) return -Infinity;
      return L(g.reduce((a, b) => a + b, 0) / g.length);
    }
    range() { // LRA (EBU Tech 3342), aproximado con short-term cada 100 ms
      const v = this.st.filter((x) => x > -70);
      if (v.length < 10) return 0;
      const lin = v.map((x) => Math.pow(10, x / 10));
      const rel = 10 * Math.log10(lin.reduce((a, b) => a + b, 0) / lin.length) - 20;
      const g = v.filter((x) => x > rel).sort((a, b) => a - b);
      if (g.length < 2) return 0;
      const q = (p) => g[Math.min(g.length - 1, Math.max(0, Math.round(p * (g.length - 1))))];
      return q(0.95) - q(0.10);
    }
  }

  // Pico real (true peak) de un búfer, con el mismo sobremuestreo ×4 de BS.1770.
  function truePeak(chans) {
    let m = 0;
    for (const x of chans) {
      const up = new Upsampler4();
      for (let i = 0; i < x.length + 2 * OS_GD + 2; i++) {
        const o = up.process(i < x.length ? x[i] : 0);
        for (let k = 0; k < OS; k++) { const a = Math.abs(o[k]); if (a > m) m = a; }
      }
    }
    return m;
  }

  function analyzeLoudness(chans, fs) {
    const lm = new LufsMeter(fs, chans.length > 1 ? 2 : 1);
    const L = chans[0], R = chans[1] || chans[0];
    for (let i = 0; i < L.length; i++) lm.push(L[i], R[i]);
    let sp = 0; for (const x of chans) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > sp) sp = a; }
    return { integrado: lm.integrated(), lra: lm.range(), maxMomentaneo: lm.maxMomentary, maxCorto: lm.maxShort,
      truePeak: linToDb(truePeak(chans)), picoMuestra: linToDb(sp) };
  }

  // ───────────────────────── curva estática del compresor ─────────────────────────
  // Rodilla suave cuadrática (Giannoulis, Massberg y Reiss, JAES 2012). Devuelve la ganancia (dB ≤ 0).
  function gainComputer(x, T, R, W) {
    const over = x - T;
    if (W > 0 && 2 * Math.abs(over) <= W) {
      const t = over + W / 2;
      return (1 / R - 1) * t * t / (2 * W);
    }
    if (over > 0) return over * (1 / R - 1);
    return 0;
  }

  // Tabla del compresor FET: umbral fijo por relación (como el original, el umbral sube con la relación).
  const FET_TABLE = {
    '4': { thr: -24, ratio: 4, knee: 4 },
    '8': { thr: -21, ratio: 8, knee: 3 },
    '12': { thr: -19, ratio: 12, knee: 2 },
    '20': { thr: -17, ratio: 20, knee: 2 },
    todos: { thr: -22, ratio: 40, knee: 10 },
  };

  // Parámetros efectivos (umbral, relación, rodilla) de un compresor. Lo usan el DSP, la
  // interfaz (para dibujar la curva) y las pruebas (para comparar con la teoría).
  // Ganancia automática: la voz a un nivel de referencia (−12 dB en el detector, una frase cantada
  // con la entrada ajustada) sale igual de fuerte que entra. «Salida» queda como retoque.
  const COMP_REF = -12;
  function compStatic(p) {
    const s = compStaticRaw(p);
    if (p.autoGan !== false) {
      let g = gainComputer(COMP_REF + s.pre, s.T, s.R, s.W);
      const range = p.tipo === 'moderno' && p.rango > 0 ? p.rango : 120;
      if (g < -range) g = -range;
      s.post += -(s.pre + g);
    }
    return s;
  }
  function compStaticRaw(p) {
    switch (p.tipo) {
      case 'fet': { // umbral fijo: la «entrada» empuja la señal contra él (como el aparato original)
        const t = FET_TABLE[p.ratioFet] || FET_TABLE['4'];
        return { T: t.thr, R: t.ratio, W: t.knee, pre: p.entrada || 0, post: p.salida || 0 };
      }
      case 'optico': {
        const lim = p.optoModo === 'limitar';
        return { T: -(p.reduccion || 0) * 0.4, R: lim ? 12 : 3, W: lim ? 8 : 18, pre: 0, post: p.salida || 0 };
      }
      case 'vca':
        return { T: p.umbral, R: p.ratio >= 30 ? 1000 : p.ratio, W: p.rodilla || 0, pre: 0, post: p.salida || 0 };
      default: { // moderno
        const R = p.ratio >= 30 ? 1000 : p.ratio;
        return { T: p.umbral, R, W: p.rodilla || 0, pre: 0, post: p.salida || 0 };
      }
    }
  }

  // Curva teórica de entrada → salida (dB de pico de un seno). Para dibujarla y para las pruebas.
  function compTransfer(p, x) {
    const s = compStatic(p);
    let g = gainComputer(x + s.pre, s.T, s.R, s.W);
    const range = p.tipo === 'moderno' && p.rango > 0 ? p.rango : 120;
    if (g < -range) g = -range;
    const wet = x + s.pre + g + s.post;
    const m = clamp((p.mezcla === undefined ? 100 : p.mezcla) / 100, 0, 1);
    if (m >= 1) return wet;
    return linToDb((1 - m) * dbToLin(x) + m * dbToLin(wet));
  }

  // ───────────────────────── compresor (4 tipos) ─────────────────────────
  const COMP_LA_MAX = 0.010; // anticipo máximo 10 ms (latencia fija)
  class Compressor {
    constructor(fs) {
      this.fs = fs;
      this.maxLa = Math.ceil(COMP_LA_MAX * fs);
      this.dl = new DelayLine(this.maxLa + 2); // audio
      this.sl = new DelayLine(this.maxLa + 2); // cadena lateral (detector)
      this.sc = new Biquad(); this.sc2 = new Biquad(); this.emph = new Biquad();
      this.env = 0; this.pwr = 0; this.gr = 0; this.hold = 0; this.mem = 0; this.relPeak = 0;
      this.dc = 0; this.dcx = 0; this.grMin = 0; this.p = null;
      this.latency = this.maxLa;
    }
    set(p) {
      this.p = p; const fs = this.fs;
      const s = compStatic(p); this.T = s.T; this.R = s.R; this.W = s.W;
      this.preG = dbToLin(s.pre); this.postG = s.post;
      this.mix = clamp((p.mezcla === undefined ? 100 : p.mezcla) / 100, 0, 1);
      this.range = p.tipo === 'moderno' && p.rango > 0 ? p.rango : 120;
      const hp = p.scHpf || 0;
      this.useSc = hp > 20; if (this.useSc) { this.sc.set(design('highpass', hp, 0.707, 0, fs)); this.sc2.set(design('highpass', hp, 0.707, 0, fs)); }
      this.useEmph = p.tipo === 'optico' && (p.enfasis || 0) > 0;
      if (this.useEmph) this.emph.set(design('highshelf', 3000, 0.6, (p.enfasis || 0) * 0.12, fs));
      const la = p.tipo === 'moderno' ? clamp(p.anticipo || 0, 0, 10) / 1000 : 0;
      this.laSamp = Math.round(la * fs);
      // detector: 'peak' | 'rms'
      const t = p.tipo;
      if (t === 'fet') {
        this.det = 'peak';
        const abi = p.ratioFet === 'todos';
        this.att = clamp(p.ataque || 0.2, 0.02, 0.8) / 1000 * (abi ? 0.6 : 1);
        this.rel = clamp(p.relajacion || 300, 50, 1100) / 1000 * (abi ? 1.5 : 1);
        this.dist = abi ? 0.035 : 0.006;
        this.rmsTau = 0;
      } else if (t === 'optico') {
        this.det = 'rms'; this.rmsTau = 0.005; this.att = 0.010; this.rel = 0.060; this.dist = 0.002;
      } else if (t === 'vca') {
        this.det = 'rms'; this.rmsTau = 0.003;
        this.att = clamp(p.ataque || 3, 0.1, 30) / 1000;
        this.rel = clamp(p.relajacion || 200, 30, 1500) / 1000;
        this.dist = 0;
      } else {
        const st = p.estilo || 'limpio';
        this.det = st === 'impacto' || st === 'limpio' ? 'peak' : 'rms';
        this.rmsTau = st === 'pegamento' ? 0.02 : 0.008;
        this.att = clamp(p.ataque === undefined ? 10 : p.ataque, 0.005, 250) / 1000;
        this.rel = clamp(p.relajacion || 150, 10, 2500) / 1000;
        this.dist = 0;
      }
      this.aAtt = coefFor(this.att, fs); this.aRel = coefFor(this.rel, fs);
      this.aRms = coefFor(this.rmsTau, fs);
      this.aMem = coefFor(1.5, fs);
      this.holdN = p.tipo === 'moderno' ? Math.round(clamp(p.retencion || 0, 0, 500) / 1000 * fs) : 0;
      this.autoRel = (p.tipo === 'vca' && p.autoRel) || (p.tipo === 'moderno' && p.estilo === 'vocal');
    }
    reset() { this.env = this.pwr = this.gr = this.mem = 0; this.dl.clear(); this.sl.clear(); }
    process(x) {
      const p = this.p;
      // cadena lateral
      let s = x;
      if (this.useSc) s = this.sc2.process(this.sc.process(s));
      if (this.useEmph) s = this.emph.process(s);
      this.dl.write(x); this.sl.write(s * this.preG);
      const xd = this.dl.read(this.maxLa);
      const sd = this.sl.read(this.maxLa - this.laSamp);
      if (!p.on) return xd;
      // nivel del detector (dB, calibrado para que un seno lea su pico)
      let lv;
      if (this.det === 'peak') lv = linToDb(Math.abs(sd));
      else { this.pwr = this.aRms * this.pwr + (1 - this.aRms) * sd * sd + DENORM; lv = 10 * Math.log10(2 * this.pwr); }
      let target = gainComputer(lv, this.T, this.R, this.W);
      if (target < -this.range) target = -this.range;
      // envolvente en dB
      let e = this.env;
      if (target < e) { // ataque
        e = this.aAtt * e + (1 - this.aAtt) * target;
        this.hold = this.holdN; this.relPeak = e;
      } else if (this.hold > 0) {
        this.hold--;
      } else { // relajación
        let a = this.aRel;
        if (p.tipo === 'optico') {
          // dos etapas: la primera mitad vuelve en ~60 ms, el resto en 0,5–5 s según la «memoria» de la célula
          const firstHalf = e < this.relPeak * 0.5;
          const slow = 0.5 + 4.5 * this.mem;
          a = firstHalf ? this.aRel : coefFor(slow, this.fs);
        } else if (p.tipo === 'fet') {
          a = coefFor(this.rel * (1 + 0.6 * this.mem), this.fs);
        } else if (this.autoRel) {
          // dependiente del programa: tras compresión larga, vuelve más despacio
          a = coefFor(this.rel * (0.5 + 2.5 * this.mem), this.fs);
        }
        e = a * e + (1 - a) * target;
      }
      this.env = e;
      const m = Math.min(1, -e / 12);
      this.mem = this.aMem * this.mem + (1 - this.aMem) * m;
      if (e < this.grMin) this.grMin = e;
      let y = xd * this.preG * dbToLin(e + this.postG);
      if (this.dist > 0) { // armónicos del FET / del amplificador de válvulas, más fuertes cuanto más comprime
        const k = this.dist * (0.3 + Math.min(1, -e / 10));
        y = y + k * (y * Math.abs(y) * 0.6 - y * y * y * 0.4);
        // bloqueo de continua
        const o = y - this.dcx + 0.9995 * this.dc; this.dcx = y; this.dc = o; y = o;
      }
      return this.mix >= 1 ? y : xd * (1 - this.mix) + y * this.mix;
    }
    takeGr() { const g = this.grMin; this.grMin = 0; return g; }
  }

  // ───────────────────────── puerta / expansor («Limpieza») ─────────────────────────
  class Gate {
    constructor(fs) { this.fs = fs; this.env = 0; this.g = 0; this.hold = 0; this.open = false; this.grMin = 0; }
    set(p) {
      this.p = p; const fs = this.fs;
      this.aDet = coefFor(0.005, fs);
      this.aAtt = coefFor(clamp(p.ataque || 1, 0.1, 50) / 1000, fs);
      this.aRel = coefFor(clamp(p.relajacion || 120, 10, 2000) / 1000, fs);
      this.holdN = Math.round(0.05 * fs);
      this.range = clamp(num0(p.rango, 12), 0, 60);
    }
    process(x) {
      const p = this.p; if (!p.on) return x;
      const a = Math.abs(x);
      this.env = a > this.env ? a : this.aDet * this.env + (1 - this.aDet) * a;
      const lv = linToDb(this.env);
      if (lv > p.umbral) { this.open = true; this.hold = this.holdN; }
      else if (lv < p.umbral - 4) { if (this.hold > 0) this.hold--; else this.open = false; }
      const target = this.open ? 0 : -this.range;
      this.g = target > this.g ? this.aAtt * this.g + (1 - this.aAtt) * target : this.aRel * this.g + (1 - this.aRel) * target;
      if (this.g > -1e-12) this.g = 0; // sin denormales
      if (this.g < this.grMin) this.grMin = this.g;
      return x * dbToLin(this.g);
    }
    takeGr() { const g = this.grMin; this.grMin = 0; return g; }
  }

  // ───────────────────────── Realce vocal ─────────────────────────
  // Voz «de radio» en un solo mando (idea: el Amplificador vocal de Audition; diseño propio):
  // simula un micro de locución (graves cálidos, menos caja, presencia y aire), quita rumble y golpes de «p»
  // y comprime en tres bandas hacia abajo Y hacia arriba: las partes fuertes bajan y las flojas suben,
  // así la voz queda densa, pegada y siempre delante sin sonar a compresor normal. Sin latencia.
  class Realce {
    constructor(fs) {
      this.fs = fs; this.pre = []; const bq2 = () => [new Biquad(), new Biquad()];
      this.l1 = bq2(); this.h1 = bq2(); this.l2 = bq2(); this.h2 = bq2(); this.al = bq2(); this.ah = bq2();
      this.lv = [0, 0, 0]; this.pk = [0, 0, 0]; this.g = [0, 0, 0]; this.grMin = 0;
      this.pres = 0; this.vlv = 0; this.hold = 0; // detector lento de «hay voz»
      this.w = 0; this.cCur = -1; this.cTgt = 0; this.cnt = 0; this.perfil = '';
      this.on = false; this.mkDb = 0;
    }
    set(p) {
      const fs = this.fs, grave = p.perfil !== 'aguda';
      this.on = !!p.on; this.cTgt = clamp(num0(p.cantidad, 60), 0, 100) / 100;
      if (this.perfil !== (grave ? 'grave' : 'aguda')) {
        this.perfil = grave ? 'grave' : 'aguda'; this.grave = grave;
        const f1 = grave ? 220 : 300, f2 = grave ? 4000 : 5000;
        // cruces Linkwitz-Riley de 24 dB/oct; los graves pasan también por el segundo cruce (paso-todo) para que la suma sea plana
        const LR = (arr, t, f) => { for (const b of arr) b.set(design(t, f, Math.SQRT1_2, 0, fs)); };
        LR(this.l1, 'lowpass', f1); LR(this.h1, 'highpass', f1); LR(this.l2, 'lowpass', f2); LR(this.h2, 'highpass', f2); LR(this.al, 'lowpass', f2); LR(this.ah, 'highpass', f2);
        this.cCur = -1; // recalcular la EQ de micro
      }
      // por banda: nivel objetivo (dB RMS con la voz entrando a −20 dBFS); proporción típica de una voz cantada
      this.T = [-34, -24, -38];
      this.aDet = coefFor(0.004, fs); this.aPk = coefFor(0.010, fs);
      this.aAtt = [coefFor(0.002, fs), coefFor(0.004, fs), coefFor(0.002, fs)];
      this.aRel = [coefFor(0.12, fs), coefFor(0.15, fs), coefFor(0.09, fs)];
      this.aV = coefFor(0.05, fs); this.aPresA = coefFor(0.02, fs); this.aPresR = coefFor(0.15, fs); this.holdN = Math.round(0.12 * fs);
      this.aW = coefFor(0.015, fs); this.aC = coefFor(0.03, fs);
    }
    // la cantidad se mueve suave (sin clics al girar el mando): EQ de micro y ganancias se recalculan cada 32 muestras
    actualizar() {
      const c = this.cCur, grave = this.grave, fs = this.fs;
      const st = [...butterworthStages('hp', grave ? 75 : 100, 12, fs),
        design('lowshelf', grave ? 160 : 250, 0.7, (grave ? 2.5 : 1.5) * c, fs),
        design('peak', grave ? 420 : 550, 1.1, -(grave ? 3 : 2.5) * c, fs),
        design('peak', grave ? 5000 : 6000, 0.9, 2.5 * c, fs), // presencia por encima de la zona estridente (2,5–4 kHz) (23/11)
        design('highshelf', 10000, 0.7, (grave ? 3 : 3.5) * c, fs)];
      if (this.pre.length !== st.length) this.pre = st.map(() => new Biquad());
      st.forEach((s, i) => this.pre[i].set(s));
      this.Rd = [1 + 8 * c, 1 + 5 * c, 1 + 5 * c];
      this.Up = [0, 8 * c, 6 * c]; // los graves no se suben (respiraciones y golpes de micro)
      this.mkDb = REALCE_MAKEUP * (1 - Math.pow(1 - c, 4)); // igual de fuerte encendido que apagado (voz a −20 dBFS RMS)
    }
    band(k, x) {
      const ax = Math.abs(x);
      this.lv[k] = this.aDet * this.lv[k] + (1 - this.aDet) * x * x;
      this.pk[k] = ax > this.pk[k] ? ax : this.aPk * this.pk[k] + (1 - this.aPk) * ax; // pico: ataque instantáneo
      const Lr = 10 * Math.log10(this.lv[k] + 1e-20), Lp = linToDb(this.pk[k]) - 9, T = this.T[k];
      const L = Math.max(Lr, Lp); // los golpes cuentan por su pico (una voz tiene ~9 dB de pico sobre su nivel medio): no se escapan
      let t;
      if (L > T) t = (T - L) * (1 - 1 / this.Rd[k]);
      else t = Math.min(this.Up[k], (T - L) * 0.5); // lo flojo sube (compresión hacia arriba)
      t = (t + this.mkDb) * this.pres; // sin voz no se toca nada: el silencio y el ruido no suben
      const g = this.g[k];
      this.g[k] = t < g ? (t < g - 6 ? t + 6 : this.aAtt[k] * g + (1 - this.aAtt[k]) * t) : this.aRel[k] * g + (1 - this.aRel[k]) * t;
      if (Math.abs(this.g[k]) < 1e-9) this.g[k] = 0;
      return x * dbToLin(this.g[k]);
    }
    process(x) {
      // fundido de 15 ms al encender y apagar; mientras está apagado sigue calculando (sin estados viejos al volver)
      this.w = this.aW * this.w + (1 - this.aW) * (this.on ? 1 : 0); if (this.w < 1e-6 && !this.on) { this.w = 0; return x; }
      if ((this.cnt++ & 31) === 0 || this.cCur < 0) {
        const c = this.cCur < 0 ? this.cTgt : this.aC * this.cCur + (1 - this.aC) * this.cTgt;
        if (this.cCur < 0 || Math.abs(c - this.cCur) > 1e-4) { this.cCur = Math.abs(c - this.cTgt) < 1e-4 ? this.cTgt : c; this.actualizar(); }
      }
      const xi = x + DENORM - DENORM * 0.5;
      // ¿hay voz? (nivel de 50 ms por encima de −45 dBFS, con retención de 120 ms)
      this.vlv = this.aV * this.vlv + (1 - this.aV) * xi * xi;
      if (this.vlv > 3.2e-5) this.hold = this.holdN; else if (this.hold > 0) this.hold--;
      const tp = this.hold > 0 ? 1 : 0;
      this.pres = tp > this.pres ? this.aPresA * this.pres + (1 - this.aPresA) * tp : this.aPresR * this.pres + (1 - this.aPresR) * tp;
      let y = xi; for (let i = 0; i < this.pre.length; i++) y = this.pre[i].process(y);
      const P = (a, v) => a[1].process(a[0].process(v));
      const l0 = P(this.l1, y), r = P(this.h1, y);
      const lo = P(this.al, l0) + P(this.ah, l0), mid = P(this.l2, r), hi = P(this.h2, r);
      const out = this.band(0, lo) + this.band(1, mid) + this.band(2, hi);
      const gr = this.g[1] - this.mkDb * this.pres; if (gr < this.grMin) this.grMin = gr;
      return this.w >= 1 ? out : out * this.w + x * (1 - this.w);
    }
    takeGr() { const g = this.grMin; this.grMin = 0; return g; }
  }

  // ───────────────────────── FFT compleja radix-2 (en sitio) ─────────────────────────
  class FFT {
    constructor(n) {
      this.n = n; this.rev = new Uint32Array(n); this.cos = new Float64Array(n / 2); this.sin = new Float64Array(n / 2);
      for (let i = 0, j = 0; i < n; i++) { this.rev[i] = j; let bit = n >> 1; while (j & bit) { j ^= bit; bit >>= 1; } j |= bit; }
      for (let i = 0; i < n / 2; i++) { this.cos[i] = Math.cos(-2 * Math.PI * i / n); this.sin[i] = Math.sin(-2 * Math.PI * i / n); }
    }
    run(re, im, inv) {
      const n = this.n, rv = this.rev, s = inv ? -1 : 1;
      for (let i = 0; i < n; i++) { const j = rv[i]; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let len = 2; len <= n; len <<= 1) {
        const h = len >> 1, st = n / len;
        for (let i = 0; i < n; i += len) for (let k = 0; k < h; k++) {
          const wr = this.cos[k * st], wi = s * this.sin[k * st], a = i + k, b = a + h;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
      if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
  }

  // ───────────────────────── Suavizador de resonancias ─────────────────────────
  // Idea de los suavizadores dinámicos tipo Soothe (diseño propio): en cada instante compara el espectro de la voz con su
  // propia forma suavizada y baja SOLO las frecuencias que sobresalen (lo que pincha, silba o raspa), y solo mientras
  // sobresalen. STFT de 512 (1024 a 88,2/96 kHz) con 75 % de solape: latencia fija de ~11 ms (lo justo para no molestar al escucharte mientras grabas).
  class Suavizador {
    constructor(fs) {
      this.fs = fs; const N = fs > 60000 ? 1024 : 512; this.N = N; this.H = N / 4; this.latency = N;
      this.fft = new FFT(N); this.re = new Float64Array(N); this.im = new Float64Array(N);
      this.win = new Float64Array(N); for (let i = 0; i < N; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
      this.inB = new Float64Array(N); this.inP = 0; this.out = new Float64Array(N); this.outP = 0; this.cnt = 0;
      const K = N / 2 + 1; this.K = K; this.db = new Float64Array(K); this.cs = new Float64Array(K + 1); this.red = new Float64Array(K); this.tgt = new Float64Array(K); this.ps = new Float64Array(K); this.pk = new Float64Array(K); this.M = Math.max(1, Math.round(500 / (fs / N)));
      this.lo = new Uint32Array(K); this.hi = new Uint32Array(K); this.peso = new Float64Array(K);
      this.dry = new DelayLine(N + 4); this.w = 0; this.warm = 0; this.on = false; this.grMax = 0; this.p = null;
    }
    set(p) {
      const fs = this.fs, N = this.N, K = this.K;
      this.on = !!p.on; this.p = p;
      const c = clamp(num0(p.cantidad, 50), 0, 100) / 100, nit = clamp(num0(p.nitidez, 50), 0, 100) / 100;
      this.maxRed = 16 * c; this.pend = 0.35 + 0.55 * c; this.umbral = 4 - c; // con cantidad alta no baja del grano natural del ruido // dB por encima de la forma suavizada
      const oct = 1 * Math.pow(1 / 8, nit); // ancho de la forma suavizada: 1 octava (nitidez 0) … 1/8 (nitidez 100)
      const da = clamp(num0(p.desde, 1500), 200, 20000), ha = clamp(num0(p.hasta, 9000), 200, 20000);
      const f1 = Math.min(da, ha), f2 = Math.max(Math.max(da, ha), f1 * 1.26);
      for (let k = 0; k < K; k++) {
        const f = Math.max(k, 1) * fs / N, a = Math.pow(2, oct / 2);
        const M3 = 3 * Math.max(1, Math.round(500 / (fs / N)));
        this.lo[k] = Math.max(0, Math.min(Math.floor(k / a), k - M3)); this.hi[k] = Math.min(K - 1, Math.max(Math.ceil(k * a), k + M3));
        // zona de trabajo con bordes suaves de 1/3 de octava
        const e1 = clamp(Math.log2(f / f1) * 6, 0, 1), e2 = clamp(Math.log2(f2 / f) * 6, 0, 1); // rampa de 1/6 de octava DENTRO del rango
        this.peso[k] = Math.min(e1, e2);
      }
      const hs = this.H / fs;
      this.aAtt = 1 - Math.exp(-hs / 0.004); this.aRel = 1 - Math.exp(-hs / (clamp(num0(p.relajacion, 80), 20, 500) / 1000));
    }
    frame() {
      const N = this.N, K = this.K, re = this.re, im = this.im, win = this.win, db = this.db, cs = this.cs, red = this.red, tgt = this.tgt;
      for (let i = 0; i < N; i++) { re[i] = this.inB[(this.inP + i) & (N - 1)] * win[i]; im[i] = 0; }
      this.fft.run(re, im, false);
      // espectro algo promediado en el tiempo (~10 ms): el grano del ruido no cuenta como resonancia
      for (let k = 0; k < K; k++) { this.ps[k] = 0.5 * this.ps[k] + 0.5 * (re[k] * re[k] + im[k] * im[k]); db[k] = 10 * Math.log10(this.ps[k] + 1e-20); }
      // forma de referencia que pasa por las CRESTAS vecinas (máximo en ±500 Hz, media alrededor SIN contar la zona propia): los armónicos de una nota
      // cantada no cuentan como resonancia; solo lo que sobresale de la forma de los armónicos (23/11)
      const pk = this.pk, M = this.M;
      for (let k = 0; k < K; k++) { let m = -400; const a = Math.max(0, k - M), b = Math.min(K - 1, k + M); for (let j = a; j <= b; j++) if (db[j] > m) m = db[j]; pk[k] = m; }
      cs[0] = 0; for (let k = 0; k < K; k++) cs[k + 1] = cs[k] + pk[k];
      let gmax = 0;
      for (let k = 1; k < K; k++) {
        let t = 0;
        if (this.peso[k] > 0 && db[k] > -100) {
          const c0 = Math.max(this.lo[k], k - this.M), c1 = Math.min(this.hi[k], k + this.M), nn = (this.hi[k] - this.lo[k] + 1) - (c1 - c0 + 1);
          const env = nn > 0 ? ((cs[this.hi[k] + 1] - cs[this.lo[k]]) - (cs[c1 + 1] - cs[c0])) / nn : db[k];
          const ex = db[k] - env - this.umbral;
          if (ex > 0) t = Math.min(this.maxRed, ex * this.pend) * this.peso[k];
        }
        tgt[k] = t;
      }
      for (let k = 1; k < K; k++) { // un poco de suavizado entre bins vecinos (sin «ruido musical»)
        const t = (tgt[k - 1] + 2 * tgt[k] + (k + 1 < K ? tgt[k + 1] : tgt[k])) * 0.25;
        red[k] += (t - red[k]) * (t > red[k] ? this.aAtt : this.aRel);
        if (red[k] < 1e-4) red[k] = 0; if (red[k] > gmax) gmax = red[k];
      }
      if (gmax > this.grMax) this.grMax = gmax;
      for (let k = 1; k < K; k++) if (red[k] > 0) { const g = dbToLin(-red[k]); re[k] *= g; im[k] *= g; if (k < N / 2) { re[N - k] *= g; im[N - k] *= g; } }
      this.fft.run(re, im, true);
      const sc = 0.5; // ventana raíz de Hann en análisis y síntesis con 75 % de solape: la suma de Hann vale 2
      for (let i = 0; i < N; i++) this.out[(this.outP + i) & (N - 1)] += re[i] * win[i] * sc;
    }
    process(x) {
      const N = this.N; this.dry.write(x); const dry = this.dry.read(N);
      const tgt = this.on && this.warm >= N ? 1 : 0;
      if (!this.on && this.w === 0) { // apagado: solo el retardo fijo (la cadena no cambia de latencia)
        if (!this.idle) { this.idle = true; this.out.fill(0); this.red.fill(0); this.cnt = 0; }
        this.warm = 0; this.outP = (this.outP + 1) & (N - 1); this.inB[this.inP] = x; this.inP = (this.inP + 1) & (N - 1); return dry;
      }
      this.idle = false;
      this.inB[this.inP] = x; this.inP = (this.inP + 1) & (N - 1);
      const y = this.out[this.outP]; this.out[this.outP] = 0; this.outP = (this.outP + 1) & (N - 1);
      if (++this.cnt >= this.H) { this.cnt = 0; this.frame(); }
      if (this.warm < N) this.warm++;
      this.w += ((tgt) - this.w) * 0.003; if (Math.abs(this.w - tgt) < 1e-4) this.w = tgt; // ~7 ms
      return this.w * y + (1 - this.w) * dry;
    }
    takeGr() { const g = this.grMax; this.grMax = 0; return -g; }
  }

  // ───────────────────────── Ecualizador de armónicos ─────────────────────────
  // Lo que Áleran hace a mano en Audition con los agudos y los gritos: subir la nota y todas sus octavas
  // (La: 220, 440, 880… hasta la octava 8) para que la nota brille «artificialmente» y destaque.
  // Modo «sigue»: detecta la nota que cantas y mueve los filtros con ella; solo actúa a partir de la nota «desde».
  // Modo «fija»: siempre la misma nota (como en Audition, para un trozo concreto). Sin latencia.
  const NOTAS = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
  const notaHz = (i, oct) => 440 * Math.pow(2, (i - 9) / 12 + (oct - 4)); // índice científico: La4 = 440 Hz
  class Armonicos {
    constructor(fs) {
      this.fs = fs; this.MAXF = 10; this.f = []; for (let i = 0; i < this.MAXF; i++) this.f.push(new Biquad());
      // detector YIN sobre la señal diezmada a ~16 kHz, con pasa-altos de 60 Hz (sin zumbidos ni DC)
      const D = Math.max(1, Math.round(fs / 16000)); this.D = D; this.fd = fs / D;
      this.hp = [new Biquad(), new Biquad()]; for (const b of this.hp) b.set(design('highpass', 60, Math.SQRT1_2, 0, fs));
      this.aa = [new Biquad(), new Biquad()]; for (const b of this.aa) b.set(design('lowpass', Math.min(3200, this.fd * 0.4), Math.SQRT1_2, 0, fs));
      this.W = Math.round(0.025 * this.fd); this.minT = Math.max(2, Math.floor(this.fd / 1600)); this.maxT = Math.floor(this.fd / 70);
      this.bufN = 1; while (this.bufN < this.W + this.maxT + 4) this.bufN <<= 1; this.buf = new Float64Array(this.bufN); this.bp = 0;
      this.d = new Float64Array(this.maxT + 2); this.dc = 0; this.hop = 0; this.hopN = Math.max(1, Math.round(this.W / 4)); this.upd = 0;
      this.f0 = 0; this.f0s = 0; this.cand = 0; this.nAct = 0; this.gCur = 0; this.on = false; this.p = null;
    }
    set(p) {
      this.p = p; this.on = !!p.on; this.modo = p.modo === 'fija' ? 'fija' : 'sigue';
      this.gain = clamp(num0(p.ganancia, 6), 0, 12); this.q = clamp(num0(p.ancho, 8), 1, 30);
      this.desde = clamp(num0(p.desde, 330), 60, 1500); this.nota = Math.max(0, NOTAS.indexOf(p.nota));
      this.aG = coefFor(0.03, this.fs); this.aGr = coefFor(0.003, this.fs); this.aF = coefFor(0.015, this.fs);
    }
    detectar() { // YIN: diferencia acumulada normalizada; el primer mínimo por debajo de 0,15 es el periodo
      const b = this.buf, M = this.bufN - 1, W = this.W, s0 = this.bp - W - this.maxT, d = this.d;
      let e = 0, m = 0; for (let i = 0; i < W; i++) { const v = b[(s0 + i) & M]; e += v * v; m += v; }
      if (e / W - (m / W) * (m / W) < 1e-6) return 0; // ventana casi en silencio (−60 dBFS): no hay nota
      let acc = 0; d[0] = 1;
      for (let t = 1; t <= this.maxT; t++) {
        let s = 0; for (let i = 0; i < W; i++) { const x = b[(s0 + i) & M] - b[(s0 + i + t) & M]; s += x * x; }
        acc += s; d[t] = acc > 0 ? s * t / acc : 1;
      }
      for (let t = this.minT; t < this.maxT; t++) {
        if (d[t] < 0.15 && d[t] <= d[t + 1]) {
          while (t + 1 < this.maxT && d[t + 1] < d[t]) t++;
          const a = d[t - 1], c = d[t + 1], den = a - 2 * d[t] + c; const off = den > 0 ? 0.5 * (a - c) / den : 0; // interpolación parabólica
          return this.fd / (t + clamp(off, -0.5, 0.5));
        }
      }
      return 0;
    }
    process(x) {
      if (!this.on && this.gCur === 0) return x;
      if (this.modo === 'sigue') {
        let y = x; for (const f of this.hp) y = f.process(y); for (const f of this.aa) y = f.process(y);
        if (++this.dc >= this.D) { this.dc = 0; this.buf[this.bp & (this.bufN - 1)] = y; this.bp++;
          if (++this.hop >= this.hopN) { this.hop = 0;
            const f = this.detectar();
            if (f > 0) {
              // dos lecturas seguidas que coincidan (±60 cents) antes de dar por buena una nota nueva
              const ok = this.cand > 0 && Math.abs(Math.log2(f / this.cand)) < 0.05; this.cand = f;
              if (ok || (this.f0 > 0 && Math.abs(Math.log2(f / this.f0)) < 0.05)) { this.f0 = f; this.nAct = Math.round(0.05 * this.fd); }
            } else { this.cand = 0; if (this.nAct > 0) this.nAct -= this.hopN; else this.f0 = 0; }
          }
        }
      } else { // nota fija: la primera octava de esa nota a partir de «desde»
        let k = 0; while (notaHz(this.nota, k) < this.desde * 0.97 && k < 9) k++; this.f0 = notaHz(this.nota, k);
      }
      const act = this.on && this.f0 > 0 && (this.modo === 'fija' || this.f0 >= this.desde) ? 1 : 0;
      // nota nueva o salto grande (más de 3 semitonos): los filtros saltan directos, sin barrer frecuencias de por medio
      // salto grande con los filtros sonando: primero bajan a cero (~3 ms), luego saltan y vuelven a subir
      const salto = this.f0 > 0 && this.f0s > 0 && Math.abs(Math.log2(this.f0 / this.f0s)) > 0.25 && this.gCur >= 0.05;
      if (this.f0 > 0 && !salto) { if (!this.f0s || this.gCur < 0.05 || Math.abs(Math.log2(this.f0 / this.f0s)) > 0.25) this.f0s = this.f0; else this.f0s = this.aF * this.f0s + (1 - this.aF) * this.f0; }
      const aG = salto ? this.aGr : this.aG;
      this.gCur = aG * this.gCur + (1 - aG) * (salto ? 0 : act * this.gain); if (this.gCur < 1e-3 && !act) this.gCur = 0;
      if ((this.upd++ & (salto ? 7 : 31)) === 0) {
        const fmax = Math.min(18000, this.fs * 0.45);
        for (let i = 0; i < this.MAXF; i++) {
          const fk = this.f0s * Math.pow(2, i);
          // las octavas se apagan poco a poco al acercarse al techo (sin clic al cruzarlo)
          const g = this.f0s > 0 && fk > 40 ? this.gCur * clamp((fmax - fk) / (0.25 * fmax), 0, 1) : 0;
          if (g > 1e-3) this.f[i].set(design('peak', Math.min(fk, fmax), this.q, g, this.fs));
          else this.f[i].set({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 });
        }
      }
      let y = x; for (let i = 0; i < this.MAXF; i++) y = this.f[i].process(y);
      return y;
    }
    takeNota() { return this.f0 > 0 ? this.f0 : 0; }
  }

  // ───────────────────────── EQ paramétrica dinámica ─────────────────────────
  class Equalizer {
    constructor(fs) { this.fs = fs; this.bands = []; this.cnt = 0; this.dynOut = []; }
    set(p) {
      this.p = p; const fs = this.fs;
      const old = this.bands;
      this.bands = p.bandas.map((b, i) => {
        const prev = old[i];
        const stages = bandStages(b, fs).map((c, k) => { const bq = prev && prev.stages[k] ? prev.stages[k] : new Biquad(); bq.set(c); return bq; });
        const d = b.din || {};
        const dyn = !!(b.on && d.on && (b.tipo === 'campana' || b.tipo === 'graves' || b.tipo === 'agudos'));
        const o = { b, stages, dyn, det: prev ? prev.det : new Biquad(), env: prev ? prev.env : 0, amt: prev ? prev.amt : 0, gNow: b.g };
        if (dyn) {
          o.det.set(design('bandpass', b.f, Math.max(0.5, b.q), 0, fs));
          o.aAtt = coefFor(clamp(d.ataque || 5, 0.5, 200) / 1000, fs);
          o.aRel = coefFor(clamp(d.relajacion || 120, 10, 2000) / 1000, fs);
          o.thr = d.umbral; o.range = num0(d.rango, -6);
        }
        return o;
      });
      this.bands.forEach((o, i) => { const pv = old[i]; if (o.dyn && pv && pv.dyn) { o.gNow = pv.gNow; o.stages[0].set(bandStages(o.b, fs, o.gNow)[0]); } });
      this.dynOut = this.bands.map((o) => o.gNow);
    }
    process(x) {
      if (!this.p.on) return x;
      const upd = (++this.cnt & 15) === 0;
      let y = x;
      for (let i = 0; i < this.bands.length; i++) {
        const o = this.bands[i];
        if (!o.b.on) continue;
        if (o.dyn) {
          const d = o.det.process(x); const a = Math.abs(d);
          o.env = a > o.env ? o.aAtt * o.env + (1 - o.aAtt) * a : o.aRel * o.env + (1 - o.aRel) * a;
          if (upd) {
            const over = linToDb(o.env * 1.41) - o.thr;
            const delta = over > 0 ? Math.sign(o.range) * Math.min(Math.abs(o.range), over * 0.6) : 0;
            const g = o.b.g + delta;
            if (Math.abs(g - o.gNow) > 0.05) { o.gNow = g; o.stages[0].set(bandStages(o.b, this.fs, g)[0]); }
            this.dynOut[i] = o.gNow;
          }
        }
        const st = o.stages;
        for (let k = 0; k < st.length; k++) y = st[k].process(y);
      }
      return y;
    }
  }

  // ───────────────────────── de-esser ─────────────────────────
  const DS_LA_MAX = 0.005;
  class DeEsser {
    constructor(fs) {
      this.fs = fs; this.maxLa = Math.ceil(DS_LA_MAX * fs);
      this.dl = new DelayLine(this.maxLa + 2); this.bl = new DelayLine(this.maxLa + 2);
      this.hp1 = new Biquad(); this.hp2 = new Biquad(); this.lp1 = new Biquad(); this.lp2 = new Biquad();
      this.split = new Biquad(); this.split2 = new Biquad(); this.splitH = new Biquad(); this.splitH2 = new Biquad();
      this.es = 0; this.ef = 0; this.g = 0; this.grMin = 0; this.latency = this.maxLa;
    }
    set(p) {
      this.p = p; const fs = this.fs;
      const lo = clamp(p.fMin || 5000, 1500, 16000), hi = clamp(Math.max(p.fMax || 12000, lo * 1.2), 2000, Math.min(20000, fs * 0.45));
      this.hp1.set(design('highpass', lo, 0.707, 0, fs)); this.hp2.set(design('highpass', lo, 0.707, 0, fs));
      this.lp1.set(design('lowpass', hi, 0.707, 0, fs)); this.lp2.set(design('lowpass', hi, 0.707, 0, fs));
      // división en dos bandas con un cruce Linkwitz-Riley de 24 dB/oct: la suma es plana y la banda alta NO arrastra los medios.
      // (Antes era «x − graves»: con un filtro de 24 dB esa resta se llevaba también 1–3 kHz y, al bajar las eses, bajaba la nota entera. 23/11)
      for (const b of [this.split, this.split2]) b.set(design('lowpass', lo * 0.8, Math.SQRT1_2, 0, fs));
      for (const b of [this.splitH, this.splitH2]) b.set(design('highpass', lo * 0.8, Math.SQRT1_2, 0, fs));
      this.laSamp = Math.round(clamp(p.anticipo || 0, 0, 5) / 1000 * fs);
      this.aE = coefFor(0.0002, fs); this.aR = coefFor(0.02, fs);
      this.aAtt = coefFor(0.0008, fs); this.aRel = coefFor(0.045, fs);
      this.range = clamp(num0(p.rango, 8), 0, 24);
    }
    process(x) {
      const p = this.p;
      const band = this.lp2.process(this.lp1.process(this.hp2.process(this.hp1.process(x))));
      this.dl.write(x); this.bl.write(band);
      const xd = this.dl.read(this.maxLa);
      if (!p.on) return xd;
      const bd = this.bl.read(this.maxLa - this.laSamp);
      const ab = Math.abs(bd), ax = Math.abs(this.dl.read(this.maxLa - this.laSamp));
      this.es = ab > this.es ? this.aE * this.es + (1 - this.aE) * ab : this.aR * this.es + (1 - this.aR) * ab;
      this.ef = ax > this.ef ? this.aE * this.ef + (1 - this.aE) * ax : this.aR * this.ef + (1 - this.aR) * ax;
      const ls = linToDb(this.es), lf = linToDb(this.ef);
      let over = ls - p.umbral;
      if (p.modo !== 'general') {
        // «voz sola»: solo cuenta como sibilancia si la banda alta domina sobre la voz entera
        const rel = ls - lf; // ≈ 0 dB cuando casi toda la energía está en la banda de la S
        if (rel < -6) over -= (-6 - rel) * 3; // más estricto: las notas agudas brillantes (metal) no son eses (23/11)
      }
      const target = over > 0 ? -Math.min(this.range, over * 0.85) : 0;
      this.g = target < this.g ? this.aAtt * this.g + (1 - this.aAtt) * target : this.aRel * this.g + (1 - this.aRel) * target;
      if (this.g < this.grMin) this.grMin = this.g;
      if (p.escuchar) return this.bl.read(this.maxLa);
      const gl = dbToLin(this.g);
      if (p.proceso === 'partida') {
        const low = this.split2.process(this.split.process(xd)), high = this.splitH2.process(this.splitH.process(xd));
        return low + high * gl;
      }
      return xd * gl;
    }
    takeGr() { const g = this.grMin; this.grMin = 0; return g; }
  }

  // ───────────────────────── saturación (cinta / válvula / transistor) ─────────────────────────
  class Saturator {
    constructor(fs) {
      this.fs = fs; this.up = new Upsampler4(); this.dn = new Downsampler4(); this.tmp = new Float64Array(OS);
      this.dry = new DelayLine(64); this.latency = 2 * OS_GD;
      this.pre = new Biquad(); this.de = new Biquad(); this.bump = new Biquad(); this.hf = new Biquad();
      this.tiltL = new Biquad(); this.tiltH = new Biquad();
      this.dc = 0; this.dcx = 0; this.hyst = 0;
    }
    set(p) {
      this.p = p; const fs = this.fs;
      this.drive = dbToLin(clamp(p.drive || 0, 0, 30));
      this.comp = dbToLin(-clamp(p.drive || 0, 0, 30) * 0.9 + (p.salida || 0));
      this.mix = clamp((p.mezcla === undefined ? 100 : p.mezcla) / 100, 0, 1);
      const t = p.tipo || 'cinta';
      if (t === 'cinta') {
        // pre-énfasis: los agudos saturan antes (como en la cinta); de-énfasis después
        this.pre.set(design('highshelf', 3000, 0.7, 6, fs)); this.de.set(design('highshelf', 3000, 0.7, -6, fs));
        this.bump.set(design('peak', 70, 1.0, 1.5, fs)); this.hf.set(design('lowpass', 17000, 0.6, 0, fs));
      } else {
        this.pre.set(design('peak', 1000, 1, 0, fs)); this.de.set(design('peak', 1000, 1, 0, fs));
        this.bump.set(design('peak', 1000, 1, 0, fs)); this.hf.set(design('lowpass', Math.min(20000, fs * 0.45), 0.707, 0, fs));
      }
      const tilt = clamp(p.tono || 0, -6, 6);
      this.tiltL.set(design('lowshelf', 800, 0.5, -tilt, fs)); this.tiltH.set(design('highshelf', 1500, 0.5, tilt, fs));
      this.type = t;
    }
    shape(u) {
      switch (this.type) {
        case 'valvula': { // triodo: asimétrico → armónicos pares
          const b = 0.25; return (Math.tanh(u + b) - Math.tanh(b)) / (1 - Math.tanh(b) * Math.tanh(b));
        }
        case 'transistor': return u / Math.pow(1 + Math.pow(Math.abs(u), 2.5), 0.4);
        default: { // cinta: simétrica (impares) con un poco de memoria (histéresis simplificada)
          const v = Math.tanh(u + 0.08 * this.hyst); this.hyst = v - u * 0.5; return v;
        }
      }
    }
    process(x) {
      this.dry.write(x);
      const dry = this.dry.read(this.latency);
      if (!this.p.on) return dry;
      let v = this.pre.process(x) * this.drive;
      const o = this.up.process(v);
      for (let k = 0; k < OS; k++) this.tmp[k] = this.shape(o[k]);
      let y = this.dn.process(this.tmp);
      y = this.de.process(y);
      if (this.type === 'cinta') y = this.hf.process(this.bump.process(y));
      y = this.tiltH.process(this.tiltL.process(y)) * this.comp;
      const d = y - this.dcx + 0.9995 * this.dc; this.dcx = y; this.dc = d; y = d;
      return this.mix >= 1 ? y : dry * (1 - this.mix) + y * this.mix;
    }
  }

  // ───────────────────────── doblador ─────────────────────────
  class Doubler {
    constructor(fs) {
      this.fs = fs; this.dl = new DelayLine(Math.ceil(0.06 * fs));
      this.ph1 = 0; this.ph2 = 0.37; this.hpL = new Biquad(); this.hpR = new Biquad(); this.lpL = new Biquad(); this.lpR = new Biquad();
    }
    set(p) {
      this.p = p; const fs = this.fs;
      this.level = dbToLin(-24 + clamp(p.cantidad || 0, 0, 100) * 0.2); // 0 % → −24 dB, 100 % → −4 dB
      this.width = clamp((p.ancho === undefined ? 100 : p.ancho) / 100, 0, 1);
      const depth = 0.4 + clamp(p.variacion === undefined ? 50 : p.variacion, 0, 100) / 100 * 2.2; // ms
      this.d1 = 0.011 * fs; this.d2 = 0.0165 * fs; this.dep = depth / 1000 * fs;
      this.inc1 = 0.17 / fs; this.inc2 = 0.23 / fs;
      for (const f of [this.hpL, this.hpR]) f.set(design('highpass', 160, 0.707, 0, fs));
      for (const f of [this.lpL, this.lpR]) f.set(design('lowpass', 9000, 0.707, 0, fs));
    }
    // devuelve [l, r] añadidos (solo la parte doblada)
    process(x, out) {
      this.dl.write(x);
      if (!this.p.on) { out[0] = 0; out[1] = 0; return; }
      this.ph1 += this.inc1; if (this.ph1 > 1) this.ph1 -= 1;
      this.ph2 += this.inc2; if (this.ph2 > 1) this.ph2 -= 1;
      const a = this.dl.readFrac(this.d1 + this.dep * (0.5 + 0.5 * Math.sin(2 * Math.PI * this.ph1)));
      const b = this.dl.readFrac(this.d2 + this.dep * (0.5 + 0.5 * Math.sin(2 * Math.PI * this.ph2)));
      const l = this.lpL.process(this.hpL.process(a)) * this.level, r = this.lpR.process(this.hpR.process(b)) * this.level;
      const w = this.width; out[0] = l * (0.5 + 0.5 * w) + r * (0.5 - 0.5 * w); out[1] = r * (0.5 + 0.5 * w) + l * (0.5 - 0.5 * w);
    }
  }

  // ───────────────────────── delay sincronizado ─────────────────────────
  const DIVISIONES = { '1/2': 2, '1/4': 1, '1/4.': 1.5, '1/4t': 2 / 3, '1/8': 0.5, '1/8.': 0.75, '1/8t': 1 / 3, '1/16': 0.25 };
  function delaySeconds(p, bpm) {
    if (p.sync) return (DIVISIONES[p.division] || 1) * 60 / clamp(bpm || 120, 30, 300);
    return clamp(p.ms || 300, 1, 2500) / 1000;
  }
  class StereoDelay {
    constructor(fs) {
      this.fs = fs; this.L = new DelayLine(Math.ceil(2.6 * fs)); this.R = new DelayLine(Math.ceil(2.6 * fs));
      this.hpL = new Biquad(); this.hpR = new Biquad(); this.lpL = new Biquad(); this.lpR = new Biquad();
      this.t = 0.3 * fs; this.ph = 0; this.fbL = 0; this.fbR = 0; this.duck = 0;
    }
    set(p, bpm) {
      this.p = p; const fs = this.fs;
      this.target = Math.min(2.5, delaySeconds(p, bpm)) * fs;
      if (!this.inited) { this.t = this.target; this.inited = true; }
      this.fb = clamp((p.feedback || 0) / 100, 0, 0.95);
      for (const f of [this.hpL, this.hpR]) f.set(design('highpass', clamp(p.hpf || 200, 20, 2000), 0.707, 0, fs));
      for (const f of [this.lpL, this.lpR]) f.set(design('lowpass', clamp(p.lpf || 6000, 1000, 20000), 0.707, 0, fs));
      this.modDepth = clamp(p.mod || 0, 0, 100) / 100 * 0.0015 * fs;
      this.aT = coefFor(0.08, fs);
      this.duckAmt = clamp(p.ducking || 0, 0, 100) / 100;
      this.aDuck = coefFor(0.04, fs); this.aDuckR = coefFor(0.08, fs); // se aparta en 40 ms al cantar y vuelve en 80 ms: florece hasta en los huecos cortos (23/11)
      this.width = clamp((p.ancho === undefined ? 100 : p.ancho) / 100, 0, 1);
    }
    // in: mono (envío ya aplicado). voiceEnv: 0..1 actividad de la voz (para el ducking)
    process(x, voiceAct, out) {
      this.t = this.aT * this.t + (1 - this.aT) * this.target;
      this.ph += 0.6 / this.fs; if (this.ph > 1) this.ph -= 1;
      const m = this.modDepth * Math.sin(2 * Math.PI * this.ph);
      const yl = this.L.readFrac(Math.max(1, this.t + m - 1));
      const yr = this.R.readFrac(Math.max(1, this.t - m - 1));
      const fl = this.lpL.process(this.hpL.process(yl)), fr = this.lpR.process(this.hpR.process(yr));
      if (this.p.pingpong) { this.L.write(x + fr * this.fb + DENORM); this.R.write(fl * this.fb + DENORM); }
      else { this.L.write(x + fl * this.fb + DENORM); this.R.write(x + fr * this.fb + DENORM); }
      { const a = voiceAct > this.duck ? this.aDuck : this.aDuckR; this.duck = a * this.duck + (1 - a) * voiceAct; }
      const g = 1 - this.duckAmt * this.duck;
      const mid = (fl + fr) * 0.5, side = (fl - fr) * 0.5 * this.width;
      out[0] = (mid + side) * g; out[1] = (mid - side) * g;
    }
  }

  // ───────────────────────── reverb de placa (tanque en ocho, Dattorro 1997) ─────────────────────────
  class Allpass {
    constructor(n, g) { this.d = new DelayLine(n + 64); this.n = n; this.g = g; }
    process(x, mod) {
      const dd = mod === undefined ? this.n - 1 : this.n - 1 + mod;
      const v = mod === undefined ? this.d.read(dd) : this.d.readFrac(dd);
      const w = x + this.g * v;
      this.d.write(w + DENORM);
      return v - this.g * w;
    }
    tap(i) { return this.d.read(i); }
  }
  class PlateReverb {
    constructor(fs) {
      this.fs = fs; const k = fs / 29761, n = (x) => Math.max(1, Math.round(x * k));
      this.k = k;
      this.pre = new DelayLine(Math.ceil(0.26 * fs));
      this.bw = 0;
      this.in1 = new Allpass(n(142), 0.75); this.in2 = new Allpass(n(107), 0.75); this.in3 = new Allpass(n(379), 0.625); this.in4 = new Allpass(n(277), 0.625);
      this.apA = new Allpass(n(672), -0.7); this.dA = new DelayLine(n(4453) + 8); this.lA = n(4453); this.apB = new Allpass(n(1800), 0.5); this.dB = new DelayLine(n(3720) + 8); this.lB = n(3720);
      this.apC = new Allpass(n(908), -0.7); this.dC = new DelayLine(n(4217) + 8); this.lC = n(4217); this.apD = new Allpass(n(2656), 0.5); this.dD = new DelayLine(n(3163) + 8); this.lD = n(3163);
      this.dampA = 0; this.dampC = 0; this.ph = 0; this.n = n;
      this.loopSec = (672 + 4453 + 1800 + 3720 + 908 + 4217 + 2656 + 3163) / 29761;
    }
    set(p) {
      this.p = p; const fs = this.fs;
      const rt = clamp(p.decay || 1.8, 0.2, 10);
      this.decay = Math.min(0.9995, Math.pow(10, -3 * this.loopSec / (4 * rt))); // 4 multiplicaciones por vuelta
      this.damp = Math.pow(clamp((p.amort === undefined ? 40 : p.amort) / 100, 0, 0.95) * 0.7, 48000 / fs); // mismo corte a 44,1 o 96 kHz
      this.bwc = 0.9995;
      this.preN = Math.round(clamp(p.predelay || 0, 0, 250) / 1000 * fs);
      this.exc = (clamp(p.mod === undefined ? 50 : p.mod, 0, 100) / 100) * 16 * this.k;
      this.inc = 1.0 / fs;
    }
    process(x, out) {
      this.pre.write(x);
      let v = this.preN > 0 ? this.pre.read(this.preN - 1) : x;
      this.bw = v * this.bwc + this.bw * (1 - this.bwc);
      v = this.in4.process(this.in3.process(this.in2.process(this.in1.process(this.bw))));
      this.ph += this.inc; if (this.ph > 1) this.ph -= 1;
      const m1 = this.exc * (0.5 + 0.5 * Math.sin(2 * Math.PI * this.ph)), m2 = this.exc * (0.5 + 0.5 * Math.cos(2 * Math.PI * this.ph));
      // lado A
      let a = v + this.decay * this.dD.read(this.lD - 1);
      a = this.apA.process(a, m1); this.dA.write(a);
      let ta = this.dA.read(this.lA - 1);
      this.dampA = ta * (1 - this.damp) + this.dampA * this.damp;
      ta = this.apB.process(this.dampA * this.decay); this.dB.write(ta);
      // lado C
      let c = v + this.decay * this.dB.read(this.lB - 1);
      c = this.apC.process(c, m2); this.dC.write(c);
      let tc = this.dC.read(this.lC - 1);
      this.dampC = tc * (1 - this.damp) + this.dampC * this.damp;
      tc = this.apD.process(this.dampC * this.decay); this.dD.write(tc);
      const n = this.n;
      const L = this.dC.read(n(266)) + this.dC.read(n(2974)) - this.apD.tap(n(1913)) + this.dD.read(n(1996)) - this.dA.read(n(1990)) - this.apB.tap(n(187)) - this.dB.read(n(1066));
      const R = this.dA.read(n(353)) + this.dA.read(n(3627)) - this.apB.tap(n(1228)) + this.dB.read(n(2673)) - this.dC.read(n(2111)) - this.apD.tap(n(335)) - this.dD.read(n(121));
      out[0] = L * 0.6; out[1] = R * 0.6;
    }
  }

  // ───────────────────────── reverb de sala / hall (red de retardos realimentada, FDN 8×8) ─────────────────────────
  class FdnReverb {
    constructor(fs) {
      this.fs = fs; this.N = 8;
      this.base = [29.7, 37.1, 41.3, 47.9, 53.3, 59.9, 67.1, 73.7]; // ms, primos entre sí al redondear
      this.lines = this.base.map((ms) => new DelayLine(Math.ceil(ms * 2.2 / 1000 * fs) + 64));
      this.len = new Float64Array(8); this.g = new Float64Array(8); this.lp = new Float64Array(8); this.out = new Float64Array(8);
      this.pre = new DelayLine(Math.ceil(0.26 * fs));
      this.diff = [new Allpass(Math.round(0.0047 * fs), 0.6), new Allpass(Math.round(0.0036 * fs), 0.6), new Allpass(Math.round(0.0127 * fs), 0.5), new Allpass(Math.round(0.0093 * fs), 0.5)];
      this.er = new DelayLine(Math.ceil(0.1 * fs));
      this.erTaps = [[0.0043, 0.84, -0.3], [0.0089, 0.62, 0.5], [0.0131, -0.5, 0.2], [0.0187, 0.42, -0.6], [0.0233, -0.36, 0.7], [0.0311, 0.3, -0.2], [0.0397, 0.24, 0.4]];
      this.ph = 0;
    }
    set(p) {
      this.p = p; const fs = this.fs;
      const hall = p.tipo === 'hall';
      const size = hall ? 2.0 : 0.85;
      const rt = clamp(p.decay || 1.2, 0.2, 10);
      for (let i = 0; i < 8; i++) {
        this.len[i] = Math.round(this.base[i] * size / 1000 * fs);
        this.g[i] = Math.pow(10, -3 * (this.len[i] / fs) / rt);
      }
      this.damp = Math.pow(clamp((p.amort === undefined ? 40 : p.amort) / 100, 0, 0.95) * 0.75, 48000 / fs);
      this.preN = Math.round(clamp(p.predelay || 0, 0, 250) / 1000 * fs);
      this.erLevel = hall ? 0.25 : 0.6;
      this.mod = clamp(p.mod === undefined ? 50 : p.mod, 0, 100) / 100 * 0.0008 * fs;
    }
    process(x, out) {
      this.pre.write(x);
      let v = this.preN > 0 ? this.pre.read(this.preN - 1) : x;
      this.er.write(v);
      let el = 0, erR = 0;
      for (const t of this.erTaps) { const s = this.er.read(Math.round(t[0] * this.fs)); el += s * t[1]; erR += s * t[2]; }
      for (const d of this.diff) v = d.process(v);
      this.ph += 0.7 / this.fs; if (this.ph > 1) this.ph -= 1;
      const md = this.mod * Math.sin(2 * Math.PI * this.ph);
      let sum = 0;
      for (let i = 0; i < 8; i++) {
        const d = i === 2 ? this.len[i] + md : i === 5 ? this.len[i] - md : this.len[i];
        let y = (i === 2 || i === 5) ? this.lines[i].readFrac(d - 1) : this.lines[i].read(d - 1);
        y = this.lp[i] = y * (1 - this.damp) + this.lp[i] * this.damp;
        y *= this.g[i];
        this.out[i] = y; sum += y;
      }
      const h = 2 / 8 * sum; // matriz de Householder: y − (2/N)·Σy
      for (let i = 0; i < 8; i++) this.lines[i].write(this.out[i] - h + v * 0.35 + DENORM);
      const o = this.out;
      const L = o[0] - o[1] + o[2] - o[3] + o[4] + o[5] - o[6] + o[7];
      const R = o[0] + o[1] - o[2] - o[3] + o[4] - o[5] + o[6] - o[7];
      out[0] = L * 0.35 + el * this.erLevel * 0.5; out[1] = R * 0.35 + erR * this.erLevel * 0.5;
    }
  }

  class Reverb {
    constructor(fs) {
      this.fs = fs; this.plate = new PlateReverb(fs); this.fdn = new FdnReverb(fs);
      this.hpL = new Biquad(); this.hpR = new Biquad(); this.lpL = new Biquad(); this.lpR = new Biquad();
      this.tmp = [0, 0]; this.duck = 0;
    }
    set(p) {
      this.p = p; const fs = this.fs;
      this.plate.set(p); this.fdn.set(p);
      for (const f of [this.hpL, this.hpR]) f.set(design('highpass', clamp(p.hpf || 250, 20, 2000), 0.707, 0, fs));
      for (const f of [this.lpL, this.lpR]) f.set(design('lowpass', clamp(p.lpf || 9000, 1000, 20000), 0.707, 0, fs));
      this.width = clamp((p.ancho === undefined ? 100 : p.ancho) / 100, 0, 1.5);
      this.duckAmt = clamp(p.ducking || 0, 0, 100) / 100; this.aDuck = coefFor(0.04, fs); this.aDuckR = coefFor(0.08, fs);
    }
    process(x, voiceAct, out) {
      if ((this.p.tipo || 'placa') === 'placa') this.plate.process(x, this.tmp); else this.fdn.process(x, this.tmp);
      const l = this.lpL.process(this.hpL.process(this.tmp[0])), r = this.lpR.process(this.hpR.process(this.tmp[1]));
      { const a = voiceAct > this.duck ? this.aDuck : this.aDuckR; this.duck = a * this.duck + (1 - a) * voiceAct; }
      const g = 1 - this.duckAmt * this.duck;
      const mid = (l + r) * 0.5, side = (l - r) * 0.5 * this.width;
      out[0] = (mid + side) * g; out[1] = (mid - side) * g;
    }
  }

  // ───────────────────────── limitador true peak ─────────────────────────
  class Limiter {
    constructor(fs) {
      this.fs = fs;
      this.L = Math.round(0.0015 * fs); // anticipación 1,5 ms
      this.tpDelay = TP_GD; // retardo de grupo del detector ×4 fino
      this.latency = this.L + this.tpDelay;
      this.upL = new Upsampler4(TP_PH); this.upR = new Upsampler4(TP_PH);
      this.dL = new DelayLine(this.latency + 4); this.dR = new DelayLine(this.latency + 4);
      // mínimo deslizante (deque monótona) sobre L+1 muestras
      const W = this.L + 1; this.W = W;
      this.qv = new Float64Array(W + 2); this.qi = new Int32Array(W + 2); this.qh = 0; this.qt = 0; this.n = 0;
      this.box = new Float64Array(W); this.bp = 0; this.bsum = W;
      this.box.fill(1);
      this.r = 1; this.grMin = 0; this.slow = 0;
    }
    set(p) {
      this.p = p; const fs = this.fs;
      this.ceil = dbToLin(clamp(p.techo === undefined ? -1 : p.techo, -12, 0) - 0.2); // 0,2 dB de margen: los medidores true peak discrepan hasta ~0,2 dB entre sí
      this.inG = dbToLin(clamp(num0(p.ganancia, 0), -24, 24));
      this.relMs = clamp(p.liberacion || 120, 10, 1000);
      this.auto = p.liberacion === 'auto' || p.autoRel;
      this.aRel = coefFor(this.relMs / 1000, fs);
      this.aSlow = coefFor(1.0, fs);
    }
    // procesa en sitio l[i], r[i] — devuelve en out[0], out[1]
    process(l, r, out) {
      const on = this.p.on;
      l *= this.inG; r *= this.inG;
      const ol = this.upL.process(l), or = this.upR.process(r);
      let pk = 0;
      for (let k = 0; k < OS; k++) { const a = Math.abs(ol[k]); if (a > pk) pk = a; const b = Math.abs(or[k]); if (b > pk) pk = b; }
      // las muestras reales también cuentan (el FIR no las reproduce exactas)
      const pl = Math.abs(this.dL.read(this.tpDelay - 1)), pr = Math.abs(this.dR.read(this.tpDelay - 1));
      this.dL.write(l); this.dR.write(r);
      if (pl > pk) pk = pl; if (pr > pk) pk = pr;
      const req = on && pk > this.ceil ? this.ceil / pk : 1;
      // mínimo deslizante
      const n = this.n++;
      while (this.qt > this.qh && this.qv[(this.qt - 1) % (this.W + 2)] >= req) this.qt--;
      this.qv[this.qt % (this.W + 2)] = req; this.qi[this.qt % (this.W + 2)] = n; this.qt++;
      while (this.qi[this.qh % (this.W + 2)] <= n - this.W) this.qh++;
      if (this.qh > 1e9) { const d = Math.floor(this.qh / (this.W + 2)) * (this.W + 2); this.qh -= d; this.qt -= d; }
      const m = this.qv[this.qh % (this.W + 2)];
      // relajación (instantánea hacia abajo, suave hacia arriba)
      if (m < this.r) this.r = m;
      else {
        let a = this.aRel;
        if (this.auto) { const grDb = -linToDb(this.r); this.slow = this.aSlow * this.slow + (1 - this.aSlow) * Math.min(1, grDb / 6); a = coefFor((0.03 + 0.35 * this.slow), this.fs); }
        this.r = a * this.r + (1 - a) * m;
      }
      // media móvil de L+1 muestras: la ganancia llega justo a tiempo al pico
      this.bsum += this.r - this.box[this.bp]; this.box[this.bp] = this.r; this.bp = (this.bp + 1) % this.W;
      if (this.bp === 0) { let s = 0; for (let k = 0; k < this.W; k++) s += this.box[k]; this.bsum = s; } // sin deriva numérica
      const g = Math.min(1, this.bsum / this.W);
      const gdb = linToDb(g); if (gdb < this.grMin) this.grMin = gdb;
      // retardo del audio = anticipación + retardo del detector: la ganancia llega exacta al pico
      out[0] = this.dL.read(this.latency) * g; out[1] = this.dR.read(this.latency) * g;
    }
    takeGr() { const g = this.grMin; this.grMin = 0; return g; }
  }

  // ───────────────────────── vocal rider ─────────────────────────
  class Rider {
    // Rider v2 (24/11). El de antes subía la voz al empezar cada frase y luego la bajaba («sube y se baja extraño»):
    // su medida de la voz se apagaba en los silencios. Ahora:
    //  · la voz se mide SOLO mientras cantas (se congela en las pausas) y espera 150 ms al empezar cada frase;
    //  · la base se mide sin bombo ni bajo (pasa-altos de 150 Hz) y con media lenta (3 s);
    //  · es RELATIVO: aprende la relación voz/base (medidas antes de los faders VOZ y BASE, así que los faders no le
    //    afectan) y solo corrige las frases que se salen de ella; «objetivo» es un extra sobre esa relación (0 = la aprendida);
    //  · en directo se reinicia en cada play (como la exportación); al apagarlo o si la base calla, vuelve a 0 dB suavemente;
    //  · sube las frases flojas hasta «rango» y baja las fuertes como mucho un tercio; sin saltos (6 dB/s como mucho).
    constructor(fs) { this.fs = fs; this.hp = new Biquad(design('highpass', 150, 0.707, 0, fs)); this.reset(); }
    reset() { this.eS = 1e-9; this.b = 0; this.nB = 0; this.lv = null; this.rel = null; this.nR = 0; this.g = 0; this.nOn = 0; this.nOff = 0; this.hp.reset(); }
    set(p) {
      if (p.on && !this.wasOn) this.reset(); // al encenderlo, empieza limpio
      this.wasOn = !!p.on;
      this.p = p; const fs = this.fs;
      this.aS = coefFor(0.05, fs); this.aB = coefFor(3, fs); this.aL = coefFor(1.5, fs); this.aR = coefFor(20, fs);
      this.aG = coefFor(clamp(p.velocidad === undefined ? 1 : p.velocidad, 0.1, 5), fs);
      this.range = clamp(num0(p.rango, 6), 0, 12);
      this.target = clamp(p.objetivo || 0, -12, 12);
      this.slew = 6 / fs; this.espera = Math.round(0.15 * fs); this.pausa = Math.round(0.3 * fs);
      this.nB3 = Math.round(3 * fs); this.nR20 = Math.round(20 * fs);
    }
    // x: voz (antes del rider), bm: base. Devuelve ganancia lineal.
    gain(x, bm) {
      if (!this.p.on) { if (this.g !== 0) this.g = this.volverACero(); return dbToLin(this.g); } // apagado: vuelve a 0 dB sin salto
      // base: media acumulada los primeros 3 s (acierta desde el principio) y luego media lenta de 3 s
      const xb = this.hp.process(bm); if (this.nB < this.nB3) this.nB++; const kB = Math.max(1 - this.aB, 1 / this.nB); this.b += kB * (xb * xb - this.b);
      this.eS = this.aS * this.eS + (1 - this.aS) * x * x;
      const sd = 10 * Math.log10(this.eS + 1e-12);
      const activo = sd > -45 && (this.lv === null || sd > this.lv - 20);
      if (activo) { this.nOn++; this.nOff = 0; } else if (++this.nOff > this.pausa) this.nOn = 0;
      const bd = 10 * Math.log10(this.b + 1e-12);
      if (activo && this.nOn > this.espera && bd > -70 && this.nB > this.fs * 0.5) { // sin base no hay nada que seguir
        this.lv = this.lv === null ? sd : this.aL * this.lv + (1 - this.aL) * sd;
        const r = bd - this.lv;                                          // base sobre voz, ahora
        if (this.nR < this.nR20) this.nR++; const kR = Math.max(1 - this.aR, 1 / this.nR); // la relación de tu mezcla:
        this.rel = this.rel === null ? r : this.rel + kR * (r - this.rel);   // media acumulada los primeros 20 s, luego lenta
        const want = clamp(r - this.rel + this.target, -this.range / 3, this.range);
        const ng = this.aG * this.g + (1 - this.aG) * want;
        this.g = clamp(ng, this.g - this.slew, this.g + this.slew);
      } else if (bd <= -70 && this.g !== 0) this.g = this.volverACero(); // la base calla (a capela): sin nada que seguir
      return dbToLin(this.g);
    }
    volverACero() { return Math.abs(this.g) <= this.slew ? 0 : this.g - Math.sign(this.g) * this.slew; }
  }

  // ───────────────────────── Voz de móvil → micro de estudio (24/11) ─────────────────────────
  // Para tomas grabadas con el móvil o un micro sencillo. Tres partes, SIN latencia (se puede escuchar mientras grabas):
  //  1. Limpieza de ruido en 4 bandas (cruces Linkwitz-Riley en 300, 2000 y 6000 Hz): cada banda baja solo cuando su nivel
  //     cae cerca del ruido aprendido en los silencios de la toma («ruidoBandas», dBFS RMS de la toma en bruto).
  //  2. EQ hacia una curva de micro de estudio: 13 campanas cada media octava (160 Hz–10 kHz) que dibujan «curva» (la calcula la
  //     mezcla automática: solo lo que se sale de lo normal entre voces de estudio, ±6 dB), ajustadas por mínimos cuadrados.
  //  3. Agudos por encima del «corte» del móvil: armónicos generados desde la octava de debajo, siguiendo el nivel de la voz.
  const CORR_F = [160, 226, 320, 453, 640, 905, 1280, 1810, 2560, 3620, 5120, 7241, 10240];
  class Corrector {
    constructor(fs) {
      this.fs = fs; const bq2 = () => [new Biquad(), new Biquad()];
      this.eq = CORR_F.map(() => new Biquad()); this.gT = new Float64Array(13); this.gC = new Float64Array(13); this.cnt = 0; this.mov = true; this.eqAct = false;
      // bandas de la limpieza: 2000 Hz primero; la rama grave pasa por el paso-todo de 6000 y la aguda por el de 300 antes de
      // dividirse, así la suma de las 4 bandas es un paso-todo puro (plana) cuando no se baja nada
      const LR = (t, f) => { const a = bq2(); for (const b of a) b.set(design(t, f, Math.SQRT1_2, 0, fs)); return a; };
      this.sL = LR('lowpass', 2000); this.sH = LR('highpass', 2000);
      this.ap6L = LR('lowpass', 6000); this.ap6H = LR('highpass', 6000); this.ap3L = LR('lowpass', 300); this.ap3H = LR('highpass', 300);
      this.aL = LR('lowpass', 300); this.aH = LR('highpass', 300); this.bL = LR('lowpass', 6000); this.bH = LR('highpass', 6000);
      this.B = new Float64Array(4); this.env = new Float64Array(4); this.gn = new Float64Array(4); this.thr = new Float64Array(4).fill(-200); this.rango = 0; this.hayRuido = false;
      this.aEnv = coefFor(0.005, fs); this.aOpen = coefFor(0.003, fs); this.aClose = coefFor(0.08, fs);
      this.xs = [new Biquad(), new Biquad()]; this.xh = []; this.xl = new Biquad(); this.eS = 0; this.eH = 0; this.aX = coefFor(0.02, fs); this.corteSet = -1; this.agudos = false;
      this.aW = coefFor(0.015, fs); this.aG = coefFor(0.03, fs); this.w = 0; this.on = false; this.wasOn = false; this.p = null; this.grMin = 0;
      // frecuencias de la EQ que caben por debajo de Nyquist (con 16 kHz o menos, las de arriba no existen: matriz singular → NaN)
      this.usa = CORR_F.map((f) => f < fs * 0.45);
    }
    reset() { // al encender: sin estados viejos de otra parte de la canción
      const todos = [...this.eq, ...this.sL, ...this.sH, ...this.ap6L, ...this.ap6H, ...this.ap3L, ...this.ap3H, ...this.aL, ...this.aH, ...this.bL, ...this.bH, ...this.xs, ...this.xh, this.xl];
      for (const b of todos) b.reset(); this.env.fill(0); this.gn.fill(0); this.eS = 0; this.eH = 0;
    }
    set(p, inG) {
      const fs = this.fs; this.p = p; this.on = !!p.on;
      if (this.on && !this.wasOn) this.reset(); this.wasOn = this.on;
      const c = clamp(num0(p.cantidad, 70), 0, 100) / 100, cur = Array.isArray(p.curva) ? p.curva : [];
      const idx = []; for (let k = 0; k < 13; k++) if (this.usa[k]) idx.push(k);
      const Dd = idx.map((k) => clamp(num0(cur[k], 0), -12, 12) * c);
      const g = new Float64Array(13);
      if (Dd.some((v) => v !== 0)) {
        // las campanas se solapan: sus ganancias se resuelven para que la SUMA pase por la curva pedida en cada centro
        // (sistema lineal con la influencia de una campana de +1 dB en cada centro, Gauss con pivote; luego 3 refinados)
        const fz = idx.map((k) => CORR_F[k]), n = idx.length;
        if (!this.M) this.M = fz.map((fi) => fz.map((fj) => 20 * Math.log10(biquadMag(design('peak', fj, 1.4, 1, fs), fi, fs))));
        const resolver = (rhs) => {
          const A = this.M.map((r, i) => [...r, rhs[i]]);
          for (let col = 0; col < n; col++) { let pv = col; for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pv][col])) pv = r; [A[col], A[pv]] = [A[pv], A[col]];
            if (Math.abs(A[col][col]) < 1e-9) return null;
            for (let r = 0; r < n; r++) if (r !== col) { const f = A[r][col] / A[col][col]; for (let q = col; q <= n; q++) A[r][q] -= f * A[col][q]; } }
          return A.map((r, i) => r[n] / r[i]);
        };
        const gi = resolver(Dd) || Dd.slice(); const gg = gi.map((v) => clamp(v, -15, 15));
        for (let it = 0; it < 3; it++) {
          const cs = fz.map((f, a) => design('peak', f, 1.4, gg[a], fs));
          const err = fz.map((f, a) => Dd[a] - cs.reduce((acc, cc) => acc + 20 * Math.log10(biquadMag(cc, f, fs)), 0));
          const dg = resolver(err); if (!dg) break; for (let a = 0; a < n; a++) gg[a] = clamp(gg[a] + dg[a], -15, 15);
        }
        idx.forEach((k, a) => { g[k] = isFinite(gg[a]) ? gg[a] : 0; });
      }
      for (let k = 0; k < 13; k++) this.gT[k] = g[k]; this.mov = true;
      this.rango = clamp(num0(p.ruido, 50), 0, 100) / 100 * 20; // hasta 20 dB
      const rb = Array.isArray(p.ruidoBandas) ? p.ruidoBandas : [];
      for (let b = 0; b < 4; b++) { const v = num0(rb[b], -200); this.thr[b] = v > -150 ? v + num0(inG, 0) + 8 : -200; } // 8 dB por encima del ruido aprendido
      this.hayRuido = Array.from(this.thr).some((t) => t > -150);
      const corte = num0(p.corte, 0); this.brillo = clamp(num0(p.brillo, 50), 0, 100) / 100;
      this.agudos = corte >= 3000 && corte <= 14500 && corte < fs * 0.42 && this.brillo > 0;
      if (this.agudos && Math.abs(corte - this.corteSet) > 1) {
        this.corteSet = corte;
        this.xs[0].set(design('highpass', corte / 2, Math.SQRT1_2, 0, fs)); this.xs[1].set(design('lowpass', corte * 0.95, Math.SQRT1_2, 0, fs));
        this.xh = butterworthStages('hp', corte, 36, fs).map((h) => new Biquad(h));
        this.xl.set(design('lowpass', Math.min(fs * 0.45, corte * 1.9), Math.SQRT1_2, 0, fs));
      }
    }
    process(x) {
      const tgt = this.on ? 1 : 0;
      if (!this.on && this.w === 0) return x;
      this.w = this.aW * this.w + (1 - this.aW) * tgt; if (Math.abs(this.w - tgt) < 1e-4) this.w = tgt;
      // 1. limpieza por bandas: con el módulo encendido SIEMPRE pasa por las bandas (sin ruido medido o con «Quitar ruido» a 0,
      //    las ganancias son 0 dB y la suma es plana), así no hay salto al mover el mando ni al llegar la mezcla automática
      const lo0 = this.sL[1].process(this.sL[0].process(x)), hi0 = this.sH[1].process(this.sH[0].process(x));
      const lo = this.ap6L[1].process(this.ap6L[0].process(lo0)) + this.ap6H[1].process(this.ap6H[0].process(lo0));
      const hi = this.ap3L[1].process(this.ap3L[0].process(hi0)) + this.ap3H[1].process(this.ap3H[0].process(hi0));
      const B = this.B; B[0] = this.aL[1].process(this.aL[0].process(lo)); B[1] = this.aH[1].process(this.aH[0].process(lo));
      B[2] = this.bL[1].process(this.bL[0].process(hi)); B[3] = this.bH[1].process(this.bH[0].process(hi));
      const activa = this.rango > 0 && this.hayRuido;
      let y = 0;
      for (let b = 0; b < 4; b++) {
        let t = 0;
        if (activa && this.thr[b] > -150) {
          this.env[b] = this.aEnv * this.env[b] + (1 - this.aEnv) * B[b] * B[b];
          const d = 10 * Math.log10(this.env[b] + 1e-20); if (d < this.thr[b]) t = Math.max(-this.rango, d - this.thr[b]); // expansión 1:2 bajo el umbral
        }
        const a = t > this.gn[b] ? this.aOpen : this.aClose; this.gn[b] = a * this.gn[b] + (1 - a) * t;
        if (this.gn[b] < this.grMin) this.grMin = this.gn[b];
        y += this.gn[b] > -0.01 ? B[b] : B[b] * dbToLin(this.gn[b]);
      }
      // 2. EQ hacia el micro de estudio (las ganancias se mueven suaves: sin clics al cambiar de toma o de cantidad)
      if (this.mov && (this.cnt++ & 31) === 0) {
        let quieto = true; this.eqAct = false;
        for (let k = 0; k < 13; k++) {
          const d = this.gT[k] - this.gC[k]; if (Math.abs(d) > 0.01) { this.gC[k] += d * (1 - Math.pow(this.aG, 32)); quieto = false; } else this.gC[k] = this.gT[k];
          if (Math.abs(this.gC[k]) < 0.01) this.eq[k].set(BQ_ID); else { this.eq[k].set(design('peak', CORR_F[k], 1.4, this.gC[k], this.fs)); this.eqAct = true; }
        }
        if (quieto) this.mov = false;
      }
      if (this.eqAct) for (let k = 0; k < 13; k++) if (this.gC[k] !== 0) y = this.eq[k].process(y);
      // 3. agudos por encima del corte del móvil: armónicos (rectificado) de la octava de debajo, al nivel de esa octava −9 dB
      if (this.agudos) {
        const s0 = this.xs[1].process(this.xs[0].process(y)); let h = s0 < 0 ? -s0 : s0; for (let k = 0; k < this.xh.length; k++) h = this.xh[k].process(h); h = this.xl.process(h);
        this.eS = this.aX * this.eS + (1 - this.aX) * s0 * s0; this.eH = this.aX * this.eH + (1 - this.aX) * h * h;
        if (this.eH > 1e-14) y += h * Math.sqrt(this.eS / this.eH) * 0.355 * this.brillo;
      }
      if (!(y === y)) { this.reset(); y = x; } // por si acaso: nunca deja un NaN pegado
      return this.w * y + (1 - this.w) * x;
    }
    takeGr() { const g = this.grMin; this.grMin = 0; return g; }
    // para la mezcla automática: nivel RMS (dBFS) de cada banda de la limpieza en unos trozos de señal. Cada trozo se mide
    // por separado (filtros calentados con su primer cuarto): coser trozos sueltos metería saltos con energía en agudos.
    static bandasRMS(fs, x, trozos) {
      const lista = trozos || [{ i: 0, n: x.length }], e = [0, 0, 0, 0]; let cuenta = 0;
      for (const t of lista) {
        const c = new Corrector(fs), cal = Math.floor(t.n / 4), B = [0, 0, 0, 0];
        for (let j = 0; j < t.n; j++) {
          const v = x[t.i + j] || 0, lo0 = c.sL[1].process(c.sL[0].process(v)), hi0 = c.sH[1].process(c.sH[0].process(v));
          const lo = c.ap6L[1].process(c.ap6L[0].process(lo0)) + c.ap6H[1].process(c.ap6H[0].process(lo0)), hi = c.ap3L[1].process(c.ap3L[0].process(hi0)) + c.ap3H[1].process(c.ap3H[0].process(hi0));
          B[0] = c.aL[1].process(c.aL[0].process(lo)); B[1] = c.aH[1].process(c.aH[0].process(lo)); B[2] = c.bL[1].process(c.bL[0].process(hi)); B[3] = c.bH[1].process(c.bH[0].process(hi));
          if (j >= cal) { for (let b = 0; b < 4; b++) e[b] += B[b] * B[b]; cuenta++; }
        }
      }
      return e.map((v) => 10 * Math.log10(v / Math.max(1, cuenta) + 1e-20));
    }
  }
  const BQ_ID = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

  // ───────────────────────── Coros (24/11) ─────────────────────────
  // Bus estéreo con la suma de las tomas marcadas como «coro» (cada una ya llega con su volumen y panorama).
  // Cadena de coro SIN latencia: corte de graves, brillo, compresión suave enlazada, ancho estéreo y volumen.
  // Se retrasa lo mismo que la cadena de la voz principal para que coros y principal vayan juntos.
  class CoroBus {
    constructor(fs) {
      this.fs = fs; this.hpL = []; this.hpR = []; this.shL = new Biquad(); this.shR = new Biquad();
      this.dL = new DelayLine(8); this.dR = new DelayLine(8); this.lat = 0; this.env = 0; this.g = 0; this.on = false; this.pk = 0; this.fSet = -1;
      this.aEnv = coefFor(0.01, fs); this.aAtt = coefFor(0.005, fs); this.aRel = coefFor(0.12, fs);
      this.aS = coefFor(0.015, fs); this.vC = 0; this.vT = 0; this.sC = 1.12; this.sT = 1.12; this.iC = 1; this.iT = 1;
    }
    set(p, lat, inG) {
      const fs = this.fs; this.on = !!p.on;
      if (lat !== this.lat) { this.lat = lat; this.dL = new DelayLine(lat + 4); this.dR = new DelayLine(lat + 4); }
      const f = clamp(num0(p.corteGraves, 160), 20, 1000);
      if (f !== this.fSet) { this.fSet = f; const st = butterworthStages('hp', f, 12, fs); if (this.hpL.length === st.length) st.forEach((c, i) => { this.hpL[i].set(c); this.hpR[i].set(c); }); else { this.hpL = st.map((c) => new Biquad(c)); this.hpR = st.map((c) => new Biquad(c)); } } // sin recrear: sin clic al mover el mando
      const c = design('highshelf', 7000, 0.7, clamp(num0(p.brillo, 0), -12, 12), fs); this.shL.set(c); this.shR.set(c);
      this.comp = clamp(num0(p.compresion, 50), 0, 100) / 100; this.ratio = 1 + 3 * this.comp; this.mk = 4 * this.comp;
      this.sT = clamp(num0(p.ancho, 70), 0, 100) / 100 * 1.3; // 100 % = algo más abierto que el original, sin meter fase invertida al otro lado
      this.vT = this.on ? dbToLin(clamp(num0(p.volumen, -3), -40, 12)) : 0; // volumen y encendido se mueven suaves (sin «zipper» ni clic)
      this.iT = dbToLin(clamp(num0(inG, 0), -24, 36)); // la misma ganancia de entrada que la principal (si no, con una toma de móvil los coros quedan muy bajos)
      this.rev = dbToLin(clamp(num0(p.reverb, 4), -24, 12)); this.eco = dbToLin(clamp(num0(p.eco, 0), -24, 12));
    }
    // l, r: suma de coros (sin procesar). out = [L, R, mono para los envíos]
    process(l, r, out) {
      this.dL.write(l); this.dR.write(r);
      let L = this.dL.read(this.lat), R = this.dR.read(this.lat);
      const a = this.aS; this.vC = a * this.vC + (1 - a) * this.vT; this.sC = a * this.sC + (1 - a) * this.sT; this.iC = a * this.iC + (1 - a) * this.iT;
      if (this.vT === 0 && this.vC < 1e-5) { this.vC = 0; out[0] = out[1] = out[2] = 0; return; }
      L *= this.iC; R *= this.iC;
      for (const b of this.hpL) L = b.process(L); for (const b of this.hpR) R = b.process(R);
      L = this.shL.process(L); R = this.shR.process(R);
      if (this.comp > 0) {
        const m = 0.5 * (L + R); this.env = this.aEnv * this.env + (1 - this.aEnv) * m * m;
        const d = 10 * Math.log10(this.env + 1e-20) + 3, over = d - (-26), t = (over > 0 ? -over * (1 - 1 / this.ratio) : 0) + this.mk;
        const a = t < this.g ? this.aAtt : this.aRel; this.g = a * this.g + (1 - a) * t;
        const gl = dbToLin(this.g); L *= gl; R *= gl;
      }
      const M = 0.5 * (L + R), S = 0.5 * (L - R) * this.sC;
      L = (M + S) * this.vC; R = (M - S) * this.vC;
      const pk = Math.max(Math.abs(L), Math.abs(R)); if (pk > this.pk) this.pk = pk;
      out[0] = L; out[1] = R; out[2] = M * this.vC;
    }
  }

  // ───────────────────────── Pista: EQ y pegamento (24/11) ─────────────────────────
  // La base también se puede retocar: cortes, graves, medios y agudos, y una compresión suave enlazada («pegamento»). Sin latencia.
  class PistaEQ {
    constructor(fs) { this.fs = fs; this.fL = []; this.fR = []; this.env = 0; this.g = 0; this.on = false; this.w = 0; this.aW = coefFor(0.015, fs); this.aEnv = coefFor(0.02, fs); this.aAtt = coefFor(0.01, fs); this.aRel = coefFor(0.15, fs); this.clave = ''; this.grMin = 0; }
    set(p) {
      const fs = this.fs; this.on = !!p.on;
      const hp = clamp(num0(p.corteGraves, 20), 20, 500), lp = clamp(num0(p.corteAgudos, 20000), 2000, 20000);
      const gG = clamp(num0(p.graves, 0), -12, 12), gM = clamp(num0(p.medios, 0), -12, 12), fM = clamp(num0(p.medFreq, 1000), 200, 5000), gA = clamp(num0(p.agudos, 0), -12, 12);
      const clave = [hp, lp, gG, gM, fM, gA].join(',');
      if (clave !== this.clave) {
        this.clave = clave; const st = []; // siempre las mismas 5 etapas (las apagadas son planas): al mover un mando no se recrea nada (sin clics)
        st.push(hp > 21 ? butterworthStages('hp', hp, 12, fs)[0] : BQ_ID);
        st.push(lp < 19999 && lp < fs * 0.45 ? butterworthStages('lp', lp, 12, fs)[0] : BQ_ID);
        st.push(gG ? design('lowshelf', 120, 0.7, gG, fs) : BQ_ID);
        st.push(gM ? design('peak', fM, 0.8, gM, fs) : BQ_ID);
        st.push(gA ? design('highshelf', 8000, 0.7, gA, fs) : BQ_ID);
        const viejos = this.fL.length === st.length;
        if (viejos) st.forEach((c, i) => { this.fL[i].set(c); this.fR[i].set(c); });
        else { this.fL = st.map((c) => new Biquad(c)); this.fR = st.map((c) => new Biquad(c)); }
      }
      this.peg = clamp(num0(p.pegamento, 0), 0, 100) / 100; this.ratio = 1 + 2 * this.peg; this.mk = 2 * this.peg;
    }
    process(l, r, out) {
      const tgt = this.on ? 1 : 0; this.w = this.aW * this.w + (1 - this.aW) * tgt; if (Math.abs(this.w - tgt) < 1e-4) this.w = tgt;
      if (this.w === 0) { out[0] = l; out[1] = r; return; }
      let L = l, R = r;
      for (let i = 0; i < this.fL.length; i++) { L = this.fL[i].process(L); R = this.fR[i].process(R); }
      if (this.peg > 0 || this.g !== 0) { // al bajar el pegamento a 0, la ganancia vuelve suave a 0 dB
        const m = 0.5 * (L + R); this.env = this.aEnv * this.env + (1 - this.aEnv) * m * m;
        const d = 10 * Math.log10(this.env + 1e-20) + 3, over = d - (-20), t = this.peg > 0 ? (over > 0 ? -over * (1 - 1 / this.ratio) : 0) + this.mk : 0;
        if (this.peg === 0 && Math.abs(this.g) < 0.01) this.g = 0;
        const a = t < this.g ? this.aAtt : this.aRel; this.g = a * this.g + (1 - a) * t; if (this.g - this.mk < this.grMin) this.grMin = this.g - this.mk;
        const gl = dbToLin(this.g); L *= gl; R *= gl;
      }
      out[0] = this.w * L + (1 - this.w) * l; out[1] = this.w * R + (1 - this.w) * r;
    }
    takeGr() { const g = this.grMin; this.grMin = 0; return g; }
  }

  // ───────────────────────── parámetros por defecto ─────────────────────────
  function defaultParams() {
    return {
      version: 1,
      entrada: { ganancia: 0, fase: false },
      limpieza: { on: false, umbral: -50, rango: 12, ataque: 1, relajacion: 150 },
      corrector: { on: false, cantidad: 70, ruido: 50, brillo: 50, curva: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], corte: 0, ruidoBandas: [-200, -200, -200, -200] },
      realce: { on: false, perfil: 'grave', cantidad: 60 },
      armonicos: { on: false, modo: 'sigue', nota: 'La', ganancia: 6, ancho: 8, desde: 330 },
      eq: { on: true, bandas: [
        { on: true, tipo: 'pasaaltos', f: 90, q: 0.71, g: 0, pendiente: 18, nombre: 'Corte de graves', din: { on: false, umbral: -30, rango: -6, ataque: 5, relajacion: 120 } },
        { on: false, tipo: 'graves', f: 180, q: 0.71, g: 0, pendiente: 12, nombre: 'Cuerpo', din: { on: false, umbral: -30, rango: -6, ataque: 5, relajacion: 120 } },
        { on: true, tipo: 'campana', f: 320, q: 1.2, g: -2, pendiente: 12, nombre: 'Barro', din: { on: false, umbral: -30, rango: -6, ataque: 5, relajacion: 120 } },
        { on: false, tipo: 'campana', f: 800, q: 4, g: 0, pendiente: 12, nombre: 'Resonancia 1', din: { on: true, umbral: -35, rango: -5, ataque: 3, relajacion: 80 } },
        { on: true, tipo: 'campana', f: 3200, q: 1.0, g: 1.5, pendiente: 12, nombre: 'Presencia', din: { on: false, umbral: -30, rango: -6, ataque: 5, relajacion: 120 } },
        { on: false, tipo: 'campana', f: 2600, q: 4, g: 0, pendiente: 12, nombre: 'Dureza', din: { on: true, umbral: -32, rango: -5, ataque: 2, relajacion: 80 } },
        { on: true, tipo: 'agudos', f: 11000, q: 0.71, g: 2, pendiente: 12, nombre: 'Aire', din: { on: false, umbral: -30, rango: -6, ataque: 5, relajacion: 120 } },
        { on: false, tipo: 'pasabajos', f: 18000, q: 0.71, g: 0, pendiente: 12, nombre: 'Corte de agudos', din: { on: false, umbral: -30, rango: -6, ataque: 5, relajacion: 120 } },
      ] },
      deesser: { on: true, posicion: 'despues', modo: 'voz', proceso: 'partida', umbral: -30, rango: 6, fMin: 5500, fMax: 11000, anticipo: 2, escuchar: false },
      comp1: { on: true, tipo: 'fet', ratioFet: '4', entrada: 6, salida: 0, ataque: 0.25, relajacion: 120, mezcla: 100, scHpf: 80,
        umbral: -20, ratio: 4, rodilla: 6, retencion: 0, anticipo: 0, rango: 0, estilo: 'vocal', autoGan: true, reduccion: 40, optoModo: 'comprimir', enfasis: 0, autoRel: false },
      comp2: { on: true, tipo: 'optico', reduccion: 35, optoModo: 'comprimir', salida: 0, enfasis: 20, mezcla: 100, scHpf: 0,
        ratioFet: '4', entrada: 0, ataque: 10, relajacion: 200, umbral: -20, ratio: 3, rodilla: 6, retencion: 0, anticipo: 0, rango: 0, estilo: 'vocal', autoGan: true, autoRel: false },
      sat: { on: false, tipo: 'cinta', drive: 6, tono: 0, mezcla: 100, salida: 0 },
      suavizador: { on: false, cantidad: 50, nitidez: 50, desde: 1500, hasta: 9000, relajacion: 80 },
      rider: { on: false, objetivo: 0, rango: 4, velocidad: 1 },
      doblador: { on: false, cantidad: 40, ancho: 100, variacion: 50 },
      delay: { on: true, envio: -20, sync: true, division: '1/4', ms: 350, feedback: 28, pingpong: true, hpf: 300, lpf: 5000, mod: 20, ducking: 50, ancho: 100 },
      reverb: { on: true, tipo: 'placa', envio: -16, decay: 1.8, predelay: 30, amort: 45, hpf: 300, lpf: 8000, ancho: 100, mod: 50, ducking: 25 },
      voz: { volumen: 0, pan: 0, mute: false, solo: false },
      base: { volumen: 0, hueco: 2, huecoFreq: 2500, mute: false },
      pista: { on: false, graves: 0, medios: 0, medFreq: 1000, agudos: 0, corteGraves: 20, corteAgudos: 20000, pegamento: 0 },
      coros: { on: true, volumen: -3, ancho: 70, reverb: 4, eco: 0, corteGraves: 160, brillo: -1, compresion: 50 },
      master: { on: true, techo: -1, ganancia: 0, liberacion: 120, autoRel: true },
      bypass: false,
      bpm: 120,
    };
  }

  // Completa un preset parcial con los valores por defecto (presets antiguos o compartidos).
  function mergeParams(base, over) {
    if (over === undefined || over === null) return base;
    if (Array.isArray(base)) {
      return base.map((b, i) => (Array.isArray(over) && over[i] !== undefined ? mergeParams(b, over[i]) : b));
    }
    if (typeof base === 'object' && base !== null) {
      const o = {};
      // solo las claves conocidas (lo desconocido de un preset ajeno se descarta)
      for (const k of Object.keys(base)) o[k] = mergeParams(base[k], Object.prototype.hasOwnProperty.call(Object(over), k) ? over[k] : undefined);
      return o;
    }
    if (typeof over !== typeof base) return base;
    if (typeof base === 'number' && !isFinite(over)) return base;
    return over;
  }

  // Lista blanca y límites de cada parámetro (los mismos que la interfaz). Un preset que llega
  // por enlace o archivo nunca puede meter un valor que rompa el audio o congele la página.
  const OPC = {
    tipoComp: ['fet', 'optico', 'vca', 'moderno'], ratioFet: ['4', '8', '12', '20', 'todos'], optoModo: ['comprimir', 'limitar'],
    estilo: ['limpio', 'vocal', 'pegamento', 'impacto'], banda: ['campana', 'graves', 'agudos', 'pasaaltos', 'pasabajos', 'muesca'],
    pendiente: [6, 12, 18, 24, 36, 48], dsModo: ['voz', 'general'], dsProc: ['partida', 'ancha'], dsPos: ['antes', 'despues'],
    sat: ['cinta', 'valvula', 'transistor'], rev: ['placa', 'sala', 'hall'],
  };
  function validarParams(p) {
    const n = (o, k, a, b) => { o[k] = clamp(isFinite(o[k]) ? +o[k] : a, a, b); };
    const e = (o, k, lista, def) => { if (!lista.includes(o[k])) o[k] = def; };
    const bo = (o, k) => { o[k] = !!o[k]; };
    n(p.entrada, 'ganancia', -24, 36); bo(p.entrada, 'fase');
    const L = p.limpieza; bo(L, 'on'); n(L, 'umbral', -80, -20); n(L, 'rango', 0, 40); n(L, 'ataque', 0.1, 50); n(L, 'relajacion', 10, 2000);
    const PI = p.pista; bo(PI, 'on'); n(PI, 'graves', -12, 12); n(PI, 'medios', -12, 12); n(PI, 'medFreq', 200, 5000); n(PI, 'agudos', -12, 12); n(PI, 'corteGraves', 20, 500); n(PI, 'corteAgudos', 2000, 20000); n(PI, 'pegamento', 0, 100);
    const CR = p.coros; bo(CR, 'on'); n(CR, 'volumen', -40, 12); n(CR, 'ancho', 0, 100); n(CR, 'reverb', -24, 12); n(CR, 'eco', -24, 12); n(CR, 'corteGraves', 20, 1000); n(CR, 'brillo', -12, 12); n(CR, 'compresion', 0, 100);
    const CO = p.corrector; bo(CO, 'on'); n(CO, 'cantidad', 0, 100); n(CO, 'ruido', 0, 100); n(CO, 'brillo', 0, 100); n(CO, 'corte', 0, 24000);
    CO.curva = Array.from({ length: 13 }, (_, i) => clamp(Array.isArray(CO.curva) && isFinite(CO.curva[i]) ? +CO.curva[i] : 0, -12, 12));
    CO.ruidoBandas = Array.from({ length: 4 }, (_, i) => clamp(Array.isArray(CO.ruidoBandas) && isFinite(CO.ruidoBandas[i]) ? +CO.ruidoBandas[i] : -200, -200, 0));
    const RZ = p.realce; bo(RZ, 'on'); e(RZ, 'perfil', ['grave', 'aguda'], 'grave'); n(RZ, 'cantidad', 0, 100);
    const AR = p.armonicos; bo(AR, 'on'); e(AR, 'modo', ['sigue', 'fija'], 'sigue'); e(AR, 'nota', NOTAS, 'La'); n(AR, 'ganancia', 0, 12); n(AR, 'ancho', 1, 30); n(AR, 'desde', 60, 1500);
    const SV = p.suavizador; bo(SV, 'on'); n(SV, 'cantidad', 0, 100); n(SV, 'nitidez', 0, 100); n(SV, 'desde', 200, 16000); n(SV, 'hasta', 400, 20000); n(SV, 'relajacion', 20, 500);
    bo(p.eq, 'on');
    for (const b of p.eq.bandas) {
      bo(b, 'on'); e(b, 'tipo', OPC.banda, 'campana'); n(b, 'f', 20, 20000); n(b, 'g', -18, 18); n(b, 'q', 0.1, 18);
      if (!OPC.pendiente.includes(b.pendiente)) b.pendiente = 12;
      if (typeof b.nombre !== 'string') b.nombre = '';
      const d = b.din; bo(d, 'on'); n(d, 'umbral', -60, 0); n(d, 'rango', -18, 18); n(d, 'ataque', 0.5, 200); n(d, 'relajacion', 10, 2000);
    }
    const ds = p.deesser; bo(ds, 'on'); bo(ds, 'escuchar'); e(ds, 'modo', OPC.dsModo, 'voz'); e(ds, 'proceso', OPC.dsProc, 'partida'); e(ds, 'posicion', OPC.dsPos, 'despues');
    n(ds, 'umbral', -60, 0); n(ds, 'rango', 0, 20); n(ds, 'fMin', 1500, 16000); n(ds, 'fMax', 2000, 20000); n(ds, 'anticipo', 0, 5);
    for (const k of ['comp1', 'comp2']) {
      const c = p[k]; bo(c, 'on'); bo(c, 'autoGan'); bo(c, 'autoRel');
      e(c, 'tipo', OPC.tipoComp, 'vca'); e(c, 'ratioFet', OPC.ratioFet, '4'); e(c, 'optoModo', OPC.optoModo, 'comprimir'); e(c, 'estilo', OPC.estilo, 'vocal');
      n(c, 'entrada', 0, 24); n(c, 'salida', -12, 24); n(c, 'ataque', 0.005, 250); n(c, 'relajacion', 10, 2500); n(c, 'mezcla', 0, 100); n(c, 'scHpf', 0, 300);
      n(c, 'umbral', -60, 0); n(c, 'ratio', 1, 30); n(c, 'rodilla', 0, 72); n(c, 'retencion', 0, 500); n(c, 'anticipo', 0, 10); n(c, 'rango', 0, 40);
      n(c, 'reduccion', 0, 100); n(c, 'enfasis', 0, 100);
    }
    const s = p.sat; bo(s, 'on'); e(s, 'tipo', OPC.sat, 'cinta'); n(s, 'drive', 0, 30); n(s, 'tono', -6, 6); n(s, 'mezcla', 0, 100); n(s, 'salida', -12, 12);
    const r = p.rider; bo(r, 'on'); n(r, 'objetivo', -6, 6); n(r, 'rango', 0, 12); n(r, 'velocidad', 0.1, 5);
    const db = p.doblador; bo(db, 'on'); n(db, 'cantidad', 0, 100); n(db, 'ancho', 0, 100); n(db, 'variacion', 0, 100);
    const dl = p.delay; bo(dl, 'on'); bo(dl, 'sync'); bo(dl, 'pingpong');
    if (!Object.prototype.hasOwnProperty.call(DIVISIONES, dl.division)) dl.division = '1/4';
    n(dl, 'envio', -60, 12); n(dl, 'ms', 1, 2500); n(dl, 'feedback', 0, 95); n(dl, 'hpf', 20, 2000); n(dl, 'lpf', 1000, 20000); n(dl, 'mod', 0, 100); n(dl, 'ducking', 0, 100); n(dl, 'ancho', 0, 100);
    const rv = p.reverb; bo(rv, 'on'); e(rv, 'tipo', OPC.rev, 'placa');
    n(rv, 'envio', -60, 12); n(rv, 'decay', 0.3, 8); n(rv, 'predelay', 0, 250); n(rv, 'amort', 0, 100); n(rv, 'hpf', 20, 2000); n(rv, 'lpf', 1000, 20000); n(rv, 'ancho', 0, 150); n(rv, 'mod', 0, 100); n(rv, 'ducking', 0, 100);
    n(p.voz, 'volumen', -60, 12); n(p.voz, 'pan', -100, 100); bo(p.voz, 'mute'); bo(p.voz, 'solo');
    n(p.base, 'volumen', -60, 12); n(p.base, 'hueco', 0, 9); n(p.base, 'huecoFreq', 500, 8000); bo(p.base, 'mute');
    const m = p.master; bo(m, 'on'); bo(m, 'autoRel'); n(m, 'techo', -12, 0); n(m, 'ganancia', -24, 24); n(m, 'liberacion', 10, 1000);
    bo(p, 'bypass'); n(p, 'bpm', 30, 300);
    return p;
  }
  // Preset de fuera (enlace, archivo, almacenamiento): se completa y se valida.
  const prepararParams = (over) => validarParams(mergeParams(defaultParams(), over));

  // ───────────────────────── motor completo ─────────────────────────
  class VoxEngine {
    constructor(fs) {
      this.fs = fs;
      this.gate = new Gate(fs); this.cor = new Corrector(fs); this.coro = new CoroBus(fs); this.pista = new PistaEQ(fs); this.tmpC = [0, 0, 0]; this.tmpP = [0, 0]; this.rz = new Realce(fs); this.ar = new Armonicos(fs); this.sv = new Suavizador(fs); this.eq = new Equalizer(fs); this.ds = new DeEsser(fs);
      this.c1 = new Compressor(fs); this.c2 = new Compressor(fs); this.sat = new Saturator(fs);
      this.rider = new Rider(fs); this.dbl = new Doubler(fs); this.dly = new StereoDelay(fs); this.rev = new Reverb(fs);
      this.lim = new Limiter(fs); this.lufs = new LufsMeter(fs, 2);
      // latencia fija de la cadena de la voz
      this.vLat = this.ds.latency + this.c1.latency + this.c2.latency + this.sat.latency + this.sv.latency;
      this.bDL = new DelayLine(this.vLat + 4); this.bDR = new DelayLine(this.vLat + 4); this.rawD = new DelayLine(this.vLat + 4);
      this.latency = this.vLat + this.lim.latency;
      this.hueL = new Biquad(); this.hueR = new Biquad(); this.hueAct = 0; this.hueG = 999; this.hueCnt = 0;
      this.vAct = 0; this.vEnv = 0; this.dn = 1e-18; // −360 dB, inaudible
      this.tmp2 = [0, 0]; this.tmpD = [0, 0]; this.tmpR = [0, 0]; this.tmpL = [0, 0];
      this.sm = { voz: 1, base: 1, dly: 0, rev: 0, panL: 1, panR: 1 };
      this.meters = this.newMeters();
      this.setParams(defaultParams());
    }
    newMeters() { return { voz: 0, base: 0, mL: 0, mR: 0, entrada: 0 }; }
    setParams(p) {
      p = prepararParams(p);
      this.p = p; const fs = this.fs;
      this.cor.set(p.corrector, p.entrada.ganancia); this.coro.set(p.coros, this.vLat, p.entrada.ganancia); this.pista.set(p.pista); this.gate.set(p.limpieza); this.rz.set(p.realce); this.ar.set(p.armonicos); this.sv.set(p.suavizador); this.eq.set(p.eq); this.ds.set(p.deesser);
      this.c1.set(p.comp1); this.c2.set(p.comp2); this.sat.set(p.sat);
      this.rider.set(p.rider); this.dbl.set(p.doblador); this.dly.set(p.delay, p.bpm); this.rev.set(p.reverb);
      this.lim.set(p.master);
      this.inG = dbToLin(clamp(p.entrada.ganancia, -24, 36)) * (p.entrada.fase ? -1 : 1);
      const anySolo = p.voz.solo;
      this.tVoz = p.voz.mute ? 0 : dbToLin(clamp(p.voz.volumen, -60, 12));
      this.tBase = p.base.mute || anySolo ? 0 : dbToLin(clamp(p.base.volumen, -60, 12));
      this.tDly = p.delay.on ? dbToLin(clamp(p.delay.envio, -60, 12)) : 0; // envío en paralelo: la voz seca no se toca
      this.tRev = p.reverb.on ? dbToLin(clamp(p.reverb.envio, -60, 12)) : 0;
      const pan = clamp(p.voz.pan || 0, -100, 100) / 100;
      const ang = (pan + 1) * Math.PI / 4;
      this.tPanL = Math.cos(ang) * Math.SQRT2; this.tPanR = Math.sin(ang) * Math.SQRT2;
      this.aSm = coefFor(0.02, fs);
      this.hueDepth = clamp(p.base.hueco || 0, 0, 9);
      this.hueF = clamp(p.base.huecoFreq || 2500, 500, 8000);
      this.aAct = coefFor(0.03, fs); this.vDec = Math.pow(10, -35 / 20 / (0.04 * fs)); // «estás cantando» suelta en ~40 ms tras la frase
      this.dsAfter = p.deesser.posicion !== 'antes';
      this.bypass = !!p.bypass;
    }
    tomarPkCoros() { const v = linToDb(this.coro.pk); this.coro.pk = 0; return v; }
    tomarCin() { const r = { c1: linToDb(this.pkC1 || 0), c2: linToDb(this.pkC2 || 0) }; this.pkC1 = this.pkC2 = 0; return r; }
    // vin: Float32Array|null (voz mono), bl/br: base, ol/or: salida, ov: voz procesada (opcional, análisis)
    process(vin, bl, br, ol, or, n, ov, cl, cr) {
      const sm = this.sm, a = this.aSm, b1 = 1 - a;
      const t2 = this.tmp2, td = this.tmpD, tr = this.tmpR, tl = this.tmpL;
      let pkV = 0, pkB = 0, pkL = 0, pkR = 0, pkIn = 0;
      for (let i = 0; i < n; i++) {
        this.dn = -this.dn;
        const raw = vin ? vin[i] : 0;
        let x = raw * this.inG + this.dn;
        const ain = Math.abs(x); if (ain > pkIn) pkIn = ain;
        // ── voz ──
        let v;
        // las dos rutas se alimentan siempre: al cambiar Bypass no suena lo que quedaba guardado
        this.rawD.write(x); const vSeca = this.rawD.read(this.vLat);
        {
          v = this.gate.process(this.cor.process(x));
          v = this.rz.process(v);
          v = this.eq.process(v);
          v = this.ar.process(v);
          if (!this.dsAfter) v = this.ds.process(v);
          { const a1 = v < 0 ? -v : v; if (a1 > this.pkC1) this.pkC1 = a1; } // nivel que entra a cada compresor (gráfica en directo)
          v = this.c1.process(v);
          { const a2 = v < 0 ? -v : v; if (a2 > this.pkC2) this.pkC2 = a2; }
          v = this.c2.process(v);
          if (this.dsAfter) v = this.ds.process(v);
          v = this.sat.process(v);
          v = this.sv.process(v);
        }
        if (this.bypass) v = vSeca; // sin efectos, con el mismo retardo para comparar
        // base retrasada para que coincida con la voz
        let bL0 = (bl ? bl[i] : 0) + this.dn, bR0 = (br ? br[i] : bL0) + this.dn;
        if (this.pista.on || this.pista.w > 0) { this.pista.process(bL0, bR0, this.tmpP); bL0 = this.tmpP[0]; bR0 = this.tmpP[1]; } // EQ y pegamento de la pista
        this.bDL.write(bL0); this.bDR.write(bR0);
        let bL = this.bDL.read(this.vLat), bR = this.bDR.read(this.vLat);
        if (!this.bypass) v *= this.rider.gain(v, (bL + bR) * 0.5);
        // actividad de la voz (0..1) para ducking y hueco
        const av = Math.abs(v);
        this.vEnv = av > this.vEnv ? av : this.vEnv * this.vDec;
        const act = clamp((linToDb(this.vEnv) + 45) / 25, 0, 1);
        this.vAct = this.aAct * this.vAct + (1 - this.aAct) * act; if (this.vAct < 1e-12) this.vAct = 0;
        // hueco para la voz en la base
        if (this.hueDepth > 0 && !this.bypass) {
          if ((this.hueCnt++ & 31) === 0) {
            const g = -this.hueDepth * this.vAct;
            if (Math.abs(g - this.hueG) > 0.05) { this.hueG = g; const c = design('peak', this.hueF, 0.9, g, this.fs); this.hueL.set(c); this.hueR.set(c); }
          }
          // solo en el CENTRO de la base (donde va la voz): lo que suena a los lados (guitarras abiertas, orquesta) queda entero (24/11)
          const mid = this.hueL.process((bL + bR) * 0.5), side = (bL - bR) * 0.5;
          bL = mid + side; bR = mid - side;
        }
        sm.base = a * sm.base + b1 * this.tBase;
        bL *= sm.base; bR *= sm.base;
        // voz en estéreo
        sm.voz = a * sm.voz + b1 * this.tVoz;
        sm.panL = a * sm.panL + b1 * this.tPanL; sm.panR = a * sm.panR + b1 * this.tPanR;
        const vv = v * sm.voz;
        if (ov) ov[i] = vv;
        let vL = vv * sm.panL * Math.SQRT1_2, vR = vv * sm.panR * Math.SQRT1_2;
        // coros: su bus, alineado con la principal; se suman a la voz y mandan a la misma reverb y eco (con su propio extra)
        let cm = 0; { const tc = this.tmpC; this.coro.process((cl ? cl[i] : 0) + this.dn, (cr ? cr[i] : cl ? cl[i] : 0) + this.dn, tc); vL += tc[0]; vR += tc[1]; cm = tc[2]; } // siempre: sin coros entra silencio y el retardo se vacía
        if (!this.bypass) {
          this.dbl.process(vv, t2); vL += t2[0]; vR += t2[1];
          sm.dly = a * sm.dly + b1 * this.tDly; sm.rev = a * sm.rev + b1 * this.tRev;
          this.dly.process((vv + cm * this.coro.eco) * sm.dly, this.vAct, td);
          this.rev.process((vv + cm * this.coro.rev) * sm.rev, this.vAct, tr);
          vL += td[0] + tr[0]; vR += td[1] + tr[1];
        }
        if (av > pkV) pkV = av;
        const abl = Math.max(Math.abs(bL), Math.abs(bR)); if (abl > pkB) pkB = abl;
        // bus final
        this.lim.process(vL + bL, vR + bR, tl);
        ol[i] = tl[0]; or[i] = tl[1];
        this.lufs.push(tl[0], tl[1]);
        const al = Math.abs(tl[0]), ar = Math.abs(tl[1]);
        if (al > pkL) pkL = al; if (ar > pkR) pkR = ar;
      }
      const m = this.meters;
      m.voz = Math.max(m.voz, pkV); m.base = Math.max(m.base, pkB); m.mL = Math.max(m.mL, pkL); m.mR = Math.max(m.mR, pkR); m.entrada = Math.max(m.entrada, pkIn);
    }
    takeMeters() {
      const m = this.meters; this.meters = this.newMeters();
      return {
        entrada: linToDb(m.entrada), voz: linToDb(m.voz), base: linToDb(m.base), mL: linToDb(m.mL), mR: linToDb(m.mR),
        cin: this.tomarCin(), coros: this.tomarPkCoros(), gr: { pista: this.pista.takeGr(), corrector: this.cor.takeGr(), puerta: this.gate.takeGr(), realce: this.rz.takeGr(), suavizador: this.sv.takeGr(), deesser: this.ds.takeGr(), c1: this.c1.takeGr(), c2: this.c2.takeGr(), lim: this.lim.takeGr() },
        eqDin: this.eq.dynOut.slice(), rider: linToDb(this.rider.p.on ? dbToLin(this.rider.g) : 1),
        nota: this.ar.takeNota(), lufsM: this.lufs.momentary, lufsS: this.lufs.shortTerm,
      };
    }
  }

  const api = {
    dbToLin, linToDb, clamp, design, biquadMag, Biquad, butterworthStages, bandStages, eqResponseDb, DelayLine,
    Upsampler4, Downsampler4, OS_H, kWeighting, LufsMeter, truePeak, analyzeLoudness, gainComputer, compStatic, compTransfer, FET_TABLE,
    Compressor, Gate, Corrector, CoroBus, PistaEQ, Realce, FFT, Suavizador, Armonicos, NOTAS, notaHz, Equalizer, DeEsser, Saturator, Doubler, StereoDelay, PlateReverb, FdnReverb, Reverb, Limiter, Rider,
    VoxEngine, defaultParams, mergeParams, validarParams, prepararParams, DIVISIONES, delaySeconds,
  };

  // ───────────────────────── AudioWorklet ─────────────────────────
  if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor !== 'undefined') {
    class VoxProcessor extends AudioWorkletProcessor {
      constructor(options) {
        super();
        const o = (options && options.processorOptions) || {};
        this.engine = new VoxEngine(sampleRate);
        this.last = o.params || null;
        if (o.params) this.engine.setParams(o.params);
        this.offline = !!o.offline;
        this.cnt = 0; this.every = Math.round(sampleRate * 0.05);
        this.port.onmessage = (e) => {
          const d = e.data || {};
          if (d.type === 'params') { this.last = d.params; this.engine.setParams(d.params); }
          else if (d.type === 'lufs-reset') this.engine.lufs.reset();
          else if (d.type === 'rider-reset') this.engine.rider.reset();
          else if (d.type === 'lufs-get') this.port.postMessage({ type: 'lufs', integrado: this.engine.lufs.integrated(), lra: this.engine.lufs.range() });
        };
        this.port.postMessage({ type: 'ready', latency: this.engine.latency, vLat: this.engine.vLat });
      }
      process(inputs, outputs) {
        const vi = inputs[0] && inputs[0].length ? inputs[0][0] : null;
        const bi = inputs[1] && inputs[1].length ? inputs[1] : null;
        const ci = inputs[2] && inputs[2].length ? inputs[2] : null; // coros (estéreo)
        const out = outputs[0];
        const ov = outputs[1] && outputs[1][0] ? outputs[1][0] : null;
        const n = out[0].length;
        this.engine.process(vi, bi ? bi[0] : null, bi ? (bi[1] || bi[0]) : null, out[0], out[1] || out[0], n, ov, ci ? ci[0] : null, ci ? (ci[1] || ci[0]) : null);
        // red de seguridad: si algo saliera no finito, se reinicia el motor y se manda silencio
        let bad = false; for (let i = 0; i < n; i += 8) if (!isFinite(out[0][i]) || !isFinite(out[out.length - 1][i])) { bad = true; break; }
        if (bad) {
          for (const ch of out) ch.fill(0); if (ov) ov.fill(0);
          this.engine = new VoxEngine(sampleRate); if (this.last) this.engine.setParams(this.last);
          if (!this.offline) this.port.postMessage({ type: 'reinicio' });
        }
        if (!this.offline) {
          this.cnt += n;
          if (this.cnt >= this.every) { this.cnt = 0; this.port.postMessage({ type: 'meters', m: this.engine.takeMeters() }); }
        }
        return true;
      }
    }
    registerProcessor('vox-processor', VoxProcessor);

    // Grabador: copia la entrada del micro en trozos y dice en qué muestra del contexto empezó.
    class VoxRecorder extends AudioWorkletProcessor {
      constructor() {
        super(); this.on = true; this.buf = new Float32Array(4096); this.n = 0; this.first = -1; this.pk = 0; this.cnt = 0;
        this.port.onmessage = (e) => { if (e.data && e.data.type === 'stop') { this.flush(); this.on = false; this.port.postMessage({ type: 'done' }); } };
      }
      flush() { if (this.n > 0) { const c = this.buf.slice(0, this.n); this.port.postMessage({ type: 'chunk', data: c }, [c.buffer]); this.n = 0; } }
      process(inputs) {
        if (!this.on) return false;
        const inp = inputs[0];
        if (this.first < 0) { if (!inp || !inp.length) return true; this.first = currentFrame; this.port.postMessage({ type: 'start', frame: currentFrame }); }
        // un bloque sin entrada se guarda como silencio: así la toma nunca se desfasa
        const len = inp && inp.length ? inp[0].length : 128;
        // estéreo: si un canal está casi vacío (micro solo en la entrada 1), se usa el otro entero
        let mode = 0;
        if (inp && inp.length > 1) { let e0 = 0, e1 = 0; for (let i = 0; i < len; i++) { e0 += inp[0][i] * inp[0][i]; e1 += inp[1][i] * inp[1][i]; } mode = e1 < e0 * 0.01 ? 0 : e0 < e1 * 0.01 ? 1 : 2; }
        for (let i = 0; i < len; i++) {
          let s = 0;
          if (inp && inp.length) s = mode === 2 ? (inp[0][i] + inp[1][i]) * 0.5 : inp[mode][i];
          this.buf[this.n++] = s; const a = Math.abs(s); if (a > this.pk) this.pk = a;
          if (this.n === this.buf.length) this.flush();
        }
        this.cnt += len;
        if (this.cnt >= 2048) { this.cnt = 0; this.port.postMessage({ type: 'level', pk: this.pk }); this.pk = 0; }
        return true;
      }
    }
    registerProcessor('vox-recorder', VoxRecorder);
  }

  return api;
}

if (typeof module !== 'undefined' && module.exports) module.exports = voxdspModule();
else if (typeof window !== 'undefined') { window.voxdspModule = voxdspModule; window.VoxDSP = voxdspModule(); }
