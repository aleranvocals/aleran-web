/* VoxStudio Lite · archivos de salida: WAV (16/24 bits, con dither) y MP3 (lamejs en un Worker). */
(function () {
  'use strict';
  // carpeta raíz de la app (este archivo está en js/), para encontrar vendor/ desde cualquier página
  const RAIZ = document.currentScript ? new URL('..', document.currentScript.src).href : new URL('.', document.baseURI).href;

  function wav(chans, sr, bits) {
    const nCh = chans.length, n = chans[0].length, bps = bits / 8;
    const dataLen = n * nCh * bps, buf = new ArrayBuffer(44 + dataLen), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * nCh * bps, true); v.setUint16(32, nCh * bps, true); v.setUint16(34, bits, true);
    str(36, 'data'); v.setUint32(40, dataLen, true);
    let o = 44;
    const full = bits === 16 ? 32767 : 8388607;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < nCh; c++) {
        let s = chans[c][i];
        // dither triangular (TPDF) de 1 LSB al reducir a 16 bits
        if (bits === 16) s += (Math.random() - Math.random()) / 32768;
        s = Math.max(-1, Math.min(1, s));
        let q = Math.round(s * full); if (q > full) q = full; if (q < -full - 1) q = -full - 1;
        if (bits === 16) { v.setInt16(o, q, true); o += 2; }
        else { v.setUint8(o, q & 255); v.setUint8(o + 1, (q >> 8) & 255); v.setUint8(o + 2, (q >> 16) & 255); o += 3; }
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // MP3: en un Worker para no congelar la página; si el Worker no se puede crear (archivo local), en la página.
  function mp3(chans, sr, kbps, onProgress) {
    return new Promise((resolve, reject) => {
      const copia = chans.map((c) => c.slice());
      const payload = { chans: copia, sr, kbps, lame: RAIZ + 'vendor/lame.min.js' };
      let w = null;
      try {
        const code = `self.onmessage=function(e){var d=e.data;try{importScripts(d.lame);var L=lamejs;var enc=new L.Mp3Encoder(d.chans.length,d.sr,d.kbps);var n=d.chans[0].length,B=1152*10,out=[];var I=d.chans.map(function(){return new Int16Array(B)});for(var i=0;i<n;i+=B){var m=Math.min(B,n-i);for(var c=0;c<d.chans.length;c++){var x=d.chans[c];for(var k=0;k<m;k++){var s=x[i+k]+(Math.random()-Math.random())/32768;s=s<-1?-1:s>1?1:s;I[c][k]=s<0?s*32768:s*32767;}}var r=d.chans.length>1?enc.encodeBuffer(I[0].subarray(0,m),I[1].subarray(0,m)):enc.encodeBuffer(I[0].subarray(0,m));if(r.length)out.push(new Uint8Array(r));if((i/B)%40===0)self.postMessage({p:i/n});}var f=enc.flush();if(f.length)out.push(new Uint8Array(f));self.postMessage({done:out});}catch(err){self.postMessage({error:String(err&&err.message||err)});}};`;
        w = new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
      } catch (e) { w = null; }
      if (w) {
        w.onmessage = (e) => {
          const d = e.data;
          if (d.p !== undefined && onProgress) onProgress(d.p);
          else if (d.done) { resolve(new Blob(d.done, { type: 'audio/mpeg' })); w.terminate(); }
          else if (d.error) { w.terminate(); enPagina().then(resolve, reject); }
        };
        w.onerror = () => { w.terminate(); enPagina().then(resolve, reject); };
        w.postMessage(payload, copia.map((c) => c.buffer));
      } else enPagina().then(resolve, reject);

      function enPagina() {
        return cargarLame().then(() => {
          const enc = new window.lamejs.Mp3Encoder(chans.length, sr, kbps), n = chans[0].length, B = 1152 * 10, out = [];
          const I = chans.map(() => new Int16Array(B));
          for (let i = 0; i < n; i += B) {
            const m = Math.min(B, n - i);
            for (let c = 0; c < chans.length; c++) for (let k = 0; k < m; k++) { const s = Math.max(-1, Math.min(1, chans[c][i + k])); I[c][k] = s < 0 ? s * 32768 : s * 32767; }
            const r = chans.length > 1 ? enc.encodeBuffer(I[0].subarray(0, m), I[1].subarray(0, m)) : enc.encodeBuffer(I[0].subarray(0, m));
            if (r.length) out.push(new Uint8Array(r));
          }
          const f = enc.flush(); if (f.length) out.push(new Uint8Array(f));
          return new Blob(out, { type: 'audio/mpeg' });
        });
      }
    });
  }
  let lameP = null;
  function cargarLame() {
    if (window.lamejs) return Promise.resolve();
    if (!lameP) lameP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = RAIZ + 'vendor/lame.min.js'; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el codificador MP3')); document.head.appendChild(s); });
    return lameP;
  }

  function descargar(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }
  const limpiarNombre = (s) => String(s || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60);

  window.Exportar = { wav, mp3, descargar, limpiarNombre };
})();
