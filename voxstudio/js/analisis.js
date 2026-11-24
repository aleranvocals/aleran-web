/* VoxStudio Lite · análisis de la voz y de la base: mezcla automática, tempo y formas de onda. */
(function () {
  'use strict';
  const D = window.VoxDSP;

  // FFT compleja radix-2 en sitio
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  // Picos (mín/máx) para dibujar una forma de onda de `w` columnas
  function picos(chans, w) {
    const n = chans[0].length, mn = new Float32Array(w), mx = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const a = Math.floor(x * n / w), b = Math.max(a + 1, Math.floor((x + 1) * n / w));
      let lo = 0, hi = 0;
      for (const c of chans) for (let i = a; i < b; i += 1) { const v = c[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      mn[x] = lo; mx[x] = hi;
    }
    return { mn, mx };
  }

  // Tempo de la base: autocorrelación de la envolvente de ataques (60–180 BPM)
  function tempo(buf) {
    const sr = buf.sampleRate, x = buf.getChannelData(0), hop = 512;
    const maxN = Math.min(x.length, sr * 90);
    const env = [];
    let prev = 0;
    for (let i = 0; i + hop < maxN; i += hop) { let e = 0; for (let k = 0; k < hop; k++) e += x[i + k] * x[i + k]; e = Math.log(1e-9 + e); env.push(Math.max(0, e - prev)); prev = e; }
    const fps = sr / hop; let best = 0, bestBpm = 120;
    for (let bpm = 60; bpm <= 180; bpm += 0.5) {
      const lag = fps * 60 / bpm; let s = 0;
      for (let i = Math.ceil(lag * 2); i < env.length; i++) {
        const a = env[i - Math.round(lag)] || 0, b = env[i - Math.round(lag * 2)] || 0;
        s += env[i] * (a + 0.5 * b);
      }
      s /= (env.length - lag * 2);
      // ligera preferencia por 80–150 BPM
      const w = 1 - 0.15 * Math.abs(Math.log2(bpm / 115));
      if (s * w > best) { best = s * w; bestBpm = bpm; }
    }
    return Math.round(bestBpm);
  }

  // Altura (f0) por autocorrelación normalizada sobre un trozo
  function f0(x, a, n, sr) {
    const minL = Math.max(2, Math.floor(sr / 1200)), maxL = Math.floor(sr / 70);
    let eT = 0; for (let i = 0; i < n; i++) eT += x[a + i] * x[a + i];
    if (eT < 1e-6) return 0;
    let best = 0; const rs = new Float64Array(maxL + 2);
    for (let L = minL; L <= maxL; L++) {
      let s = 0, e0 = 0, e1 = 0; for (let i = 0; i < n - L; i++) { s += x[a + i] * x[a + i + L]; e0 += x[a + i] * x[a + i]; e1 += x[a + i + L] * x[a + i + L]; }
      const r = s / Math.sqrt(e0 * e1 + 1e-12); rs[L] = r;
      if (r > best) best = r;
    }
    if (best <= 0.75) return 0;
    // el primer pico casi tan alto como el mejor: los múltiplos del periodo (una octava más grave) también correlan
    // y quedarse con el máximo absoluto confundía voces agudas con una octava más abajo (22/11)
    for (let L = minL; L < maxL; L++) if (rs[L] >= best * 0.92 && (L === minL || rs[L] >= rs[L - 1]) && rs[L] >= rs[L + 1]) return sr / L;
    return 0;
  }

  /* Mezcla automática: mira la voz grabada (y la base) y ajusta los parámetros de corrección
   * sobre el estilo elegido. Devuelve { params, notas: [texto para el alumno] }. */
  async function autoMezcla(motor, params) {
    const notas = [], extra = {};
    const p = JSON.parse(JSON.stringify(params));
    const t = motor.toma; if (!t) throw new Error('Primero graba o carga tu voz.');
    const sr = t.buffer.sampleRate, x = t.buffer.getChannelData(0);
    const N = 2048, hop = 1024, frames = [];
    for (let i = 0; i + N < x.length; i += hop) { let e = 0; for (let k = 0; k < N; k++) e += x[i + k] * x[i + k]; frames.push({ i, db: 10 * Math.log10(e / N + 1e-12) + 3.01 }); }
    if (frames.length < 20) throw new Error('La toma es demasiado corta para analizarla.');
    const sorted = frames.map((f) => f.db).sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.1)];
    const loud = sorted[Math.floor(sorted.length * 0.95)];
    const thr = Math.max(floor + 12, loud - 30, -60);
    const act = frames.filter((f) => f.db > thr);
    if (act.length < 10) throw new Error('No encuentro voz en la toma (¿estaba el micro silenciado?).');
    // 1. nivel de entrada: la voz cantada a −20 dBFS RMS (así los presets se comportan igual con cualquier micro)
    let eAct = 0; for (const f of act) eAct += Math.pow(10, f.db / 10); const rmsAct = 10 * Math.log10(eAct / act.length) - 3.01;
    const g = D.clamp(-20 - rmsAct, -12, 30);
    p.entrada.ganancia = Math.round(g * 10) / 10;
    notas.push(`Nivel de tu voz ajustado ${g >= 0 ? '+' : ''}${UI.num(g)} dB para que entre a la cadena en su punto.`);
    // 2. limpieza: si el ruido de fondo queda alto tras subir el nivel
    const ruido = floor - 3.01 + g;
    if (ruido > -62 && loud - floor > 18) {
      p.limpieza.on = true; p.limpieza.umbral = Math.round(Math.min(ruido + 9, -30)); p.limpieza.rango = 10;
      notas.push(`Ruido de fondo en ${Math.round(ruido)} dB: activo la limpieza entre frases.`);
    } else p.limpieza.on = false;
    // 3. espectro medio de la voz cantada
    const F = 4096, spec = new Float64Array(F / 2), win = new Float64Array(F);
    for (let i = 0; i < F; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / F);
    const re = new Float64Array(F), im = new Float64Array(F);
    const pick = act.filter((_, k) => k % Math.max(1, Math.floor(act.length / 160)) === 0);
    const sib = new Float64Array(F / 2); let nSib = 0;
    const f0s = [];
    for (const fr of pick) {
      if (fr.i + F > x.length) continue;
      for (let i = 0; i < F; i++) { re[i] = x[fr.i + i] * win[i]; im[i] = 0; }
      fft(re, im);
      let lo = 0, hi = 0; const kSib = Math.round(4500 / sr * F);
      for (let k = 1; k < F / 2; k++) { const m = re[k] * re[k] + im[k] * im[k]; spec[k] += m; if (k < kSib) lo += m; else hi += m; }
      if (hi > lo * 0.8) { nSib++; for (let k = 1; k < F / 2; k++) sib[k] += re[k] * re[k] + im[k] * im[k]; }
      const ff = f0(x, fr.i, Math.min(F, Math.round(0.035 * sr)), sr); if (ff) f0s.push(ff); // ventana de 35 ms: igual a cualquier frecuencia de muestreo
    }
    const binF = (k) => k * sr / F, kOf = (f) => Math.round(f / sr * F);
    const smooth = (s, frac) => { // suavizado de 1/frac de octava, en dB
      const out = new Float64Array(s.length);
      for (let k = 1; k < s.length; k++) { const a = Math.max(1, Math.floor(k / Math.pow(2, 0.5 / frac))), b = Math.min(s.length - 1, Math.ceil(k * Math.pow(2, 0.5 / frac))); let e = 0; for (let j = a; j <= b; j++) e += s[j]; out[k] = 10 * Math.log10(e / (b - a + 1) + 1e-20); }
      return out;
    };
    const S3 = smooth(spec, 3), S12 = smooth(spec, 12), S2 = smooth(spec, 2);
    // recta de tendencia (dB frente a octavas) entre 200 Hz y 8 kHz
    let sx = 0, sy = 0, sxx = 0, sxy = 0, cnt = 0;
    for (let k = kOf(200); k <= kOf(8000); k++) { const lx = Math.log2(binF(k)), y = S3[k]; sx += lx; sy += y; sxx += lx * lx; sxy += lx * y; cnt++; }
    const slope = (cnt * sxy - sx * sy) / (cnt * sxx - sx * sx), icp = (sy - slope * sx) / cnt;
    const res = (f) => S3[kOf(f)] - (icp + slope * Math.log2(f));
    const mean = (a, b) => { let s = 0, n = 0; for (let f = a; f <= b; f *= 1.06) { s += res(f); n++; } return s / n; };
    const argmax = (a, b) => { let m = -1e9, fm = a; for (let f = a; f <= b; f *= 1.03) { const r = res(f); if (r > m) { m = r; fm = f; } } return fm; };
    const B = p.eq.bandas;
    // grave: corte según la nota más grave que cantas
    if (f0s.length > 5) {
      f0s.sort((a, b) => a - b);
      // fuera lecturas por debajo de la mitad larga de la mediana: subarmónicos de voces rasgadas (metal), no notas reales (22/11)
      const med = f0s[Math.floor(f0s.length / 2)], fiables = f0s.filter((f) => f >= med / 1.9);
      const low = fiables[Math.floor(fiables.length * 0.05)];
      const hpf = Math.round(D.clamp(low * 0.6, 60, 120));
      B[0].on = true; B[0].f = hpf; notas.push(`Tu nota más grave ronda ${Math.round(low)} Hz: corto por debajo de ${hpf} Hz (ruidos y golpes de micro).`);
    }
    // barro
    const mud = mean(200, 450);
    if (mud > 1.2) { const f = argmax(180, 500); B[2].on = true; B[2].tipo = 'campana'; B[2].f = Math.round(f); B[2].q = 1.2; B[2].g = -Math.round(D.clamp(mud * 0.9, 1, 5) * 10) / 10; notas.push(`Quito barro en ${Math.round(f)} Hz (${UI.num(B[2].g)} dB).`); }
    else { B[2].g = Math.min(B[2].g, -1); }
    // dureza / presencia
    const pres = mean(2000, 5000);
    if (pres > 2) { const f = argmax(2000, 5000); B[5].on = true; B[5].tipo = 'campana'; B[5].f = Math.round(f); B[5].q = 3; B[5].g = 0; B[5].din = { on: true, umbral: Math.round(-20 + g - 14), rango: -Math.round(D.clamp(pres * 1.2, 2, 6)), ataque: 2, relajacion: 80 }; notas.push(`Tu voz tiene dureza en ${UI.fmt.hz(f)}: la domo solo cuando aparece (EQ dinámica).`); }
    else if (pres < -2) { const g0 = B[4].g; B[4].g = Math.min(4, B[4].g + D.clamp(-pres * 0.6, 0.5, 3)); extra.pres = B[4].g - g0; notas.push('Le falta presencia: subo un poco la zona de 3 kHz.'); }
    // aire
    // el aire se calcula siempre (por si luego cambias a un estilo sin Realce), pero con el Realce encendido no se aplica: el Realce ya lo da (24/11)
    if (mean(8000, 13000) < -4) { extra.aire = Math.min(5, B[6].g + 1.5) - B[6].g; if (!(p.realce && p.realce.on)) { B[6].g += extra.aire; notas.push('Le falta aire arriba: subo el brillo un poco.'); } }
    // resonancia estrecha (picos que sobresalen del entorno)
    let rf = 0, rv = 0;
    for (let k = kOf(250); k <= kOf(5000); k++) { const d = S12[k] - S2[k]; if (d > rv) { rv = d; rf = binF(k); } }
    if (rv > 4.5) { B[3].on = true; B[3].tipo = 'campana'; B[3].f = Math.round(rf); B[3].q = 5; B[3].g = 0; B[3].din = { on: true, umbral: Math.round(-20 + g - 16), rango: -Math.round(D.clamp(rv, 3, 7)), ataque: 3, relajacion: 90 }; notas.push(`Resonancia en ${UI.fmt.hz(rf)} (+${UI.num(rv)} dB): la controlo con una banda dinámica estrecha.`); }
    else B[3].on = false;
    // sibilancia
    if (nSib >= 3) {
      let mv = 0, mf = 6500; for (let k = kOf(4000); k <= kOf(11000); k++) if (sib[k] > mv) { mv = sib[k]; mf = binF(k); }
      p.deesser.on = true; p.deesser.fMin = Math.round(D.clamp(mf / 1.35, 3000, 9000)); p.deesser.fMax = Math.round(D.clamp(mf * 1.6, 7000, 16000));
      notas.push(`Tus «eses» están en torno a ${UI.fmt.hz(mf)}: el de-esser vigila de ${UI.fmt.hz(p.deesser.fMin)} a ${UI.fmt.hz(p.deesser.fMax)}.`);
    }
    // hueco en la base: donde tu voz tiene más energía (ahí es donde la tapan las guitarras y la orquesta) (22/11)
    { let mv = -1e9, mf = 2500; for (let f = 1000; f <= 3500; f *= 1.03) { const v = S2[kOf(f)] - (icp + slope * Math.log2(f)); if (v > mv) { mv = v; mf = f; } }
      p.base.huecoFreq = Math.round(mf / 50) * 50; notas.push(`El hueco que la base le hace a tu voz va en ${UI.fmt.hz(p.base.huecoFreq)}, donde tu voz tiene más energía.`); }
    // 4. tempo de la base
    if (motor.base && !p._bpmManual) { const bpm = tempo(motor.base); if (bpm) { p.bpm = bpm; notas.push(`Tempo de la base: ${bpm} BPM (los ecos van a tempo).`); } }
    // 5. volumen de la voz frente a la base: render rápido y medida real (LUFS)
    if (motor.base) {
      const durMax = 45;
      const ini = Math.max(0, t.inicio + act[0].i / sr - 0.5), fin = Math.min(motor.duracion(), ini + durMax); // desde que empiezas a cantar
      p.voz.volumen = 0; p.base.volumen = 0; // se parte de cero: el resultado no depende de ajustes anteriores
      const vox = await motor.render({ params: p, modo: 'voz', desde: ini, hasta: fin });
      const a = Math.floor(ini * sr), b = Math.floor(fin * sr), nV = b - a;
      const lv = D.analyzeLoudness([vox[0].subarray(0, nV), vox[1].subarray(0, nV)], sr).integrado;
      const bl = motor.base.getChannelData(0), br = motor.base.numberOfChannels > 1 ? motor.base.getChannelData(1) : bl;
      const lb = D.analyzeLoudness([bl.subarray(a, Math.min(b, bl.length)), br.subarray(a, Math.min(b, br.length))], sr).integrado;
      if (isFinite(lv) && isFinite(lb)) {
        const delante = p._delante !== undefined ? p._delante : -2.5; // gusto de Áleran (24/11): voz metida en la pista
        // diferencia que falta; si la base viene muy fuerte (masterizada), se baja la base en vez de forzar la voz
        const falta = lb + p.base.volumen + delante - lv; // la base suena con su fader actual
        const dv = D.clamp(p.voz.volumen + falta, -12, 4);
        const db = D.clamp(p.base.volumen - (falta - (dv - p.voz.volumen)), -24, 6);
        p.voz.volumen = Math.round(dv * 10) / 10; p.base.volumen = Math.round(db * 10) / 10;
        if (db < -0.5) notas.push(`La base viene muy fuerte: la bajo ${UI.num(-db)} dB para que tu voz respire (el volumen final se recupera al exportar).`);
        notas.push(delante >= 0 ? `Volumen medido en LUFS: tu voz queda ${UI.num(delante)} dB por delante de la base.` : `Volumen medido en LUFS: tu voz queda ${UI.num(-delante)} dB por debajo de la base, metida en la mezcla.`);
      }
    }
    return { params: p, notas, extra };
  }

  window.Analisis = { fft, picos, tempo, autoMezcla };
})();
