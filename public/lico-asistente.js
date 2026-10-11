/* Lico asistente (Agenda de Prácticos): burbuja de la cabecera con consejos según el estado de la app,
 * resumen del día, hitos celebrados una vez al día, pistas de los toasts y atajo Alt+L.
 *
 * - Lógica pura (consejos, resumen, hitos, "una vez al día") exportada para Node: test/lico.test.js.
 * - En el navegador expone window.LicoAsistente; app.js llama a LicoAsistente.iniciar(deps).
 * - Respeta el interruptor de Lico (LicoJuegos.activo()) y el de "consejos automáticos"
 *   (#lico-consejos, localStorage 'agenda-lico-consejos' = 'off').
 * - Todo el texto se inserta con textContent (nunca HTML con datos).
 */
(function () {
  'use strict';

  var FRASES_LICO = [
    'Pulsa "Cómo usar el sistema" y te llevo de paseo por todas las pestañas.',
    'El buscador de arriba encuentra por RUT, nombre o teléfono. Con 3 caracteres basta.',
    'Si un bloque se libera o se pisa, la cita no se pierde: queda en la Papelera.',
    'Las clases D y A5 solo van en su bloque especial. Yo no hago las reglas, pero las cumplo.',
    'Antes de importar un Excel con "Reemplazar todo", respira hondo. Es irreversible.',
    'El tema oscuro existe. Tus ojos de la tarde te lo agradecerán.',
    'Un RUT con dígito verificador incorrecto no pasa. Ni conmigo de abogado.',
    'En Reagendar, "Ver bloques libres" te muestra dónde hay cupo antes de mover a alguien.',
    'Si pulsas de nuevo el resultado activo (Aprobó, Reprobó...), se borra. Así de simple.',
    'Mi licencia está al día. ¿Y la tuya?',
    'Revisa el teléfono y el correo del postulante: sin ellos no puedo avisarle de nada.',
    'Cada bloque libre es un postulante más cerca de su licencia. Sin presión.',
    'Alt+L me llama desde cualquier pestaña.'
  ];
  // Claves = data-tab del menú (index.html)
  var FRASES_TAB = {
    disponibles: ['Aquí ves los bloques libres. Filtra por clase de licencia antes de ofrecer una hora.', 'Un clic en un bloque libre abre el formulario de agendamiento. Revisa teléfono y correo.'],
    agenda: ['Agenda: marca Aprobó, Reprobó o No asistió. Si te equivocas, pulsa de nuevo el resultado y se borra.', 'Bloquear un día o un tramo horario sin cita es un solo paso. Pon siempre el motivo.'],
    reagendar: ['Reagendar: elige primero a la persona y mira los bloques libres antes de mover a nadie.', 'Quien no asistió o fue derivado aparece aquí. Que nadie se quede sin nueva hora.'],
    porconfirmar: ['Por confirmar en cero es mi estado favorito. Hasta confeti sale.', 'Confirmar asistencia a tiempo evita bloques vacíos el día del examen.'],
    vencimientos: ['Por vencer: atiende primero los trámites con menos días restantes.', 'Un trámite vencido obliga a empezar de nuevo. Avisa con tiempo al postulante.'],
    dia: ['Agenda del día: elige formato y orientación antes de imprimir. Yo desaparezco al imprimir.', 'Revisa el diseño (hoja única o por examinador) según cómo lo vayan a leer en sala.'],
    analitica: ['Estadísticas: compara períodos con calma. Los números cuentan una historia.', 'Si el rango no muestra datos, prueba ampliar las fechas.'],
    papelera: ['La Papelera guarda las citas liberadas. Restaurar es mejor que volver a digitar.', 'Vaciar la Papelera es definitivo. Respira hondo antes de pulsar.'],
    datos: ['Datos: haz un backup antes de importar un Excel. Con "Reemplazar todo" no hay vuelta atrás.', 'Generar la grilla crea bloques solo en días hábiles. Revisa el rango.'],
    errores: ['El Reporte de errores vacío es una obra de arte administrativa.', 'Cada error trae su detalle: corrige el dato en origen y desaparece del reporte.']
  };

  var DIAS_POR_VENCER = 14;
  var META_APROBADOS = 100;
  var MAX_PISTA = 80;

  // ================= lógica pura =================
  var num = function (x) { var v = Number(x); return v > 0 ? Math.floor(v) : 0; };
  var plural = function (k, uno, varios) { return k + ' ' + (k === 1 ? uno : varios); };

  // Consejos ordenados por prioridad a partir de los contadores de la app.
  function consejosDesde(c) {
    c = c || {};
    var lista = [];
    var add = function (id, k, texto, tab, boton) { if (k > 0) lista.push({ id: id, texto: texto, tab: tab, boton: boton }); };
    var pc = num(c.porconfirmar), ve = num(c.porVencer), st = num(c.sinTramiteHoy), re = num(c.reagendar), er = num(c.errores);
    add('porconfirmar', pc, 'Tienes ' + plural(pc, 'cita', 'citas') + ' por confirmar en los próximos 7 días.', 'porconfirmar', 'Ir a Por confirmar');
    add('vencer', ve, (ve === 1 ? '1 trámite vence' : ve + ' trámites vencen') + ' en ' + DIAS_POR_VENCER + ' días o menos.', 'vencimientos', 'Ir a Por vencer');
    add('sintramite', st, 'Hoy hay ' + plural(st, 'cita', 'citas') + ' sin fecha de inicio de trámite.', 'agenda', 'Ir a Agenda');
    add('reagendar', re, plural(re, 'persona espera', 'personas esperan') + ' nueva hora en Reagendar.', 'reagendar', 'Ir a Reagendar');
    add('errores', er, 'El Reporte de errores tiene ' + plural(er, 'hallazgo', 'hallazgos') + ' por revisar.', 'errores', 'Ir a Reporte de errores');
    return lista;
  }

  // El consejo más prioritario distinto del último mostrado (para no repetir); null si no hay.
  function elegirConsejo(c, ultimoId) {
    var lista = consejosDesde(c);
    if (!lista.length) return null;
    for (var i = 0; i < lista.length; i++) if (lista[i].id !== ultimoId) return lista[i];
    return lista[0];
  }

  function saludoHora(hora) {
    return hora < 12 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
  }

  function resumenDiario(c, hora) {
    c = c || {};
    return saludoHora(hora) + '. Hoy: ' + plural(num(c.examenesHoy), 'examen', 'exámenes') + ', ' +
      num(c.porconfirmar) + ' por confirmar, ' + plural(num(c.porVencer), 'trámite', 'trámites') + ' por vencer.';
  }

  function fechaLocal(d) {
    d = d || new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // true la primera vez del día para `clave` (y lo anota); false después o sin almacenamiento.
  function unaVezAlDia(store, clave, fecha) {
    try {
      if (!store || store.getItem(clave) === fecha) return false;
      store.setItem(clave, fecha);
      return true;
    } catch (e) { return false; }
  }

  // Hitos alcanzados al pasar de `prev` a `act`. Los "a cero" exigen haber visto antes un valor > 0.
  function hitosAlcanzados(prev, act) {
    prev = prev || {}; act = act || {};
    var r = [];
    var aCero = function (k) { return num(prev[k]) > 0 && act[k] === 0; };
    if (aCero('porconfirmar')) r.push({ id: 'porconfirmar0', texto: '¡Por confirmar en cero! Todo el mundo sabe a qué hora viene.' });
    if (aCero('errores')) r.push({ id: 'errores0', texto: '¡Reporte de errores en cero! Una obra de arte administrativa.' });
    if (num(act.aprobadosMes) >= META_APROBADOS) r.push({ id: 'aprobados100', texto: '¡Ya van ' + num(act.aprobadosMes) + ' aprobados este mes! Mucha licencia nueva en la calle.' });
    return r;
  }

  function recortar(txt, max) {
    max = max || MAX_PISTA;
    var s = String(txt == null ? '' : txt).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
  }

  function frasePara(tab, rnd) {
    var propias = FRASES_TAB[tab] || [];
    var pool = FRASES_LICO.concat(propias, propias); // las de la pestaña pesan el doble
    return pool[Math.floor((rnd == null ? Math.random() : rnd) * pool.length) % pool.length];
  }

  var puro = {
    FRASES_LICO: FRASES_LICO, FRASES_TAB: FRASES_TAB,
    consejosDesde: consejosDesde, elegirConsejo: elegirConsejo, saludoHora: saludoHora,
    resumenDiario: resumenDiario, fechaLocal: fechaLocal, unaVezAlDia: unaVezAlDia,
    hitosAlcanzados: hitosAlcanzados, recortar: recortar, frasePara: frasePara
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = puro;
  if (typeof window === 'undefined') return;

  // ================= navegador =================
  var CLAVE_CONSEJOS = 'agenda-lico-consejos';
  var CLAVE_RESUMEN = 'agenda-lico-resumen';
  var CLAVE_HITO = 'agenda-lico-hito-';
  var CACHE_MS = 60e3;

  var dep = null, btn = null, burbuja = null, timer = null;
  var cache = null, ultimoConsejo = null, ultimaFrase = '', vistos = {};

  var store = function () { try { return window.localStorage; } catch (e) { return null; } };
  var licoActivo = function () { return !window.LicoJuegos || window.LicoJuegos.activo(); };
  function consejosAuto() {
    try { return window.localStorage.getItem(CLAVE_CONSEJOS) !== 'off'; } catch (e) { return true; }
  }
  var automatico = function () { return licoActivo() && consejosAuto(); };
  var reducido = function () { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); };

  // ---- contadores (cache 60 s; los fallos cuentan como "sin dato") ----
  async function contar() {
    if (cache && Date.now() - cache.t < CACHE_MS) return cache.c;
    var hoy = dep.hoy(), hasta7 = dep.sumarDias(hoy, 7);
    var pedir = function (p, ms) { return dep.apiReciente(p, ms || CACHE_MS).catch(function () { return null; }); };
    var r = await Promise.all([
      pedir('/agenda?estado=porconfirmar', 30e3), pedir('/cola-reagendar', 30e3), pedir('/agenda?estado=pendiente', 30e3),
      pedir('/errores'), pedir('/tramites-por-vencer?filtro=30'), pedir('/agenda?fecha=' + hoy)
    ]);
    var ocupadasHoy = Array.isArray(r[5]) ? r[5].filter(function (b) { return !b.bloqueado && (b.rut || b.nombre); }) : null;
    var c = {
      porconfirmar: Array.isArray(r[0]) ? r[0].filter(function (x) { return x.fecha >= hoy && x.fecha <= hasta7; }).length : null,
      reagendar: Array.isArray(r[1]) || Array.isArray(r[2]) ? (r[1] || []).length + (r[2] || []).length : null,
      errores: r[3] && Array.isArray(r[3].hallazgos) ? r[3].hallazgos.filter(function (h) { return h.severidad !== 'info'; }).length : null,
      porVencer: Array.isArray(r[4]) ? r[4].filter(function (x) { return x.dias_restantes_tramite <= DIAS_POR_VENCER; }).length : null,
      examenesHoy: ocupadasHoy ? ocupadasHoy.length : null,
      sinTramiteHoy: ocupadasHoy ? ocupadasHoy.filter(function (b) { return !b.fecha_inicio_tramite; }).length : null
    };
    cache = { t: Date.now(), c: c };
    return c;
  }

  // ---- burbuja ----
  function cerrar(devolverFoco) {
    clearTimeout(timer);
    if (!burbuja || burbuja.hidden) return;
    var teniaFoco = burbuja.contains(document.activeElement);
    burbuja.hidden = true;
    btn.classList.remove('habla');
    if (devolverFoco || teniaFoco) btn.focus();
  }
  function programarCierre(ms) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (burbuja.contains(document.activeElement)) { programarCierre(4000); return; } // no cerrar con el foco dentro
      cerrar(false);
    }, ms);
  }
  // accion opcional: { boton: 'Ir a ...', tab: 'porconfirmar' }
  function decir(txt, ms, accion) {
    if (!burbuja) return;
    burbuja.textContent = '';
    var p = document.createElement('span');
    p.textContent = txt;
    burbuja.appendChild(p);
    if (accion && accion.tab && accion.boton) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'head-lico-ir';
      b.textContent = accion.boton + ' →';
      b.addEventListener('click', function () { cerrar(true); dep.irA(accion.tab); });
      burbuja.appendChild(b);
    }
    burbuja.hidden = false;
    btn.classList.add('habla');
    programarCierre(ms || (accion ? 12000 : 7000));
  }

  function tabActual() { return (location.hash.slice(1) || 'disponibles').split('?')[0]; }

  // Clic o Alt+L: primero un consejo según el estado; si no hay (o ya se dio), una frase.
  async function pedirConsejo() {
    var c = null;
    try { c = await contar(); } catch (e) { c = null; }
    var tip = c ? elegirConsejo(c, ultimoConsejo) : null;
    if (tip && tip.id !== ultimoConsejo) {
      ultimoConsejo = tip.id;
      decir(tip.texto, 0, tip);
      return;
    }
    ultimoConsejo = null; // la próxima vez vuelve a dar consejos
    var f, intentos = 0;
    do { f = frasePara(tabActual()); } while (f === ultimaFrase && ++intentos < 5);
    ultimaFrase = f;
    decir(f, 7000);
  }

  // ---- hitos (una vez al día cada uno) ----
  function celebrar(hito) {
    if (!licoActivo() || !unaVezAlDia(store(), CLAVE_HITO + hito.id, fechaLocal())) return;
    // 'Por confirmar' ya lanza su propio confeti en la tabla al quedar vacia: no duplicar.
    if (!reducido() && dep.licoConfeti && hito.id !== 'porconfirmar0') dep.licoConfeti(btn);
    if (window.LicoJuegos) window.LicoJuegos.reaccionar('celebra');
    if (consejosAuto()) decir(hito.texto, 6000);
  }
  // app.js informa contadores reales (solo en caminos de éxito)
  function notar(clave, n) {
    if (typeof n !== 'number') return;
    var prev = {}; prev[clave] = vistos[clave];
    var act = {}; act[clave] = n;
    vistos[clave] = n;
    hitosAlcanzados(prev, act).forEach(celebrar);
  }
  async function revisarAprobadosMes() {
    if (!licoActivo()) return;
    var hoy = dep.hoy();
    try { if (store() && store().getItem(CLAVE_HITO + 'aprobados100') === fechaLocal()) return; } catch (e) { return; }
    try {
      var a = await dep.apiReciente('/analitica?desde=' + hoy.slice(0, 8) + '01&hasta=' + hoy, 5 * CACHE_MS);
      var k = a && a.kpis ? a.kpis.aprobados : 0;
      hitosAlcanzados({}, { aprobadosMes: k }).forEach(celebrar);
    } catch (e) { /* silencioso */ }
  }

  // ---- toasts: pista breve con el texto del aviso ----
  function explicar(msg) {
    if (!automatico() || !burbuja || document.getElementById('tour-overlay')) return;
    decir(recortar(msg), 4500);
  }

  // ---- interruptor "consejos automáticos" ----
  function pintarConsejos() {
    var b = document.getElementById('lico-consejos');
    if (!b) return;
    var on = consejosAuto();
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.classList.toggle('lico-off', !on);
    b.title = on ? 'Consejos automáticos de Lico: activados (clic para desactivar)' : 'Consejos automáticos de Lico: desactivados (clic para activar)';
    b.setAttribute('aria-label', b.title);
  }
  function alternarConsejos() {
    var on = !consejosAuto();
    try { window.localStorage.setItem(CLAVE_CONSEJOS, on ? 'on' : 'off'); } catch (e) { /* sin almacenamiento */ }
    if (!on) cerrar(false);
    pintarConsejos();
  }

  // ---- saludo / resumen del día ----
  async function saludar() {
    if (!automatico()) return;
    var hora = new Date().getHours();
    var texto;
    if (unaVezAlDia(store(), CLAVE_RESUMEN, fechaLocal())) {
      var c = await contar().catch(function () { return {}; });
      texto = resumenDiario(c, hora);
    } else {
      try {
        if (window.sessionStorage.getItem('agenda-lico-saludo')) return;
        window.sessionStorage.setItem('agenda-lico-saludo', '1');
      } catch (e) { return; }
      texto = saludoHora(hora) + '. Soy Lico. Pulsa mi carita (o Alt+L) cuando quieras un consejo.';
    }
    try { window.sessionStorage.setItem('agenda-lico-saludo', '1'); } catch (e) { /* nada */ }
    if (burbuja.hidden && !document.getElementById('tour-overlay') && automatico()) decir(texto, 8000);
  }

  function iniciar(deps) {
    dep = deps;
    btn = document.getElementById('head-lico');
    burbuja = document.getElementById('head-lico-burbuja');
    pintarConsejos();
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('#lico-consejos')) alternarConsejos();
    });
    if (!btn || !burbuja) return;
    btn.addEventListener('click', pedirConsejo);
    document.addEventListener('keydown', function (e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        pedirConsejo();
      } else if (e.key === 'Escape' && !burbuja.hidden) {
        cerrar(true);
      }
    });
    document.addEventListener('click', function (e) {
      if (!burbuja.hidden && !(e.target.closest && e.target.closest('.head-lico-wrap'))) cerrar(false);
    });
    document.addEventListener('lico:cambio', function () { if (!licoActivo()) cerrar(false); });
    setTimeout(function () { saludar().catch(function () {}); revisarAprobadosMes(); }, 1500);
  }

  window.LicoAsistente = { iniciar: iniciar, notar: notar, explicar: explicar, decir: decir, pedirConsejo: pedirConsejo, _puro: puro };
})();
