/* Lico travieso y reactivo (Agenda de Prácticos).
 * Adaptado del kit "Lico" del sistema Petición Cambio de Domicilio (lico-juegos.js), sin nada atado a Razor.
 *
 *  1) Travesuras por inactividad: tras IDLE_MS sin actividad, Lico hace una gracia a pie de pantalla
 *     ('toc' | 'pelota' | 'duerme' | 'domina'). Cualquier mouse/tecla/clic/scroll/toque la despide al instante.
 *  2) Gracias en la cabecera: al pulsar el Lico de #head-lico hace una gracia en su sitio
 *     (salta, gira, baila, toc, duerme, pelota, domina). El consejo de texto lo sigue dando app.js.
 *  3) Reacciones: LicoJuegos.reaccionar('celebra' | 'alerta') cambia unos segundos la pose del Lico de la cabecera
 *     (la llama toast() en app.js tras un logro o un error).
 *  4) Interruptor #lico-onoff: apaga/enciende todo lo animado. Se guarda en localStorage ('agenda-lico').
 *
 * Es solo decorativo (pointer-events: none), no aparece con la guía abierta, un cuadro de diálogo abierto, un
 * campo de texto en edición, la pestaña oculta ni si el sistema pide reducir movimiento.
 *
 * Requiere window.Lico.svg(pose) (lico.js) y los estilos .lico-travieso / .hl-* de styles.css.
 * Tiempo de inactividad: window.LICO_IDLE_MS (ms) ANTES de cargar este archivo (por defecto 90 000).
 * Desactivar del todo: window.LICO_JUEGOS = false antes de cargarlo.
 * Prueba manual: LicoJuegos.jugar('toc' | 'pelota' | 'duerme' | 'domina')
 */
(function () {
  'use strict';

  if (window.LICO_JUEGOS === false) return;

  var IDLE_MS = (window.LICO_IDLE_MS | 0) || 90000;
  var CLAVE = 'agenda-lico';          // localStorage: 'off' = desactivado
  var JUEGOS = {
    toc:    { pose: 'saluda',  ms: 7000,  texto: '¡Toc, toc! ¿Sigues ahí?' },
    pelota: { pose: 'celebra', ms: 9500,  texto: '¡Gooool!' },
    duerme: { pose: 'saluda',  ms: 16000, texto: 'Zzz… muévete para despertarme' },
    domina: { pose: 'saluda',  ms: 11000, texto: '¡Mira, no se me cae!' }
  };
  var IDS = Object.keys(JUEGOS);

  var el = null;
  var timerIdle = null;
  var timerFin = null;
  var timerLimpiar = null;
  var jugando = false;
  var inicioMs = 0;
  var manual = false;   // lanzada a mano (prueba): el mouse no la espanta, solo clic o tecla
  var ultimo = null;

  // ---- Interruptor persistido (con try/catch: localStorage puede fallar) ----
  var encendido = true;
  try { encendido = window.localStorage.getItem(CLAVE) !== 'off'; } catch (e) { encendido = true; }

  function reducido() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  // true si Lico puede moverse (interruptor encendido y sin "reducir movimiento")
  function animado() { return encendido && !reducido(); }

  function puedeAparecer() {
    if (document.hidden) return false;
    if (reducido()) return false;
    if (!window.Lico || typeof window.Lico.svg !== 'function') return false;
    if (document.getElementById('tour-overlay')) return false;                 // guía abierta
    var mr = document.getElementById('modal-root');
    if (mr && mr.children.length) return false;                                // cuadro de diálogo abierto
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.id !== 'bq') return false; // editando un campo
    return true;
  }

  // Ojos cerrados, boquita y gorro de dormir: se añaden al SVG de Lico y solo se ven mientras duerme (CSS).
  function ponerSueno(contenedor) {
    var cuerpo = contenedor && contenedor.querySelector('.lico-cuerpo');
    if (!cuerpo || cuerpo.querySelector('.lico-sueno')) return;
    cuerpo.insertAdjacentHTML('beforeend', '<g class="lico-sueno"><ellipse cx="90" cy="117" rx="25" ry="17" fill="#fff"/><path d="M57 92Q66 101 75 92M105 92Q114 101 123 92" stroke="#23262a" stroke-width="4.5" fill="none" stroke-linecap="round"/><ellipse cx="90" cy="114" rx="6" ry="5" fill="#e8503f" stroke="#23262a" stroke-width="2.5"/><path d="M30 24Q44 -2 98 1Q132 3 152 24Z" fill="#6d5bd0" stroke="#26388c" stroke-width="3" stroke-linejoin="round"/><circle cx="70" cy="12" r="3" fill="#f6d23c"/><circle cx="104" cy="10" r="3" fill="#f6d23c"/><rect x="24" y="20" width="132" height="13" rx="6.5" fill="#fff" stroke="#26388c" stroke-width="3"/><circle cx="156" cy="34" r="9" fill="#fff" stroke="#26388c" stroke-width="3"/></g>');
  }

  function crear() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'lico-travieso';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="lt-ondas"><span class="lt-onda"></span><span class="lt-onda"></span><span class="lt-onda"></span></div>' +
      '<div class="lt-pelota"><span class="lt-pelota-i"></span></div>' +
      '<div class="lt-lico">' +
        '<div class="lt-globo"></div>' +
        '<div class="lt-zzz"><b>z</b><b>z</b><b>Z</b></div>' +
        '<div class="lt-cuerpo"></div>' +
      '</div>';
    document.body.appendChild(el);
  }

  function programar(ms) {
    clearTimeout(timerIdle);
    if (!encendido) return;
    timerIdle = setTimeout(jugarAleatorio, ms || IDLE_MS);
  }

  function jugarAleatorio() {
    var candidatos = IDS.filter(function (id) { return id !== ultimo; });
    jugar(candidatos[Math.floor(Math.random() * candidatos.length)]);
  }

  function jugar(id, esManual) {
    var juego = JUEGOS[id];
    if (!juego || jugando) return;
    if (!esManual && !encendido) return;
    if (!puedeAparecer()) { programar(); return; }

    crear();
    clearTimeout(timerLimpiar);
    ultimo = id;
    jugando = true;
    manual = !!esManual;
    inicioMs = Date.now();

    el.querySelector('.lt-cuerpo').innerHTML = window.Lico.svg(juego.pose);
    ponerSueno(el.querySelector('.lt-cuerpo'));
    el.querySelector('.lt-globo').textContent = juego.texto;
    el.className = 'lico-travieso modo-' + id;
    void el.offsetWidth;                       // reinicia las animaciones CSS
    el.classList.add('activo');

    clearTimeout(timerFin);
    timerFin = setTimeout(function () { terminar(false); }, juego.ms);
  }

  function terminar(porActividad) {
    clearTimeout(timerFin);
    if (!jugando) return;
    jugando = false;
    if (el) el.classList.add('saliendo');
    timerLimpiar = setTimeout(function () {
      if (el) el.className = 'lico-travieso';
    }, 320);
    // Si se fue sola, la próxima travesura tarda el doble; si la ahuyentó el usuario, el tiempo normal.
    programar(porActividad ? IDLE_MS : IDLE_MS * 2);
  }

  function alHaberActividad(e) {
    // En prueba manual solo clic o tecla la despiden.
    if (jugando && manual && e && /^(mousemove|wheel|scroll)$/.test(e.type)) return;
    // Ignora los primeros 400 ms: el propio temblor del mouse al soltarlo no debe espantarla.
    if (jugando && Date.now() - inicioMs > 400) {
      terminar(true);
    } else if (!jugando) {
      programar();
    }
  }

  ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart', 'click', 'input'].forEach(function (ev) {
    window.addEventListener(ev, alHaberActividad, { passive: true, capture: true });
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (jugando) terminar(true); } else { programar(); }
  });

  // ---- Gracias del Lico de la cabecera (clic) ----
  var GRACIAS = [
    { cls: 'hl-salta',  ms: 1400 },
    { cls: 'hl-gira',   ms: 1500 },
    { cls: 'hl-baila',  ms: 2100 },
    { cls: 'hl-toc',    ms: 2200 },
    { cls: 'hl-duerme', ms: 3100 },
    { cls: 'hl-pelota', ms: 2600 },
    { cls: 'hl-domina', ms: 3100 }
  ];
  var ultimaGracia = -1;
  var timerGracia = null;
  var graciaActiva = false;

  function graciaLico(boton) {
    if (!animado()) return;
    var i;
    do { i = Math.floor(Math.random() * GRACIAS.length); } while (i === ultimaGracia);
    ultimaGracia = i;
    var g = GRACIAS[i];

    if (!boton.querySelector('.hl-bola')) {
      var bola = document.createElement('span');
      bola.className = 'hl-bola';
      bola.setAttribute('aria-hidden', 'true');
      boton.appendChild(bola);
    }
    ponerSueno(boton);
    clearTimeout(timerGracia);
    GRACIAS.forEach(function (x) { boton.classList.remove(x.cls); });
    void boton.offsetWidth;                    // reinicia la animación aunque se repita
    boton.classList.add(g.cls);
    graciaActiva = true;
    timerGracia = setTimeout(function () {
      boton.classList.remove(g.cls);
      graciaActiva = false;
    }, g.ms);
  }

  // Sin stopPropagation: el consejo de texto de app.js sigue funcionando.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.head-lico') : null;
    if (b) graciaLico(b);
  }, true);

  // ---- Reacción contextual: la pose del Lico de la cabecera cambia unos segundos ----
  var timerReac = null;
  function reaccionar(pose) {
    if (!animado() || graciaActiva || !window.Lico) return;
    if (pose !== 'celebra' && pose !== 'alerta') return;
    var btn = document.getElementById('head-lico');
    var cont = btn && btn.querySelector('[data-lico]');
    if (!cont) return;
    cont.innerHTML = window.Lico.svg(pose);
    if (pose === 'celebra') {
      btn.classList.remove('hl-salta');
      void btn.offsetWidth;
      btn.classList.add('hl-salta');
    }
    clearTimeout(timerReac);
    timerReac = setTimeout(function () {
      cont.innerHTML = window.Lico.svg('saluda');
      btn.classList.remove('hl-salta');
    }, 2800);
  }

  // ---- Interruptor ----
  function pintarInterruptor() {
    var b = document.getElementById('lico-onoff');
    if (!b) return;
    b.setAttribute('aria-pressed', encendido ? 'true' : 'false');
    b.classList.toggle('lico-off', !encendido);
    b.title = encendido ? 'Lico animado: activado (clic para desactivar)' : 'Lico animado: desactivado (clic para activar)';
    b.setAttribute('aria-label', b.title);
  }
  function activar(v) {
    encendido = !!v;
    try { window.localStorage.setItem(CLAVE, encendido ? 'on' : 'off'); } catch (e) { /* sin almacenamiento */ }
    if (!encendido) { if (jugando) terminar(true); clearTimeout(timerIdle); } else { programar(); }
    pintarInterruptor();
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('#lico-onoff') : null;
    if (b) activar(!encendido);
  });
  pintarInterruptor();

  window.LicoJuegos = {
    jugar: function (id) { clearTimeout(timerIdle); jugar(id, true); },
    terminar: function () { terminar(true); },
    reaccionar: reaccionar,
    activo: function () { return encendido; },
    animado: animado,
    activar: activar
  };

  programar();
})();
