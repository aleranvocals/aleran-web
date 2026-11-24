/* ─────────────────────────────────────────────────────────────────────────────
 *  PRESETS DE ÁLERAN  ·  VoxStudio Lite
 *
 *  Estos son los estilos que ven tus alumnos en «Elige estilo».
 *  Cómo añadir uno tuyo (sin tocar nada más):
 *    1. En VoxStudio Lite, modo avanzado, deja la voz como te guste.
 *    2. Pulsa «Guardar preset» → «Descargar archivo». Se baja un .json.
 *    3. Abre ese .json, copia lo que hay dentro de "params": { … }
 *       y pégalo aquí como un estilo nuevo (copia uno de abajo y cambia nombre y textos).
 *  Solo hace falta escribir lo que cambia: lo demás se queda con su valor normal.
 *
 *  Campos: id (sin espacios), nombre, descripcion, etiquetas,
 *          delante = dB de la voz respecto a la base en la mezcla automática (LUFS).
 *                    Negativo = la voz va metida en la pista (gusto de Áleran).
 *
 *  EQUILIBRADOS (24/11) a partir de «Puertas – Garra DEFINITIVA», con lo que Áleran pidió de oído:
 *   · voz bastante más metida (Rock con garra = la definitiva: −2,5, unos −4 dB bajo la pista al cantar);
 *   · hueco de 3–4 dB solo en el centro de la base;
 *   · efectos mucho más fuertes, en paralelo, que se apartan al cantar y florecen en los huecos;
 *   · Realce encendido en rock y metal; Suavizador al 50 % en los estilos brillantes;
 *   · Armónicos suaves (4–5 dB desde Mi4) solo en Rock, Metal y Épico.
 *  RIDER (23/11): el vocal rider nuevo, que a Áleran le encantó («está re brutal»), va encendido en los estilos
 *   cantados: rango 5 en Balada y Épico (los más dinámicos), 4 en Pop y Rock, 3 en Metal, Acústico y Rap
 *   (ya van muy comprimidos o deben sonar naturales). Apagado en Radio (es un efecto) y Ensayo (se oye la técnica tal cual).
 * ───────────────────────────────────────────────────────────────────────────── */

window.VOX_PRESETS_ALERAN = [
  {
    id: 'pop-limpio', nombre: 'Pop limpio', etiquetas: ['pop', 'claro'], delante: -2,
    descripcion: 'Voz clara y brillante sin pinchar. Compresión rápida + suave en serie, placa y eco con puntillo que florecen entre frases.',
    params: {
      eq: { bandas: [{ f: 100 }, {}, { f: 300, g: -2.5 }, {}, { f: 3200, g: 2 }, {}, { f: 12000, g: 3 }] },
      comp1: { tipo: 'fet', ratioFet: '4', entrada: 7, salida: -0.3, ataque: 0.3, relajacion: 120 },
      comp2: { tipo: 'optico', reduccion: 35, salida: 0.6, enfasis: 20 },
      deesser: { umbral: -30, rango: 6 },
      suavizador: { on: true, cantidad: 50, nitidez: 50, desde: 1800, hasta: 9000, relajacion: 80 },
      doblador: { on: true, cantidad: 30, ancho: 100, variacion: 50 },
      delay: { envio: -11, division: '1/8.', feedback: 25, ducking: 85 },
      reverb: { tipo: 'placa', envio: -7, decay: 1.8, predelay: 30, ducking: 80 },
      rider: { on: true, objetivo: 0, rango: 4, velocidad: 1 },
      base: { hueco: 3 },
    },
  },
  {
    id: 'rock-garra', nombre: 'Rock con garra', etiquetas: ['rock', 'directo'], delante: -2.5,
    descripcion: 'La mezcla DEFINITIVA de Áleran: medios con cuerpo y mordida, FET apretado y cinta, Realce, voz ancha, armónicos suaves y hall + eco que florecen en los huecos.',
    params: {
      eq: { bandas: [{ f: 110 }, { on: true, f: 200, g: 1 }, { f: 400, g: -2 }, {}, { f: 2000, q: 0.9, g: 2.5 }, {}, { f: 10000, g: 1.5 }] },
      comp1: { tipo: 'fet', ratioFet: '8', entrada: 9, salida: -0.6, ataque: 0.2, relajacion: 90 },
      comp2: { tipo: 'vca', umbral: -18, ratio: 3, rodilla: 6, ataque: 5, relajacion: 150, salida: 0.6 },
      sat: { on: true, tipo: 'cinta', drive: 9, tono: 0.5, mezcla: 70 },
      realce: { on: true, perfil: 'grave', cantidad: 70 },
      suavizador: { on: true, cantidad: 50, nitidez: 50, desde: 1800, hasta: 9000, relajacion: 80 },
      armonicos: { on: true, modo: 'sigue', ganancia: 5, ancho: 8, desde: 330 },
      doblador: { on: true, cantidad: 45, ancho: 100, variacion: 50 },
      delay: { envio: -9, division: '1/4', feedback: 35, ducking: 75 },
      reverb: { tipo: 'hall', envio: -5, decay: 2.6, predelay: 40, ducking: 60 },
      rider: { on: true, objetivo: 0, rango: 4, velocidad: 1 },
      base: { hueco: 3.5 },
    },
  },
  {
    id: 'metal-moderno', nombre: 'Metal moderno', etiquetas: ['metal', 'potente'], delante: -3,
    descripcion: 'Voz muy controlada que corta entre guitarras: dos compresores fuertes, válvula, Realce, armónicos en los agudos y efectos que llenan los huecos.',
    params: {
      eq: { bandas: [{ f: 130, pendiente: 24 }, {}, { f: 350, g: -3 }, {}, { f: 2600, q: 1.1, g: 3 }, {}, { f: 9000, g: 2 }] },
      comp1: { tipo: 'fet', ratioFet: '12', entrada: 10, salida: -0.6, ataque: 0.15, relajacion: 70 },
      comp2: { tipo: 'optico', reduccion: 45, optoModo: 'limitar', salida: 0.9, enfasis: 30 },
      deesser: { umbral: -32, rango: 8 },
      sat: { on: true, tipo: 'valvula', drive: 8, tono: 1, mezcla: 60 },
      realce: { on: true, perfil: 'grave', cantidad: 65 },
      suavizador: { on: true, cantidad: 50, nitidez: 50, desde: 1800, hasta: 9000, relajacion: 80 },
      armonicos: { on: true, modo: 'sigue', ganancia: 5, ancho: 8, desde: 330 },
      doblador: { on: true, cantidad: 40, ancho: 100, variacion: 50 },
      delay: { envio: -10, division: '1/4', feedback: 30, ducking: 85 },
      reverb: { tipo: 'placa', envio: -7, decay: 2.2, predelay: 40, ducking: 75 },
      rider: { on: true, objetivo: 0, rango: 3, velocidad: 1 },
      base: { hueco: 4 },
    },
  },
  {
    id: 'metal-epico', nombre: 'Épico sinfónico', etiquetas: ['metal sinfónico', 'power'], delante: -3,
    descripcion: 'Para voces líricas sobre orquesta: hall largo con predelay, eco a negra, Realce, armónicos suaves y colas que florecen entre frases.',
    params: {
      eq: { bandas: [{ f: 100 }, {}, { f: 300, g: -2 }, {}, { f: 3000, g: 2 }, {}, { f: 12000, g: 3.5 }] },
      comp1: { tipo: 'moderno', estilo: 'vocal', umbral: -22, ratio: 3, rodilla: 18, ataque: 8, relajacion: 160 },
      comp2: { tipo: 'optico', reduccion: 30, salida: 0.5 },
      realce: { on: true, perfil: 'grave', cantidad: 60 },
      suavizador: { on: true, cantidad: 50, nitidez: 50, desde: 1800, hasta: 9000, relajacion: 80 },
      armonicos: { on: true, modo: 'sigue', ganancia: 4, ancho: 8, desde: 330 },
      doblador: { on: true, cantidad: 35, ancho: 100, variacion: 50 },
      delay: { envio: -8, division: '1/4', feedback: 38, ducking: 80, mod: 30 },
      reverb: { tipo: 'hall', envio: -3, decay: 3.6, predelay: 60, amort: 40, ducking: 65 },
      rider: { on: true, objetivo: 0, rango: 5, velocidad: 1 },
      base: { hueco: 3.5 },
    },
  },
  {
    id: 'balada', nombre: 'Balada íntima', etiquetas: ['balada', 'cálida'], delante: -1.5,
    descripcion: 'Cercana y cálida: compresión óptica lenta, graves con cuerpo, placa larga y eco con puntillo que respiran entre frases.',
    params: {
      eq: { bandas: [{ f: 80 }, { on: true, f: 160, g: 1.5 }, { f: 280, g: -1.5 }, {}, { f: 3500, g: 1 }, {}, { f: 11000, g: 2.5 }] },
      comp1: { tipo: 'optico', reduccion: 40, salida: 0.6, enfasis: 10 },
      comp2: { on: false },
      sat: { on: true, tipo: 'valvula', drive: 4, mezcla: 50 },
      delay: { envio: -11, division: '1/4.', feedback: 32, ducking: 80 },
      reverb: { tipo: 'placa', envio: -8, decay: 3.0, predelay: 50, ducking: 75 },
      rider: { on: true, objetivo: 0, rango: 5, velocidad: 1 },
      base: { hueco: 3 },
    },
  },
  {
    id: 'acustico', nombre: 'Acústico natural', etiquetas: ['acústico', 'natural'], delante: -1.5,
    descripcion: 'Poco efecto: corrige lo justo, compresión suave y una sala pequeña que asoma entre frases. Para que se oiga tu voz tal cual.',
    params: {
      eq: { bandas: [{ f: 85 }, {}, { f: 300, g: -1.5 }, {}, { f: 3000, g: 1 }, {}, { f: 12000, g: 1.5 }] },
      comp1: { tipo: 'vca', umbral: -22, ratio: 2.5, rodilla: 10, ataque: 8, relajacion: 180, salida: 0.6 },
      comp2: { on: false },
      deesser: { rango: 5 },
      delay: { on: false },
      reverb: { tipo: 'sala', envio: -11, decay: 1.1, predelay: 15, ducking: 40 },
      rider: { on: true, objetivo: 0, rango: 3, velocidad: 1 },
      base: { hueco: 3 },
    },
  },
  {
    id: 'urbano', nombre: 'Rap / urbano', etiquetas: ['rap', 'trap', 'reggaetón'], delante: -1.5,
    descripcion: 'Seca, gorda y en tu cara: mucha compresión, graves presentes, aire arriba sin pinchar y ecos que solo salen en los finales.',
    params: {
      eq: { bandas: [{ f: 90 }, { on: true, f: 150, g: 2 }, { f: 350, g: -3 }, {}, { f: 4000, g: 2 }, {}, { f: 13000, g: 4 }] },
      comp1: { tipo: 'fet', ratioFet: '20', entrada: 8, salida: -0.3, ataque: 0.1, relajacion: 60 },
      comp2: { tipo: 'moderno', estilo: 'impacto', umbral: -18, ratio: 4, rodilla: 6, ataque: 3, relajacion: 90, salida: 0.6 },
      sat: { on: true, tipo: 'transistor', drive: 5, mezcla: 40 },
      suavizador: { on: true, cantidad: 50, nitidez: 50, desde: 1800, hasta: 9000, relajacion: 80 },
      delay: { envio: -10, division: '1/8', feedback: 22, ducking: 92 },
      reverb: { tipo: 'sala', envio: -14, decay: 0.9, ducking: 70 },
      rider: { on: true, objetivo: 0, rango: 3, velocidad: 1 },
      base: { hueco: 3.5 },
    },
  },
  {
    id: 'radio', nombre: 'Efecto radio / teléfono', etiquetas: ['efecto', 'lo-fi'], delante: -2.5,
    descripcion: 'Voz filtrada y saturada, como por una radio vieja. Para intros, puentes o efectos.',
    params: {
      eq: { bandas: [{ f: 500, pendiente: 24 }, {}, { on: false }, {}, { f: 1800, q: 1.4, g: 5 }, {}, { on: false }, { on: true, f: 3500, pendiente: 24 }] },
      comp1: { tipo: 'fet', ratioFet: 'todos', entrada: 8, salida: -0.9 },
      comp2: { on: false },
      sat: { on: true, tipo: 'transistor', drive: 16, mezcla: 100, salida: -0.6 },
      deesser: { on: false },
      delay: { envio: -15, division: '1/8', feedback: 18, ducking: 70 },
      reverb: { tipo: 'sala', envio: -16, decay: 0.7, ducking: 50 },
      base: { hueco: 3 },
    },
  },
  {
    id: 'ensayo', nombre: 'Ensayo (neutro)', etiquetas: ['clase', 'práctica'], delante: -0.5,
    descripcion: 'Para escuchar tu técnica sin maquillaje: solo nivel, limpieza de graves y un toque de sala.',
    params: {
      eq: { bandas: [{ f: 80 }, {}, { g: 0 }, {}, { g: 0 }, {}, { g: 0 }] },
      comp1: { tipo: 'vca', umbral: -14, ratio: 2, rodilla: 8, ataque: 10, relajacion: 200 },
      comp2: { on: false },
      deesser: { on: false },
      delay: { on: false },
      reverb: { tipo: 'sala', envio: -16, decay: 0.8, ducking: 40 },
      base: { hueco: 3 },
    },
  },
];

/* Bases que dejas tú para tus alumnos (opcional). Pon los archivos en la carpeta `bases/`
 * y añádelos aquí. Ejemplo:
 *   { nombre: 'Ejercicio 1 · escalas en Do', archivo: 'bases/ejercicio1.mp3', bpm: 90 },
 */
window.VOX_BASES_ALERAN = [
];
