"""Genera las 3 páginas SEO (borrador) con el mismo diseño que quiz.html.

Uso: py -X utf8 generar.py   → escribe clases-de-canto-*.html en la raíz de aleran-web.
Mientras sean borrador, están en .vercelignore y no se publican.
"""
import json
import os
import re

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = "https://www.aleranvocals.es"
quiz = open(os.path.join(RAIZ, "quiz.html"), encoding="utf-8").read()

cabeza = quiz[: quiz.index("</head>")]
cuerpo_ini = quiz[quiz.index("</head>") : quiz.index("</header>") + len("</header>")]
pie = quiz[quiz.index("<footer>") : quiz.index("  safe(function initQuiz(){")] + "</script>\n</body>\n</html>\n"

PAGINAS = {
    "murcia": "clases-de-canto-murcia.html",
    "online": "clases-de-canto-online.html",
    "metal": "clases-de-canto-metal.html",
}
TITULOS_CORTOS = {"murcia": "En Murcia", "online": "Online", "metal": "Canto metal"}

ESTILO = """
<style>
  .landing { padding: 130px 0 60px; }
  .landing .container { max-width: 820px; }
  .landing h1 { font-family: var(--font-display); font-weight: 500; font-size: clamp(2.1rem, 5vw, 3.2rem); line-height: 1.1; margin: 10px 0 18px; }
  .landing h1 em, .landing h2 em { color: var(--crimson-text); font-style: italic; }
  .landing h2 { font-family: var(--font-display); font-weight: 500; font-size: clamp(1.5rem, 3.4vw, 2rem); margin: 42px 0 12px; }
  .landing p, .landing li { color: var(--bone-dim); font-size: 1.02rem; margin-bottom: 14px; }
  .landing strong { color: var(--bone); font-weight: 500; }
  .landing ul { padding-left: 20px; margin-bottom: 14px; }
  .landing .lede { font-size: 1.12rem; color: var(--bone); }
  .landing .cta { display: flex; gap: 10px; flex-wrap: wrap; margin: 26px 0 8px; }
  .landing .planes-mini { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin: 14px 0; }
  .landing .plan-mini { border: 1px solid var(--line); background: var(--bg-panel); border-radius: 10px; padding: 14px; }
  .landing .plan-mini b { display: block; color: var(--bone); font-family: var(--font-display); font-size: 1.3rem; font-weight: 500; }
  .landing .plan-mini span { color: var(--crimson-text); font-family: var(--font-mono); font-size: .85rem; }
  .landing .plan-mini small { display: block; color: var(--muted); font-size: .85rem; margin-top: 4px; }
  .landing .otras { border-top: 1px solid var(--line); margin-top: 46px; padding-top: 18px; font-size: .95rem; }
  .landing .otras a, .landing p a { color: var(--crimson-text); }
  .landing figure { margin: 26px 0 30px; }
  .landing figure img { display: block; width: 100%; height: auto; max-height: 560px; object-fit: cover; border-radius: 12px; border: 1px solid var(--line); }
  .landing figure.vertical img { max-width: 440px; margin: 0 auto; max-height: none; }
  .landing figcaption { color: var(--muted); font-size: .8rem; margin-top: 8px; text-align: center; }
</style>
"""

PLANES = """
<div class="planes-mini">
  <div class="plan-mini"><b>Forja Vocal</b><span>25 € / sesión (1 h)</span><small>Clase suelta, sin permanencia</small></div>
  <div class="plan-mini"><b>Obsidiana</b><span>100 € / mes</span><small>4 sesiones de 1 hora</small></div>
  <div class="plan-mini"><b>Esmeralda</b><span>300 € / 3 meses</span><small>12 sesiones de 1 hora</small></div>
  <div class="plan-mini"><b>Rubí</b><span>600 € / 6 meses</span><small>24 sesiones de 1 hora</small></div>
</div>
<p>Los detalles de cada plan están en la <a href="/#planes">página principal</a>. ¿Dudas entre uno y otro? <a href="/quiz.html">Responde 4 preguntas</a> y te digo cuál encaja contigo.</p>
"""

CTA = """
<div class="cta">
  <a href="https://agenda.aleranvocals.es/reservar" target="_blank" rel="noopener" class="btn filled">Reservar mi clase</a>
  <a href="https://wa.me/34632926726?text=Hola%20Áleran,%20quiero%20información%20sobre%20las%20clases%20de%20canto" target="_blank" rel="noopener" class="btn whatsapp">Preguntar por WhatsApp</a>
</div>
"""

CONTENIDO = {
    "murcia": {
        "title": "Clases de canto en Murcia · Profesor de canto presencial · Áleran Vocals",
        "desc": "Clases de canto presenciales en Murcia, en un estudio con tratamiento acústico. Voz mixta, agudos sin tensión, rasgados y guturales con salud vocal. Desde cero o para pulir tu nivel.",
        "eyebrow": "Clases presenciales · Murcia",
        "h1": "Clases de canto en <em>Murcia</em>",
        "servicio": "Clases de canto presenciales en Murcia",
        "cuerpo": """
<p class="lede">Si buscas un profesor de canto en Murcia que te enseñe técnica de verdad, con explicaciones claras y sin poner en riesgo tu voz, estás en el sitio correcto. Soy Áleran, cantante y vocal coach, y doy clases presenciales en mi estudio de Murcia.</p>

<h2>Un estudio pensado para la <em>voz</em></h2>
<p>Las clases son en un estudio con tratamiento acústico y equipo profesional. Eso importa más de lo que parece: en una sala que no rebota, oyes tu voz tal como es, y yo oigo cada detalle. Si en algún momento quieres grabarte, ya estás en el sitio.</p>

<h2>Qué vas a trabajar</h2>
<p>El canto, para mí, tiene cuatro capas, y las vamos construyendo en orden:</p>
<ul>
  <li><strong>Mecanismos vocales:</strong> voz de pecho, voz de cabeza y, uniéndolas, la voz mixta. Es lo que te deja llegar a los agudos con fuerza, sin gritar ni pasarte a falsete.</li>
  <li><strong>Colocaciones:</strong> el color de tu voz. El twang, la voz cubierta, la voz al frente… son como los ecualizadores de una guitarra.</li>
  <li><strong>Adornos:</strong> vibrato, glissando, melismas. Lo que hace que una frase suene a cantante y no a lectura.</li>
  <li><strong>Efectos:</strong> distorsiones, rasgados y guturales, cuando la base ya está firme.</li>
</ul>
<p>Y por debajo de todo, la salud vocal. Si algo duele, no se hace. Mientras más sube la nota, más suelta tiene que estar la voz, no más apretada.</p>

<h2>¿Para quién son?</h2>
<p>Para cualquiera que quiera cantar mejor. Trabajo desde cero con personas que nunca han cantado y con cantantes con experiencia que necesitan pulir su rendimiento: preparar un concierto, una grabación o simplemente dejar de quedarse sin voz al segundo tema.</p>
<p>Las canciones no son el objetivo, son la excusa: la técnica se trabaja sobre canciones que te gustan, para que lo que aprendes lo notes donde importa.</p>

<h2>Cómo es una clase</h2>
<p>Una hora. Primero te escucho y vemos qué tienes bien y qué conviene mejorar. Después, ejercicios concretos para eso, y al final lo aplicamos a una frase de verdad. Te vas con tareas claras para practicar en casa y con acceso a mis herramientas de práctica (afinador, piano, metrónomo, ejercicios) en <a href="/herramientas/guia.html">Práctica Vocal</a>.</p>
<p>No te voy a prometer que cantarás como tu ídolo en treinta días. El canto es memoria muscular y el cuerpo aprende a su ritmo. Lo que sí te prometo es un camino claro y que cada clase sepas por qué haces lo que haces.</p>

<h2>Planes y precios</h2>
""",
    },
    "online": {
        "title": "Clases de canto online · Vocal coach online desde España y Latinoamérica · Áleran Vocals",
        "desc": "Clases de canto online en directo, desde cualquier país. Técnica vocal con salud: voz mixta, agudos, afinación, vibrato, rasgados y guturales. Reserva tu horario sin esperas.",
        "eyebrow": "Clases en directo · Desde cualquier país",
        "h1": "Clases de canto <em>online</em>",
        "servicio": "Clases de canto online",
        "cuerpo": """
<p class="lede">Clases de canto online en directo, una persona y una hora, con la misma precisión que en el estudio. Da igual si estás en España, en Colombia, en México o en Canadá: si tienes conexión, tenemos clase.</p>

<h2>¿De verdad funciona online?</h2>
<p>Sí, si se hace bien. Las clases se dan con audio de alta fidelidad, así que oigo tu voz con detalle: dónde aprietas, dónde se escapa el aire, dónde se quiebra. Y tú me oyes a mí demostrando cada ejercicio, que en canto es media clase.</p>
<p>Además, online tiene una ventaja: practicas en el mismo sitio donde vas a practicar solo. Lo que encuentras en clase lo puedes repetir esa misma tarde, en la misma silla.</p>

<h2>Qué necesitas</h2>
<ul>
  <li>Un ordenador o un móvil con conexión estable.</li>
  <li>Auriculares, para que tu voz y la mía no se mezclen.</li>
  <li>Un rincón donde puedas cantar sin miedo a los vecinos. (Ese miedo también lo trabajamos.)</li>
</ul>

<h2>Qué vas a trabajar</h2>
<p>Lo mismo que en una clase presencial, por capas y en orden:</p>
<ul>
  <li><strong>Voz de pecho, voz de cabeza y voz mixta,</strong> para llegar a los agudos sin gritar.</li>
  <li><strong>Colocaciones</strong> como el twang o la voz cubierta, que le dan color y potencia a tu voz.</li>
  <li><strong>Afinación y vibrato,</strong> los primeros indicios de que alguien canta bien.</li>
  <li><strong>Rasgados y guturales,</strong> sin dañar la garganta, cuando la base está firme.</li>
</ul>

<h2>Entre clase y clase no estás solo</h2>
<p>Después de cada clase tienes tareas claras y mis herramientas de práctica en <a href="/herramientas/guia.html">Práctica Vocal</a>: afinador, piano, metrónomo, ejercicios de oído y de ritmo. Y si te surge una duda, me escribes y la vemos.</p>

<h2>Horarios</h2>
<p>En la <a href="https://agenda.aleranvocals.es/reservar" target="_blank" rel="noopener">agenda</a> ves los huecos libres y eliges el que te venga bien. Si vives en Latinoamérica y no sabes qué franja te cuadra, escríbeme por WhatsApp y lo miramos.</p>

<h2>Planes y precios</h2>
""",
    },
    "metal": {
        "title": "Clases de canto metal · Aprender guturales y rasgados con salud vocal · Áleran Vocals",
        "desc": "Aprende a cantar metal: guturales, rasgados, voz limpia potente y agudos de heavy y power metal, sin dañar tu voz. Clases con Áleran, vocalista de metal. Presencial en Murcia u online.",
        "eyebrow": "Voces extremas · Heavy · Power · Death",
        "h1": "Clases de canto <em>metal</em>: guturales y rasgados",
        "servicio": "Clases de canto metal: guturales, rasgados y voz limpia",
        "cuerpo": """
<p class="lede">Quieres sacar un gutural que retumbe, un rasgado que corte o esos agudos de power metal que parecen imposibles. Y quieres poder cantar el concierto entero y seguir teniendo voz al día siguiente. Para eso son estas clases.</p>

<h2>Te enseña alguien que lo <em>canta</em></h2>
<p>Soy Áleran. Canto metal desde hace años: fui vocalista de Darkness, hoy canto en Ángel Negro y tengo mi proyecto propio, ÁLERAN, de power metal sinfónico. Hago voz limpia de tenor, rasgado tipo black metal y gutural profundo. Todo lo que te enseño lo uso yo en el escenario y en el estudio.</p>

<h2>Gutural y rasgado no son lo mismo</h2>
<p>Cada uno tiene su posición y su forma de hacerse. Mucha gente se hace daño porque intenta los dos igual, a base de apretar. Aquí se trabaja al revés: el sonido sale con poco esfuerzo, y si pica, raspa o duele, paramos y buscamos otra forma. Hay maneras de hacer gutural que, por bueno que seas, siempre te van a doler: esas se descartan desde el principio.</p>

<h2>El orden importa</h2>
<p>Las voces extremas no son lo primero que se aprende, y no te voy a mentir con eso. Primero se asienta la base: respiración, voz de pecho, voz de cabeza, voz mixta y twang. Con esa base, los efectos salen antes y, sobre todo, sin romperte. Si ya tienes la base, vamos directos.</p>
<ul>
  <li><strong>Gutural:</strong> grave, oscuro y estable, sin forzar las cuerdas vocales.</li>
  <li><strong>Rasgado:</strong> de la distorsión suave del hard rock al rasgado agudo del black metal.</li>
  <li><strong>Voz limpia de metal:</strong> agudos de heavy y power con cuerpo, voz mixta y vibrato.</li>
  <li><strong>Resistencia:</strong> cantar un concierto entero, o una sesión de grabación, sin quedarte afónico.</li>
</ul>

<h2>Con canciones que te gustan</h2>
<p>Las canciones no son el objetivo, son la excusa. Trabajamos la técnica sobre los temas que quieres cantar, de lo que escuches: heavy, power, thrash, melodic death, black. Para que lo que aprendes lo notes en tu música, no solo en un ejercicio.</p>

<h2>Presencial o online</h2>
<p>Puedes venir a mi estudio en <a href="/clases-de-canto-murcia.html">Murcia</a> o hacer las clases <a href="/clases-de-canto-online.html">online</a> desde cualquier país, con audio de alta fidelidad.</p>

<h2>Planes y precios</h2>
""",
    },
}


def figura(src, ancho, alto, alt, credito=None, vertical=False):
    clase = ' class="vertical"' if vertical else ""
    pie = f"<figcaption>{credito}</figcaption>" if credito else ""
    return (f'<figure{clase}><img src="/{src}" width="{ancho}" height="{alto}" alt="{alt}" loading="lazy" decoding="async">{pie}</figure>\n')


FOTOS = {
    # clave: [(después de qué texto, figura)]
    "murcia": [("</p>", figura("foto-directo-angel-negro.webp", 900, 599,
        "Áleran cantando en directo con Ángel Negro, micrófono en mano", "Áleran en directo con Ángel Negro · Foto: @cromfotografia"))],
    "online": [("</p>", figura("foto-alera-coach-movil.webp", 900, 1127,
        "Áleran, vocal coach, profesor de canto online", None, vertical=True))],
    "metal": [
        ("</p>", figura("foto-canto-metal.webp", 640, 960,
            "Áleran haciendo un gutural en directo, con cadenas y micrófono", "Foto: Harold Pineda · Metal Machine", vertical=True)),
        ("<h2>Gutural y rasgado no son lo mismo</h2>", figura("foto-canto-extremo.webp", 610, 960,
            "Áleran con pintura de guerra cantando voces extremas en directo", None, vertical=True)),
    ],
}


def json_ld(clave, c, url):
    datos = {
        "@context": "https://schema.org",
        "@type": "Service",
        "name": c["servicio"],
        "serviceType": "Clases de canto",
        "url": url,
        "description": c["desc"],
        "provider": {"@type": "Person", "name": "Áleran", "url": WEB + "/"},
        "image": WEB + "/" + FOTOS[clave][0][1].split('src="/')[1].split('"')[0],
        "areaServed": ({"@type": "City", "name": "Murcia"} if clave == "murcia" else "Online"),
        "offers": [
            {"@type": "Offer", "name": "Forja Vocal", "price": "25", "priceCurrency": "EUR"},
            {"@type": "Offer", "name": "Obsidiana", "price": "100", "priceCurrency": "EUR"},
            {"@type": "Offer", "name": "Esmeralda", "price": "300", "priceCurrency": "EUR"},
            {"@type": "Offer", "name": "Rubí", "price": "600", "priceCurrency": "EUR"},
        ],
    }
    return '<script type="application/ld+json">\n' + json.dumps(datos, ensure_ascii=False, indent=2) + "\n</script>\n"


for clave, archivo in PAGINAS.items():
    c = dict(CONTENIDO[clave])
    for ancla, fig in FOTOS.get(clave, []):
        if ancla == "</p>":
            c["cuerpo"] = c["cuerpo"].replace("</p>", "</p>\n" + fig, 1)  # justo tras la entradilla
        else:
            c["cuerpo"] = c["cuerpo"].replace(ancla, ancla + "\n" + fig, 1)
    url = f"{WEB}/{archivo}"
    h = cabeza
    h = re.sub(r"<title>.*?</title>", f"<title>{c['title']}</title>", h, count=1, flags=re.S)
    h = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{c["desc"]}">', h, count=1)
    h = h.replace(f"{WEB}/quiz.html", url)
    h = re.sub(r'(<meta property="og:title" content=")[^"]*', r"\g<1>" + c["title"], h)
    h = re.sub(r'(<meta name="twitter:title" content=")[^"]*', r"\g<1>" + c["title"], h)
    h = re.sub(r'(<meta property="og:description" content=")[^"]*', r"\g<1>" + c["desc"], h)
    h = re.sub(r'(<meta name="twitter:description" content=")[^"]*', r"\g<1>" + c["desc"], h)
    h += json_ld(clave, c, url) + ESTILO
    ini = cuerpo_ini.replace('<a href="/quiz.html" class="active">', '<a href="/quiz.html">')
    otras = " · ".join(
        f'<a href="/{PAGINAS[k]}">Clases de canto {TITULOS_CORTOS[k].lower() if k != "metal" else "metal"}</a>'
        for k in PAGINAS
        if k != clave
    )
    seccion = (
        '\n<main class="landing">\n  <div class="container">\n'
        f'    <span class="eyebrow">{c["eyebrow"]}</span>\n'
        f'    <h1>{c["h1"]}</h1>\n'
        + c["cuerpo"]
        + PLANES
        + CTA
        + f'    <p class="otras">También: {otras} · <a href="/">Volver a la portada</a></p>\n'
        + "  </div>\n</main>\n"
    )
    html = h + ini + seccion + pie
    open(os.path.join(RAIZ, archivo), "w", encoding="utf-8").write(html)
    texto = re.sub(r"<[^>]+>", " ", c["cuerpo"])
    print(archivo, len(texto.split()), "palabras")
