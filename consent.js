/* Consentimiento de cookies de aleranvocals.es.
 * Google Analytics solo se carga si la persona pulsa «Aceptar». La elección se guarda en este navegador
 * (localStorage «aleran-consent») durante 12 meses y se puede cambiar en cualquier momento desde /cookies.html.
 */
(function () {
  var GA_ID = "G-LZRJ0C776T";
  var CLAVE = "aleran-consent";
  var VIGENCIA_MS = 365 * 24 * 3600 * 1000;

  function leer() {
    try {
      var v = JSON.parse(localStorage.getItem(CLAVE) || "null");
      if (v && v.t && Date.now() - v.t < VIGENCIA_MS && (v.e === "granted" || v.e === "denied")) return v.e;
    } catch (e) {}
    return null;
  }
  function guardar(e) {
    try { localStorage.setItem(CLAVE, JSON.stringify({ e: e, t: Date.now() })); } catch (err) {}
  }

  function cargarAnalytics() {
    if (window.__gaCargado) return;
    window.__gaCargado = true;
    window["ga-disable-" + GA_ID] = false;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID, { anonymize_ip: true });
  }
  function apagarAnalytics() {
    window["ga-disable-" + GA_ID] = true;
    document.cookie.split(";").forEach(function (c) {
      var n = c.split("=")[0].trim();
      if (n === "_ga" || n.indexOf("_ga_") === 0 || n === "_gid") {
        var host = location.hostname.replace(/^www\./, "");
        [location.hostname, "." + host].forEach(function (d) {
          document.cookie = n + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=" + d;
        });
      }
    });
  }

  function elegir(e) {
    guardar(e);
    if (e === "granted") cargarAnalytics(); else apagarAnalytics();
    quitarBanner();
  }

  var banner = null;
  function quitarBanner() { if (banner) { banner.remove(); banner = null; } }
  function mostrarBanner() {
    if (banner) return;
    banner = document.createElement("div");
    banner.className = "aviso-cookies";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Cookies");
    banner.innerHTML =
      '<p>Uso cookies de analítica (Google Analytics) para saber qué páginas se visitan. Solo se activan si las aceptas. <a href="/cookies.html">Más información</a></p>' +
      '<div class="aviso-cookies-botones"><button type="button" data-e="denied">Rechazar</button><button type="button" data-e="granted">Aceptar</button></div>';
    banner.addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-e]");
      if (b) elegir(b.dataset.e);
    });
    document.body.appendChild(banner);
  }

  var css = document.createElement("style");
  css.textContent =
    ".aviso-cookies{position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:640px;margin:0 auto;padding:14px 16px;border-radius:12px;background:#120e0e;border:1px solid #3a2a2a;color:#f2e9e4;font:400 14px/1.45 system-ui,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.55);display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between}" +
    ".aviso-cookies p{margin:0;flex:1 1 280px}.aviso-cookies a{color:#e2597a;text-decoration:underline}" +
    ".aviso-cookies-botones{display:flex;gap:8px}" +
    ".aviso-cookies button{min-height:40px;padding:0 18px;border-radius:8px;border:1px solid #93172c;background:#1a1414;color:#f2e9e4;font:600 14px system-ui,sans-serif;cursor:pointer}" +
    ".aviso-cookies button[data-e=granted]{background:#93172c}.aviso-cookies button:focus-visible{outline:2px solid #e2597a;outline-offset:2px}";
  document.head.appendChild(css);

  window.AleranConsent = { estado: leer, elegir: elegir, preguntar: function () { mostrarBanner(); } };

  var e = leer();
  if (e === "granted") cargarAnalytics();
  else if (e === "denied") window["ga-disable-" + GA_ID] = true;
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mostrarBanner);
  else mostrarBanner();
})();
