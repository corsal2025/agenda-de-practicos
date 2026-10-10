'use strict';

/* ================= helpers ================= */
// Clases D y A5: llevan escuela de conductores. La vigencia del tramite (6 meses) aplica a todas.
const esClaseTramite = (clase) => String(clase || '').split(',').some((c) => ['D', 'A5'].includes(c.trim()));
const alertasHtml = (b) => (b.alerts || []).map((t) => `<span class="badge reprob" title="${esc(t)}">⚠ ${esc(t)}</span>`).join(' ');

// Vigencia del tramite D/A5 en el cliente (misma regla que el servidor: vence a los 6 meses,
// aritmetica solo de fechas en UTC para no correr un dia por la zona horaria).
const MS_DIA = 86400000;
const isoUTC = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
function sumarMesesISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const ult = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, ult))).toISOString().slice(0, 10);
}
function vigenciaTramiteCli(inicio, hoyIso = hoy()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio || '')) return null;
  const vence = sumarMesesISO(inicio, 6);
  return { vence, dias: Math.round((isoUTC(vence) - isoUTC(hoyIso)) / MS_DIA) };
}
const diasTxt = (n) => `${n} día${n === 1 ? '' : 's'}`;
// Badge de cuenta regresiva: verde > 30, ambar 8-30, rojo <= 7, vencido si dias <= 0.
function cuentaRegresivaHtml(dias, vence) {
  if (dias == null) return '';
  const cls = dias <= 7 ? 'reprob' : dias <= 30 ? 'reag' : 'aprob';
  const txt = dias <= 0 ? `⛔ Vencido hace ${diasTxt(-dias)}` : `⏳ Quedan ${diasTxt(dias)}`;
  return `<span class="badge ${cls} cuenta-tramite" title="El trámite vence el ${esc(fFecha(vence))}">${txt}</span>`;
}
// Badge neutro cuando la cita no tiene fecha de inicio de tramite (para que se complete).
const SIN_INICIO_HTML = '<span class="badge noasiste cuenta-tramite" title="Falta registrar la fecha de inicio del trámite">⏳ Sin fecha de inicio</span>';
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
let META = null;

// Cache de lecturas (GET): ultima respuesta (texto JSON) por ruta. Permite dibujar
// al instante una vista ya visitada mientras se pide la version fresca, y que el
// badge y la vista compartan una misma respuesta. Cualquier escritura (POST/PUT/
// DELETE) lo vacia: nunca se muestra algo que el propio usuario ya cambio.
const cacheGet = new Map(); // path -> { t, txt }
const enVuelo = new Map();  // path -> Promise<txt>: dos pedidos iguales simultaneos = 1 request
let genCache = 0;           // sube con cada escritura; un GET viejo no repuebla el cache

function vaciarCache() { genCache++; cacheGet.clear(); enVuelo.clear(); }

async function pedir(path, opts) {
  const esForm = opts.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    headers: opts.body && !esForm ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
    body: opts.body && !esForm ? JSON.stringify(opts.body) : opts.body,
  });
  const txt = await res.text();
  const data = txt ? JSON.parse(txt) : null;
  if (!res.ok) {
    const e = new Error(data && data.error ? data.error : `Error ${res.status}`);
    e.data = data; e.status = res.status;
    throw e;
  }
  return txt;
}

async function api(path, opts = {}) {
  const esGet = !opts.method || opts.method.toUpperCase() === 'GET';
  if (!esGet) {
    vaciarCache();
    try { const txt = await pedir(path, opts); return txt ? JSON.parse(txt) : null; }
    finally { vaciarCache(); }
  }
  let p = enVuelo.get(path);
  if (!p) {
    const gen = genCache;
    p = pedir(path, opts).then((txt) => {
      if (gen === genCache) cacheGet.set(path, { t: Date.now(), txt });
      return txt;
    });
    p.finally(() => { if (enVuelo.get(path) === p) enVuelo.delete(path); }).catch(() => {});
    enVuelo.set(path, p);
  }
  const txt = await p;
  return txt ? JSON.parse(txt) : null; // cada llamador recibe su propia copia
}

// Como api(), pero si hay una respuesta de hace menos de `maxEdadMs` la reutiliza
// sin ir a la red (para los contadores de las pestañas).
function apiReciente(path, maxEdadMs) {
  const c = cacheGet.get(path);
  if (c && Date.now() - c.t < maxEdadMs) return Promise.resolve(c.txt ? JSON.parse(c.txt) : null);
  return api(path);
}

// Carga los datos de una vista: si ya se visito, dibuja al instante con lo ultimo
// conocido y despues redibuja solo si lo fresco cambio. `slot` identifica quien
// pide: un pedido mas nuevo del mismo slot, o cambiar de pestaña, descarta al viejo
// (evita que la respuesta lenta del dia A se pinte encima del dia B).
const turnoVista = {};
let genVista = 0;
async function cargarVista(slot, path, pintar) {
  const turno = (turnoVista[slot] = (turnoVista[slot] || 0) + 1);
  const gv = genVista;
  const vigente = () => turnoVista[slot] === turno && gv === genVista;
  const previo = cacheGet.get(path)?.txt;
  if (previo !== undefined) pintar(previo ? JSON.parse(previo) : null);
  const fresco = await api(path);
  if (!vigente()) return;
  if (previo !== undefined && cacheGet.get(path)?.txt === previo) return; // sin cambios
  pintar(fresco);
}

function toast(msg, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  // Lico en miniatura: alerta en errores, celebra en logros importantes (el mensaje siempre va como texto)
  const pose = tipo === 'err' ? 'alerta' : (tipo === 'ok' && /agendada|asignada|[ée]xito|Aprobó|Importacion completada|bloques nuevos/i.test(String(msg))) ? 'celebra' : '';
  // El Lico de la cabecera reacciona unos segundos (gesto pequeño; no hace nada si Lico esta desactivado)
  if (pose && window.LicoJuegos) window.LicoJuegos.reaccionar(pose);
  if (pose && window.Lico) {
    const ico = document.createElement('span');
    ico.className = 'toast-lico';
    ico.setAttribute('aria-hidden', 'true');
    ico.innerHTML = window.Lico.svg(pose);
    t.appendChild(ico);
  }
  const txt = document.createElement('span');
  txt.className = 'toast-txt';
  txt.textContent = msg;
  t.appendChild(txt);
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), tipo === 'err' ? 6000 : 3200);
}

function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- Lico en estados vacios (titulo y texto se escapan aqui: pasar texto plano) ----
let pcTeniaPendientes = false; // para el confeti al dejar Por confirmar en cero
function licoVacio(pose, titulo, texto) {
  const svg = window.Lico ? window.Lico.svg(pose) : '';
  return `<div class="lico-vacio lico-vacio-${esc(pose)}"><span class="lico-vacio-img" aria-hidden="true">${svg}</span>
    <div class="lico-vacio-txt"><b>${esc(titulo)}</b><span>${esc(texto)}</span></div></div>`;
}
function licoVacioFila(cols, pose, titulo, texto) {
  return `<tr><td colspan="${cols}" class="lico-vacio-celda">${licoVacio(pose, titulo, texto)}</td></tr>`;
}
// Confeti discreto (huevo de pascua): se omite con movimiento reducido
function licoConfeti(origen) {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (window.LicoJuegos && !window.LicoJuegos.animado()) return;
    const r = (origen && origen.getBoundingClientRect) ? origen.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 3, width: 0, height: 0 };
    const cx = r.left + r.width / 2, cy = r.top + Math.min(r.height, 80) / 2;
    const cols = ['#1fb5d9', '#e889c4', '#f6d23c', '#2fb56a', '#e8503f'];
    const root = document.createElement('div');
    root.className = 'lico-confeti';
    root.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 16; i++) {
      const p = document.createElement('i');
      const ang = (Math.PI * 2 * i) / 16 + Math.random() * .4;
      const d = 50 + Math.random() * 60;
      p.style.cssText = `left:${cx}px;top:${cy}px;background:${cols[i % cols.length]};--dx:${Math.cos(ang) * d}px;--dy:${Math.sin(ang) * d - 30}px;--rot:${Math.round(Math.random() * 540)}deg`;
      root.appendChild(p);
    }
    document.body.appendChild(root);
    setTimeout(() => root.remove(), 1200);
  } catch { /* decorativo */ }
}

// ---- Lico en la cabecera: al pulsarlo dice una frase corta y se calla solo ----
const FRASES_LICO = [
  'Pulsa "Cómo usar el sistema" y te llevo de paseo por todas las pestañas.',
  'El buscador de arriba encuentra por RUT, nombre o teléfono. Con 3 caracteres basta.',
  'Por confirmar en cero es mi estado favorito. Hasta me dan ganas de bailar.',
  'Si un bloque se libera o se pisa, la cita no se pierde: queda en la Papelera.',
  'Las clases D y A5 solo van en su bloque especial. Yo no hago las reglas, pero las cumplo.',
  'Antes de importar un Excel con "Reemplazar todo", respira hondo. Es irreversible.',
  'El tema oscuro existe. Tus ojos de la tarde te lo agradecerán.',
  'Un RUT con dígito verificador incorrecto no pasa. Ni conmigo de abogado.',
  'En Reagendar, "Ver bloques libres" te muestra dónde hay cupo antes de mover a alguien.',
  'Si pulsas de nuevo el resultado activo (Aprobó, Reprobó...), se borra. Así de simple.',
  'Mi licencia está al día. ¿Y la tuya?',
  'El Reporte de errores vacío es una obra de arte administrativa.',
  'Revisa el teléfono y el correo del postulante: sin ellos no puedo avisarle de nada.',
  'Cada bloque libre es un postulante más cerca de su licencia. Sin presión.'
];
// Consejos segun la pestaña abierta (se mezclan con los generales al pulsar a Lico)
const FRASES_TAB = {
  disponibles: ['Aquí ves los bloques libres. Filtra por clase de licencia antes de ofrecer una hora.', 'Un clic en un bloque libre abre el formulario de agendamiento. Revisa teléfono y correo.'],
  agenda: ['Agenda: marca Aprobó, Reprobó o No asistió. Si te equivocas, pulsa de nuevo el resultado y se borra.', 'Bloquear un día o un tramo horario sin cita es un solo paso. Pon siempre el motivo.'],
  reagendar: ['Reagendar: elige primero a la persona y mira los bloques libres antes de mover a nadie.', 'Quien no asistió o fue derivado aparece aquí. Que nadie se quede sin nueva hora.'],
  porconfirmar: ['Por confirmar en cero es mi estado favorito. Hasta confeti sale.', 'Confirmar asistencia a tiempo evita bloques vacíos el día del examen.'],
  dia: ['Agenda del día: elige formato y orientación antes de imprimir. Yo desaparezco al imprimir.', 'Revisa el diseño (hoja única o por examinador) según cómo lo vayan a leer en sala.'],
  analitica: ['Estadísticas: compara períodos con calma. Los números cuentan una historia.', 'Si el rango no muestra datos, prueba ampliar las fechas.'],
  papelera: ['La Papelera guarda las citas liberadas. Restaurar es mejor que volver a digitar.', 'Vaciar la Papelera es definitivo. Respira hondo antes de pulsar.'],
  datos: ['Datos: haz un backup antes de importar un Excel. Con "Reemplazar todo" no hay vuelta atrás.', 'Generar la grilla crea bloques solo en días hábiles. Revisa el rango.'],
  errores: ['El Reporte de errores vacío es una obra de arte administrativa.', 'Cada error trae su detalle: corrige el dato en origen y desaparece del reporte.']
};
function licoSaludoHora() {
  const hr = new Date().getHours();
  const s = hr < 12 ? 'Buenos días' : hr < 20 ? 'Buenas tardes' : 'Buenas noches';
  return s + '. Soy Lico. Pulsa mi carita cuando quieras un consejo.';
}
function iniciarLicoCabecera() {
  const btn = document.getElementById('head-lico');
  const burbuja = document.getElementById('head-lico-burbuja');
  if (!btn || !burbuja) return;
  let ultimo = -1, timer = null;
  const cerrar = () => {
    clearTimeout(timer);
    burbuja.hidden = true;
    btn.classList.remove('habla');
  };
  const decir = (txt, ms) => {
    burbuja.textContent = txt; // siempre como texto, nunca como HTML
    burbuja.hidden = false;
    btn.classList.add('habla');
    clearTimeout(timer);
    timer = setTimeout(cerrar, ms || 7000);
  };
  btn.addEventListener('click', () => {
    const tab = (location.hash.slice(1) || 'disponibles').split('?')[0];
    const propias = FRASES_TAB[tab] || [];
    const pool = FRASES_LICO.concat(propias, propias); // las de la pestaña pesan el doble
    let i;
    do { i = Math.floor(Math.random() * pool.length); } while (i === ultimo && pool.length > 1);
    ultimo = i;
    decir(pool[i], 7000);
  });
  // Saludo segun la hora: una sola vez por sesion y solo con Lico activado
  try {
    if (!sessionStorage.getItem('agenda-lico-saludo') && (!window.LicoJuegos || window.LicoJuegos.activo())) {
      sessionStorage.setItem('agenda-lico-saludo', '1');
      setTimeout(() => { if (burbuja.hidden && !document.getElementById('tour-overlay')) decir(licoSaludoHora(), 5500); }, 1500);
    }
  } catch (_) { /* sin sessionStorage: sin saludo */ }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !burbuja.hidden) cerrar(); });
  document.addEventListener('click', (e) => { if (!burbuja.hidden && !e.target.closest('.head-lico-wrap')) cerrar(); });
}
iniciarLicoCabecera();

// Digito verificador de un RUT (formato limpio, solo digitos + K final).
function rutDvEsperado(cuerpo) {
  let suma = 0, factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  return resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
}
// true solo si "parece" un RUT (7-9 digitos/K) y el digito verificador calza.
function rutEsValido(v) {
  const c = String(v || '').toUpperCase().replace(/[^0-9K]/g, '');
  if (c.length < 7 || c.length > 9 || !/^\d+[0-9K]$/.test(c)) return false;
  return rutDvEsperado(c.slice(0, -1)) === c.slice(-1);
}
// Si el texto es un RUT chileno valido (digito verificador correcto), lo
// devuelve formateado "12.345.678-9". Si no, devuelve el texto tal cual
// (asi no confunde un telefono u otro numero con un RUT).
function formatearSiEsRut(v) {
  if (!rutEsValido(v)) return v;
  const c = String(v).toUpperCase().replace(/[^0-9K]/g, '');
  const cuerpo = c.slice(0, -1);
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${c.slice(-1)}`;
}
// Autocompleta puntos y guion al salir del campo, solo si el RUT es valido.
function autoformatoRut(input) {
  if (!input) return;
  input.addEventListener('blur', () => {
    const f = formatearSiEsRut(input.value.trim());
    if (f && f !== input.value) input.value = f;
  });
}
const hoy = () => (META ? META.hoy : new Date().toISOString().slice(0, 10));

// Fecha en formato dia/mes/año para MOSTRAR. Los <input type="date"> siguen usando ISO.
function fFecha(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
}
function fFechaHora(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}`;
  return fFecha(v);
}
function fFechaDia(v) {
  if (!v) return '';
  const d = new Date(`${v}T12:00:00`);
  const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  return `${dias[d.getDay()]} ${fFecha(v)}`;
}

// Mantener la posicion del scroll cuando una accion vuelve a dibujar la vista.
let _scrollY = null;
const guardarScroll = () => { _scrollY = window.scrollY; };
function restaurarScroll() {
  if (_scrollY == null) return;
  const y = _scrollY; _scrollY = null;
  requestAnimationFrame(() => window.scrollTo(0, y));
}
// Envuelve un callback para que, tras redibujar, la pantalla quede donde estaba.
const recargar = (fn) => async () => {
  const y = window.scrollY;
  await fn();
  requestAnimationFrame(() => window.scrollTo(0, y));
};
// Nombres siempre en mayuscula al mostrar.
const nom = (v) => String(v ?? '').toUpperCase();
// Telefono chileno para mostrar: +56 9 1234 5678
function fTel(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.startsWith('56') && d.length > 9) d = d.slice(2);
  if (!d) return '';
  if (d.length === 9) return `+56 ${d[0]} ${d.slice(1, 5)} ${d.slice(5)}`;
  return '+56 ' + d;
}
const DIAS_SEM = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function fFechaLarga(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return fFecha(iso);
  const d = new Date(`${iso}T12:00:00`);
  return `${DIAS_SEM[d.getDay()]} ${Number(m[3])} de ${MESES[d.getMonth()]} de ${m[1]}`;
}
function sumarDias(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
// Avanza/retrocede un dia (n = 1 o -1) saltandose fines de semana y feriados
// sin bloques generados: domingo siempre se salta, sabado y feriado solo si
// estan vacios.
async function proximoDiaConAgenda(desde, n) {
  const feriados = new Set((META && META.feriados || []).map((f) => f.fecha));
  let fecha = sumarDias(desde, n);
  for (let i = 0; i < 30; i++) {
    const dow = new Date(`${fecha}T12:00:00`).getDay();
    if (dow === 0) { fecha = sumarDias(fecha, n); continue; }
    if (dow === 6 || feriados.has(fecha)) {
      const rows = await api(`/agenda?fecha=${fecha}`);
      if (!rows.length) { fecha = sumarDias(fecha, n); continue; }
    }
    break;
  }
  return fecha;
}
const opt = (arr, sel) => ['<option value="">--</option>']
  .concat(arr.map((v) => `<option ${v === sel ? 'selected' : ''}>${esc(v)}</option>`)).join('');

function modal(titulo, cuerpoHtml, pieHtml, extraCls = '') {
  const root = $('#modal-root');
  root.innerHTML = '';
  const ov = h(`<div class="overlay">
    <div class="modal ${extraCls}" role="dialog" aria-modal="true">
      <header><h3>${esc(titulo)}</h3><button class="x" aria-label="Cerrar">&times;</button></header>
      <div class="cuerpo"></div>
      <footer></footer>
    </div></div>`);
  ov.querySelector('.cuerpo').innerHTML = cuerpoHtml;
  ov.querySelector('footer').innerHTML = pieHtml || '';
  ov.querySelector('.x').onclick = cerrarModal;
  ov.addEventListener('click', (e) => { if (e.target === ov) cerrarModal(); });
  root.appendChild(ov);
  return ov;
}
const cerrarModal = () => { $('#modal-root').innerHTML = ''; };

/* ================= marca / logo ================= */
const ESCUDO_FALLBACK = `<svg class="escudo" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M20 2l15 5v11c0 9.5-6.2 16.8-15 20-8.8-3.2-15-10.5-15-20V7l15-5z" fill="#1b3a75"></path>
  <path d="M13 21l4.5 4.5L27 15" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
let MARCA = { logo: null, organismo: 'Municipalidad de Valparaíso', unidad: 'Departamento de Licencias de Conducir' };
function logoHtml(cls) {
  return MARCA.logo
    ? `<img src="${MARCA.logo}" alt="${esc(MARCA.organismo)}" class="${cls} es-img">`
    : ESCUDO_FALLBACK.replace('class="escudo"', `class="${cls}"`);
}

/* ================= router ================= */
const tabs = {
  agenda: renderAgenda, disponibles: renderDisponibles, reagendar: renderReagendar,
  porconfirmar: renderPorConfirmar,
  buscar: renderBuscar, errores: renderErrores, dia: renderDia, analitica: renderAnalitica,
  papelera: renderPapelera, datos: renderDatos, vencimientos: renderVencimientos,
};
function irA(tab) {
  if (location.hash !== `#${tab}`) { location.hash = tab; return; }
  ruta();
}
// Mide la altura real del header y del panel de filtros fijo, y las deja en
// variables CSS para que .panel-fijo y .g-head se enganchen justo debajo
// (sin dejar hueco ni tapar contenido), sin depender de numeros fijos.
function ajustarOffsetsFijos() {
  const header = document.querySelector('header.top');
  const panelFijo = document.querySelector('.panel-fijo');
  const raiz = document.documentElement.style;
  if (header) raiz.setProperty('--alto-header', `${Math.round(header.getBoundingClientRect().height)}px`);
  if (panelFijo) raiz.setProperty('--alto-panel-fijo', `${Math.round(panelFijo.getBoundingClientRect().height)}px`);
}
function ruta() {
  cerrarModal();
  const tab = (location.hash.slice(1) || 'disponibles').split('?')[0];
  document.querySelectorAll('#nav button[data-tab]').forEach((b) => b.classList.toggle('activo', b.dataset.tab === tab));
  genVista++; // las cargas pendientes de la pestaña anterior ya no pintan
  (tabs[tab] || renderAgenda)();
  requestAnimationFrame(ajustarOffsetsFijos);
}
window.addEventListener('resize', () => requestAnimationFrame(ajustarOffsetsFijos));
window.addEventListener('hashchange', ruta);

function textoForzar(b) {
  return b.hora === META.hora_d_a5
    ? 'Forzar: ya hay citas a las horas siguientes (13:00/13:30 no se van a bloquear)'
    : `Forzar: clase pesada fuera del bloque ${META.hora_d_a5}`;
}

/* ================= editor de bloque ================= */
// "B,A2" -> ['B','A2']. Acepta tanto el valor guardado (con comas) como uno solo.
const clasesDe = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function editorSlot(b, alGuardar) {
  // 1. Si la celda está bloqueada: Diálogo para desbloquear
  if (b.bloqueado) {
    modal(
      `Bloque inhabilitado · ${fFecha(b.fecha)} · ${b.hora} · ${b.examinador}`,
      `
      <div style="text-align:center;padding:1.4rem .5rem">
        <div style="font-size:2.4rem;margin-bottom:.5rem">&#128274;</div>
        <h3 style="margin:0 0 .5rem;color:var(--alerta);font-size:1.2rem;text-transform:uppercase">${esc(b.bloqueo_motivo || 'BLOQUEADO')}</h3>
        <p class="muted" style="max-width:380px;margin:0 auto;line-height:1.4">Este horario de examen práctico se encuentra actualmente no disponible.</p>
      </div>
      `,
      `
      <button class="btn btn-desbloq-accion" id="btn-desbloq-slot">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
        Desbloquear esta hora
      </button>
      <button class="btn sec" id="btn-cancel-bloq">Cerrar</button>
      `
    );
    $('#btn-cancel-bloq').onclick = cerrarModal;
    $('#btn-desbloq-slot').onclick = async () => {
      try {
        await api(`/agenda/${b.id}/liberar`, { method: 'POST', body: { motivo: 'Desbloqueo manual' } });
        cerrarModal();
        alGuardar && alGuardar();
        toast('Bloque desbloqueado exitosamente · Ahora está disponible para citar', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    };
    return;
  }

  // 2. Si la celda está libre o tiene cita: Abrir DIRECTAMENTE el formulario de agendamiento completo
  formularioCita(b, alGuardar);
}

function funcionarioActual() {
  if (!META) return null;
  if (META.funcionario_id) {
    const f = (META.funcionarios || []).find((x) => x.id === META.funcionario_id);
    if (f) return f;
  }
  return (META.funcionarios || []).find((f) => f.activo) || null;
}

function formularioCita(b, alGuardar) {
  const c = META.catalogos;
  const funcs = META.funcionarios.filter((f) => f.activo);
  const actual = funcionarioActual();
  const fAsignado = (b.funcionario_id && (META.funcionarios || []).find((f) => f.id === b.funcionario_id))
    || actual
    || (b.funcionario ? { id: b.funcionario_id || null, nombre: b.funcionario } : null)
    || { id: null, nombre: 'Sin asignar' };
  const clasesIniciales = clasesDe(b.clase);
  const esPesada = clasesIniciales.some((cl) => META.clases_pesadas.includes(cl));
  const tieneCita = Boolean(b && (b.rut || b.nombre));

  modal(
    `${tieneCita ? 'Ficha de cita' : 'Agendar nueva cita'} · ${fFecha(b.fecha)} · ${b.hora} hrs · Examinador/a: ${esc(b.examinador)}`,
    `
    <div class="campo"><label>Nombre completo <b class="req" style="color:var(--alerta)">*</b></label>
      <input id="f-nombre" value="${esc(nom(b.nombre))}" required placeholder="NOMBRES Y APELLIDOS" style="text-transform:uppercase;font-weight:600">
    </div>
    
    <div class="campo"><label>RUT (con puntos y guión) <b class="req" style="color:var(--alerta)">*</b></label>
      <input id="f-rut" value="${esc(b.rut)}" required placeholder="12.345.678-9" style="font-weight:600">
    </div>

    <div class="campo"><label>Celular (contacto) <b class="req" style="color:var(--alerta)">*</b></label>
      <input id="f-contacto" value="${esc(fTel(b.contacto))}" required placeholder="+56 9 1234 5678" inputmode="tel">
    </div>

    <div class="campo ancho"><label>Clase de Licencia que está sacando <b class="req" style="color:var(--alerta)">*</b> (puedes marcar más de una)</label>
      <div class="chk-clases" id="f-clase">${c.clase.map((cl) => `
        <label class="chk-clase"><input type="checkbox" value="${esc(cl)}" ${clasesIniciales.includes(cl) ? 'checked' : ''}> ${esc(cl)}</label>
      `).join('')}</div>
    </div>

    <div class="campo"><label>Correo electrónico <b class="req" style="color:var(--alerta)">*</b></label>
      <input id="f-correo" type="email" required placeholder="nombre@correo.com" value="${esc(b.correo)}">
    </div>

    <div class="campo" id="wrap-f-func">
      <label>Funcionario/a que agenda</label>
      <div id="disp-f-func" style="display:flex;align-items:center;gap:.6rem;padding:.45rem .75rem;background:var(--elev);border:1px solid var(--linea);border-radius:6px;min-height:38px;box-sizing:border-box">
        <span style="font-size:14px">👤</span>
        <span id="txt-f-func" style="font-weight:700;color:var(--tinta);font-size:13px">${esc(fAsignado.nombre)}</span>
        <span class="badge" style="margin-left:auto;font-size:10px;background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;padding:2px 7px;font-weight:600">
          ${b.funcionario_id ? 'Asignado' : 'Por defecto'}
        </span>
        <button type="button" class="btn chico sec" id="btn-cambiar-func" style="padding:1px 6px;font-size:11px;margin-left:6px" title="Cambiar funcionario">Cambiar</button>
      </div>
      <div id="sel-f-func-cont" hidden style="margin-top:4px">
        <select id="f-func-sel" style="width:100%">
          ${funcs.map((f) => `<option value="${f.id}" ${f.id === (fAsignado.id || b.funcionario_id) ? 'selected' : ''}>${esc(f.nombre)}</option>`).join('')}
          <option value="__nuevo">+ Nuevo...</option>
        </select>
      </div>
      <input type="hidden" id="f-func" value="${fAsignado.id || ''}">
    </div>

    <div class="campo ancho" id="zona-forzar" ${esPesada ? '' : 'hidden'}>
      <label><input type="checkbox" id="f-forzar"> <span id="f-forzar-txt">${esc(textoForzar(b))}</span></label>
    </div>
    ${(b.alerts || []).length ? `<div class="campo ancho">${alertasHtml(b)}</div>` : ''}
    <div class="campo ancho" id="f-intento-aviso" hidden></div>
    <div class="campo">
      <label>Fecha de Inicio de Trámite</label>
      <input type="date" id="f-fecha-inicio" value="${b.fecha_inicio_tramite || ''}" max="${hoy()}" style="width:100%;padding:.45rem .6rem;border:1px solid var(--linea);border-radius:6px">
      <div id="f-cuenta-tramite" class="cuenta-tramite-zona" aria-live="polite"></div>
    </div>
    <div class="campo" id="zona-escuela" ${esClaseTramite(b.clase) ? '' : 'hidden'}>
      <label>Escuela de Conductores</label>
      <select id="f-escuela" style="width:100%;padding:.45rem .6rem;border:1px solid var(--linea);border-radius:6px">
        <option value="">-- Sin escuela --</option>
        ${c.escuela_conductores ? c.escuela_conductores.map((e) => `<option value="${esc(e)}" ${b.escuela_conductores === e ? 'selected' : ''}>${esc(e)}</option>`).join('') : ''}
      </select>
    </div>
    <div class="campo">
      <label>Tipo de Reagendamiento</label>
      <select id="f-tipo-reagendamiento" style="width:100%;padding:.45rem .6rem;border:1px solid var(--linea);border-radius:6px">
        <option value="">-- Sin tipo --</option>
        ${c.tipo_reagendamiento ? c.tipo_reagendamiento.map((tipo) => `<option value="${esc(tipo)}" ${b.tipo_reagendamiento === tipo ? 'selected' : ''}>${esc(tipo)}</option>`).join('') : ''}
      </select>
    </div>
    ${tieneCita ? `<div class="campo">
      <label>Confirmó asistencia</label>
      <select id="f-conf">
        <option value="" ${b.confirmo_asistencia == null ? 'selected' : ''}>-- Sin respuesta --</option>
        <option value="1" ${b.confirmo_asistencia === 1 ? 'selected' : ''}>SÍ</option>
        <option value="0" ${b.confirmo_asistencia === 0 ? 'selected' : ''}>NO</option>
      </select>
    </div>
    <div class="campo">
      <label>Resultado</label>
      <select id="f-res">
        <option value="">-- Sin resultado --</option>
        ${(c.resultado || []).map((r) => `<option value="${esc(r)}" ${b.resultado === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
      </select>
    </div>
    <div class="campo ancho">
      <label>Comentarios</label>
      <textarea id="f-coment" rows="3">${esc(b.comentarios || '')}</textarea>
    </div>` : ''}
    ${tieneCita ? '<div class="campo ancho hist-cita" id="zona-hist-cita"><h4>Historial del solicitante</h4><div class="hist-lista">Cargando...</div></div>' : ''}
    `,
    `
    ${(b.rut || b.nombre) ? '<button class="btn peligro sec" id="btn-liberar" title="Quita la cita del bloque">Liberar bloque</button>' : ''}
    ${(b.rut || b.nombre) ? '<button type="button" class="btn sec" id="btn-reagendar-slot" style="color:var(--azul);font-weight:600">Reagendar postulante</button>' : ''}
    ${tieneCita ? '<button type="button" class="btn sec" id="btn-imprimir-ficha">Imprimir ficha</button>' : ''}
    <button class="btn sec" id="btn-cancel">Cancelar</button>
    <button class="btn" id="btn-guardar" style="background:#1d4ed8;font-weight:700">${tieneCita ? "Guardar cambios" : "Confirmar y agendar cita"}</button>
    `,
    'lateral'
  );
  if (tieneCita) cargarHistorialCita(b, alGuardar);

  // Autoformato de RUT en tiempo real
  $('#f-rut').addEventListener('input', () => {
    let v = $('#f-rut').value.replace(/[^0-9kK]/g, '').toUpperCase();
    if (v.length > 9) v = v.slice(0, 9);
    if (v.length > 1) {
      const cuerpo = v.slice(0, -1);
      const dv = v.slice(-1);
      let cuerpoFmt = '';
      for (let i = cuerpo.length - 1, j = 1; i >= 0; i--, j++) {
        cuerpoFmt = cuerpo[i] + cuerpoFmt;
        if (j % 3 === 0 && i > 0) cuerpoFmt = '.' + cuerpoFmt;
      }
      $('#f-rut').value = cuerpoFmt + '-' + dv;
    } else {
      $('#f-rut').value = v;
    }
  });

  // Autoformato de Celular
  $('#f-contacto').addEventListener('blur', () => {
    let v = $('#f-contacto').value.trim().replace(/\s+/g, '');
    if (v.startsWith('+56')) v = v.slice(3);
    if (v.startsWith('56')) v = v.slice(2);
    if (v.length === 9 && v.startsWith('9')) {
      $('#f-contacto').value = `+56 9 ${v.slice(1, 5)} ${v.slice(5)}`;
    } else if (v.length === 8) {
      $('#f-contacto').value = `+56 9 ${v.slice(0, 4)} ${v.slice(4)}`;
    }
  });

  // Autocompletar datos si el RUT tiene citas anteriores
  if (!b.rut && !b.nombre) {
    $('#f-rut').addEventListener('blur', async () => {
      const val = $('#f-rut').value.trim();
      if (!val) return;
      try {
        const hist = await api(`/historial?rut=${encodeURIComponent(val)}`);
        if (!hist.length) return;
        const ultimo = hist[hist.length - 1];
        let completo = false;
        if (!$('#f-nombre').value && ultimo.nombre) { $('#f-nombre').value = nom(ultimo.nombre); completo = true; }
        if (!$('#f-contacto').value && ultimo.contacto) { $('#f-contacto').value = fTel(ultimo.contacto); completo = true; }
        if (!$('#f-correo').value && ultimo.correo) { $('#f-correo').value = ultimo.correo; completo = true; }
        if (completo) toast('Datos autocompletados de una cita anterior', 'ok');
      } catch (_) {}
    });
  }

  if ($('#btn-cambiar-func')) {
    $('#btn-cambiar-func').onclick = () => {
      $('#sel-f-func-cont').hidden = false;
      $('#btn-cambiar-func').style.display = 'none';
      $('#f-func-sel').focus();
    };
  }
  if ($('#f-func-sel')) {
    $('#f-func-sel').onchange = async (e) => {
      if (e.target.value === '__nuevo') {
        const nombre = prompt('Nombre del nuevo funcionario/a:');
        if (!nombre || !nombre.trim()) { e.target.value = $('#f-func').value; return; }
        try {
          const r = await api('/funcionarios', { method: 'POST', body: { nombre } });
          META = await api('/meta');
          const optEl = document.createElement('option');
          optEl.value = r.id; optEl.textContent = r.nombre; optEl.selected = true;
          $('#f-func-sel').insertBefore(optEl, $('#f-func-sel').lastElementChild);
          $('#f-func').value = r.id;
          $('#txt-f-func').textContent = r.nombre;
        } catch (err) {
          toast(err.message, 'err');
        }
        return;
      }
      $('#f-func').value = e.target.value;
      const fn = funcs.find((f) => String(f.id) === String(e.target.value));
      $('#txt-f-func').textContent = fn ? fn.nombre : '';
    };
  }

  const clasesMarcadas = () => Array.from(document.querySelectorAll('#f-clase input:checked')).map((i) => i.value);

  const chequearPesada = () => {
    const clases = clasesMarcadas();
    const tienePesada = clases.some((cl) => META.clases_pesadas.includes(cl));
    $('#zona-forzar').hidden = !tienePesada;
    if (tienePesada) $('#f-forzar-txt').textContent = textoForzar(b);
    $('#zona-escuela').hidden = !esClaseTramite(clases.join(','));
    actualizarCuentaTramite();
  };
  const actualizarCuentaTramite = () => {
    const v = vigenciaTramiteCli($('#f-fecha-inicio').value);
    $('#f-cuenta-tramite').innerHTML = v ? cuentaRegresivaHtml(v.dias, v.vence) : '';
  };
  document.querySelectorAll('#f-clase input').forEach((chk) => {
    chk.addEventListener('change', chequearPesada);
  });
  $('#f-fecha-inicio').addEventListener('input', actualizarCuentaTramite);
  $('#f-fecha-inicio').addEventListener('change', actualizarCuentaTramite);
  actualizarCuentaTramite();

  $('#btn-cancel').onclick = cerrarModal;
  if ($('#btn-imprimir-ficha')) $('#btn-imprimir-ficha').onclick = () => imprimirFicha(b).catch((e) => toast(e.message, 'err'));

  if ($('#btn-liberar')) {
    $('#btn-liberar').onclick = async () => {
      if (!confirm('¿Seguro que deseas liberar este bloque? La cita se moverá a la Papelera.')) return;
      try {
        await api(`/agenda/${b.id}/liberar`, { method: 'POST', body: { motivo: 'Liberado desde formulario' } });
        cerrarModal(); alGuardar && alGuardar();
        toast('Bloque liberado');
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  if ($('#btn-reagendar-slot')) {
    $('#btn-reagendar-slot').onclick = async () => {
      try {
        await api(`/agenda/${b.id}/reagendar`, { method: 'POST', body: { motivo: 'POSTULANTE SOLICITA CAMBIO' } });
        cerrarModal(); alGuardar && alGuardar();
        actualizarBadgeReagendar();
        toast('Postulante enviado a la lista de Reagendamiento', 'ok');
        irA('reagendar');
        setTimeout(() => {
          if (typeof detalleReagendar === 'function') detalleReagendar(b.id);
        }, 120);
      } catch (e) { toast(e.message, 'err'); }
    };
  }


  $('#btn-guardar').onclick = async () => {
    const nombre = $('#f-nombre').value.trim();
    const rutVal = $('#f-rut').value.trim();
    const clases = clasesMarcadas();
    const contacto = $('#f-contacto').value.trim();
    const correoVal = $('#f-correo').value.trim();

    // Validaciones estrictas de campos obligatorios
    if (!nombre) { toast('El nombre del postulante es obligatorio', 'err'); $('#f-nombre').focus(); return; }
    if (!rutVal) { toast('El RUT es obligatorio', 'err'); $('#f-rut').focus(); return; }
    if (!formatearSiEsRut(rutVal)) { toast('El RUT ingresado no es válido (revisa el dígito verificador)', 'err'); $('#f-rut').focus(); return; }
    if (!clases.length) { toast('Debes marcar al menos una clase de licencia', 'err'); return; }
    if (!contacto) { toast('El número de celular es obligatorio', 'err'); $('#f-contacto').focus(); return; }
    if (!correoVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoVal)) { toast('Ingresa un correo electrónico válido', 'err'); $('#f-correo').focus(); return; }

    $('#btn-guardar').disabled = true;
    $('#btn-guardar').textContent = 'Guardando...';

    const comun = { visto_en: b.actualizado_en, comentarios: $('#f-coment') ? ($('#f-coment').value.trim() || null) : (b.comentarios || null) };
    try {
      const body = {
        ...comun,
        rut: rutVal,
        nombre: nombre,
        nacionalidad: b.nacionalidad || 'CHILENA',
        clase: clases.join(','),
        contacto: contacto,
        correo: correoVal,
        tipo_cita: b.tipo_cita || 'NORMAL',
        motivo_reagendamiento: b.motivo_reagendamiento || null,
        lista_espera: 'NO',
        intento: b.intento || '1° VEZ',
        funcionario_id: $('#f-func').value && $('#f-func').value !== '__nuevo' ? Number($('#f-func').value) : null,
        fecha_inicio_tramite: $('#f-fecha-inicio') ? ($('#f-fecha-inicio').value || null) : (b.fecha_inicio_tramite || null),
        escuela_conductores: esClaseTramite(clasesMarcadas().join(',')) ? ($('#f-escuela').value || null) : null,
        tipo_reagendamiento: $('#f-tipo-reagendamiento') ? $('#f-tipo-reagendamiento').value || null : (b.tipo_reagendamiento || null),
        confirmo_asistencia: $('#f-conf') ? ($('#f-conf').value === '' ? null : Number($('#f-conf').value)) : (b.confirmo_asistencia ?? null),
        resultado: $('#f-res') ? ($('#f-res').value || null) : (b.resultado || null),
        pendiente_reagendar: Boolean(b.pendiente_reagendar),
        pendiente_nota: b.pendiente_nota || null,
        forzar: $('#f-forzar') && $('#f-forzar').checked,
      };

      const r = await api(`/agenda/${b.id}`, { method: 'PUT', body });
      (r.avisos || []).forEach((a) => toast(a, 'err'));
      toast('Cita agendada exitosamente · Comprobante e instrucciones enviadas por correo', 'ok');
      cerrarModal();
      alGuardar && alGuardar();
    } catch (e) {
      $('#btn-guardar').disabled = false;
      $('#btn-guardar').textContent = 'Guardar cita';
      toast(e.message, 'err');
      if (e.status === 409 && e.data && e.data.bloque) { editorSlot(e.data.bloque, alGuardar); }
    }
  };
}
async function abrirSlotPorId(id, alGuardar) {
  editorSlot(await api(`/agenda/${id}`), alGuardar);
}

async function fechaInicialAgenda() {
  const h = hoy();
  const dow = new Date(`${h}T12:00:00`).getDay();
  if (dow === 0 || dow === 6) {
    return await proximoDiaConAgenda(h, 1);
  }
  try {
    const rows = await apiReciente(`/agenda?fecha=${h}`, 30e3);
    if (!Array.isArray(rows) || !rows.length) return await proximoDiaConAgenda(h, 1);
  } catch (_) {}
  return h;
}


/* ================= tab: POR CONFIRMAR ================= */
async function renderPorConfirmar() {
  view.innerHTML = `
    <div class="panel">
      <div class="fila" style="justify-content:space-between;align-items:center">
        <div>
          <h2 style="margin:0 0 .25rem;display:flex;align-items:center;gap:.5rem">
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" style="color:#f59e0b">
              <rect x="3" y="3" width="14" height="14" rx="2"/>
              <path d="M6.5 10l2.5 2.5 5-5"/>
            </svg>
            Citas por confirmar asistencia
          </h2>
          <p class="muted" style="margin:0;font-size:13px">
            Postulantes citados en los próximos días que aún no confirman asistencia. Contacta telefónicamente o por correo y registra directamente su respuesta.
          </p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="pastilla" id="pc-total-badge" style="font-weight:700">Cargando...</span>
          <button class="btn sec chico" id="pc-refrescar" title="Actualizar lista">↻ Actualizar</button>
          <button class="btn chico" id="btn-enviar-correos-masivos" title="Enviar enlace de confirmación por correo a todos los pendientes">✉ Enviar correos a pendientes</button>
          <button class="btn chico sec" id="btn-correo-prueba" style="color:var(--azul);font-weight:600" title="Enviar correos de prueba dirigidos a tu correo">🧪 Prueba a mi correo</button>
        </div>
      </div>
      <div class="fila" style="margin-top:1rem;gap:12px;align-items:flex-end">
        <div class="campo" style="flex:1;min-width:240px">
          <label>Buscar en la lista (RUT, nombre o teléfono)</label>
          <input type="search" id="pc-q" placeholder="Escribe para filtrar al instante..." autocomplete="off">
        </div>
        <div class="campo" style="min-width:180px">
          <label>Rango de fechas</label>
          <select id="pc-rango">
            <option value="7" selected>Próximos 7 días</option>
            <option value="15">Próximos 15 días</option>
            <option value="30">Próximos 30 días</option>
            <option value="todos">Todas las fechas futuras</option>
          </select>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:.75rem">
      <div class="tabla-scroll">
        <table style="width:100%">
          <thead>
            <tr>
              <th class="c" style="width:95px">Fecha</th>
              <th class="c" style="width:65px">Hora</th>
              <th class="c">Postulante</th>
              <th class="c" style="width:115px;white-space:nowrap">RUT</th>
              <th class="c" style="width:65px">Clase</th>
              <th class="c" style="width:150px">Teléfono</th>
              <th class="c" style="min-width:180px">Correo</th>
              <th class="c" style="min-width:230px">Gestión de asistencia</th>
            </tr>
          </thead>
          <tbody id="pc-tbody">
            <tr><td colspan="8" class="c muted" style="padding:2rem">Cargando citas por confirmar...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  let citasCargadas = [];

  const pintarLista = () => {
    const q = ($('#pc-q').value || '').trim().toLowerCase();
    const filtradas = citasCargadas.filter((r) => {
      if (!q) return true;
      const nomP = (r.nombre || '').toLowerCase();
      const rutP = (r.rut || '').toLowerCase();
      const telP = (r.contacto || '').toLowerCase();
      return nomP.includes(q) || rutP.includes(q) || telP.includes(q);
    });

    if (filtradas.length && !q) pcTeniaPendientes = true;
    $('#pc-total-badge').textContent = `${filtradas.length} ${filtradas.length === 1 ? 'cita pendiente' : 'citas pendientes'}`;

    if (!filtradas.length) {
      $('#pc-tbody').innerHTML = q
        ? licoVacioFila(8, 'explica', 'Sin coincidencias', 'No se encontraron postulantes que coincidan con la búsqueda.')
        : licoVacioFila(8, 'celebra', '¡Todo al día!', 'No hay citas pendientes de confirmación en este rango. Lico aprueba esta gestión.');
      if (!q && pcTeniaPendientes) licoConfeti($('#pc-tbody'));
      pcTeniaPendientes = false;
      return;
    }

    $('#pc-tbody').innerHTML = filtradas.map((r) => {
      const numLimpio = String(r.contacto || '').replace(/\D/g, '');
      const telWa = numLimpio.startsWith('56') ? numLimpio : (numLimpio.length === 9 ? '56' + numLimpio : '');
      const nomP = nom(r.nombre) || 'Estimado/a postulante';
      const examP = r.examinador || 'por asignar';
      const fechaP = fFecha(r.fecha);
      const horaP = r.hora || '';
      const claseP = r.clase ? ` (Clase ${r.clase})` : '';
      const mensajeWa = `Hola ${nomP}, te contactamos desde la Dirección de Tránsito respecto a tu examen práctico de conducir${claseP}. Te recordamos que tu cita está agendada para el día ${fechaP} a las ${horaP} hrs con el examinador ${examP}. Por favor confírmanos si podrás asistir o si necesitas reagendar tu hora para otra fecha.`;

      return `
      <tr data-id="${r.id}">
        <td class="c" style="white-space:nowrap"><b>${esc(fFecha(r.fecha))}</b></td>
        <td class="c"><b>${esc(r.hora)}</b></td>
        <td class="c"><b>${esc(nom(r.nombre) || '(Sin nombre)')}</b></td>
        <td class="c num" style="white-space:nowrap;font-weight:600">${esc(r.rut || '-')}</td>
        <td class="c">${r.clase ? clasesTagsHtml(r.clase) : '<span class="muted">-</span>'}</td>
        <td class="c num">
          ${r.contacto ? `
            <div style="display:inline-flex;flex-direction:column;align-items:center;gap:4px">
              <a href="tel:${esc(r.contacto)}" style="text-decoration:none;font-weight:600;color:var(--azul)">📞 ${esc(fTel(r.contacto))}</a>
              ${telWa ? `<a href="whatsapp://send?phone=${telWa}&text=${encodeURIComponent(mensajeWa)}" class="btn-wa" title="Escribir por WhatsApp a este postulante para confirmar o reagendar">💬 WhatsApp</a>` : ''}
            </div>
          ` : '<span class="muted">Sin teléfono</span>'}
        </td>
        <td class="c" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${r.correo ? `<a href="mailto:${esc(r.correo)}" style="color:var(--azul)" title="${esc(r.correo)}">${esc(r.correo)}</a>` : '<span class="muted">Sin correo</span>'}
        </td>
        <td class="c" style="white-space:nowrap">
          <button class="btn chico" data-si="${r.id}" style="background:#10b981;border-color:#059669;color:#fff;font-weight:700;margin-right:4px">✔ Confirmó</button>
          <button class="btn chico sec" data-no="${r.id}" style="color:#b91c1c;font-weight:600;margin-right:4px">✖ No asiste</button>
          <button class="btn chico sec" data-reag="${r.id}" style="color:var(--azul);font-weight:600;margin-right:4px" title="Derivar a Reagendar">🔄 Reagendar</button>
        </td>
      </tr>
      `;
    }).join('');

    $('#pc-tbody').querySelectorAll('button[data-si]').forEach((el) => {
      el.onclick = () => marcarAsistencia(Number(el.dataset.si), 1);
    });
    $('#pc-tbody').querySelectorAll('button[data-no]').forEach((el) => {
      el.onclick = () => marcarAsistencia(Number(el.dataset.no), 0);
    });
    $('#pc-tbody').querySelectorAll('button[data-reag]').forEach((el) => {
      el.onclick = async () => {
        const id = Number(el.dataset.reag);
        try {
          await api(`/agenda/${id}/reagendar`, { method: 'POST', body: { motivo: 'POSTULANTE SOLICITA CAMBIO' } });
          citasCargadas = citasCargadas.filter((c) => c.id !== id);
          pintarLista();
          actualizarBadgePorConfirmar();
          actualizarBadgeReagendar();
          toast('Postulante derivado a Reagendamiento', 'ok');
          irA('reagendar');
          setTimeout(() => {
            if (typeof detalleReagendar === 'function') detalleReagendar(id);
          }, 120);
        } catch (e) {
          toast(e.message, 'err');
        }
      };
    });
  };

  const marcarAsistencia = async (id, val) => {
    try {
      await api(`/agenda/${id}/confirmar`, {
        method: 'POST',
        body: { valor: val }
      });
      citasCargadas = citasCargadas.filter((c) => c.id !== id);
      pintarLista();
      actualizarBadgePorConfirmar();
      toast(val ? 'Asistencia confirmada exitosamente' : 'Registrado: postulante no asiste', val ? 'ok' : 'alerta');
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const cargarDatos = async () => {
    const rango = $('#pc-rango').value;
    const h = hoy();
    let hasta = null;
    if (rango === '7') hasta = sumarDias(h, 7);
    else if (rango === '15') hasta = sumarDias(h, 15);
    else if (rango === '30') hasta = sumarDias(h, 30);

    try {
      const todos = await api('/agenda?estado=porconfirmar');
      citasCargadas = todos.filter((r) => {
        if (r.fecha < h) return false;
        if (hasta && r.fecha > hasta) return false;
        return true;
      });
      pintarLista();
      actualizarBadgePorConfirmar();
    } catch (e) {
      $('#pc-tbody').innerHTML = `<tr><td colspan="9" class="c muted" style="color:var(--error);padding:2rem">Error: ${esc(e.message)}</td></tr>`;
    }
  };

  $('#pc-q').oninput = pintarLista;
  $('#pc-rango').onchange = cargarDatos;
  $('#pc-refrescar').onclick = cargarDatos;

  if ($('#btn-enviar-correos-masivos')) {
    $('#btn-enviar-correos-masivos').onclick = async () => {
      if (!confirm('¿Deseas enviar el correo de confirmación de asistencia a todos los postulantes citados que tengan correo registrado?')) return;
      try {
        toast('Enviando correos a postulantes...', 'info');
        const res = await api('/agenda/enviar-correos-pendientes', { method: 'POST', body: {} });
        if (res.enviados > 0) {
          toast(`¡Éxito! Se enviaron ${res.enviados} correos de confirmación.`, 'ok');
        } else if (!res.smtp_habilitado) {
          toast(`Tokens de confirmación generados (${res.tokens_generados}). El servicio de correo (SMTP) no está activo en este entorno.`, 'alerta');
        } else {
          toast(`No se enviaron correos nuevos. Total pendientes: ${res.total_pendientes}.`, 'info');
        }
      } catch (e) {
        toast('Error al enviar correos: ' + e.message, 'err');
      }
    };
  }

  if ($('#btn-correo-prueba')) {
    $('#btn-correo-prueba').onclick = async () => {
      const email = prompt('Indica el correo donde deseas recibir las pruebas de confirmación:', 'RAUL.SALAZAR1984@GMAIL.COM');
      if (!email || !email.includes('@')) return;
      try {
        toast('Enviando correos de prueba a ' + email + '...', 'info');
        const res = await api('/agenda/enviar-correos-pendientes', { method: 'POST', body: { correo_prueba: email.trim() } });
        if (res.enviados > 0) {
          toast(`¡Éxito! Se enviaron ${res.enviados} correos de prueba a ${email}.`, 'ok');
        } else if (!res.smtp_habilitado) {
          toast(`Tokens generados. Nota: para envío real hacia ${email} hay que configurar el correo SMTP (SMTP_HOST en el archivo .env).`, 'alerta');
        } else {
          toast('No se encontraron citas pendientes para enviar.', 'info');
        }
      } catch (e) {
        toast('Error en prueba de correo: ' + e.message, 'err');
      }
    };
  }

  await cargarDatos();
}

/* ================= tab: AGENDA ================= */
let estadoAgenda = { fecha: null, examinador_id: '', filtro: '' };
async function renderAgenda() {
  if (!estadoAgenda.fecha) estadoAgenda.fecha = await fechaInicialAgenda();
  view.innerHTML = `
    <div class="panel no-print panel-fijo">
      <div class="fila" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:flex-end;gap:6px">
          <button class="btn sec" id="dia-prev" style="padding:.45rem .65rem" title="Día anterior">&#8592;</button>
          <div class="campo"><label>Fecha</label><input type="date" id="a-fecha" value="${estadoAgenda.fecha}"></div>
          <button class="btn sec" id="dia-next" style="padding:.45rem .65rem" title="Día siguiente">&#8594;</button>
          <button class="btn sec" id="a-hoy">Hoy</button>
          <div class="campo"><label>Examinador</label>
            <select id="a-exam"><option value="">Todos</option>
              ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(e.id) === String(estadoAgenda.examinador_id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
            </select></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="pastilla" id="a-libres" data-tooltip="Total de horas disponibles para agendar en la fecha seleccionada">— bloques libres</span>
          <div class="vista-selector" title="Elegir modalidad de visualización de la Agenda">
            <button type="button" class="btn-vista ${(estadoAgenda.modoVista || localStorage.getItem('agenda_modo_vista')) === 'horizontal' ? '' : 'activo'}" id="btn-vista-vertical" title="Vista vertical por examinador (modo actual)">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2zm7 0a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V2z"/></svg>
              <span>Vertical</span>
            </button>
            <button type="button" class="btn-vista ${(estadoAgenda.modoVista || localStorage.getItem('agenda_modo_vista')) === 'horizontal' ? 'activo' : ''}" id="btn-vista-horizontal" title="Vista horizontal continua (Línea de tiempo hacia el lado)">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm0 7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3z"/></svg>
              <span>Horizontal</span>
            </button>
          </div>
          
          <button class="btn btn-bloq-accion" id="a-bloqdia" data-tooltip="Inhabilita franjas horarias por licencias, feriados, capacitaciones o terreno (envía citas a Reagendar)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Bloquear
          </button>
          <button class="btn btn-desbloq-accion" id="a-desbloqdia" data-tooltip="Libera y reactiva bloques previamente bloqueados para volver a citar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
            Desbloquear
          </button>
        </div>
      </div>
    </div>
    <div class="panel"><div id="a-grid">Cargando...</div></div>`;

  $('#a-fecha').onchange = (e) => { estadoAgenda.fecha = e.target.value; renderAgenda(); };
  $('#a-exam').onchange = (e) => { estadoAgenda.examinador_id = e.target.value; renderAgenda(); };
  $('#dia-prev').onclick = async () => { estadoAgenda.fecha = await proximoDiaConAgenda(estadoAgenda.fecha, -1); renderAgenda(); };
  $('#dia-next').onclick = async () => { estadoAgenda.fecha = await proximoDiaConAgenda(estadoAgenda.fecha, 1); renderAgenda(); };
  $('#a-hoy').onclick = async () => { estadoAgenda.fecha = await fechaInicialAgenda(); renderAgenda(); };
  $('#a-bloqdia').onclick = () => dialogoBloquearDia();
  $('#a-desbloqdia').onclick = () => dialogoDesbloquearDia();
  if ($('#a-porconfirmar')) $('#a-porconfirmar').onclick = () => irA('porconfirmar');
  const btnV = $('#btn-vista-vertical');
  const btnH = $('#btn-vista-horizontal');
  if (btnV && btnH) {
    btnV.onclick = () => {
      estadoAgenda.modoVista = 'vertical';
      localStorage.setItem('agenda_modo_vista', 'vertical');
      renderAgenda();
    };
    btnH.onclick = () => {
      estadoAgenda.modoVista = 'horizontal';
      localStorage.setItem('agenda_modo_vista', 'horizontal');
      renderAgenda();
    };
  }


  const q = new URLSearchParams({ fecha: estadoAgenda.fecha });
  if (estadoAgenda.examinador_id) q.set('examinador_id', estadoAgenda.examinador_id);
  const fecha = estadoAgenda.fecha;
  await cargarVista('agenda', `/agenda?${q}`, (filas) => {
    const libres = filas.filter((f) => !f.rut && !f.nombre && !f.bloqueado).length;
    $('#a-libres').textContent = `${libres} ${libres === 1 ? 'bloque libre' : 'bloques libres'}`;
    pintarGrilla($('#a-grid'), filas, fecha);
    restaurarScroll();
    requestAnimationFrame(ajustarOffsetsFijos);
  });
  actualizarBadgePapelera();
  actualizarBadgeErrores();
  actualizarBadgeReagendar();
  actualizarBadgePorConfirmar();
}

async function dialogoPorConfirmar() { irA('porconfirmar'); return;

  const hasta = sumarDias(hoy(), 7);
  const rows = (await api('/agenda?estado=porconfirmar'))
    .filter((r) => r.fecha <= hasta);
  modal('Citas por confirmar (proximos 7 dias)', `
    <div class="ancho tabla-scroll"><table><thead><tr><th class="c">Fecha</th><th class="c">Hora</th><th>Nombre</th><th>Teléfono</th><th>Correo</th><th class="c"></th></tr></thead>
    <tbody id="pc-body">${rows.length ? rows.map((r) => `<tr data-id="${r.id}">
      <td class="c">${esc(fFecha(r.fecha))}</td><td class="c">${esc(r.hora)}</td><td>${esc(nom(r.nombre))}</td>
      <td class="c num">${esc(fTel(r.contacto))}</td><td>${esc(r.correo)}</td>
      <td><button class="btn chico" data-si="${r.id}">Confirmo</button>
          <button class="btn chico sec" data-no="${r.id}">No</button></td></tr>`).join('')
      : licoVacioFila(6, 'celebra', '¡Nada por confirmar!', 'Todo en orden por aquí.')}</tbody></table></div>
  `, `<button class="btn sec" id="pc-cerrar">Cerrar</button>`);
  $('#pc-cerrar').onclick = () => { cerrarModal(); recargar(renderAgenda)(); };
  const marcar = async (id, val) => {
    const b = await api(`/agenda/${id}`);
    await api(`/agenda/${id}`, { method: 'PUT', body: {
      visto_en: b.actualizado_en, rut: b.rut, nombre: b.nombre, clase: b.clase,
      contacto: b.contacto, correo: b.correo, tipo_cita: b.tipo_cita,
      motivo_reagendamiento: b.motivo_reagendamiento, lista_espera: b.lista_espera,
      intento: b.intento, funcionario_id: b.funcionario_id, fecha_inicio_tramite: b.fecha_inicio_tramite,
      resultado: b.resultado, comentarios: b.comentarios, confirmo_asistencia: val,
      // El servidor los reinicia si faltan: se reenvian para no perder la marca de "pendiente de reagendar".
      pendiente_reagendar: b.pendiente_reagendar, pendiente_nota: b.pendiente_nota,
    } });
    const tr = $(`#pc-body tr[data-id="${id}"]`);
    if (tr) tr.remove();
    toast(val ? 'Confirmada' : 'Marcada como no confirma');
  };
  $('#pc-body').querySelectorAll('button[data-si]').forEach((el) => { el.onclick = () => marcar(Number(el.dataset.si), 1); });
  $('#pc-body').querySelectorAll('button[data-no]').forEach((el) => { el.onclick = () => marcar(Number(el.dataset.no), 0); });
}

// Bloquea todos los bloques de un examinador (o de todos) en un rango de fechas:
// permisos administrativos, licencias, feriado legal, compensatorios, etc.
const MOTIVOS_BLOQUEO_DEF = ['PERMISO ADMINISTRATIVO', 'LICENCIA MEDICA', 'FERIADO LEGAL', 'COMPENSATORIO', 'CAPACITACION', 'TERRENO'];
const ETQ_MOTIVO = {
  'LICENCIA MEDICA': 'Licencia médica',
  'FERIADO LEGAL': 'Feriado legal',
  'CAPACITACION': 'Capacitación',
  'COMPENSATORIO': 'Día compensatorio',
  'TERRENO': 'Examen en terreno',
  'TRASLADO': 'Traslado',
  'BLOQUEADO': 'Bloqueo administrativo'
};
function dialogoBloquearDia() {
  const motivos = META.motivos_bloqueo || MOTIVOS_BLOQUEO_DEF;
  const f = estadoAgenda.fecha || hoy();
  const horasDisponibles = (META && META.horas && META.horas.length) ? META.horas : [
    '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30'
  ];
  let modoActual = 'dias'; // 'dias' | 'horas'
  let horasSeleccionadas = new Set(['08:30', '09:00']);

  modal('🔒 Bloquear días u horas', `
    <div class="tabs-modo-bloq ancho">
      <button type="button" class="btn-tab-bloq activo" id="bd-tab-dias">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Día(s) completo(s)
      </button>
      <button type="button" class="btn-tab-bloq" id="bd-tab-horas">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Por horas / bloques específicos
      </button>
    </div>

    <div class="campo ancho"><label>Examinador</label><select id="bd-exam">
      <option value="" ${!estadoAgenda.examinador_id ? 'selected' : ''}>Todos los examinadores</option>
      ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(e.id) === String(estadoAgenda.examinador_id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
    </select></div>

    <!-- PANEL MODO DÍAS COMPLETOS -->
    <div id="bd-panel-dias" class="ancho" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px">
      <div class="campo" style="flex:1"><label>Desde fecha</label><input type="date" id="bd-desde" value="${f}"></div>
      <div class="campo" style="flex:1"><label>Hasta fecha</label><input type="date" id="bd-hasta" value="${f}"></div>
      <div class="ancho" style="margin-top:-4px"><button type="button" class="btn chico sec" id="bd-semana"
        title="Lleva Desde al lunes y Hasta al viernes de sus semanas">Ajustar a semanas completas (lun–vie)</button></div>
    </div>

    <!-- PANEL MODO HORAS / BLOQUES -->
    <div id="bd-panel-horas" class="ancho" style="display:none;flex-direction:column;gap:10px;margin-bottom:6px">
      <div style="display:flex;gap:10px;align-items:flex-end">
        <div class="campo" style="flex:1;margin:0"><label>Fecha</label><input type="date" id="bd-h-fecha" value="${f}"></div>
        <div class="campo" id="bd-h-c-hasta" style="flex:1;margin:0" hidden><label>Hasta fecha</label><input type="date" id="bd-h-hasta" value="${f}"></div>
        <button type="button" class="btn chico sec" id="bd-h-toggle-rango-dias" style="margin-bottom:2px" title="Permite aplicar el bloqueo horario a varios días consecutivos">Aplicar a varios días...</button>
      </div>

      <div style="background:#f8fafc;border:1px solid var(--linea,#e2e8f0);border-radius:8px;padding:12px;margin-top:2px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <label style="font-size:11px;font-weight:700;color:var(--tinta-2);text-transform:uppercase;margin:0">
            Selecciona los bloques a bloquear:
          </label>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn btn-xs sec" id="bd-h-quick-manana" style="font-size:11px;padding:2px 8px">Mañana (08:30-11:00)</button>
            <button type="button" class="btn btn-xs sec" id="bd-h-quick-tarde" style="font-size:11px;padding:2px 8px">Mediodía (11:30-13:30)</button>
            <button type="button" class="btn btn-xs sec" id="bd-h-quick-limpiar" style="font-size:11px;padding:2px 8px">Desmarcar</button>
          </div>
        </div>

        <!-- Selector directo de rango de horas -->
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
          <span style="font-size:11px;color:var(--tinta-3);font-weight:600">Rango rápido:</span>
          <select id="bd-h-sel-desde" style="padding:3px 8px;font-size:12px;border-radius:4px;border:1px solid #cbd5e1">
            ${horasDisponibles.map((h) => `<option value="${h}" ${h === '08:30' ? 'selected' : ''}>${h} hrs</option>`).join('')}
          </select>
          <span style="font-size:11px;color:var(--tinta-3)">a</span>
          <select id="bd-h-sel-hasta" style="padding:3px 8px;font-size:12px;border-radius:4px;border:1px solid #cbd5e1">
            ${horasDisponibles.map((h) => `<option value="${h}" ${h === '10:00' ? 'selected' : ''}>${h} hrs</option>`).join('')}
          </select>
          <button type="button" class="btn chico sec" id="bd-h-btn-marcar-rango" style="padding:3px 10px;font-size:12px">Marcar</button>
        </div>

        <!-- Chips interactivos para cada hora -->
        <div id="bd-horas-chips-cont" style="display:flex;flex-wrap:wrap;gap:6px">
          ${horasDisponibles.map((h) => {
            const esPesada = h === META.hora_d_a5;
            return `<button type="button" class="chip-hora ${horasSeleccionadas.has(h) ? 'activo' : ''}" data-hora="${h}">
              ${h}
              ${esPesada ? '<span style="font-size:9px;background:rgba(0,0,0,0.08);padding:1px 4px;border-radius:3px;margin-left:2px">D/A5</span>' : ''}
            </button>`;
          }).join('')}
        </div>

        <div id="bd-horas-seleccionadas-txt" style="font-size:12px;color:var(--azul,#0284c7);font-weight:700;margin-top:8px">
          2 bloques seleccionados: 08:30, 09:00
        </div>
      </div>
    </div>

    <!-- MOTIVO Y OPCIONES COMUNES -->
    <div class="campo ancho"><label>Motivo del bloqueo</label><select id="bd-motivo">
      ${motivos.map((m) => `<option value="${esc(m)}">${esc(ETQ_MOTIVO[m] || m.charAt(0) + m.slice(1).toLowerCase())}</option>`).join('')}
      <option value="__otro">Otro...</option></select></div>
    <div class="campo ancho" id="bd-otro-c" hidden><label>Otro motivo</label><input id="bd-otro" placeholder="Escribe el motivo"></div>
    <div class="campo ancho" id="bd-ocupados-c"><label><input type="checkbox" id="bd-ocupados" checked> Incluir bloques que ya tienen cita (se enviarán a Reagendar)</label></div>
    <div class="ancho aviso" id="bd-resumen" hidden></div>
  `, `
    <button class="btn sec" id="bd-cancel">Cancelar</button>
    <button class="btn btn-bloq-accion" id="bd-ok">Bloquear días u horas</button>
  `);

  // Switch de modo
  $('#bd-tab-dias').onclick = () => {
    modoActual = 'dias';
    $('#bd-tab-dias').classList.add('activo');
    $('#bd-tab-horas').classList.remove('activo');
    $('#bd-panel-dias').style.display = 'flex';
    $('#bd-panel-horas').style.display = 'none';
    previa();
  };

  $('#bd-tab-horas').onclick = () => {
    modoActual = 'horas';
    $('#bd-tab-dias').classList.remove('activo');
    $('#bd-tab-horas').classList.add('activo');
    $('#bd-panel-dias').style.display = 'none';
    $('#bd-panel-horas').style.display = 'flex';
    actualizarVistaChips();
    previa();
  };

  // Toggle multidia en modo horas
  $('#bd-h-toggle-rango-dias').onclick = () => {
    const cHasta = $('#bd-h-c-hasta');
    cHasta.hidden = !cHasta.hidden;
    $('#bd-h-toggle-rango-dias').textContent = cHasta.hidden ? 'Aplicar a varios días...' : 'Solo este día';
    $('#bd-h-toggle-rango-dias').classList.toggle('activo', !cHasta.hidden);
    if (!cHasta.hidden && !$('#bd-h-hasta').value) $('#bd-h-hasta').value = $('#bd-h-fecha').value;
    previa();
  };

  const actualizarVistaChips = () => {
    const cont = $('#bd-horas-chips-cont');
    if (!cont) return;
    cont.querySelectorAll('.chip-hora').forEach((btn) => {
      btn.classList.toggle('activo', horasSeleccionadas.has(btn.dataset.hora));
    });
    const info = $('#bd-horas-seleccionadas-txt');
    if (info) {
      const arr = Array.from(horasSeleccionadas).sort();
      if (!arr.length) {
        info.textContent = 'Ningún bloque seleccionado (haz clic en los horarios arriba)';
        info.style.color = 'var(--alerta, #dc2626)';
      } else {
        info.textContent = `${arr.length} ${arr.length === 1 ? 'bloque seleccionado' : 'bloques seleccionados'}: ${arr.join(', ')}`;
        info.style.color = 'var(--azul, #0284c7)';
      }
    }
  };

  const contChips = $('#bd-horas-chips-cont');
  if (contChips) {
    contChips.querySelectorAll('.chip-hora').forEach((btn) => {
      btn.onclick = () => {
        const h = btn.dataset.hora;
        if (horasSeleccionadas.has(h)) {
          horasSeleccionadas.delete(h);
        } else {
          horasSeleccionadas.add(h);
        }
        actualizarVistaChips();
        previa();
      };
    });
  }

  $('#bd-h-quick-manana').onclick = () => {
    horasSeleccionadas = new Set(['08:30', '09:00', '09:30', '10:00', '10:30', '11:00']);
    actualizarVistaChips();
    previa();
  };
  $('#bd-h-quick-tarde').onclick = () => {
    horasSeleccionadas = new Set(['11:30', '12:00', '12:30', '13:00', '13:30']);
    actualizarVistaChips();
    previa();
  };
  $('#bd-h-quick-limpiar').onclick = () => {
    horasSeleccionadas.clear();
    actualizarVistaChips();
    previa();
  };
  $('#bd-h-btn-marcar-rango').onclick = () => {
    const hd = $('#bd-h-sel-desde').value;
    const hh = $('#bd-h-sel-hasta').value;
    if (hh < hd) return toast('La hora hasta no puede ser anterior a la hora desde', 'err');
    horasDisponibles.forEach((h) => {
      if (h >= hd && h <= hh) horasSeleccionadas.add(h);
    });
    actualizarVistaChips();
    previa();
  };

  $('#bd-semana').onclick = () => {
    const mover = (iso, alDia) => {
      const d = new Date(`${iso}T12:00:00Z`);
      const dow = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - dow + alDia);
      return d.toISOString().slice(0, 10);
    };
    const desde = $('#bd-desde').value;
    if (!desde) return;
    $('#bd-desde').value = mover(desde, 0);
    $('#bd-hasta').value = mover($('#bd-hasta').value || desde, 4);
    previa();
  };

  const motivo = () => ($('#bd-motivo').value === '__otro' ? $('#bd-otro').value.trim() : $('#bd-motivo').value);
  
  const datos = () => {
    if (modoActual === 'dias') {
      return {
        desde: $('#bd-desde').value,
        hasta: $('#bd-hasta').value || $('#bd-desde').value,
        examinador_id: $('#bd-exam').value || null,
        motivo: motivo(),
        incluir_ocupados: $('#bd-ocupados').checked,
      };
    } else {
      const dDesde = $('#bd-h-fecha').value;
      const dHasta = ($('#bd-h-c-hasta') && !$('#bd-h-c-hasta').hidden && $('#bd-h-hasta').value)
        ? $('#bd-h-hasta').value
        : dDesde;
      return {
        desde: dDesde,
        hasta: dHasta,
        examinador_id: $('#bd-exam').value || null,
        motivo: motivo(),
        incluir_ocupados: $('#bd-ocupados').checked,
        horas: Array.from(horasSeleccionadas).sort(),
      };
    }
  };

  let tmr;
  let pedido = 0;
  const previa = () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const d = datos();
      const res = $('#bd-resumen');
      if (!res) return;
      if (!d.desde || d.hasta < d.desde) {
        res.hidden = false;
        res.textContent = 'Revisa las fechas: "Hasta" no puede ser anterior a "Desde".';
        $('#bd-ok').disabled = true;
        return;
      }
      if (modoActual === 'horas' && (!d.horas || !d.horas.length)) {
        res.hidden = false;
        res.textContent = 'Selecciona al menos un bloque u horario para bloquear.';
        $('#bd-ok').disabled = true;
        return;
      }

      const n = ++pedido;
      const dias = Math.round((Date.parse(d.hasta) - Date.parse(d.desde)) / 864e5) + 1;
      let txtEncabezado = '';
      if (modoActual === 'dias') {
        txtEncabezado = `${fFecha(d.desde)} al ${fFecha(d.hasta)} (${dias} ${dias === 1 ? 'día' : 'días'})`;
      } else {
        const hTxt = d.horas.join(', ');
        txtEncabezado = dias > 1
          ? `${fFecha(d.desde)} al ${fFecha(d.hasta)} (${dias} días) · ${d.horas.length} ${d.horas.length === 1 ? 'bloque' : 'bloques'} (${hTxt})`
          : `${fFecha(d.desde)} · ${d.horas.length} ${d.horas.length === 1 ? 'bloque' : 'bloques'} (${hTxt})`;
      }

      try {
        const r = await api('/bloquear-dia', { method: 'POST', body: { ...d, simular: true } });
        if (n !== pedido || !$('#bd-resumen')) return;
        let txt = `${txtEncabezado} · se bloquearán ${r.bloqueables} ${r.bloqueables === 1 ? 'bloque' : 'bloques'}.`;
        if (r.con_cita) {
          txt += d.incluir_ocupados
            ? ` ${r.con_cita} ${r.con_cita === 1 ? 'cita pasa' : 'citas pasan'} a la lista de Reagendamiento.`
            : ` Hay ${r.con_cita} ${r.con_cita === 1 ? 'cita' : 'citas'} en el rango que NO se tocan: reagéndalas o marca "Incluir bloques que ya tienen cita".`;
        }
        res.hidden = false;
        res.textContent = txt;
        $('#bd-ok').disabled = false;
        $('#bd-ok').textContent = r.bloqueables ? `Bloquear ${r.bloqueables} ${r.bloqueables === 1 ? 'bloque' : 'bloques'}` : 'Bloquear días u horas';
      } catch (e) {
        res.hidden = false;
        res.textContent = e.message;
        $('#bd-ok').disabled = false;
        $('#bd-ok').textContent = 'Bloquear días u horas';
      }
    }, 200);
  };

  $('#bd-motivo').onchange = () => {
    $('#bd-otro-c').hidden = $('#bd-motivo').value !== '__otro';
    previa();
  };
  $('#bd-otro').oninput = previa;
  $('#bd-desde').onchange = () => {
    if (!$('#bd-hasta').value || $('#bd-hasta').value < $('#bd-desde').value) $('#bd-hasta').value = $('#bd-desde').value;
    previa();
  };
  $('#bd-h-fecha').onchange = () => {
    if (!$('#bd-h-hasta').value || $('#bd-h-hasta').value < $('#bd-h-fecha').value) $('#bd-h-hasta').value = $('#bd-h-fecha').value;
    previa();
  };
  ['#bd-hasta', '#bd-h-hasta', '#bd-exam', '#bd-ocupados'].forEach((s) => {
    const el = $(s);
    if (el) el.onchange = previa;
  });
  previa();

  $('#bd-cancel').onclick = cerrarModal;
  $('#bd-ok').onclick = async () => {
    const d = datos();
    if ($('#bd-motivo').value === '__otro' && !d.motivo) return toast('Escribe el motivo del bloqueo', 'err');
    if (modoActual === 'horas' && (!d.horas || !d.horas.length)) {
      return toast('Debes seleccionar al menos un bloque u horario', 'err');
    }

    if (d.incluir_ocupados) {
      try {
        const sim = await api('/bloquear-dia', { method: 'POST', body: { ...d, simular: true } });
        if (sim.con_cita > 0) {
          const txt = sim.con_cita === 1 ? '1 postulante' : `${sim.con_cita} postulantes`;
          if (!confirm(`Se bloqueará el horario seleccionado.\n${txt} con cita agendada pasarán a la sección "Reagendar" para reasignarles un nuevo cupo.\n\n¿Deseas proceder con el bloqueo?`)) return;
        }
      } catch (err) {
        return toast(err.message, 'err');
      }
    }

    $('#bd-ok').disabled = true;
    try {
      const r = await api('/bloquear-dia', { method: 'POST', body: d });
      cerrarModal();
      if (!r.bloqueados) return toast('No había bloques disponibles en ese horario para bloquear', 'err');
      let msg = `${r.bloqueados} ${r.bloqueados === 1 ? 'bloque bloqueado' : 'bloques bloqueados'}`;
      if (r.a_reagendar) msg += ` · ${r.a_reagendar} citas movidas a Reagendar`;
      toast(msg, 'ok');
      actualizarBadgeReagendar();
      estadoAgenda.fecha = d.desde;
      await renderAgenda();
      if (r.a_reagendar && confirm(`Se bloquearon los bloques y ${r.a_reagendar} postulante(s) fueron enviados a Reagendar.\n\n¿Deseas ir a la pestaña Reagendar ahora para asignarles cupo?`)) {
        irA('reagendar');
      }
    } catch (e) {
      $('#bd-ok').disabled = false;
      toast(e.message, 'err');
    }
  };
}

async function dialogoDesbloquearDia() {
  const f = estadoAgenda.fecha || hoy();
  const examinadores = META.examinadores || [];
  const motivos = META.catalogos.bloqueo_motivo || [];
  const horasDisponibles = (META && META.horas && META.horas.length) ? META.horas : [
    '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30'
  ];
  let modoActual = 'dias'; // 'dias' | 'horas'
  let horasSeleccionadas = new Set(['08:30', '09:00']);

  modal('🔓 Desbloquear días u horas', `
    <div class="tabs-modo-bloq ancho">
      <button type="button" class="btn-tab-bloq activo" id="desb-tab-dias">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Día(s) completo(s)
      </button>
      <button type="button" class="btn-tab-bloq" id="desb-tab-horas">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Por horas / bloques específicos
      </button>
    </div>

    <div class="campo ancho"><label>Examinador</label><select id="desb-exam">
      <option value="" ${!estadoAgenda.examinador_id ? 'selected' : ''}>Todos los examinadores</option>
      ${examinadores.filter((e) => e.activo !== false).map((e) => `<option value="${e.id}" ${String(e.id) === String(estadoAgenda.examinador_id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
    </select></div>

    <!-- PANEL MODO DÍAS COMPLETOS -->
    <div id="desb-panel-dias" class="ancho" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px">
      <div class="campo" style="flex:1"><label>Desde fecha</label><input type="date" id="desb-desde" value="${f}"></div>
      <div class="campo" style="flex:1"><label>Hasta fecha</label><input type="date" id="desb-hasta" value="${f}"></div>
      <div class="ancho" style="margin-top:-4px"><button type="button" class="btn chico sec" id="desb-semana"
        title="Lleva Desde al lunes y Hasta al viernes de sus semanas">Ajustar a semanas completas (lun–vie)</button></div>
    </div>

    <!-- PANEL MODO HORAS / BLOQUES -->
    <div id="desb-panel-horas" class="ancho" style="display:none;flex-direction:column;gap:10px;margin-bottom:6px">
      <div style="display:flex;gap:10px;align-items:flex-end">
        <div class="campo" style="flex:1;margin:0"><label>Fecha</label><input type="date" id="desb-h-fecha" value="${f}"></div>
        <div class="campo" id="desb-h-c-hasta" style="flex:1;margin:0" hidden><label>Hasta fecha</label><input type="date" id="desb-h-hasta" value="${f}"></div>
        <button type="button" class="btn chico sec" id="desb-h-toggle-rango-dias" style="margin-bottom:2px" title="Permite aplicar el desbloqueo horario a varios días consecutivos">Aplicar a varios días...</button>
      </div>

      <div style="background:#f8fafc;border:1px solid var(--linea,#e2e8f0);border-radius:8px;padding:12px;margin-top:2px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <label style="font-size:11px;font-weight:700;color:var(--tinta-2);text-transform:uppercase;margin:0">
            Selecciona los bloques a desbloquear:
          </label>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn btn-xs sec" id="desb-h-quick-manana" style="font-size:11px;padding:2px 8px">Mañana (08:30-11:00)</button>
            <button type="button" class="btn btn-xs sec" id="desb-h-quick-tarde" style="font-size:11px;padding:2px 8px">Mediodía (11:30-13:30)</button>
            <button type="button" class="btn btn-xs sec" id="desb-h-quick-todos" style="font-size:11px;padding:2px 8px">Todos</button>
            <button type="button" class="btn btn-xs sec" id="desb-h-quick-limpiar" style="font-size:11px;padding:2px 8px">Desmarcar</button>
          </div>
        </div>

        <!-- Selector directo de rango de horas -->
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
          <span style="font-size:11px;color:var(--tinta-3);font-weight:600">Rango rápido:</span>
          <select id="desb-h-sel-desde" style="padding:3px 8px;font-size:12px;border-radius:4px;border:1px solid #cbd5e1">
            ${horasDisponibles.map((h) => `<option value="${h}" ${h === '08:30' ? 'selected' : ''}>${h} hrs</option>`).join('')}
          </select>
          <span style="font-size:11px;color:var(--tinta-3)">a</span>
          <select id="desb-h-sel-hasta" style="padding:3px 8px;font-size:12px;border-radius:4px;border:1px solid #cbd5e1">
            ${horasDisponibles.map((h) => `<option value="${h}" ${h === '10:00' ? 'selected' : ''}>${h} hrs</option>`).join('')}
          </select>
          <button type="button" class="btn chico sec" id="desb-h-btn-marcar-rango" style="padding:3px 10px;font-size:12px">Marcar</button>
        </div>

        <!-- Chips interactivos para cada hora -->
        <div id="desb-horas-chips-cont" style="display:flex;flex-wrap:wrap;gap:6px">
          ${horasDisponibles.map((h) => {
            const esPesada = h === META.hora_d_a5;
            return `<button type="button" class="chip-hora ${horasSeleccionadas.has(h) ? 'activo' : ''}" data-hora="${h}">
              ${h}
              ${esPesada ? '<span style="font-size:9px;background:rgba(0,0,0,0.08);padding:1px 4px;border-radius:3px;margin-left:2px">D/A5</span>' : ''}
            </button>`;
          }).join('')}
        </div>

        <div id="desb-horas-seleccionadas-txt" style="font-size:12px;color:var(--azul,#0284c7);font-weight:700;margin-top:8px">
          2 bloques seleccionados: 08:30, 09:00
        </div>
      </div>
    </div>

    <!-- MOTIVO ESPECÍFICO (OPCIONAL) -->
    <div class="campo ancho"><label>Motivo específico a desbloquear (opcional)</label><select id="desb-motivo">
      <option value="">Todos los motivos (desbloquear cualquier causa)</option>
      ${motivos.map((m) => `<option value="${esc(m)}">${esc(ETQ_MOTIVO[m] || m.charAt(0) + m.slice(1).toLowerCase())}</option>`).join('')}
    </select></div>
    <div class="ancho aviso" id="desb-resumen" hidden></div>
  `, `
    <button class="btn sec" id="desb-cancel">Cancelar</button>
    <button class="btn btn-desbloq-accion" id="desb-ok">Desbloquear días u horas</button>
  `);

  // Switch de modo
  $('#desb-tab-dias').onclick = () => {
    modoActual = 'dias';
    $('#desb-tab-dias').classList.add('activo');
    $('#desb-tab-horas').classList.remove('activo');
    $('#desb-panel-dias').style.display = 'flex';
    $('#desb-panel-horas').style.display = 'none';
    previa();
  };

  $('#desb-tab-horas').onclick = () => {
    modoActual = 'horas';
    $('#desb-tab-dias').classList.remove('activo');
    $('#desb-tab-horas').classList.add('activo');
    $('#desb-panel-dias').style.display = 'none';
    $('#desb-panel-horas').style.display = 'flex';
    actualizarVistaChips();
    previa();
  };

  // Toggle multidia en modo horas
  $('#desb-h-toggle-rango-dias').onclick = () => {
    const cHasta = $('#desb-h-c-hasta');
    cHasta.hidden = !cHasta.hidden;
    $('#desb-h-toggle-rango-dias').textContent = cHasta.hidden ? 'Aplicar a varios días...' : 'Solo este día';
    $('#desb-h-toggle-rango-dias').classList.toggle('activo', !cHasta.hidden);
    if (!cHasta.hidden && !$('#desb-h-hasta').value) $('#desb-h-hasta').value = $('#desb-h-fecha').value;
    previa();
  };

  const actualizarVistaChips = () => {
    const cont = $('#desb-horas-chips-cont');
    if (!cont) return;
    cont.querySelectorAll('.chip-hora').forEach((btn) => {
      btn.classList.toggle('activo', horasSeleccionadas.has(btn.dataset.hora));
    });
    const info = $('#desb-horas-seleccionadas-txt');
    if (info) {
      const arr = Array.from(horasSeleccionadas).sort();
      if (!arr.length) {
        info.textContent = 'Ningún bloque seleccionado (haz clic en los horarios arriba)';
        info.style.color = 'var(--alerta, #dc2626)';
      } else {
        info.textContent = `${arr.length} ${arr.length === 1 ? 'bloque seleccionado' : 'bloques seleccionados'}: ${arr.join(', ')}`;
        info.style.color = 'var(--azul, #0284c7)';
      }
    }
  };

  const contChips = $('#desb-horas-chips-cont');
  if (contChips) {
    contChips.querySelectorAll('.chip-hora').forEach((btn) => {
      btn.onclick = () => {
        const h = btn.dataset.hora;
        if (horasSeleccionadas.has(h)) {
          horasSeleccionadas.delete(h);
        } else {
          horasSeleccionadas.add(h);
        }
        actualizarVistaChips();
        previa();
      };
    });
  }

  $('#desb-h-quick-manana').onclick = () => {
    horasSeleccionadas = new Set(['08:30', '09:00', '09:30', '10:00', '10:30', '11:00']);
    actualizarVistaChips();
    previa();
  };
  $('#desb-h-quick-tarde').onclick = () => {
    horasSeleccionadas = new Set(['11:30', '12:00', '12:30', '13:00', '13:30']);
    actualizarVistaChips();
    previa();
  };
  $('#desb-h-quick-todos').onclick = () => {
    horasSeleccionadas = new Set(horasDisponibles);
    actualizarVistaChips();
    previa();
  };
  $('#desb-h-quick-limpiar').onclick = () => {
    horasSeleccionadas.clear();
    actualizarVistaChips();
    previa();
  };
  $('#desb-h-btn-marcar-rango').onclick = () => {
    const hd = $('#desb-h-sel-desde').value;
    const hh = $('#desb-h-sel-hasta').value;
    if (hh < hd) return toast('La hora hasta no puede ser anterior a la hora desde', 'err');
    horasDisponibles.forEach((h) => {
      if (h >= hd && h <= hh) horasSeleccionadas.add(h);
    });
    actualizarVistaChips();
    previa();
  };

  $('#desb-semana').onclick = () => {
    const mover = (iso, alDia) => {
      const d = new Date(`${iso}T12:00:00Z`);
      const dow = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - dow + alDia);
      return d.toISOString().slice(0, 10);
    };
    const desde = $('#desb-desde').value;
    if (!desde) return;
    $('#desb-desde').value = mover(desde, 0);
    $('#desb-hasta').value = mover($('#desb-hasta').value || desde, 4);
    previa();
  };

  const datos = () => {
    if (modoActual === 'dias') {
      return {
        desde: $('#desb-desde').value,
        hasta: $('#desb-hasta').value || $('#desb-desde').value,
        examinador_id: $('#desb-exam').value || null,
        motivo: $('#desb-motivo').value || null,
      };
    } else {
      const dDesde = $('#desb-h-fecha').value;
      const dHasta = ($('#desb-h-c-hasta') && !$('#desb-h-c-hasta').hidden && $('#desb-h-hasta').value)
        ? $('#desb-h-hasta').value
        : dDesde;
      return {
        desde: dDesde,
        hasta: dHasta,
        examinador_id: $('#desb-exam').value || null,
        motivo: $('#desb-motivo').value || null,
        horas: Array.from(horasSeleccionadas).sort(),
      };
    }
  };

  let tmr;
  let pedido = 0;
  const previa = () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const d = datos();
      const res = $('#desb-resumen');
      if (!res) return;
      if (!d.desde || d.hasta < d.desde) {
        res.hidden = false;
        res.textContent = 'Revisa las fechas: "Hasta" no puede ser anterior a "Desde".';
        $('#desb-ok').disabled = true;
        return;
      }
      if (modoActual === 'horas' && (!d.horas || !d.horas.length)) {
        res.hidden = false;
        res.textContent = 'Selecciona al menos un bloque u horario para desbloquear.';
        $('#desb-ok').disabled = true;
        return;
      }

      const n = ++pedido;
      const dias = Math.round((Date.parse(d.hasta) - Date.parse(d.desde)) / 864e5) + 1;
      let txtEncabezado = '';
      if (modoActual === 'dias') {
        txtEncabezado = `${fFecha(d.desde)} al ${fFecha(d.hasta)} (${dias} ${dias === 1 ? 'día' : 'días'})`;
      } else {
        const hTxt = d.horas.join(', ');
        txtEncabezado = dias > 1
          ? `${fFecha(d.desde)} al ${fFecha(d.hasta)} (${dias} días) · ${d.horas.length} ${d.horas.length === 1 ? 'bloque' : 'bloques'} (${hTxt})`
          : `${fFecha(d.desde)} · ${d.horas.length} ${d.horas.length === 1 ? 'bloque' : 'bloques'} (${hTxt})`;
      }

      try {
        const r = await api('/desbloquear-dia', { method: 'POST', body: { ...d, simular: true } });
        if (n !== pedido || !$('#desb-resumen')) return;
        const total = r.desbloqueables || 0;
        let txt = `${txtEncabezado} · se reactivarán ${total} ${total === 1 ? 'bloque bloqueado' : 'bloques bloqueados'}.`;
        if (total === 0) {
          txt += ' No hay bloques bloqueados que coincidan con estos criterios.';
        }
        res.hidden = false;
        res.textContent = txt;
        $('#desb-ok').disabled = false;
        $('#desb-ok').textContent = total ? `Desbloquear ${total} ${total === 1 ? 'bloque' : 'bloques'}` : 'Desbloquear días u horas';
      } catch (e) {
        res.hidden = false;
        res.textContent = e.message;
        $('#desb-ok').disabled = false;
        $('#desb-ok').textContent = 'Desbloquear días u horas';
      }
    }, 200);
  };

  $('#desb-motivo').onchange = previa;
  $('#desb-desde').onchange = () => {
    if (!$('#desb-hasta').value || $('#desb-hasta').value < $('#desb-desde').value) $('#desb-hasta').value = $('#desb-desde').value;
    previa();
  };
  $('#desb-h-fecha').onchange = () => {
    if (!$('#desb-h-hasta').value || $('#desb-h-hasta').value < $('#desb-h-fecha').value) $('#desb-h-hasta').value = $('#desb-h-fecha').value;
    previa();
  };
  ['#desb-hasta', '#desb-h-hasta', '#desb-exam'].forEach((s) => {
    const el = $(s);
    if (el) el.onchange = previa;
  });
  previa();

  $('#desb-cancel').onclick = cerrarModal;
  $('#desb-ok').onclick = async () => {
    const d = datos();
    if (modoActual === 'horas' && (!d.horas || !d.horas.length)) {
      return toast('Debes seleccionar al menos un bloque u horario para desbloquear', 'err');
    }

    $('#desb-ok').disabled = true;
    try {
      const r = await api('/desbloquear-dia', { method: 'POST', body: d });
      cerrarModal();
      if (!r.desbloqueados) return toast('No había bloques bloqueados que coincidieran con la selección', 'alerta');
      toast(`${r.desbloqueados} ${r.desbloqueados === 1 ? 'bloque desbloqueado y reactivado' : 'bloques desbloqueados y reactivados'} exitosamente`, 'ok');
      estadoAgenda.fecha = d.desde;
      await renderAgenda();
    } catch (e) {
      $('#desb-ok').disabled = false;
      toast(e.message, 'err');
    }
  };
}

// Motivo corto si a la cita le falta algun dato clave, o null si esta bien.
// Mismo criterio que el Reporte de errores, pero visible directo en la tarjeta.
function problemaDatos(b) {
  if (b.rut && !rutEsValido(b.rut)) return 'RUT con dígito verificador inválido';
  if (!b.contacto && !b.correo) return 'Sin teléfono ni correo: no se puede avisar ni confirmar';
  if (b.contacto && b.contacto.replace(/\D/g, '').length !== 9) return 'Teléfono incompleto';
  return null;
}
// Historial del solicitante dentro del panel lateral de la ficha. Cada cita se puede abrir.
async function cargarHistorialCita(b, alGuardar) {
  const cont = $('#zona-hist-cita .hist-lista');
  if (!cont) return;
  const params = new URLSearchParams();
  if (b.rut) params.set('rut', b.rut);
  if (b.nombre) params.set('nombre', b.nombre);
  try {
    const rows = await api(`/buscar-historial?${params.toString()}`);
    if (!document.body.contains(cont)) return;
    if (!Array.isArray(rows) || !rows.length) { cont.textContent = 'Sin citas registradas'; return; }
    pintarAvisoIntento(b, rows);
    cont.innerHTML = rows.map((r) => {
      const actual = r.id === b.id;
      return `<div class="hist-item ${actual ? 'actual' : ''}" ${actual ? '' : `role="button" tabindex="0" data-id="${r.id}"`}>
        <div class="hist-fila"><b>${esc(fFecha(r.fecha))}</b> · ${esc(r.hora)} hrs${actual ? '<span class="badge reag">Cita actual</span>' : ''}<span class="hist-clase">${esc(r.clase || '-')}</span></div>
        <div class="hist-sub">Examinador: ${esc(r.examinador || '-')}</div>
        <div class="hist-sub">Resultado: <b>${esc(r.resultado || 'Sin resultado')}</b></div>
        <div class="hist-sub">Inicio trámite: <b>${r.fecha_inicio_tramite ? esc(fFecha(r.fecha_inicio_tramite)) : 'Sin registrar'}</b>${r.fecha_vencimiento_tramite ? ` · Vence: <b>${esc(fFecha(r.fecha_vencimiento_tramite))}</b>` : ''}</div>
        ${r.dias_restantes_tramite != null ? `<div class="hist-sub">${cuentaRegresivaHtml(r.dias_restantes_tramite, r.fecha_vencimiento_tramite)}</div>` : ''}
        ${r.escuela_conductores ? `<div class="hist-sub">Escuela: ${esc(r.escuela_conductores)}</div>` : ''}
        ${r.tipo_reagendamiento ? `<div class="hist-sub">Reagendamiento: ${esc(r.tipo_reagendamiento)}</div>` : ''}
        ${(r.alerts || []).length ? `<div class="hist-sub">${alertasHtml(r)}</div>` : ''}
      </div>`;
    }).join('');
    cont.querySelectorAll('.hist-item[data-id]').forEach((el) => {
      const abrir = () => abrirSlotPorId(Number(el.dataset.id), alGuardar).catch((e) => toast(e.message, 'err'));
      el.onclick = abrir;
      el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); } };
    });
  } catch (e) {
    if (document.body.contains(cont)) cont.textContent = 'No se pudo cargar el historial';
  }
}

// Reprobaciones previas (mismo RUT, alguna clase en comun) antes de esta cita.
const RESULTADOS_REPROBADO = ['REPROBADO', 'REPROBADO INASISTENCIA'];
function reprobacionesPrevias(b, rows) {
  if (!b.rut) return 0;
  const clases = clasesDe(b.clase);
  return rows.filter((r) => r.id !== b.id && r.fecha <= b.fecha
    && RESULTADOS_REPROBADO.includes(r.resultado)
    && clasesDe(r.clase).some((c) => clases.includes(c))).length;
}
const ordinalIntento = (n) => (n === 3 ? '3er' : `${n}°`);
// Aviso (no bloquea): con 2+ reprobaciones previas en la misma clase, este es el 3er intento o mas.
function pintarAvisoIntento(b, rows) {
  const zona = $('#f-intento-aviso');
  const previas = reprobacionesPrevias(b, rows);
  if (!zona || previas < 2) return;
  zona.innerHTML = `<span class="badge reprob" title="${previas} reprobaciones previas en la misma clase">⚠ ${ordinalIntento(previas + 1)} intento</span>`;
  zona.hidden = false;
}

// Ficha imprimible: documento municipal con datos del postulante + historial, en una ventana aparte.
const siNo = (v) => (v === 1 ? 'SÍ' : v === 0 ? 'NO' : '');
function estadoTramiteTxt(b) {
  const d = b.dias_restantes_tramite;
  if (d == null) return b.fecha_inicio_tramite ? '' : 'Sin fecha de inicio registrada';
  return d <= 0 ? `VENCIDO (hace ${diasTxt(-d)})` : `Vigente · quedan ${diasTxt(d)}`;
}
const FICHA_SECCIONES = [
  ['Datos personales', [
    ['Nombre', (b) => nom(b.nombre)], ['RUT', (b) => b.rut],
    ['Teléfono', (b) => fTel(b.contacto)], ['Correo', (b) => b.correo],
  ]],
  ['Trámite', [
    ['Clase(s)', (b) => b.clase], ['Escuela de conductores', (b) => b.escuela_conductores],
    ['Fecha de inicio', (b) => (b.fecha_inicio_tramite ? fFecha(b.fecha_inicio_tramite) : '')],
    ['Fecha de vencimiento', (b) => (b.fecha_vencimiento_tramite ? fFecha(b.fecha_vencimiento_tramite) : '')],
    ['Estado / días restantes', estadoTramiteTxt], ['Intento', (b) => b.intento],
    ['Tipo de cita', (b) => b.tipo_cita], ['Tipo de reagendamiento', (b) => b.tipo_reagendamiento],
  ]],
  ['Resultado', [
    ['Confirmó asistencia', (b) => siNo(b.confirmo_asistencia)], ['Resultado', (b) => b.resultado],
    ['Comentarios', (b) => b.comentarios, true],
  ]],
];
const FICHA_CSS = `@page{size:A4;margin:16mm 15mm 18mm}
*{box-sizing:border-box}body{font:10.5pt/1.4 "Segoe UI",Arial,Helvetica,sans-serif;color:#000;background:#fff;margin:0}
.doc-hd{display:flex;align-items:center;gap:14px;border-bottom:2px solid #000;padding-bottom:10px}
.doc-hd img{height:64px;width:auto}.doc-hd .org{flex:1}.doc-hd .org b{display:block;font-size:11pt;letter-spacing:.02em}
.doc-hd .org span{font-size:9pt;color:#333}.doc-hd .emi{font-size:8.5pt;text-align:right;color:#333;white-space:nowrap}
h1{font:700 15pt/1.25 Georgia,"Times New Roman",serif;text-align:center;margin:16px 0 2px}
.sub{text-align:center;font-size:9pt;color:#333;margin:0 0 14px}
.cita{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #000;margin-bottom:12px}
.cita div{padding:6px 8px;border-right:1px solid #999}.cita div:last-child{border-right:0}
.lbl{display:block;font-size:7.5pt;text-transform:uppercase;letter-spacing:.05em;color:#444}
.val{font-weight:600}h2{font:700 11pt Georgia,"Times New Roman",serif;border-bottom:1px solid #000;margin:14px 0 6px;padding-bottom:2px}
.grid{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #bbb;border-left:1px solid #bbb}
.grid div{padding:5px 8px;border-right:1px solid #bbb;border-bottom:1px solid #bbb;break-inside:avoid}.grid .ancho{grid-column:1/-1}
table{border-collapse:collapse;width:100%;font-size:9pt}th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#e9e9e9;font-size:8pt;text-transform:uppercase;letter-spacing:.03em}tbody tr:nth-child(even) td{background:#f5f5f5}
tr{break-inside:avoid;page-break-inside:avoid}thead{display:table-header-group}
.firmas{display:flex;gap:60px;margin-top:60px;break-inside:avoid}.firmas div{flex:1;border-top:1px solid #000;text-align:center;padding-top:4px;font-size:9pt}
.pie{margin-top:24px;border-top:1px solid #999;padding-top:4px;font-size:8pt;color:#444;display:flex;justify-content:space-between}
@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
function fichaImprimibleHtml(b, rows, logoUrl) {
  const ahora = new Date();
  const emitido = `${fFecha(hoy())} ${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')} hrs`;
  const celda = (t, v, ancho) => `<div${ancho ? ' class="ancho"' : ''}><span class="lbl">${esc(t)}</span><span class="val">${esc(v || '—')}</span></div>`;
  const cita = [['Fecha', fFecha(b.fecha)], ['Hora', b.hora ? `${b.hora} hrs` : ''], ['Examinador/a', b.examinador], ['Funcionario/a', b.funcionario]]
    .map(([t, v]) => celda(t, v)).join('');
  const secciones = FICHA_SECCIONES.map(([titulo, campos]) => `<h2>${esc(titulo)}</h2>
    <div class="grid">${campos.map(([t, f, ancho]) => celda(t, f(b), ancho)).join('')}</div>`).join('');
  const hist = rows.length ? rows.map((r) => `<tr>
    <td>${esc(fFecha(r.fecha))} ${esc(r.hora || '')}</td><td>${esc(r.clase || '—')}</td><td>${r.fecha_inicio_tramite ? esc(fFecha(r.fecha_inicio_tramite)) : '—'}</td><td>${r.fecha_vencimiento_tramite ? esc(fFecha(r.fecha_vencimiento_tramite)) : '—'}</td><td>${esc(r.examinador || '—')}</td>
    <td>${esc(r.resultado || 'Sin resultado')}</td><td>${esc(r.escuela_conductores || '—')}</td><td>${esc(r.comentarios || '')}</td></tr>`).join('')
    : '<tr><td colspan="8">Sin citas registradas</td></tr>';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ficha ${esc(nom(b.nombre))}</title>
    <style>${FICHA_CSS}</style></head><body>
    <header class="doc-hd"><img id="ficha-logo" src="${esc(logoUrl)}" alt="${esc(MARCA.organismo)}">
      <div class="org"><b>Ilustre ${esc(MARCA.organismo)}</b><span>Dirección de Tránsito y Transporte Público · ${esc(MARCA.unidad)}</span></div>
      <div class="emi">Emitido el<br>${esc(emitido)}</div></header>
    <h1>Ficha del Postulante — Examen Práctico de Conducir</h1>
    <p class="sub">Dirección de Tránsito y Transporte Público — Ilustre ${esc(MARCA.organismo)}</p>
    <div class="cita">${cita}</div>
    ${secciones}
    <h2>Historial de citas</h2>
    <table><thead><tr><th>Fecha</th><th>Clase</th><th>Inicio trámite</th><th>Término trámite</th><th>Examinador/a</th><th>Resultado</th><th>Escuela</th><th>Comentarios</th></tr></thead>
    <tbody>${hist}</tbody></table>
    <div class="firmas"><div>Firma funcionario/a</div><div>Firma postulante</div></div>
    <footer class="pie"><span>Documento generado por Agenda de Prácticos</span></footer>
    </body></html>`;
}
async function imprimirFicha(b) {
  const params = new URLSearchParams();
  if (b.rut) params.set('rut', b.rut);
  if (b.nombre) params.set('nombre', b.nombre);
  const rows = await api(`/buscar-historial?${params.toString()}`);
  const w = window.open('', '_blank');
  if (!w) { toast('El navegador bloqueó la ventana de impresión', 'err'); return; }
  w.document.write(fichaImprimibleHtml(b, Array.isArray(rows) ? rows : [], `${location.origin}/logo.png`));
  w.document.close();
  w.focus();
  // Espera a que cargue el logo (o falle) antes de imprimir, con tope de 3 s.
  const img = w.document.getElementById('ficha-logo');
  let impreso = false;
  const imprimir = () => { if (!impreso) { impreso = true; w.print(); } };
  if (!img || img.complete) { imprimir(); return; }
  img.addEventListener('load', imprimir);
  img.addEventListener('error', () => { img.remove(); imprimir(); });
  setTimeout(imprimir, 3000);
}

// Esc cierra el panel lateral de la ficha.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.querySelector('#modal-root .modal.lateral')) cerrarModal();
});

// Boton "Historial" en las tarjetas de la cuadricula: abre la ficha editable en el panel lateral.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-hist');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  abrirSlotPorId(Number(btn.dataset.id), () => { if ($('#a-grid')) renderAgenda(); })
    .catch((err) => toast(err.message, 'err'));
}, true);

function slotCard(b) {
  if (!b) return '<div class="slot libre">—</div>';
  if (b.bloqueado) {
    return `<div class="slot bloqueado" role="button" tabindex="0" data-id="${b.id}">
      <span class="nombre">&#128274; ${esc(b.bloqueo_motivo || 'BLOQUEADO')}</span>
      <span class="sub">No disponible</span></div>`;
  }
  const ocupada = b.rut || b.nombre;
  const res = b.resultado === 'APROBADO' ? 'res-aprob'
    : (b.resultado === 'REPROBADO' || b.resultado === 'REPROBADO INASISTENCIA') ? 'res-reprob' : '';
  const cls = ['slot', ocupada ? 'ocupada' : 'libre', b.hora === META.hora_d_a5 ? 'pesada' : '', res]
    .filter(Boolean).join(' ');

  if (!ocupada) {
    return `<div class="${cls}" style="cursor:default">
      <span class="sub" style="color:var(--tinta-3);font-size:11px">—</span>
      ${b.hora === META.hora_d_a5 ? '<span class="badges"><span class="badge dpesada">Bloque para D y A5</span></span>' : ''}
    </div>`;
  }

  const badges = [];
  if (b.intento) {
    const int = String(b.intento).toUpperCase();
    if (int.includes('1') || int.includes('PRIMERA')) badges.push('<span class="badge intento-1">1° vez</span>');
    else if (int.includes('2') || int.includes('SEGUNDA')) badges.push('<span class="badge intento-2">2° vez</span>');
  }
  if (b.tipo_cita === 'REAGENDADO') badges.push('<span class="badge reag">Reagendada</span>');
  if (b.pendiente_reagendar) badges.push('<span class="badge reag">Pendiente de reagendar</span>');
  if (b.confirmo_asistencia === 1) badges.push('<span class="badge aprob">Confirmó asistencia</span>');
  if (b.resultado === 'APROBADO') badges.push('<span class="badge aprob">Aprobó</span>');
  else if (b.resultado === 'REPROBADO') badges.push('<span class="badge reprob">Reprobó</span>');
  else if (b.resultado) badges.push('<span class="badge noasiste">' + esc(b.resultado) + '</span>');

  // Marcado rapido de resultado (solo citas de hoy o pasadas)
  const noAsiste = b.resultado === 'NO ASISTIO' || b.resultado === 'REPROBADO INASISTENCIA';
  const acc = b.fecha <= META.hoy ? `<span class="slot-res" data-id="${b.id}">
    <span class="sr sr-a ${b.resultado === 'APROBADO' ? 'on' : ''}" role="button" tabindex="0" data-r="APROBADO">Aprobó</span>
    <span class="sr sr-r ${b.resultado === 'REPROBADO' ? 'on' : ''}" role="button" tabindex="0" data-r="REPROBADO">Reprobó</span>
    <span class="sr sr-n ${noAsiste ? 'on' : ''}" role="button" tabindex="0" data-r="NO ASISTIO">No asistió</span>
  </span>` : '';

  const problema = problemaDatos(b);
  const esConfirmado = b.confirmo_asistencia === 1;
  const numLimpio = String(b.contacto || '').replace(/\D/g, '');
  const telWa = numLimpio.startsWith('56') ? numLimpio : (numLimpio.length === 9 ? '56' + numLimpio : '');
  const nomP = nom(b.nombre) || 'Estimado/a postulante';
  const examP = b.examinador || (META.examinadores.find((e) => e.id === b.examinador_id) || {}).nombre || 'por asignar';
  const fechaP = fFecha(b.fecha);
  const horaP = b.hora || '';
  const claseP = b.clase ? ` (Clase ${b.clase})` : '';
  const mensajeWa = `Hola ${nomP}, te contactamos desde la Dirección de Tránsito respecto a tu examen práctico de conducir${claseP}. Te recordamos que tu cita está agendada para el día ${fechaP} a las ${horaP} hrs con el examinador ${examP}. Por favor confirma tu asistencia respondiendo a este mensaje.`;

  return `<div class="${cls}" data-id="${b.id}">
    ${problema ? `<span class="alerta-dato" title="${esc(problema)}">⚠</span>` : ''}
    <div class="slot-top">${b.dias_restantes_tramite != null ? cuentaRegresivaHtml(b.dias_restantes_tramite, b.fecha_vencimiento_tramite) : SIN_INICIO_HTML}</div>
    ${(b.alerts || []).length ? `<div class="slot-alertas">${alertasHtml(b)}</div>` : ''}
    <span class="nombre">${esc(nom(b.nombre) || '(SIN NOMBRE)')}</span>
    <button type="button" class="btn-hist" data-id="${b.id}" title="Ver ficha e historial del postulante">📋 Historial</button>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
      <span class="sub" style="margin:0">
        ${clasesTagsHtml(b.clase)}
        <span class="cita-rut num">${esc(b.rut || 'sin RUT')}</span>
      </span>
      ${b.funcionario ? `<span class="slot-func" title="Atendido por ${esc(b.funcionario)}"><svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/></svg> ${esc(b.funcionario)}</span>` : ''}
    </div>
    <div class="slot-contacto">
      <div class="slot-contacto-fila">
        <span class="sc-item ${b.contacto ? '' : 'sin'}" title="${b.contacto ? 'Teléfono: ' + esc(fTel(b.contacto)) : 'Sin teléfono registrado'}">
          <svg class="sc-ico" viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M3.654 1.328a.678.678 0 0 0-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.568 17.568 0 0 0 4.168 6.608 17.569 17.569 0 0 0 6.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 0 0-.063-1.015l-2.307-1.794a.678.678 0 0 0-.58-.122l-2.19.547a1.745 1.745 0 0 1-1.657-.459L5.482 8.06a1.745 1.745 0 0 1-.46-1.657l.548-2.19a.678.678 0 0 0-.122-.58L3.654 1.328z"/></svg>
          <span class="num">${esc(fTel(b.contacto) || 'Sin teléfono')}</span>
        </span>
        ${telWa ? `<a href="whatsapp://send?phone=${telWa}&text=${encodeURIComponent(mensajeWa)}" class="btn-wa" title="Escribir por WhatsApp a este postulante con los datos de su cita" onclick="event.stopPropagation()">💬 WhatsApp</a>` : ''}
      </div>
      <span class="sc-item ${b.correo ? 'slot-mail' : 'sin'}" title="${b.correo ? 'Correo: ' + esc(b.correo) : 'Sin correo registrado'}">
        <svg class="sc-ico" viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2zm13 2.383-4.708 2.825L15 11.105V5.383zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741zM1 11.105l4.708-2.897L1 5.383v5.722z"/></svg>
        <span>${esc(b.correo || 'Sin correo')}</span>
      </span>
    </div>

    ${badges.length ? `<span class="badges">${badges.join('')}</span>` : ''}
    <div class="slot-acciones" data-id="${b.id}">
      <button type="button" class="btn-slot-act btn-confirmar ${esConfirmado ? 'es-confirmado' : ''}" data-act="confirmar" title="${esConfirmado ? 'Asistencia confirmada. Clic para modificar estado' : 'Confirmar asistencia del postulante'}">
        <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>
        <span>${esConfirmado ? 'Confirmado' : 'Confirmar'}</span>
      </button>
      <button type="button" class="btn-slot-act btn-reagendar" data-act="reagendar" title="Derivar directamente a reagendamiento">
        <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>
        <span>Reagendar</span>
      </button>
    </div>
    ${acc}
  </div>`;
}
// Familia de la clase de licencia (para el color del recuadro).
function claseFamilia(c) {
  const x = String(c || '').toUpperCase();
  if (x === 'D' || x === 'A5') return 'pesada';
  if (x === 'E') return 'prof';
  if (x.startsWith('A')) return 'moto';
  return 'liviana';
}
// Una cita puede tener varias clases marcadas ("B,A2"): una etiqueta por cada una.
function clasesTagsHtml(clase) {
  const lista = clasesDe(clase);
  if (!lista.length) return '—';
  return lista.map((cl) => `<span class="clase-tag ${claseFamilia(cl)}">${esc(cl)}</span>`).join(' ');
}

function pintarGrilla(cont, filas, fecha) {
  const exs = estadoAgenda.examinador_id
    ? META.examinadores.filter((e) => String(e.id) === String(estadoAgenda.examinador_id))
    : META.examinadores.filter((e) => e.activo);
  if (!filas.length) {
    cont.className = '';
    cont.style.gridTemplateColumns = '';
    cont.innerHTML = licoVacio('explica', 'Sin bloques este día', `No hay bloques para ${fFecha(fecha)}. Puede ser fin de semana o feriado, o falta generar la grilla (pestaña Datos).`);
    return;
  }
  const porKey = {};
  const cuenta = {};
  filas.forEach((f) => {
    porKey[`${f.hora}|${f.examinador_id}`] = f;
    if (f.rut || f.nombre) cuenta[f.examinador_id] = (cuenta[f.examinador_id] || 0) + 1;
  });
  const modo = estadoAgenda.modoVista || localStorage.getItem('agenda_modo_vista') || 'vertical';

  if (modo === 'horizontal') {
    cont.className = 'grilla-horizontal-wrap';
    cont.style.gridTemplateColumns = '';
    let html = `<div class="grilla-horizontal" style="grid-template-columns: 200px repeat(${META.horas.length}, 320px)">`;
    html += `<div class="gh-esquina">Examinador \\ Hora</div>`;
    for (const hora of META.horas) {
      const pesada = hora === META.hora_d_a5;
      html += `<div class="gh-hora-head ${pesada ? 'pesada' : ''}">
        <span class="gh-h-txt">${esc(hora)}</span>
        ${pesada ? '<span class="et">D · A5</span>' : ''}
      </div>`;
    }
    for (const e of exs) {
      html += `<div class="gh-exam-col">
        <span class="gh-exam-nombre">${esc(e.nombre)}</span>
        <span class="gh-exam-citas">${cuenta[e.id] || 0} citas</span>
      </div>`;
      for (const hora of META.horas) {
        const pesada = hora === META.hora_d_a5;
        html += `<div class="gh-slot-col ${pesada ? 'fila-pesada' : ''}">${slotCard(porKey[`${hora}|${e.id}`])}</div>`;
      }
    }
    html += `</div>`;
    cont.innerHTML = html;
  } else {
    cont.className = 'grilla';
    cont.style.gridTemplateColumns = `58px repeat(${exs.length}, minmax(0, 1fr))`;
    let html = `<div class="g-esquina"><span class="gh-n">&nbsp;</span><span class="gh-c">Hora</span></div>` + exs.map((e) =>
      `<div class="g-head"><span class="gh-n">${esc(e.nombre)}</span><span class="gh-c">${cuenta[e.id] || 0} citas</span></div>`).join('');
    for (const hora of META.horas) {
      const pesada = hora === META.hora_d_a5;
      html += `<div class="g-hora" data-hora="${esc(hora)}">${esc(hora)}${pesada ? '<span class="et">D · A5</span>' : ''}</div>`;
      for (const e of exs) html += `<div${pesada ? ' class="fila-pesada"' : ''}>${slotCard(porKey[`${hora}|${e.id}`])}</div>`;
    }
    cont.innerHTML = html;
  }
  cont.querySelectorAll('.slot-res .sr').forEach((el) => {
    el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.click(); } };
    el.onclick = async (ev) => {
      ev.stopPropagation();
      const box = el.closest('.slot-res');
      const card = el.closest('.slot');
      const id = Number(box.dataset.id);
      const quitar = el.classList.contains('on');
      // Se pinta al instante; si el guardado falla se vuelve al estado anterior.
      const antes = { on: [...box.querySelectorAll('.sr.on')], card: card.className };
      box.querySelectorAll('.sr').forEach((s) => s.classList.remove('on'));
      card.classList.remove('res-aprob', 'res-reprob');
      if (!quitar) {
        el.classList.add('on');
        card.classList.add(el.dataset.r === 'APROBADO' ? 'res-aprob' : 'res-reprob');
      }
      try {
        await marcarResultado(id, quitar ? null : el.dataset.r);
        if (!quitar && el.dataset.r === 'APROBADO') licoConfeti(el);
        toast(quitar ? 'Resultado borrado' : `Marcado: ${el.dataset.r === 'NO ASISTIO' ? 'No asistió' : el.dataset.r === 'APROBADO' ? 'Aprobó' : 'Reprobó'}`);
      } catch (e) {
        box.querySelectorAll('.sr').forEach((s) => s.classList.remove('on'));
        antes.on.forEach((s) => s.classList.add('on'));
        card.className = antes.card;
        toast(e.message, 'err');
      }
    };
  });
  cont.querySelectorAll('.slot-acciones button').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const id = Number(btn.closest('.slot-acciones').dataset.id);
      const act = btn.dataset.act;
      if (act === 'confirmar') {
        const yaConfirmado = btn.classList.contains('es-confirmado');
        if (yaConfirmado) {
          if (!confirm('Esta cita ya figura con asistencia confirmada.\n\n¿Deseas volver a marcarla como pendiente de confirmación?')) return;
        }
        try {
          await api(`/agenda/${id}/confirmar`, { method: 'POST', body: { valor: yaConfirmado ? 0 : 1 } });
          toast(yaConfirmado ? 'Cita marcada como pendiente' : 'Asistencia confirmada exitosamente', 'ok');
          actualizarBadgePorConfirmar();
          renderAgenda();
        } catch (e) { toast(e.message, 'err'); }
      } else if (act === 'reagendar') {
        try {
          await api(`/agenda/${id}/reagendar`, { method: 'POST', body: { motivo: 'POSTULANTE SOLICITA CAMBIO' } });
          toast('Postulante enviado a la lista de Reagendamiento', 'ok');
          actualizarBadgeReagendar();
          irA('reagendar');
          setTimeout(() => {
            if (typeof detalleReagendar === 'function') detalleReagendar(id);
          }, 120);
        } catch (e) { toast(e.message, 'err'); }
      }
    };
  });
}
// Marca (o borra, con resultado=null) el resultado de una cita preservando
// el resto de sus datos. Compartido entre la grilla y el check-in del dia.
async function marcarResultado(id, resultado) {
  await api(`/agenda/${id}/resultado`, { method: 'POST', body: { resultado } });
}

/* ================= tab: DISPONIBLES ================= */
let filtDisp = { desde: null, hasta: null, clase: '', examinador_id: '' };
async function renderDisponibles() {
  if (!filtDisp.desde) { filtDisp.desde = hoy(); filtDisp.hasta = sumarDias(hoy(), 60); }
  view.innerHTML = `
    <div class="panel no-print"><div class="fila">
      <div class="campo"><label>Desde</label><input type="date" id="d-desde" value="${filtDisp.desde}"></div>
      <div class="campo"><label>Hasta</label><input type="date" id="d-hasta" value="${filtDisp.hasta}"></div>
      <div class="campo"><label>Clase</label><select id="d-clase">${opt(META.catalogos.clase, filtDisp.clase)}</select></div>
      <div class="campo"><label>Examinador</label><select id="d-exam"><option value="">Todos</option>
        ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</select></div>
      <button class="btn" id="d-buscar">Buscar</button>
    </div><p class="muted" id="d-regla"></p></div>
    <div class="panel tabla-scroll"><table><thead><tr>
      <th class="c">Fecha</th><th class="c">Hora</th><th class="c">Examinador</th><th class="c">Regla del bloque</th><th class="c"></th>
    </tr></thead><tbody id="d-body"><tr><td colspan="5">Cargando...</td></tr></tbody></table></div>`;
  $('#d-clase').value = filtDisp.clase;
  $('#d-exam').value = filtDisp.examinador_id;
  const buscar = async () => {
    filtDisp = { desde: $('#d-desde').value, hasta: $('#d-hasta').value, clase: $('#d-clase').value, examinador_id: $('#d-exam').value };
    const pesada = META.clases_pesadas.includes(filtDisp.clase);
    $('#d-regla').textContent = pesada ? `Clase ${filtDisp.clase}: solo bloques de las ${META.hora_d_a5}.` : '';
    const q = new URLSearchParams(Object.fromEntries(Object.entries(filtDisp).filter(([, v]) => v)));
    const base = $('#d-regla').textContent;
    await cargarVista('disponibles', `/disponibles?${q}`, (rows) => pintarDisp(rows, base));
  };
  const pintarDisp = (rows, base) => {
    rows.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora) || a.examinador.localeCompare(b.examinador));
    $('#d-body').innerHTML = rows.length ? rows.map((r) => `<tr>
      <td class="num c">${esc(fFecha(r.fecha))}</td><td class="num c">${esc(r.hora)}</td><td class="c">${esc(r.examinador)}</td>
      <td class="c"><span class="regla ${r.apto_pesada ? 'ok' : ''}">${r.apto_pesada ? 'D · A5 permitidas' : 'B, C, A1-A4 · sin D/A5'}</span></td>
      <td class="c"><button class="btn chico" data-id="${r.id}">Agendar</button></td></tr>`).join('')
      : licoVacioFila(5, 'explica', 'Sin bloques libres en este rango', `No hay bloques libres entre ${fFecha(filtDisp.desde)} y ${fFecha(filtDisp.hasta)}. Los primeros meses suelen estar llenos: amplía la fecha "Hasta" o prueba un mes más adelante.`);
    $('#d-regla').textContent = rows.length
      ? `${base ? base + ' · ' : ''}${rows.length} bloque(s) libre(s) en el rango.`
      : base;
    $('#d-body').querySelectorAll('button[data-id]').forEach((el) => {
      el.onclick = () => abrirSlotPorId(Number(el.dataset.id), recargar(buscar));
    });
  };
  $('#d-buscar').onclick = buscar;
  buscar();
}

/* ================= tab: REAGENDAR ================= */
let reagendarSeleccion = null; // null | { tipo: 'agenda', id, cita } | { tipo: 'cola', id, item }
let filtReag = { desde: null, hasta: null, examinador_id: '' };
let filtroOrigenReag = 'todos'; // 'todos' | 'bloqueo' | 'cambio'

async function renderReagendar() {
  if (!filtReag.desde) filtReag.desde = sumarDias(hoy(), 1);
  if (!filtReag.hasta) filtReag.hasta = sumarDias(hoy(), 30);

  view.innerHTML = `
    <div id="r-detalle"></div>

    <div class="panel">
      <div class="fila" style="justify-content:space-between;align-items:center;margin-bottom:.75rem;flex-wrap:wrap;gap:8px">
        <div>
          <h2 style="margin:0 0 .2rem">Personas por Reagendar</h2>
          <p class="muted" style="margin:0;font-size:13px">Listado unificado con prioridad inteligente: afectados por bloqueo municipal (urgentes) y solicitudes de cambio.</p>
        </div>
        <div id="r-filtros-origen" style="display:flex;align-items:center;gap:6px">
          <span class="pastilla" style="font-weight:700">Cargando...</span>
        </div>
      </div>
      <div class="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th class="c" style="width:145px">Prioridad / Origen</th>
              <th class="c" style="width:105px">Fecha cita</th>
              <th class="c" style="width:75px">Hora</th>
              <th class="c">Postulante</th>
              <th class="c" style="width:125px">RUT</th>
              <th class="c" style="width:65px">Clase</th>
              <th class="c" style="width:170px">Examinador</th>
              <th>Motivo / Causa</th>
              <th class="c" style="width:180px">Acción</th>
            </tr>
          </thead>
          <tbody id="r-tabla-unificada"><tr><td colspan="9" class="c muted" style="padding:1.5rem">Cargando postulantes...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  pintarPanelTopReagendar();

  try {
    const [pend, cola] = await Promise.all([
      api('/agenda?estado=pendiente').catch(() => []),
      api('/cola-reagendar').catch(() => [])
    ]);

    const itemsBloqueo = cola.map((c) => ({
      tipo: 'cola',
      prioridad: 1, // Urgente
      id: c.id,
      fecha: c.origen_fecha,
      hora: c.origen_hora,
      nombre: c.nombre,
      rut: c.rut,
      clase: c.clase,
      examinador: c.origen_examinador || 'No asignado',
      motivo: c.motivo || 'Bloqueo por ausencia',
      raw: c
    }));

    const itemsCambio = pend.map((p) => ({
      tipo: 'agenda',
      prioridad: 2, // Solicitud normal
      id: p.id,
      fecha: p.fecha,
      hora: p.hora,
      nombre: p.nombre,
      rut: p.rut,
      clase: p.clase,
      examinador: p.examinador || 'No asignado',
      motivo: p.pendiente_nota || p.motivo_reagendamiento || 'POSTULANTE SOLICITA CAMBIO',
      raw: p
    }));

    // Prioridad 1 (bloqueo) primero; luego por fecha y hora
    const todos = [...itemsBloqueo, ...itemsCambio].sort((a, b) => {
      if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;
      return String(a.fecha).localeCompare(String(b.fecha)) || String(a.hora).localeCompare(String(b.hora));
    });

    const fCont = $('#r-filtros-origen');
    if (fCont) {
      fCont.innerHTML = `
        <button type="button" class="btn chico ${filtroOrigenReag === 'todos' ? '' : 'sec'}" id="r-f-todos" style="font-weight:700">Todos (${todos.length})</button>
        <button type="button" class="btn chico ${filtroOrigenReag === 'bloqueo' ? '' : 'sec'}" id="r-f-bloq" style="font-weight:700;${filtroOrigenReag === 'bloqueo' ? 'background:#dc2626;border-color:#b91c1c;color:#fff' : 'color:#dc2626'}">🚨 Por Bloqueo (${itemsBloqueo.length})</button>
        <button type="button" class="btn chico ${filtroOrigenReag === 'cambio' ? '' : 'sec'}" id="r-f-camb" style="font-weight:700;${filtroOrigenReag === 'cambio' ? 'background:#1d4ed8;color:#fff' : 'color:#1d4ed8'}">Solicitud de cambio (${itemsCambio.length})</button>
      `;
      $('#r-f-todos').onclick = () => { filtroOrigenReag = 'todos'; pintarFilas(); };
      $('#r-f-bloq').onclick = () => { filtroOrigenReag = 'bloqueo'; pintarFilas(); };
      $('#r-f-camb').onclick = () => { filtroOrigenReag = 'cambio'; pintarFilas(); };
    }

    const pintarFilas = () => {
      const btnTodos = $('#r-f-todos');
      const btnBloq = $('#r-f-bloq');
      const btnCamb = $('#r-f-camb');
      if (btnTodos) btnTodos.className = `btn chico ${filtroOrigenReag === 'todos' ? '' : 'sec'}`;
      if (btnBloq) {
        btnBloq.className = `btn chico ${filtroOrigenReag === 'bloqueo' ? '' : 'sec'}`;
        btnBloq.style = `font-weight:700;${filtroOrigenReag === 'bloqueo' ? 'background:#dc2626;border-color:#b91c1c;color:#fff' : 'color:#dc2626'}`;
      }
      if (btnCamb) {
        btnCamb.className = `btn chico ${filtroOrigenReag === 'cambio' ? '' : 'sec'}`;
        btnCamb.style = `font-weight:700;${filtroOrigenReag === 'cambio' ? 'background:#1d4ed8;color:#fff' : 'color:#1d4ed8'}`;
      }

      const filtrados = todos.filter((it) => {
        if (filtroOrigenReag === 'bloqueo') return it.tipo === 'cola';
        if (filtroOrigenReag === 'cambio') return it.tipo === 'agenda';
        return true;
      });

      const tb = $('#r-tabla-unificada');
      if (!tb) return;

      if (!filtrados.length) {
        tb.innerHTML = licoVacioFila(9, 'celebra', '¡Sin pendientes!', 'No hay personas pendientes en esta categoría.');
        return;
      }

      tb.innerHTML = filtrados.map((r) => {
        const estaActivo = reagendarSeleccion && reagendarSeleccion.tipo === r.tipo && reagendarSeleccion.id === r.id;
        const esBloqueo = r.tipo === 'cola';
        const badgeTipo = esBloqueo
          ? '<span class="badge" style="background:#fee2e2;color:#991b1b;border:1px solid #f87171;font-weight:800;padding:3px 7px;border-radius:4px;font-size:11px">🚨 BLOQUEO</span>'
          : '<span class="badge" style="background:#dbeafe;color:#1e40af;border:1px solid #93c5fd;font-weight:700;padding:3px 7px;border-radius:4px;font-size:11px">SOLICITUD</span>';

        return `<tr style="${estaActivo ? 'background:#eff6ff;outline:2px solid #3b82f6;outline-offset:-2px' : ''}">
          <td class="c">${badgeTipo}</td>
          <td class="c"><b>${esc(fFecha(r.fecha))}</b></td>
          <td class="c"><b>${esc(r.hora)}</b></td>
          <td class="c"><b>${esc(nom(r.nombre))}</b></td>
          <td class="c num" style="white-space:nowrap;font-weight:600">${esc(r.rut)}</td>
          <td class="c">${r.clase ? clasesTagsHtml(r.clase) : '<span class="muted">-</span>'}</td>
          <td class="c">${esc(r.examinador)}</td>
          <td>${esc(r.motivo)}</td>
          <td class="c" style="white-space:nowrap">
            ${esBloqueo
              ? `<button class="btn chico" data-cola="${r.id}" style="${estaActivo ? 'background:#059669;color:#fff' : 'background:#10b981;border-color:#059669;color:#fff'};font-weight:700;margin-right:4px">${estaActivo ? '✓ Seleccionado' : 'Asignar hora'}</button>
                 <button class="btn chico sec" data-desc="${r.id}" style="color:#b91c1c;font-weight:600">Descartar</button>`
              : `<button class="btn chico" data-id="${r.id}" style="${estaActivo ? 'background:#059669;color:#fff' : 'background:#1d4ed8'};font-weight:700">${estaActivo ? '✓ Seleccionado' : 'Reagendar'}</button>`
            }
          </td>
        </tr>`;
      }).join('');

      tb.querySelectorAll('button[data-id]').forEach((el) => {
        el.onclick = () => detalleReagendar(Number(el.dataset.id));
      });
      tb.querySelectorAll('button[data-cola]').forEach((el) => {
        el.onclick = () => detalleCola(cola.find((c) => c.id === Number(el.dataset.cola)));
      });
      tb.querySelectorAll('button[data-desc]').forEach((el) => {
        el.onclick = async () => {
          if (!confirm('¿Seguro que deseas descartar a este postulante de la lista de reagendamiento?')) return;
          try {
            await api(`/cola-reagendar/${el.dataset.desc}/descartar`, { method: 'POST', body: { nota: 'Descartado por funcionario' } });
            toast('Postulante descartado');
            if (reagendarSeleccion && reagendarSeleccion.tipo === 'cola' && reagendarSeleccion.id === Number(el.dataset.desc)) {
              reagendarSeleccion = null;
            }
            renderReagendar();
            actualizarBadgeReagendar();
          } catch (e) { toast(e.message, 'err'); }
        };
      });
    };

    pintarFilas();
  } catch (err) {
    const tb = $('#r-tabla-unificada');
    if (tb) tb.innerHTML = `<tr><td colspan="9" class="c muted" style="color:var(--error);padding:1.5rem">Error al cargar listado: ${esc(err.message)}</td></tr>`;
  }
}

function pintarPanelTopReagendar() {
  const cont = $('#r-detalle');
  if (!cont) return;

  if (!filtReag.desde) filtReag.desde = sumarDias(hoy(), 1);
  if (!filtReag.hasta) filtReag.hasta = sumarDias(hoy(), 30);

  if (!reagendarSeleccion) {
    cont.innerHTML = `
      <div class="panel" style="border:1px solid var(--linea);box-shadow:0 3px 12px rgba(27,58,117,.06);margin-bottom:1.25rem;background:#f8fafc">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
          <div>
            <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--azul)">Reagendamiento de Citas</div>
            <h3 style="margin:2px 0 0;color:var(--azul-900);font-size:1.15rem">Búsqueda y Reubicación de Cupos Libres</h3>
          </div>
          <span class="pastilla" style="font-weight:600;background:#e2e8f0;color:var(--tinta-2)">Selecciona un postulante para moverlo</span>
        </div>

        <div class="fila" style="align-items:flex-end;gap:12px;background:#fff;padding:.85rem;border-radius:6px;border:1px solid var(--linea)">
          <div class="campo"><label>Destino desde</label><input type="date" id="rd-desde" value="${filtReag.desde}"></div>
          <div class="campo"><label>Hasta</label><input type="date" id="rd-hasta" value="${filtReag.hasta}"></div>
          <div class="campo"><label>Examinador</label>
            <select id="rd-exam">
              <option value="">Cualquiera</option>
              ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(filtReag.examinador_id) === String(e.id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
            </select>
          </div>
          <button class="btn" id="rd-buscar" style="background:#1d4ed8;font-weight:700">Ver bloques libres</button>
        </div>

        <div id="rd-ayuda" style="margin-top:.75rem;padding:.65rem .85rem;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;color:#1e40af;font-size:13px;display:flex;align-items:center;gap:8px">
          <span style="font-size:16px">👉</span>
          <div>Haz clic en <b>Reagendar</b> en cualquiera de los postulantes de abajo (o en <b>Asignar hora</b> si fue por bloqueo) para asignarle un nuevo cupo libre.</div>
        </div>

        <div id="rd-tabla-prev" class="tabla-scroll" style="display:none;margin-top:.75rem;max-height:300px;overflow-y:auto">
          <table>
            <thead>
              <tr>
                <th class="c" style="width:110px">Fecha</th>
                <th class="c" style="width:80px">Hora</th>
                <th class="c">Examinador disponible</th>
                <th class="c" style="width:140px">Estado</th>
              </tr>
            </thead>
            <tbody id="rd-body"></tbody>
          </table>
        </div>
      </div>`;

    $('#rd-buscar').onclick = async () => {
      filtReag.desde = $('#rd-desde').value;
      filtReag.hasta = $('#rd-hasta').value;
      filtReag.examinador_id = $('#rd-exam').value;
      const q = new URLSearchParams({ desde: filtReag.desde, hasta: filtReag.hasta });
      if (filtReag.examinador_id) q.set('examinador_id', filtReag.examinador_id);
      $('#rd-tabla-prev').style.display = 'block';
      $('#rd-body').innerHTML = '<tr><td colspan="4" class="c muted" style="padding:1rem">Buscando cupos libres...</td></tr>';
      try {
        const libres = await api(`/disponibles?${q}`);
        $('#rd-body').innerHTML = libres.length ? libres.map((l) => `<tr>
          <td class="c"><b>${esc(fFecha(l.fecha))}</b></td>
          <td class="c"><b>${esc(l.hora)}</b></td>
          <td class="c">${esc(l.examinador)}</td>
          <td class="c"><span class="badge-ok" style="background:#e0f2fe;color:#0369a1;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:700">Cupo libre</span></td></tr>`).join('')
          : licoVacioFila(4, 'alerta', 'Sin cupos en este rango', 'No hay bloques libres en este rango de fechas. Prueba ampliarlo.');
      } catch (e) {
        $('#rd-body').innerHTML = `<tr><td colspan="4" class="c muted" style="color:var(--error);padding:1rem">Error al buscar: ${esc(e.message)}</td></tr>`;
      }
    };
    return;
  }

  // Si hay postulante de agenda seleccionado:
  if (reagendarSeleccion.tipo === 'agenda') {
    const cita = reagendarSeleccion.cita;
    const pesada = cita.clase && META.clases_pesadas.includes(cita.clase);
    cont.innerHTML = `
      <div class="panel" style="border:2px solid var(--azul);box-shadow:0 6px 20px rgba(27,58,117,.15);margin-bottom:1.25rem;background:#f8fafc">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.75rem">
          <div>
            <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--azul)">Reagendamiento en curso</div>
            <h3 style="margin:2px 0 4px;color:var(--azul-900);font-size:1.25rem">
              <b>${esc(nom(cita.nombre) || '(SIN NOMBRE)')}</b>
              <span style="font-weight:400;font-size:13.5px;color:var(--tinta-2);margin-left:8px">RUT: <b style="font-family:monospace">${esc(cita.rut || 'sin RUT')}</b> · Clase: <b>${esc(cita.clase || '-')}</b></span>
            </h3>
            <p class="muted" style="margin:0;font-size:13px">
              Cita actual que se cambiará: <b>${esc(fFecha(cita.fecha))} a las ${esc(cita.hora)} hrs</b> con <b>${esc(cita.examinador || 'No asignado')}</b>
            </p>
          </div>
          <button type="button" class="btn chico sec" id="rd-cerrar" style="font-weight:700">✕ Cancelar selección</button>
        </div>

        <div class="fila" style="align-items:flex-end;gap:12px;background:#fff;padding:.85rem;border-radius:6px;border:1px solid var(--linea)">
          <div class="campo"><label>Destino desde</label><input type="date" id="rd-desde" value="${filtReag.desde}"></div>
          <div class="campo"><label>Hasta</label><input type="date" id="rd-hasta" value="${filtReag.hasta}"></div>
          <div class="campo"><label>Examinador</label>
            <select id="rd-exam">
              <option value="">Cualquiera</option>
              ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(filtReag.examinador_id) === String(e.id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
            </select>
          </div>
          <button class="btn" id="rd-buscar" style="background:#1d4ed8;font-weight:700">Ver bloques libres</button>
        </div>

        ${pesada ? `<p class="muted" style="margin:.5rem 0 0;color:var(--pesada);font-weight:700">⚠ Clase ${esc(cita.clase)}: destino limitado al bloque ${esc(META.hora_d_a5)}.</p>` : ''}

        <div class="campo" style="margin-top:.75rem">
          <label>Motivo del reagendamiento</label>
          <input id="rd-motivo" value="${esc(cita.motivo_reagendamiento || cita.pendiente_nota || 'POSTULANTE SOLICITA CAMBIO')}">
        </div>

        <div class="tabla-scroll" style="margin-top:.75rem;max-height:360px;overflow-y:auto">
          <table>
            <thead>
              <tr>
                <th class="c" style="width:110px">Fecha</th>
                <th class="c" style="width:80px">Hora</th>
                <th class="c">Examinador disponible</th>
                <th class="c" style="width:140px">Acción</th>
              </tr>
            </thead>
            <tbody id="rd-body"><tr><td colspan="4" class="c muted" style="padding:1.5rem">Buscando bloques libres...</td></tr></tbody>
          </table>
        </div>
      </div>`;

    $('#rd-cerrar').onclick = () => {
      reagendarSeleccion = null;
      renderReagendar();
    };

    const buscarLibres = async () => {
      filtReag.desde = $('#rd-desde').value;
      filtReag.hasta = $('#rd-hasta').value;
      filtReag.examinador_id = $('#rd-exam').value;
      const q = new URLSearchParams({ desde: filtReag.desde, hasta: filtReag.hasta });
      if (filtReag.examinador_id) q.set('examinador_id', filtReag.examinador_id);
      if (pesada) q.set('clase', cita.clase);
      try {
        const libres = await api(`/disponibles?${q}`);
        $('#rd-body').innerHTML = libres.length ? libres.map((l) => `<tr>
          <td class="c"><b>${esc(fFecha(l.fecha))}</b></td>
          <td class="c"><b>${esc(l.hora)}</b></td>
          <td class="c">${esc(l.examinador)}</td>
          <td class="c"><button class="btn chico" data-id="${l.id}" style="background:#10b981;border-color:#059669;color:#fff;font-weight:700">Mover aquí</button></td></tr>`).join('')
          : '<tr><td colspan="4" class="c muted" style="padding:1.5rem">No se encontraron bloques libres en este rango de fechas. Amplía el rango "Hasta" para buscar más adelante.</td></tr>';

        $('#rd-body').querySelectorAll('button[data-id]').forEach((el) => {
          el.onclick = async () => {
            const lId = Number(el.dataset.id);
            const selSlot = libres.find((x) => x.id === lId);
            const fechaTxt = selSlot ? `${fFecha(selSlot.fecha)} a las ${selSlot.hora}` : 'el nuevo horario';
            if (!confirm(`¿Confirmar el reagendamiento de ${nom(cita.nombre) || cita.rut} para ${fechaTxt}?`)) return;
            try {
              await api(`/agenda/${cita.id}/reagendar`, { method: 'POST', body: { destino_id: lId, motivo: $('#rd-motivo').value } });
              toast('¡Cita reagendada con éxito!', 'ok');
              reagendarSeleccion = null;
              actualizarBadgeReagendar();
              renderReagendar();
            } catch (e) { toast(e.message, 'err'); }
          };
        });
      } catch (e) {
        $('#rd-body').innerHTML = `<tr><td colspan="4" class="c muted" style="color:var(--error);padding:1.5rem">Error al buscar: ${esc(e.message)}</td></tr>`;
      }
    };

    $('#rd-buscar').onclick = buscarLibres;
    buscarLibres();
    cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  // Si hay postulante de cola de bloqueos seleccionado:
  if (reagendarSeleccion.tipo === 'cola') {
    const item = reagendarSeleccion.item;
    const pesada = String(item.clase || '').split(',').some((c) => META.clases_pesadas.includes(c.trim()));
    cont.innerHTML = `
      <div class="panel" style="border:2px solid #10b981;box-shadow:0 6px 20px rgba(16,185,129,.15);margin-bottom:1.25rem;background:#f0fdf4">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.75rem">
          <div>
            <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#047857">Asignación de cupo por bloqueo</div>
            <h3 style="margin:2px 0 4px;color:#065f46;font-size:1.25rem">
              <b>${esc(nom(item.nombre) || '(SIN NOMBRE)')}</b>
              <span style="font-weight:400;font-size:13.5px;color:var(--tinta-2);margin-left:8px">RUT: <b style="font-family:monospace">${esc(item.rut || 'sin RUT')}</b> · Clase: <b>${esc(item.clase || '-')}</b></span>
            </h3>
            <p class="muted" style="margin:0;font-size:13px">
              Cita original afectada: <b>${esc(fFecha(item.origen_fecha))} a las ${esc(item.origen_hora)} hrs</b> con <b>${esc(item.origen_examinador || 'No asignado')}</b> (${esc(item.motivo || 'Bloqueo')})
            </p>
          </div>
          <button type="button" class="btn chico sec" id="rd-cerrar" style="font-weight:700">✕ Cancelar selección</button>
        </div>

        <div class="fila" style="align-items:flex-end;gap:12px;background:#fff;padding:.85rem;border-radius:6px;border:1px solid var(--linea)">
          <div class="campo"><label>Destino desde</label><input type="date" id="rd-desde" value="${filtReag.desde}"></div>
          <div class="campo"><label>Hasta</label><input type="date" id="rd-hasta" value="${filtReag.hasta}"></div>
          <div class="campo"><label>Examinador</label>
            <select id="rd-exam">
              <option value="">Cualquiera</option>
              ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(filtReag.examinador_id) === String(e.id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
            </select>
          </div>
          <button class="btn" id="rd-buscar" style="background:#10b981;border-color:#059669;color:#fff;font-weight:700">Ver bloques libres</button>
        </div>

        ${pesada ? `<p class="muted" style="margin:.5rem 0 0;color:var(--pesada);font-weight:700">⚠ Clase ${esc(item.clase)}: solo bloques de las ${esc(META.hora_d_a5)}.</p>` : ''}

        <div class="campo" style="margin-top:.75rem">
          <label>Correo para confirmación (opcional)</label>
          <input id="rd-cola-correo" type="email" value="${esc(item.correo || '')}" placeholder="ejemplo@correo.cl">
        </div>

        <div class="tabla-scroll" style="margin-top:.75rem;max-height:360px;overflow-y:auto">
          <table>
            <thead>
              <tr>
                <th class="c" style="width:110px">Fecha</th>
                <th class="c" style="width:80px">Hora</th>
                <th class="c">Examinador disponible</th>
                <th class="c" style="width:160px">Acción</th>
              </tr>
            </thead>
            <tbody id="rd-body"><tr><td colspan="4" class="c muted" style="padding:1.5rem">Buscando bloques libres...</td></tr></tbody>
          </table>
        </div>
      </div>`;

    $('#rd-cerrar').onclick = () => {
      reagendarSeleccion = null;
      renderReagendar();
    };

    const buscarLibresCola = async () => {
      filtReag.desde = $('#rd-desde').value;
      filtReag.hasta = $('#rd-hasta').value;
      filtReag.examinador_id = $('#rd-exam').value;
      const q = new URLSearchParams({ desde: filtReag.desde, hasta: filtReag.hasta });
      if (filtReag.examinador_id) q.set('examinador_id', filtReag.examinador_id);
      if (pesada) q.set('clase', 'D');
      try {
        const libres = await api(`/disponibles?${q}`);
        $('#rd-body').innerHTML = libres.length ? libres.map((l) => `<tr>
          <td class="c"><b>${esc(fFecha(l.fecha))}</b></td>
          <td class="c"><b>${esc(l.hora)}</b></td>
          <td class="c">${esc(l.examinador)}</td>
          <td class="c"><button class="btn chico" data-id="${l.id}" style="background:#10b981;border-color:#059669;color:#fff;font-weight:700">Asignar este cupo</button></td></tr>`).join('')
          : '<tr><td colspan="4" class="c muted" style="padding:1.5rem">No se encontraron bloques libres en este rango de fechas. Amplía el rango "Hasta" para buscar más adelante.</td></tr>';

        $('#rd-body').querySelectorAll('button[data-id]').forEach((el) => {
          el.onclick = async () => {
            const lId = Number(el.dataset.id);
            const selSlot = libres.find((x) => x.id === lId);
            const fechaTxt = selSlot ? `${fFecha(selSlot.fecha)} a las ${selSlot.hora}` : 'el nuevo horario';
            if (!confirm(`¿Confirmar asignación de hora para ${nom(item.nombre) || item.rut} el ${fechaTxt}?`)) return;
            try {
              const r = await api(`/cola-reagendar/${item.id}/asignar`, {
                method: 'POST',
                body: { destino_id: lId, correo: $('#rd-cola-correo').value }
              });
              toast('¡Hora asignada exitosamente!', 'ok');
              (r.avisos || []).forEach((a) => toast(a, 'alerta'));
              reagendarSeleccion = null;
              actualizarBadgeReagendar();
              renderReagendar();
            } catch (e) { toast(e.message, 'err'); }
          };
        });
      } catch (e) {
        $('#rd-body').innerHTML = `<tr><td colspan="4" class="c muted" style="color:var(--error);padding:1.5rem">Error al buscar: ${esc(e.message)}</td></tr>`;
      }
    };

    $('#rd-buscar').onclick = buscarLibresCola;
    buscarLibresCola();
    cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
}

async function detalleReagendar(id) {
  try {
    const cita = await api(`/agenda/${id}`);
    reagendarSeleccion = { tipo: 'agenda', id, cita };
    renderReagendar();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function detalleCola(item) {
  reagendarSeleccion = { tipo: 'cola', id: item.id, item };
  renderReagendar();
}

/* ================= tab: BUSCAR (historial) ================= */
// La busqueda vive en el buscador de la cabecera; esta vista solo muestra el
// historial del contribuyente elegido ahi.
let contribuyenteSel = null;
async function renderBuscar() {
  view.innerHTML = '<div id="bx-hist"></div>';
  if (!contribuyenteSel) {
    $('#bx-hist').innerHTML = `<div class="panel"><h2>Buscar contribuyente</h2>
      <p class="muted">Escribe un RUT, nombre o telefono en el buscador de arriba (minimo 3 caracteres).</p></div>`;
    $('#bq').focus();
    return;
  }
  historial(contribuyenteSel.rut, contribuyenteSel.nombre);
}

/* buscador global de la cabecera */
(function buscadorGlobal() {
  const qi = $('#bq');
  const res = $('#bq-res');
  let tmr;
  let pedido = 0; // descarta respuestas viejas si el usuario sigue escribiendo
  let sel = -1;

  const cerrar = () => { res.hidden = true; res.innerHTML = ''; sel = -1; };
  const items = () => [...res.querySelectorAll('.bq-item')];
  const marcar = (i) => {
    const its = items();
    if (!its.length) return;
    sel = (i + its.length) % its.length;
    its.forEach((el, k) => el.classList.toggle('sel', k === sel));
    its[sel].scrollIntoView({ block: 'nearest' });
  };
  const elegir = (el) => {
    contribuyenteSel = { rut: el.dataset.rut, nombre: el.dataset.nom };
    cerrar();
    qi.value = '';
    qi.blur();
    if ((location.hash.slice(1) || 'agenda').split('?')[0] === 'buscar') renderBuscar();
    else irA('buscar');
  };

  autoformatoRut(qi);
  qi.addEventListener('input', () => {
    clearTimeout(tmr);
    const q = qi.value.trim();
    if (q.length < 3) { cerrar(); return; }
    tmr = setTimeout(async () => {
      const n = ++pedido;
      let rows;
      try { rows = await api(`/buscar?q=${encodeURIComponent(q)}`); } catch (e) { toast(e.message, 'err'); return; }
      if (n !== pedido || qi.value.trim() !== q) return;
      const vistos = new Set();
      const html = [];
      for (const r of rows) {
        const k = r.rut || r.nombre;
        if (vistos.has(k)) continue;
        vistos.add(k);
        html.push(`<button type="button" class="bq-item" data-rut="${esc(r.rut || '')}" data-nom="${esc(r.nombre || '')}">
          <span>${esc(nom(r.nombre) || r.rut)}</span><small>${esc(r.rut || 'sin RUT')}</small></button>`);
      }
      res.innerHTML = html.join('') || '<div class="bq-vacio">Sin resultados</div>';
      res.hidden = false;
      sel = -1;
      items().forEach((el) => { el.onmousedown = (ev) => { ev.preventDefault(); elegir(el); }; });
    }, 250);
  });
  qi.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { cerrar(); qi.blur(); return; }
    if (res.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); marcar(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(sel - 1); }
    else if (e.key === 'Enter') {
      const its = items();
      if (its.length) { e.preventDefault(); elegir(its[sel >= 0 ? sel : 0]); }
    }
  });
  // En reposo el campo es angosto: placeholder corto; al enfocarlo se ensancha y explica que buscar.
  qi.addEventListener('blur', () => { qi.placeholder = 'Buscar'; setTimeout(cerrar, 120); });
  qi.addEventListener('focus', () => {
    qi.placeholder = 'RUT, nombre o teléfono (mín. 3)';
    if (qi.value.trim().length >= 3) qi.dispatchEvent(new Event('input'));
  });
})();
async function historial(rutv, nombre) {
  const rows = rutv ? await api(`/historial?rut=${encodeURIComponent(rutv)}`) : [];
  $('#bx-hist').innerHTML = `<div class="panel"><h3>${esc(nom(nombre) || rutv)}</h3>
    ${rutv ? '' : '<p class="muted">Sin RUT registrado; no se puede armar historial.</p>'}
    <div class="tabla-scroll"><table><thead><tr><th class="c">Fecha</th><th class="c">Hora</th><th>Examinador</th><th class="c">Clase</th><th>Tipo</th><th>Resultado</th><th class="c"></th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td class="c">${esc(fFecha(r.fecha))}</td><td class="c">${esc(r.hora)}</td><td>${esc(r.examinador)}</td>
      <td class="c">${esc(r.clase)}</td><td>${esc(r.tipo_cita)}</td><td>${esc(r.resultado)}</td>
      <td class="c"><button class="btn chico" data-id="${r.id}">Abrir</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin citas.</td></tr>'}
    </tbody></table></div></div>`;
  $('#bx-hist').querySelectorAll('button[data-id]').forEach((el) => {
    el.onclick = () => abrirSlotPorId(Number(el.dataset.id), recargar(() => historial(rutv, nombre)));
  });
}

/* ================= tab: ERRORES ================= */
const ETIQUETA = {
  INCOMPLETA: 'Cita incompleta', RUT_INVALIDO: 'RUT invalido', CLASE_BLOQUE: 'Clase en bloque incorrecto',
  DUPLICADO_FUTURO: 'Duplicado futuro', DUPLICADO_DIA: 'Duplicado el mismo dia', CONFLICTO_TERRENO: 'Conflicto terreno',
  SIN_RESULTADO: 'Sin resultado', SIN_CONTACTO: 'Sin contacto', TELEFONO_INCOMPLETO: 'Teléfono incompleto', DIA_INHABIL: 'Cita en dia inhabil',
  PENDIENTE_REAGENDAR: 'Pendiente de reagendar', FALTA_TELEFONO: 'Falta teléfono', FALTA_CORREO: 'Falta correo',
  CORREO_INVALIDO: 'Correo inválido', FALTA_CLASE: 'Falta clase', CONFLICTO_PESADA: 'Conflicto D/A5 12:30',
};
let filtErr = { tipo: '' };
async function renderErrores() {
  view.innerHTML = `<div class="panel"><div class="fila">
      <h2 style="margin:0;flex:1">Reporte de errores</h2>
      <button class="btn sec" id="e-refresh">Recalcular</button></div>
    <div class="chips" id="e-chips" style="margin:.6rem 0"></div></div>
    <div class="panel tabla-scroll"><table><thead><tr>
      <th class="c">Sev</th><th>Tipo</th><th class="c">Fecha</th><th class="c">Hora</th><th>Examinador</th><th>RUT</th><th>Nombre</th><th>Detalle</th><th class="c"></th>
    </tr></thead><tbody id="e-body"><tr><td colspan="9">Cargando...</td></tr></tbody></table></div>`;
  const cargar = () => cargarVista('errores', '/errores', (rep) => {
    pintarBadgeErrores(rep); // mismo reporte: no se vuelve a pedir /errores solo para el numerito
    $('#e-chips').innerHTML = [`<button class="chip" data-t="">Todos (${rep.total})</button>`]
      .concat(Object.entries(rep.resumen).sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `<button class="chip" data-t="${t}">${esc(ETIQUETA[t] || t)} (${n})</button>`)).join('');
    $('#e-chips').querySelectorAll('button').forEach((el) => {
      el.onclick = () => { filtErr.tipo = el.dataset.t; pintar(rep); };
    });
    pintar(rep);
  });
  const pintar = (rep) => {
    const rows = rep.hallazgos.filter((x) => (!filtErr.tipo || x.tipo === filtErr.tipo));
    $('#e-body').innerHTML = rows.length ? rows.slice(0, 600).map((x) => `<tr>
      <td class="c"><span class="sev ${x.severidad}">${x.severidad}</span></td>
      <td>${esc(ETIQUETA[x.tipo] || x.tipo)}</td>
      <td class="c">${esc(fFecha(x.fecha))}</td><td class="c">${esc(x.hora)}</td><td>${esc(x.examinador)}</td>
      <td>${esc(x.rut)}</td><td>${esc(nom(x.nombre))}</td><td>${esc(x.mensaje)}</td>
      <td class="c">${x.agenda_id ? `<button class="btn chico" data-id="${x.agenda_id}">Abrir</button>` : ''}</td></tr>`).join('')
      : licoVacioFila(9, 'celebra', 'Todo en orden', 'Nada que mostrar: no hay errores. ¡Eso es lo ideal!');
    $('#e-body').querySelectorAll('button[data-id]').forEach((el) => {
      el.onclick = () => abrirSlotPorId(Number(el.dataset.id), recargar(cargar));
    });
  };
  $('#e-refresh').onclick = () => { cacheGet.delete('/errores'); cargar(); };
  cargar();
}

/* ================= tab: AGENDA DEL DIA (informe de impresion) ================= */
const ESCUDO_SVG = `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="34" height="34">
  <path d="M20 2l15 5v11c0 9.5-6.2 16.8-15 20-8.8-3.2-15-10.5-15-20V7l15-5z" fill="#1b3a75"></path>
  <path d="M13 21l4.5 4.5L27 15" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

// Formato de hoja para imprimir (se elige segun el papel que haya en la impresora).
const PAGINAS = {
  carta:  { etq: 'Carta · 216 × 279 mm', size: '216mm 279mm' },
  a4:     { etq: 'A4 · 210 × 297 mm', size: '210mm 297mm' },
  oficio: { etq: 'Oficio · 216 × 330 mm', size: '216mm 330mm' },
};
function formatoImpresion() {
  try { return PAGINAS[localStorage.getItem('agenda-formato')] ? localStorage.getItem('agenda-formato') : 'carta'; }
  catch (_) { return 'carta'; }
}
function orientacionImpresion() {
  try { return localStorage.getItem('agenda-orientacion') || 'vertical'; }
  catch (_) { return 'vertical'; }
}
function aplicarFormatoImpresion(f, ori) {
  const formato = f || formatoImpresion();
  const orientacion = ori || orientacionImpresion();
  const p = PAGINAS[formato] || PAGINAS.carta;
  let st = document.getElementById('estilo-pagina');
  if (!st) { st = document.createElement('style'); st.id = 'estilo-pagina'; document.head.appendChild(st); }
  
  const dim = p.size.split(' ');
  const w = orientacion === 'horizontal' ? dim[1] : dim[0];
  const h = orientacion === 'horizontal' ? dim[0] : dim[1];
  const pageSize = `${w} ${h}`;
  const margins = orientacion === 'horizontal' ? '8mm' : '8mm 6mm';
  
  st.textContent = `@media print {
    @page { size: ${pageSize}; margin: ${margins}; }
    @page unica { size: ${pageSize}; margin: ${margins}; }
    .hoja-unica { page: unica; }
  }`;
  try {
    localStorage.setItem('agenda-formato', formato);
    localStorage.setItem('agenda-orientacion', orientacion);
  } catch (_) { /* ignore */ }
}
aplicarFormatoImpresion(formatoImpresion(), orientacionImpresion());

function disenoDia() {
  try { return localStorage.getItem('agenda-diseno-dia') === 'porexam' ? 'porexam' : 'unica'; }
  catch (_) { return 'unica'; }
}

// Una sola hoja (horizontal): filas = horas, columnas = examinadores. Cada
// celda trae solo nombre, RUT y clase, o el motivo si esta bloqueado.
function hojaUnicaDia(data, exs, largaFecha, generado) {
  const horas = [...new Set(exs.flatMap((ex) => data.examinadores[ex].map((r) => r.hora)))].sort();
  const celda = (r) => {
    if (!r) return '<td class="hu-vacio">—</td>';
    if (r.bloqueado) return `<td class="hu-bloq">${esc(r.bloqueo_motivo || 'BLOQUEADO')}</td>`;
    if (!(r.rut || r.nombre)) return '<td class="hu-libre">Disponible</td>';
    const claseTag = r.clase ? `<span class="hu-tag-clase">${esc(r.clase)}</span>` : '<span class="hu-tag-clase s-clase">s/c</span>';
    return `<td class="hu-celda">
      <div class="hu-nom">${esc(nom(r.nombre))}</div>
      <div class="hu-meta">
        <span class="hu-rut">${esc(r.rut || '-')}</span>
        <span class="hu-badges">${claseTag}</span>
      </div>
    </td>`;
  };
  const tot = exs.map((ex) => data.examinadores[ex].filter((r) => !r.bloqueado && (r.rut || r.nombre)).length);
  return `<article class="hoja-dia hoja-unica">
    <header class="hd-cab">
      ${MARCA.logo ? `<img src="${MARCA.logo}" alt="${esc(MARCA.organismo)}" class="hd-logo">` : ESCUDO_SVG}
      <div class="hd-org"><span>${esc(MARCA.organismo)} · ${esc(MARCA.unidad)}</span><b>Agenda de Prácticos</b></div>
      <div class="hd-folio">${esc(largaFecha)}</div>
    </header>
    <h2 class="hu-titulo">Agenda diaria — todos los examinadores (${tot.reduce((a, b) => a + b, 0)} citas)</h2>
    <table class="hd-tabla hu-tabla">
      <thead><tr><th class="hu-hora">Hora</th>${exs.map((ex, i) => `<th>${esc(nom(ex))}<span class="hu-det">${tot[i]} citas</span></th>`).join('')}</tr></thead>
      <tbody>${horas.map((h) => `<tr><td class="hu-hora num">${esc(h)}</td>${
        exs.map((ex) => celda(data.examinadores[ex].find((r) => r.hora === h))).join('')}</tr>`).join('')}</tbody>
    </table>
    <div class="hd-pie"><div class="hd-firmas">
      ${exs.map((ex) => `<div class="hd-firma"><div class="hd-linea"></div><span>${esc(nom(ex))}</span></div>`).join('')}
    </div><div class="hd-gen">Generado ${esc(generado)} · Sistema de Agenda de Prácticos</div></div>
  </article>`;
}

async function renderDia() {
  const fecha = (estadoAgenda.fecha || hoy());
  view.innerHTML = `
    <div class="panel no-print"><div class="fila">
      <div class="campo"><label>Fecha</label><input type="date" id="dd-fecha" value="${fecha}"></div>
      <div class="campo"><label>Formato de hoja</label>
        <select id="dd-formato">${Object.entries(PAGINAS).map(([k, v]) =>
          `<option value="${k}" ${k === formatoImpresion() ? 'selected' : ''}>${esc(v.etq)}</option>`).join('')}</select></div>
      <div class="campo"><label>Orientación</label>
        <select id="dd-orientacion">
          <option value="vertical" ${orientacionImpresion() === 'vertical' ? 'selected' : ''}>Vertical</option>
          <option value="horizontal" ${orientacionImpresion() === 'horizontal' ? 'selected' : ''}>Horizontal</option>
        </select></div>
      <div class="campo"><label>Diseño</label>
        <select id="dd-diseno">
          <option value="unica" ${disenoDia() === 'unica' ? 'selected' : ''}>Todos los examinadores en una hoja</option>
          <option value="porexam" ${disenoDia() === 'porexam' ? 'selected' : ''}>Una hoja por examinador/a</option>
        </select></div>
      <button class="btn" id="dd-print">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 6V2h8v4M4 12H2V6h12v6h-2M4 10h8v4H4z"/></svg>
        Imprimir informe
      </button>
    </div></div>
    <div id="dd-cont" class="dd-cont">Cargando...</div>`;
  $('#dd-fecha').onchange = (e) => { estadoAgenda.fecha = e.target.value; renderDia(); };
  $('#dd-formato').onchange = (e) => { aplicarFormatoImpresion(e.target.value); toast(`Formato: ${PAGINAS[e.target.value].etq}`); };
  $('#dd-orientacion').onchange = (e) => { aplicarFormatoImpresion(null, e.target.value); toast(`Orientación: ${e.target.value === 'vertical' ? 'Vertical' : 'Horizontal'}`); document.body.classList.toggle('orientacion-horizontal', e.target.value === 'horizontal'); };
  $('#dd-print').onclick = () => window.print();
  $('#dd-diseno').onchange = (e) => { try { localStorage.setItem('agenda-diseno-dia', e.target.value); } catch (_) { /* ignore */ } renderDia(); };

  await cargarVista('dia', `/dia?fecha=${fecha}`, (data) => {
  const exs = Object.keys(data.examinadores);
  if (!exs.length) {
    $('#dd-cont').innerHTML = `<div class="panel">${licoVacio('explica', 'Sin bloques este día', `No hay bloques para ${fFecha(fecha)}.`)}</div>`;
    return;
  }
  const generado = fFechaHora(new Date().toISOString());
  const largaFecha = fFechaLarga(fecha);
  document.body.classList.toggle('dia-unica', disenoDia() === 'unica');
  if (disenoDia() === 'unica') {
    $('#dd-cont').innerHTML = hojaUnicaDia(data, exs, largaFecha, generado);
    return;
  }

  $('#dd-cont').innerHTML = exs.map((ex, i) => {
    const filas = data.examinadores[ex];
    const citas = filas.filter((r) => !r.bloqueado && (r.rut || r.nombre));
    const conf = citas.filter((r) => r.confirmo_asistencia === 1).length;
    const bloq = filas.filter((r) => r.bloqueado).length;
    let n = 0;
    const cuerpo = filas.map((r) => {
      if (r.bloqueado) {
        return `<tr class="hd-bloq"><td></td><td class="num">${esc(r.hora)}</td><td colspan="3">NO DISPONIBLE — ${esc(r.bloqueo_motivo || 'BLOQUEADO')}</td></tr>`;
      }
      const ocupada = r.rut || r.nombre;
      if (!ocupada) {
        return `<tr class="hd-libre"><td></td><td class="num">${esc(r.hora)}</td><td colspan="3">Disponible</td></tr>`;
      }
      n += 1;
      return `<tr>
        <td class="hd-n">${n}</td>
        <td class="num">${esc(r.hora)}</td>
        <td class="num">${esc(r.rut || '')}</td>
        <td class="hd-nom">${esc(nom(r.nombre))}</td>
        <td class="hd-c">${r.clase ? clasesTagsHtml(r.clase) : ''}</td>
      </tr>`;
    }).join('');

    return `<article class="hoja-dia">
      <header class="hd-cab">
        ${MARCA.logo ? `<img src="${MARCA.logo}" alt="${esc(MARCA.organismo)}" class="hd-logo">` : ESCUDO_SVG}
        <div class="hd-org">
          <span>${esc(MARCA.organismo)} · ${esc(MARCA.unidad)}</span>
          <b>Agenda de Prácticos</b>
        </div>
        <div class="hd-folio">Hoja ${i + 1} de ${exs.length}</div>
      </header>

      <div class="hd-titulo">
        <h2>Agenda diaria de exámenes prácticos</h2>
        <div class="hd-datos">
          <div><span>Examinador/a</span><b>${esc(nom(ex))}</b></div>
          <div><span>Fecha</span><b>${esc(largaFecha)}</b></div>
          <div><span>Citas</span><b>${citas.length}</b></div>
          <div><span>Confirmadas</span><b>${conf}</b></div>
          <div><span>Bloqueos</span><b>${bloq}</b></div>
        </div>
      </div>

      <table class="hd-tabla">
        <colgroup>
          <col class="c-n"><col class="c-h"><col class="c-r"><col><col class="c-cl">
        </colgroup>
        <thead><tr>
          <th>N°</th><th>Hora</th><th>RUT</th><th>Nombre</th><th>Clase</th>
        </tr></thead>
        <tbody>${cuerpo}</tbody>
      </table>

      <div class="hd-pie">
        <div class="hd-firmas">
          <div class="hd-firma"><div class="hd-linea"></div><span>Firma examinador/a</span></div>
          <div class="hd-firma"><div class="hd-linea"></div><span>Visto bueno jefatura</span></div>
        </div>
        <div class="hd-gen">Generado ${esc(generado)} · Sistema de Agenda de Prácticos</div>
      </div>
    </article>`;
  }).join('');
  });
}

/* ================= tab: ANALITICA ================= */
let charts = [];
function limpiarCharts() { charts.forEach((c) => c.destroy()); charts = []; }
function paletaInst() {
  const oscuro = document.documentElement.dataset.tema === 'oscuro';
  return {
    serie: ['#1b3a75', '#2a5db0', '#5a3fae', '#1f7a3d', '#a8590a', '#ad2b2f', '#8b95a3', '#1b4f8f', '#6f8bd0'],
    linea: oscuro ? '#6d8bff' : '#1b3a75',
    rejilla: oscuro ? 'rgba(255,255,255,.08)' : 'rgba(16,24,40,.08)',
    texto: oscuro ? '#9aa4bd' : '#56616f',
  };
}
function grafico(id, tipo, labels, datos, label) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  const p = paletaInst();
  charts.push(new Chart(ctx, {
    type: tipo,
    data: { labels, datasets: [{
      label: label || '', data: datos,
      backgroundColor: tipo === 'doughnut' ? p.serie
        : tipo === 'line' ? 'rgba(27,58,117,.10)' : p.linea,
      borderColor: p.linea, borderWidth: tipo === 'line' ? 2.5 : 0, tension: .3, fill: tipo === 'line',
      borderRadius: tipo === 'bar' ? 2 : 0, maxBarThickness: 46,
      pointRadius: 0, pointHoverRadius: 4,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: tipo === 'doughnut', labels: { color: p.texto, font: { family: 'Public Sans' } } } },
      scales: tipo === 'doughnut' ? {} : {
        x: { grid: { color: p.rejilla }, ticks: { color: p.texto, font: { family: 'Public Sans' } } },
        y: { beginAtZero: true, grid: { color: p.rejilla }, ticks: { color: p.texto, font: { family: 'Public Sans' } } },
      },
    },
  }));
}
function graficoStack(id, labels, series) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  const p = paletaInst();
  charts.push(new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: series.map((s) => ({ label: s.label, data: s.data, backgroundColor: s.color, borderRadius: 2, maxBarThickness: 70 })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'bottom', labels: { color: p.texto, font: { family: 'Public Sans' }, boxWidth: 12 } } },
      scales: {
        x: { stacked: true, grid: { color: p.rejilla }, ticks: { color: p.texto, font: { family: 'Public Sans' } } },
        y: { stacked: true, beginAtZero: true, grid: { color: p.rejilla }, ticks: { color: p.texto, font: { family: 'Public Sans' }, precision: 0 } },
      },
    },
  }));
}
async function renderAnalitica() {
  const r = META.rango_agenda || {};
  view.innerHTML = `
    <div class="panel no-print"><div class="fila" style="justify-content:center;align-items:flex-end;gap:14px">
      <div class="campo"><label>Desde</label><input type="date" id="an-desde" value="${r.desde || ''}"></div>
      <div class="campo"><label>Hasta</label><input type="date" id="an-hasta" value="${r.hasta || ''}"></div>
      <button class="btn" id="an-ok">Aplicar filtro</button>
    </div></div>
    <div class="kpis" id="an-kpis"></div>
    <div class="grid2">
      <div class="panel"><h3>Resultado de examenes</h3><div class="grafico"><canvas id="g-res"></canvas></div></div>
      <div class="panel"><h3>Citas por examinador</h3><div class="grafico"><canvas id="g-exam"></canvas></div></div>
      <div class="panel"><h3>Resultados por examinador</h3>
        <div class="grafico"><canvas id="g-exres"></canvas></div>
        <div class="tabla-scroll" style="margin-top:.6rem"><table><thead><tr>
          <th>Examinador</th><th class="c">Aprobó</th><th class="c">Reprobó</th><th class="c">No asistió</th><th class="c">% aprobación</th>
        </tr></thead><tbody id="exres-tabla"></tbody></table></div>
      </div>
      <div class="panel"><h3>Citas por clase</h3><div class="grafico"><canvas id="g-clase"></canvas></div></div>
      <div class="panel"><h3>Citas por funcionario/a</h3><div class="grafico"><canvas id="g-func"></canvas></div></div>
      <div class="panel"><h3>Tipo de cita</h3><div class="grafico"><canvas id="g-tipo"></canvas></div></div>
      <div class="panel"><h3>Citas por dia (fecha de la cita)</h3><div class="grafico"><canvas id="g-tend"></canvas></div></div>
      <div class="panel"><h3>Agendados por dia (fecha de agendamiento)</h3><div class="grafico"><canvas id="g-agend"></canvas></div>
        <p class="muted" style="font-size:.8rem">Para citas migradas del Excel el dato es aproximado.</p></div>
    </div>
    <div class="panel"><h3>Resultados por escuela de conductores</h3>
      <div class="tabla-scroll"><table class="tabla-escuelas"><thead><tr>
        <th>Escuela</th><th class="c">Citas</th><th class="c">Aprobó</th><th class="c">Reprobó</th><th>% aprobación</th>
      </tr></thead><tbody id="esc-tabla"><tr><td colspan="5">Cargando...</td></tr></tbody></table></div>
      <p class="muted" style="font-size:.8rem">El % se calcula sobre aprobados + reprobados (incluye reprobado por inasistencia).</p>
    </div>`;
  const cargar = () => {
    const q = new URLSearchParams();
    if ($('#an-desde').value) q.set('desde', $('#an-desde').value);
    if ($('#an-hasta').value) q.set('hasta', $('#an-hasta').value);
    cargarVista('escuelas', `/estadisticas-escuelas?${q}`, pintarEscuelas).catch((e) => toast(e.message, 'err'));
    return cargarVista('analitica', `/analitica?${q}`, pintarAn);
  };
  const pintarEscuelas = (rows) => {
    if (!$('#esc-tabla')) return;
    $('#esc-tabla').innerHTML = (rows || []).length ? rows.map((x) => `<tr>
      <td>${esc(x.escuela_conductores)}</td><td class="c">${x.total}</td>
      <td class="c" style="color:var(--ok);font-weight:700">${x.aprobados}</td>
      <td class="c" style="color:var(--error);font-weight:700">${x.reprobados}</td>
      <td>${x.pct_aprobacion == null ? '<span class="muted">Sin resultados</span>'
        : `<div class="barra-pct"><span style="width:${Number(x.pct_aprobacion)}%"></span></div><b>${x.pct_aprobacion}%</b>`}</td></tr>`).join('')
      : licoVacioFila(5, 'explica', 'Sin datos', 'No hay citas con escuela de conductores en el período.');
  };
  const pintarAn = (a) => {
    limpiarCharts();
    const k = a.kpis;
    $('#an-kpis').innerHTML = [
      ['Bloques', k.bloques], ['Bloqueados', k.bloqueadas], ['Citas agendadas', k.ocupadas], ['Ocupacion', k.ocupacion + '%'],
      ['Con resultado', k.con_resultado], ['Aprobacion', k.aprobacion + '%'], ['Inasistencia', k.inasistencia + '%'],
      ['Reagendadas', k.reagendadas], ['Tasa reagend.', k.tasa_reagendamiento + '%'],
      ['En lista espera', k.lista_espera], ['Agendadas hoy', k.agendadas_hoy],
    ].map(([t, n]) => `<div class="kpi"><div class="n">${n}</div><div class="t">${t}</div></div>`).join('');
    const pares = (arr) => [arr.map((x) => x.k), arr.map((x) => x.n)];
    grafico('g-res', 'doughnut', ...pares(a.por_resultado));
    grafico('g-exam', 'bar', ...pares(a.por_examinador), 'Citas');
    const exr = a.por_examinador_resultado || [];
    graficoStack('g-exres', exr.map((x) => x.examinador), [
      { label: 'Aprobó', data: exr.map((x) => x.aprobados), color: '#1f7a3d' },
      { label: 'Reprobó', data: exr.map((x) => x.reprobados), color: '#ad2b2f' },
      { label: 'No asistió', data: exr.map((x) => x.no_asistio), color: '#98a2b2' },
    ]);
    $('#exres-tabla').innerHTML = exr.length ? exr.map((x) => `<tr>
      <td>${esc(x.examinador)}</td>
      <td class="c" style="color:#1f7a3d;font-weight:700">${x.aprobados}</td>
      <td class="c" style="color:#ad2b2f;font-weight:700">${x.reprobados}</td>
      <td class="c">${x.no_asistio}</td>
      <td class="c" style="font-weight:700">${x.aprobacion}%</td></tr>`).join('')
      : licoVacioFila(5, 'explica', 'Sin resultados', 'Aún no hay resultados en el período seleccionado.');
    grafico('g-clase', 'bar', ...pares(a.por_clase), 'Citas');
    grafico('g-func', 'bar', ...pares(a.por_funcionario), 'Citas');
    grafico('g-tipo', 'bar', ...pares(a.por_tipo), 'Citas');
    grafico('g-tend', 'line', a.tendencia.map((x) => x.dia), a.tendencia.map((x) => x.n), 'Citas');
    grafico('g-agend', 'line', a.tendencia_agendamiento.map((x) => x.dia), a.tendencia_agendamiento.map((x) => x.n), 'Agendados');
  };
  $('#an-ok').onclick = cargar;
  cargar();
}

/* ================= tab: POR VENCER (tramites D/A5) ================= */
async function renderVencimientos() {
  view.innerHTML = `
    <div class="panel">
      <div class="fila" style="align-items:center">
        <h2 style="margin:0;flex:1">Trámites por vencer</h2>
        <div class="campo"><label for="ven-filtro">Mostrar</label>
          <select id="ven-filtro">
            <option value="7">Vencen en 7 días o menos</option>
            <option value="30">Vencen en 30 días o menos</option>
            <option value="vencidos">Vencidos</option>
            <option value="todos" selected>Todos</option>
          </select></div>
      </div>
      <p class="muted">Citas de todas las clases desde hoy (y pasadas de los últimos 30 días sin resultado). El trámite vence 6 meses después de su inicio.</p>
      <div class="tabla-scroll"><table class="tabla-vencimientos"><thead><tr>
        <th class="c">Días restantes</th><th>Nombre</th><th>RUT</th><th class="c">Clase</th><th>Teléfono</th>
        <th class="c">Fecha cita</th><th>Examinador</th><th class="c">Vence</th>
      </tr></thead><tbody id="ven-body"><tr><td colspan="8">Cargando...</td></tr></tbody></table></div>
    </div>`;
  const cargar = () => cargarVista('vencimientos', `/tramites-por-vencer?filtro=${encodeURIComponent($('#ven-filtro').value)}`, pintar)
    .catch((e) => toast(e.message, 'err'));
  const pintar = (rows) => {
    const body = $('#ven-body');
    if (!body) return;
    body.innerHTML = (rows || []).length ? rows.map((r) => `<tr role="button" tabindex="0" data-id="${r.id}">
      <td class="c">${cuentaRegresivaHtml(r.dias_restantes_tramite, r.fecha_vencimiento_tramite)}</td>
      <td>${esc(nom(r.nombre) || '—')}</td><td class="num">${esc(r.rut || '—')}</td><td class="c">${esc(r.clase || '—')}</td>
      <td class="num">${esc(fTel(r.contacto) || '—')}</td><td class="num c">${esc(fFecha(r.fecha))} · ${esc(r.hora)}</td>
      <td>${esc(r.examinador || '—')}</td><td class="num c">${esc(fFecha(r.fecha_vencimiento_tramite))}</td></tr>`).join('')
      : licoVacioFila(8, 'explica', 'Nada por vencer', 'No hay trámites D/A5 en este filtro.');
    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      const abrir = () => abrirSlotPorId(Number(tr.dataset.id), cargar).catch((e) => toast(e.message, 'err'));
      tr.onclick = abrir;
      tr.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); } };
    });
  };
  $('#ven-filtro').onchange = cargar;
  cargar();
}

/* ================= tab: PAPELERA ================= */
const MOTIVO_TXT = {
  liberar: 'Se liberó el bloque', bloquear: 'Se bloqueó el bloque',
  'bloquear-dia': 'Se bloqueó el día completo', sobrescribir: 'Se pisó con otra cita',
  reagendar: 'Se reagendó a otro bloque',
};
function pintarBadge(id, n) {
  const b = document.getElementById(id);
  if (!b) return;
  b.textContent = n > 99 ? '99+' : n ? String(n) : '';
  b.hidden = !n;
}
// Los contadores se refrescan con cada dibujo de la Agenda; reutilizan una
// respuesta de menos de 1 minuto para no repetir el pedido en cada clic.
async function actualizarBadgePorConfirmar() {
  try {
    const hasta = sumarDias(hoy(), 7);
    const rows = (await apiReciente('/agenda?estado=porconfirmar', 30e3))
      .filter((r) => r.fecha >= hoy() && r.fecha <= hasta);
    pintarBadge('badge-porconfirmar', rows.length);
  } catch (_) {
    pintarBadge('badge-porconfirmar', 0);
  }
}

async function actualizarBadgeReagendar() {
  try {
    const [cola, pend] = await Promise.all([
      apiReciente('/cola-reagendar', 30e3).catch(() => []),
      apiReciente('/agenda?estado=pendiente', 30e3).catch(() => [])
    ]);
    pintarBadge('badge-reagendar', (cola.length || 0) + (pend.length || 0));
  } catch (_) { pintarBadge('badge-reagendar', 0); }
}

async function actualizarBadgePapelera() {
  try { pintarBadge('badge-papelera', (await apiReciente('/papelera', 60e3)).length); }
  catch (_) { pintarBadge('badge-papelera', 0); }
}
// Cuenta solo error+warning (los que valen la pena mirar); "info" queda fuera
// para no saturar el numerito con avisos de rutina (ej. citas sin resultado).
const pintarBadgeErrores = (rep) => pintarBadge('badge-errores', rep.hallazgos.filter((h) => h.severidad !== 'info').length);
// /errores recorre todas las citas (es el pedido mas pesado): el numerito se
// recalcula como maximo 1 vez por minuto aunque entremedio se guarden cambios.
// La pestaña "Reporte de errores" siempre trae el reporte fresco.
let badgeErroresT = 0;
async function actualizarBadgeErrores() {
  if (Date.now() - badgeErroresT < 60e3) return;
  badgeErroresT = Date.now();
  try { pintarBadgeErrores(await api('/errores')); }
  catch (_) { badgeErroresT = 0; pintarBadge('badge-errores', 0); }
}
async function renderPapelera() {
  view.innerHTML = `
    <div class="panel">
      <div class="fila" style="align-items:center">
        <h2 style="margin:0;flex:1">Papelera</h2>
        <button class="btn peligro sec" id="pap-vaciar">Vaciar papelera</button>
      </div>
      <p class="muted">Citas retiradas de un bloque al <b>liberarlo</b>, <b>bloquearlo</b>, <b>pisarlo</b> con otra cita
        o <b>reagendarlo</b>. Se conservan las últimas 200; se listan las 80 más recientes.
        Restaurar solo funciona si el bloque original sigue libre.</p>
      <div class="tabla-scroll tabla-papelera"><table><thead><tr>
        <th class="c">Cuándo</th><th class="c">Motivo</th><th class="c">Bloque original</th>
        <th class="c">Nombre</th><th class="c">RUT</th><th class="c">Clase</th><th class="c">Por</th><th class="c"></th>
      </tr></thead><tbody id="pap-body"><tr><td colspan="8">Cargando...</td></tr></tbody></table></div>
    </div>`;

  const cargar = () => cargarVista('papelera', '/papelera', (pap) => {
    pintarBadge('badge-papelera', pap.length);
    $('#pap-body').innerHTML = pap.length ? pap.map((p) => `<tr>
      <td class="num c">${esc(fFechaHora(p.ts))}</td>
      <td class="c">${esc(MOTIVO_TXT[p.motivo] || p.motivo || '—')}</td>
      <td class="num c">${esc(fFecha(p.fecha))} · ${esc(p.hora)}</td>
      <td>${esc(nom(p.nombre) || p.bloqueo_motivo || '—')}</td>
      <td class="num">${esc(p.rut || '—')}</td>
      <td class="c">${p.clase ? clasesTagsHtml(p.clase) : '—'}</td>
      <td>${esc(p.actor || '—')}</td>
      <td class="c">
        <button class="btn chico" data-id="${p.id}">Restaurar</button>
        <button class="btn chico peligro sec" data-del="${p.id}">Eliminar</button>
      </td></tr>`).join('')
      : licoVacioFila(8, 'saluda', 'Papelera vacía', 'Aquí no hay nada. Lico ya sacó la basura.');
    $('#pap-body').querySelectorAll('button[data-id]').forEach((el) => {
      el.onclick = async () => {
        try {
          const r = await api(`/papelera/${el.dataset.id}/restaurar`, { method: 'POST' });
          toast(`Restaurada: ${nom(r.bloque.nombre) || r.bloque.rut || 'cita'}`);
          cargar();
        } catch (e) { toast(e.message, 'err'); }
      };
    });
    $('#pap-body').querySelectorAll('button[data-del]').forEach((el) => {
      el.onclick = async () => {
        if (!confirm('Eliminar esta entrada de la papelera? No se puede deshacer.')) return;
        try {
          await api(`/papelera/${el.dataset.del}/eliminar`, { method: 'POST' });
          toast('Entrada eliminada');
          cargar();
        } catch (e) { toast(e.message, 'err'); }
      };
    });
  });
  $('#pap-vaciar').onclick = async () => {
    if (!confirm('Vaciar toda la papelera? Se pierden todas las citas retiradas guardadas ahi. No se puede deshacer.')) return;
    try {
      const r = await api('/papelera/vaciar', { method: 'POST' });
      toast(`Papelera vaciada (${r.eliminadas} entradas)`);
      cargar();
    } catch (e) { toast(e.message, 'err'); }
  };
  cargar();
}

/* ================= tab: DATOS ================= */
async function renderDatos() {
  view.innerHTML = `
    <div class="panel"><h2>Importar / Exportar</h2>
      <div class="fila">
        <div class="campo"><label>Archivo Excel de origen (.xlsx, .xls)</label><input type="file" id="im-file" accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
        <label style="align-self:center"><input type="checkbox" id="im-limpiar"> Reemplazar todo (borra lo actual)</label>
        <button class="btn" id="im-btn">Importar</button>
      </div>
      <p class="muted">Sin "reemplazar" se hace un backup antes y se fusionan las citas por (fecha, hora, examinador).</p>
      <div class="fila">
        <a class="btn sec" href="/api/export">Exportar (formato dashboard)</a>
        <a class="btn sec" href="/api/export?formato=original">Exportar (formato Excel original)</a>
        <button class="btn sec" id="bk-btn">Crear backup de la base</button>
      </div>
      <div id="im-res"></div>
    </div>

    <div class="panel"><h2>Generar bloques de agenda</h2>
      <div class="fila">
        <div class="campo"><label>Desde</label><input type="date" id="gb-desde"></div>
        <div class="campo"><label>Hasta</label><input type="date" id="gb-hasta"></div>
        <button class="btn" id="gb-btn">Generar</button>
      </div>
      <p class="muted">Crea los bloques faltantes (dias habiles, 11 horarios, por examinador activo). No pisa lo existente.</p>
    </div>

    <div class="panel"><h2>Feriados / dias inhabiles</h2>
      <div class="chips" id="fe-cont" style="margin:.4rem 0"></div>
      <div class="fila"><input type="date" id="fe-fecha"><input id="fe-nombre" placeholder="Nombre (opcional)"><button class="btn chico" id="fe-add">Agregar</button></div>
      <p class="muted">Tras cambiar feriados, volve a generar los bloques del periodo afectado.</p>
    </div>

    <div class="panel"><h2>Listas desplegables</h2><div id="cat-cont"></div></div>

    <div class="grid2">
      <div class="panel"><h2>Examinadores</h2><div id="ex-cont"></div>
        <div class="fila"><input id="ex-nuevo" placeholder="Nombre"><button class="btn chico" id="ex-add">Agregar</button></div></div>
      <div class="panel"><h2>Funcionarios/as</h2>
        <div id="fu-cont"></div>
        <div class="fila"><input id="fu-nuevo" placeholder="Nombre"><button class="btn chico" id="fu-add">Agregar</button></div></div>
    </div>

    <div class="panel"><h2>Ultimos movimientos</h2><div class="tabla-scroll"><table>
      <thead><tr><th class="c">Fecha</th><th>Acción</th><th>Por</th><th>Detalle</th></tr></thead><tbody id="mov-body"></tbody></table></div></div>`;

  // El .xlsx se lee ACA en el navegador (via vendor/xlsx.full.min.js) y se manda
  // ya leido al servidor, que tambien acepta el archivo crudo (campo 'archivo').
  //
  // OJO con las celdas de fecha/hora: sheet_to_json({cellDates:true}) devuelve
  // objetos Date. JSON.stringify() los convierte solo con .toISOString() (UTC),
  // y el servidor (worker/lib/fechas.js aISO/aHora) espera el mismo formato que
  // devolvia el Node viejo -- que corria en horario de Chile y leia esas fechas
  // con getFullYear()/getHours() (hora LOCAL). Si se manda la fecha ya en UTC,
  // la hora/fecha puede correrse (el navegador del usuario SI esta en horario
  // de Chile, asi que sus getters locales son los correctos a preservar). Por
  // eso cada Date se pasa a texto 'YYYY-MM-DD HH:MM:SS' con getters locales
  // ANTES de armar el JSON, en vez de dejar que JSON.stringify decida.
  const pad2 = (n) => String(n).padStart(2, '0');
  function celdaASerializable(v) {
    if (!(v instanceof Date) || isNaN(v)) return v;
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())} ${pad2(v.getHours())}:${pad2(v.getMinutes())}:${pad2(v.getSeconds())}`;
  }
  const HOJAS_IMPORTAR = ['AGO-DIC', 'ENE-JUN 2027', 'AGENDA', 'CITAS DISPONIBLES'];
  $('#im-btn').onclick = async () => {
    const f = $('#im-file').files[0];
    if (!f) return toast('Elige un archivo .xlsx o .xls', 'err');
    $('#im-res').innerHTML = '<p class="muted">Leyendo archivo...</p>';
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const hojas = {};
      for (const nombre of HOJAS_IMPORTAR) {
        const ws = wb.Sheets[nombre];
        if (!ws) continue;
        const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, cellDates: true, defval: null });
        hojas[nombre] = filas.map((fila) => Array.isArray(fila) ? fila.map(celdaASerializable) : fila);
      }
      // Si no tiene hojas con nombres estándar, procesar todas las hojas existentes
      if (Object.keys(hojas).length === 0 && wb.SheetNames && wb.SheetNames.length > 0) {
        for (const nombre of wb.SheetNames) {
          const ws = wb.Sheets[nombre];
          if (!ws) continue;
          const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, cellDates: true, defval: null });
          if (filas && filas.length > 1) {
            hojas[nombre] = filas.map((fila) => Array.isArray(fila) ? fila.map(celdaASerializable) : fila);
          }
        }
      }
      const encontradas = Object.keys(hojas);
      if (encontradas.length === 0) {
        const hojasArchivo = (wb.SheetNames || []).join(', ') || 'ninguna';
        return toast(`El archivo no contiene filas con datos. Hojas: ${hojasArchivo}`, 'err');
      }
      $('#im-res').innerHTML = '<p class="muted">Importando...</p>';
      const r = await api('/import', { method: 'POST', body: { hojas, limpiar: $('#im-limpiar').checked } });
      $('#im-res').innerHTML = `<div class="aviso">Listo. Leidas ${r.resumen.leidas}, citas ${r.resumen.ocupadas},
        bloques nuevos ${r.resumen.bloques_generados}, rango ${r.resumen.rango.map(fFecha).join(' a ')}.</div>`;
      META = await api('/meta');
      toast('Importacion completada');
    } catch (e) { $('#im-res').innerHTML = `<div class="aviso">${esc(e.message)}</div>`; }
  };
  $('#bk-btn').onclick = async () => {
    const r = await api('/backup', { method: 'POST' });
    toast('Backup: ' + r.archivo.split(/[\\/]/).pop());
  };
  $('#gb-btn').onclick = async () => {
    if (!$('#gb-desde').value || !$('#gb-hasta').value) return toast('Indica el rango', 'err');
    const r = await api('/agenda/generar', { method: 'POST', body: { desde: $('#gb-desde').value, hasta: $('#gb-hasta').value } });
    toast(`${r.creados} bloques nuevos en ${r.dias} dias habiles`);
    META = await api('/meta');
  };

  // feriados
  const fe = $('#fe-cont');
  fe.innerHTML = (META.feriados || []).map((f) => `<span class="chip">${esc(fFecha(f.fecha))}${f.nombre ? ' · ' + esc(f.nombre) : ''}<button data-f="${esc(f.fecha)}">&times;</button></span>`).join('') || '<span class="muted">Sin feriados</span>';
  fe.querySelectorAll('button[data-f]').forEach((b) => {
    b.onclick = async () => { await api(`/feriados?fecha=${b.dataset.f}`, { method: 'DELETE' }); META = await api('/meta'); renderDatos(); };
  });
  $('#fe-add').onclick = async () => {
    if (!$('#fe-fecha').value) return;
    await api('/feriados', { method: 'POST', body: { fecha: $('#fe-fecha').value, nombre: $('#fe-nombre').value } });
    META = await api('/meta'); renderDatos();
  };

  // catalogos
  const cc = $('#cat-cont');
  cc.innerHTML = Object.keys(META.catalogos).map((tipo) => `
    <div style="margin-bottom:.7rem"><b>${tipo}</b>
      <div class="chips" data-tipo="${tipo}" style="margin:.3rem 0">
        ${META.catalogos[tipo].map((v) => `<span class="chip">${esc(v)}<button data-v="${esc(v)}">&times;</button></span>`).join('')}
      </div>
      <div class="fila"><input placeholder="nuevo valor"><button class="btn chico">Agregar</button></div>
    </div>`).join('');
  cc.querySelectorAll('[data-tipo]').forEach((div) => {
    const tipo = div.dataset.tipo;
    div.querySelectorAll('button[data-v]').forEach((b) => {
      b.onclick = async () => {
        await api(`/catalogos?tipo=${tipo}&valor=${encodeURIComponent(b.dataset.v)}`, { method: 'DELETE' });
        META = await api('/meta'); renderDatos();
      };
    });
  });
  cc.querySelectorAll('.fila').forEach((fila) => {
    const tipo = fila.previousElementSibling.dataset.tipo;
    fila.querySelector('button').onclick = async () => {
      const valor = fila.querySelector('input').value.trim();
      if (!valor) return;
      await api('/catalogos', { method: 'POST', body: { tipo, valor } });
      META = await api('/meta'); renderDatos();
    };
  });

  // examinadores / funcionarios
  const listar = (cont, arr, base) => {
    cont.innerHTML = arr.map((x) => `<div class="fila" style="margin-bottom:.3rem">
      <span style="flex:1">${esc(x.nombre)}</span>
      <label><input type="checkbox" ${x.activo ? 'checked' : ''} data-id="${x.id}"> activo</label></div>`).join('');
    cont.querySelectorAll('input[data-id]').forEach((el) => {
      el.onchange = async () => {
        await api(`/${base}/${el.dataset.id}`, { method: 'PUT', body: { activo: el.checked } });
        META = await api('/meta');
      };
    });
  };
  listar($('#ex-cont'), META.examinadores, 'examinadores');
  const listarFuncionarios = (cont, arr) => {
    cont.innerHTML = arr.map((x) => `<div class="fila" style="margin-bottom:.4rem;align-items:center">
      <span style="flex:1">${esc(x.nombre)}</span>
      <label><input type="checkbox" class="fu-activo" ${x.activo ? 'checked' : ''} data-id="${x.id}"> activo</label></div>`).join('');
    cont.querySelectorAll('.fu-activo').forEach((el) => {
      el.onchange = async () => {
        await api(`/funcionarios/${el.dataset.id}`, { method: 'PUT', body: { activo: el.checked } });
        META = await api('/meta');
      };
    });
  };
  listarFuncionarios($('#fu-cont'), META.funcionarios);
  $('#ex-add').onclick = async () => {
    const nombre = $('#ex-nuevo').value.trim(); if (!nombre) return;
    await api('/examinadores', { method: 'POST', body: { nombre } });
    META = await api('/meta'); renderDatos();
  };
  $('#fu-add').onclick = async () => {
    const nombre = $('#fu-nuevo').value.trim(); if (!nombre) return;
    await api('/funcionarios', { method: 'POST', body: { nombre } });
    META = await api('/meta'); renderDatos();
  };

  const mov = await api('/movimientos');
  $('#mov-body').innerHTML = mov.map((m) => `<tr><td class="num c">${esc(fFechaHora(m.ts))}</td><td>${esc(m.accion)}</td><td>${esc(m.actor)}</td><td>${esc(m.detalle)}</td></tr>`).join('');

}

/* ================= arranque ================= */
async function init({ forzarAgenda = false } = {}) {
  try {
    META = await api('/meta');
    MARCA = { logo: META.logo, organismo: META.organismo || MARCA.organismo, unidad: META.unidad || MARCA.unidad };
    $('#marca').innerHTML = MARCA.logo
      ? `${logoHtml('escudo')}<span class="marca-txt"><span class="marca-titulo">Agenda de Prácticos</span></span>`
      : `${ESCUDO_FALLBACK}<span class="marca-txt">
          <span class="marca-org">${esc(MARCA.organismo)} · ${esc(MARCA.unidad)}</span>
          <span class="marca-titulo">Agenda de Prácticos</span></span>`;
    const r = META.rango_agenda || {};
    $('#estado').innerHTML = `${r.desde ? `Agenda ${fFecha(r.desde)} – ${fFecha(r.hasta)} · ` : ''}hoy ${fFecha(META.hoy)}`;
    // Al abrir el sistema siempre parte en Agenda, aunque la
    // URL guardada traiga otra pestaña (#datos, etc.). Solo un F5 conserva la actual.
    // replaceState no dispara hashchange, asi la vista no se dibuja dos veces.
    const esRecarga = performance.getEntriesByType('navigation')[0]?.type === 'reload';
    const curTab = (location.hash.slice(1) || '').split('?')[0];
    if (forzarAgenda || (!tabs[curTab] && !location.hash)) history.replaceState(null, '', '#disponibles');
    ruta();
    actualizarBadgePapelera();
    actualizarBadgeErrores();
    actualizarBadgePorConfirmar();
  } catch (e) {
    view.innerHTML = `<div class="panel"><h2>No se pudo conectar</h2><p>${esc(e.message)}</p></div>`;
  }
}
document.querySelectorAll('#nav button[data-tab]').forEach((b) => { b.onclick = () => irA(b.dataset.tab); });

/* tema claro / oscuro */
(function tema() {
  const btn = document.getElementById('tema');
  try {
    const g = localStorage.getItem('agenda-tema');
    if (g) document.documentElement.dataset.tema = g;
  } catch (_) { /* ignore */ }
  const pinta = () => { btn.textContent = document.documentElement.dataset.tema === 'oscuro' ? '☀' : '☾'; };
  pinta();
  btn.onclick = () => {
    const nuevo = document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro';
    document.documentElement.dataset.tema = nuevo;
    try { localStorage.setItem('agenda-tema', nuevo); } catch (_) { /* ignore */ }
    pinta();
    if ((location.hash.slice(1) || 'agenda') === 'analitica') renderAnalitica();
  };
})();

const btnGuiaGlobal = document.getElementById('btn-guia-global');
if (btnGuiaGlobal) {
  btnGuiaGlobal.onclick = () => iniciarGuiaInteractiva(); // el primer paso decide la pestaña
}

init();


/* ================= GUÍA INTERACTIVA / SIMULADOR ================= */
// Cada paso: { seccion, tab?, target, fallback?, listo?, titulo, icono, descripcion, pose? }
//  - tab: pestaña que se abre (irA) antes de apuntar al target.
//  - listo: selector (o función) que indica que la vista ya pintó; por defecto, el propio target.
//  - fallback: elemento a resaltar si el target no existe (p. ej. no hay datos para esa fecha).
// El número del título se antepone automáticamente según la posición del paso.
let tourPasoActual = 0;
let tourToken = 0;
let tourTabOrigen = null;
const tourTabActual = () => (location.hash.slice(1) || 'disponibles').split('?')[0];
const tourQuery = (sel) => { if (!sel) return null; try { return document.querySelector(sel); } catch (_) { return null; } };
const tourSinCargando = (sel) => () => { const el = tourQuery(sel); return !!el && !/Cargando/i.test(el.textContent || ''); };
const tourPausa = (ms) => new Promise((r) => setTimeout(r, ms));
const TOUR_GRILLA_LISTA = '#a-grid .g-head, #a-grid .gh-exam-col, #a-grid .lico-vacio';

const PASOS_TOUR = [
  /* ---------- Entorno general ---------- */
  {
    seccion: 'Entorno general',
    target: '#nav',
    titulo: 'Pestañas y módulos principales',
    icono: '🧭',
    descripcion: 'Desde aquí accedes a todos los módulos: <b>Citas disponibles</b>, <b>Agenda</b>, <b>Reagendar</b>, <b>Por confirmar</b>, <b>Agenda del día</b>, <b>Estadísticas</b>, <b>Papelera</b>, <b>Datos</b> y <b>Reporte de errores</b>. Los números de color junto a algunas pestañas son avisos pendientes. Esta guía los recorre uno por uno.'
  },
  {
    seccion: 'Entorno general',
    target: '#bq',
    titulo: 'Buscador global',
    icono: '🔎',
    descripcion: 'Escribe un <b>RUT, nombre o teléfono</b> (mínimo 3 caracteres). Navega los resultados con las flechas <b>↑ ↓</b> y elige con <b>Enter</b> o con clic: se abre el <b>historial completo</b> de esa persona, con un botón <b>Abrir</b> en cada cita para ver su ficha. <b>Esc</b> cierra la lista.'
  },
  {
    seccion: 'Entorno general',
    target: '#tema',
    titulo: 'Tema claro u oscuro',
    icono: '🌗',
    descripcion: 'Alterna entre el tema <b>claro</b> y el <b>oscuro</b>. El sistema recuerda tu elección en este equipo.'
  },
  {
    seccion: 'Entorno general',
    target: '#btn-guia-global',
    titulo: 'Esta guía, cuando la necesites',
    icono: '🧑‍🏫',
    descripcion: 'Puedes volver a abrir esta guía en cualquier momento con este botón. Dentro de ella usa <b>← →</b> para avanzar o retroceder y <b>Esc</b> para salir. Al cerrarla, regresas a la pestaña donde estabas.',
    pose: 'saluda'
  },

  /* ---------- Citas disponibles ---------- */
  {
    seccion: 'Citas disponibles',
    tab: 'disponibles',
    target: '#view > .panel.no-print',
    listo: '#d-buscar',
    titulo: 'Citas disponibles: filtros de búsqueda',
    icono: '🗓️',
    descripcion: 'Busca cupos libres por rango <b>Desde / Hasta</b> (por defecto, los próximos 60 días), <b>Clase</b> y <b>Examinador</b>, y pulsa <b>Buscar</b>. Si eliges clase <b>D</b> o <b>A5</b>, solo se muestran los bloques reservados para clases pesadas.'
  },
  {
    seccion: 'Citas disponibles',
    tab: 'disponibles',
    target: '#d-body button[data-id]',
    fallback: '#d-body',
    listo: tourSinCargando('#d-body'),
    titulo: 'Reservar un cupo (Agendar)',
    icono: '✍️',
    descripcion: 'Cada fila es un bloque libre. <b>Agendar</b> abre el formulario de la cita: <b>nombre, RUT</b> (con validación), <b>celular</b>, <b>clase(s)</b> (puedes marcar más de una), <b>correo</b> y el <b>funcionario/a</b> que agenda. Para clases pesadas fuera de su bloque aparece la casilla <b>Forzar</b>. Termina con <b>Confirmar y agendar cita</b>. Si no hay cupos en el rango, amplía la fecha <b>Hasta</b>.'
  },

  /* ---------- Agenda ---------- */
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-fecha',
    titulo: 'Agenda: navegación por fechas',
    icono: '📅',
    descripcion: 'Elige la fecha en el calendario o usa las flechas <b>← →</b> para saltar al día anterior o siguiente con agenda. El botón <b>Hoy</b> te devuelve de inmediato a la jornada actual.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-exam',
    titulo: 'Filtro de examinadores',
    icono: '👤',
    descripcion: 'Ve la grilla con <b>todos</b> los examinadores en columnas paralelas, o selecciona uno para concentrarte en sus citas y cupos.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-libres',
    titulo: 'Contador de bloques libres',
    icono: '🔢',
    descripcion: 'Indica cuántos bloques quedan <b>disponibles para agendar</b> en la fecha (y examinador) que estás viendo.',
    listo: () => { const el = tourQuery('#a-libres'); return !!el && !/^—/.test(el.textContent.trim()); }
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '.vista-selector',
    titulo: 'Vistas vertical y horizontal',
    icono: '📐',
    descripcion: 'Cambia entre la vista clásica en <b>columnas por examinador</b> (vertical) o la <b>vista horizontal continua</b> tipo línea de tiempo. El sistema recuerda tu preferencia.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'La grilla operativa',
    icono: '🗂️',
    descripcion: 'Una columna por examinador y una fila por horario. El horario reservado para clases pesadas se marca con la etiqueta <b>D · A5</b>. Cada examinador muestra cuántas citas tiene ese día. Los bloques libres se ven con un guion (<b>—</b>) y los cupos se reservan desde <b>Citas disponibles</b>.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .slot.ocupada',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Tarjeta de cita',
    icono: '🪪',
    descripcion: 'Cada tarjeta muestra <b>postulante, clase, RUT, funcionario/a, teléfono y correo</b>. El símbolo <b>⚠</b> avisa de datos faltantes o inválidos (RUT, teléfono o correo). Las insignias indican <b>1° o 2° vez</b>, <b>Reagendada</b>, <b>Confirmó asistencia</b> y el <b>resultado</b>. Para ver o editar la ficha completa de una cita (incluida <b>Liberar bloque</b>), usa el buscador global o el Reporte de errores y pulsa <b>Abrir</b>.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .btn-wa',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Contacto por WhatsApp',
    icono: '💬',
    descripcion: 'Si la cita tiene un celular válido, el botón <b>WhatsApp</b> abre la conversación con un mensaje institucional ya redactado (fecha, hora y examinador). También verás el teléfono y el correo registrados.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .btn-confirmar',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Confirmar asistencia',
    icono: '✅',
    descripcion: 'Marca que el postulante <b>confirmó su asistencia</b>. Si ya estaba confirmado, el sistema pide confirmación antes de volver a dejarlo como pendiente. Las citas sin confirmar aparecen en la pestaña <b>Por confirmar</b>.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .btn-reagendar',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Derivar a Reagendar',
    icono: '🔄',
    descripcion: 'Envía al postulante a la lista de <b>Reagendar</b> (motivo: solicita cambio) y te lleva a esa pestaña para elegirle un nuevo cupo.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .slot-res',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Resultados: Aprobó, Reprobó, No asistió',
    icono: '🏁',
    descripcion: 'En las citas de <b>hoy o de días pasados</b> aparecen tres botones rápidos: <b>Aprobó</b>, <b>Reprobó</b> y <b>No asistió</b>. El resultado se guarda al instante; si pulsas de nuevo el botón activo, el resultado se <b>borra</b>. En citas futuras estos botones no se muestran.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .slot.bloqueado',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Bloques inhabilitados',
    icono: '🔒',
    descripcion: 'Los bloques bloqueados se muestran con el candado y el <b>motivo</b> (licencia, feriado, capacitación, terreno...). No se pueden agendar hasta que se desbloqueen con el botón <b>Desbloquear</b> de arriba.',
    pose: 'alerta'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-bloqdia',
    titulo: 'Bloquear días u horas',
    icono: '🔐',
    descripcion: 'Inhabilita franjas por licencias, feriados, capacitaciones o terreno. En el diálogo eliges <b>Día(s) completo(s)</b> (con <i>Ajustar a semanas completas lun–vie</i>) o <b>Por horas / bloques</b> (chips por hora, rango rápido, Mañana, Mediodía y aplicar a varios días), el <b>examinador</b> (o todos) y el <b>motivo</b>. Con la casilla <b>Incluir bloques que ya tienen cita</b> activa, esos postulantes pasan automáticamente a <b>Reagendar</b> para proteger su cupo.',
    pose: 'alerta'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-desbloqdia',
    titulo: 'Desbloquear días u horas',
    icono: '🔓',
    descripcion: 'Estructura simétrica al bloqueo: reactiva días completos o bloques de horas específicos cuando una ausencia se cancela. Antes de confirmar, el diálogo te informa <b>cuántos bloques se reactivarán</b>.'
  },

  /* ---------- Reagendar ---------- */
  {
    seccion: 'Reagendar',
    tab: 'reagendar',
    target: '#r-filtros-origen',
    listo: tourSinCargando('#r-filtros-origen'),
    titulo: 'Reagendar: origen y prioridad',
    icono: '🚨',
    descripcion: 'Reúne a quienes necesitan una nueva hora, ordenados por prioridad: primero los afectados por un <b>bloqueo</b> (urgentes) y luego las <b>solicitudes de cambio</b>. Filtra con <b>Todos</b>, <b>Por bloqueo</b> o <b>Solicitud de cambio</b>; cada botón muestra su contador.'
  },
  {
    seccion: 'Reagendar',
    tab: 'reagendar',
    target: '#r-detalle',
    listo: '#r-detalle .panel',
    titulo: 'Búsqueda de cupos libres',
    icono: '🧭',
    descripcion: 'Define el rango de destino (<b>Destino desde / Hasta</b>) y el <b>examinador</b>, y pulsa <b>Ver bloques libres</b> para explorar qué cupos hay. Al seleccionar a un postulante, este mismo panel pasa a mostrar su cita actual y los cupos donde puede ir.'
  },
  {
    seccion: 'Reagendar',
    tab: 'reagendar',
    target: '#r-tabla-unificada button[data-id]',
    fallback: '#r-tabla-unificada',
    listo: tourSinCargando('#r-tabla-unificada'),
    titulo: 'Reagendar una solicitud de cambio',
    icono: '🔁',
    descripcion: 'Con <b>Reagendar</b> seleccionas al postulante: se abre el panel <b>Reagendamiento en curso</b>. Elige el rango y el examinador, pulsa <b>Ver bloques libres</b> y usa <b>Mover aquí</b> sobre el cupo deseado. <b>Cancelar selección</b> deshace la elección. Si no hay filas, la lista está vacía y no hay nadie pendiente.'
  },
  {
    seccion: 'Reagendar',
    tab: 'reagendar',
    target: '#r-tabla-unificada button[data-cola]',
    fallback: '#r-tabla-unificada',
    listo: tourSinCargando('#r-tabla-unificada'),
    titulo: 'Asignar hora por bloqueo',
    icono: '📌',
    descripcion: 'Para quienes perdieron su cita por un bloqueo: <b>Asignar hora</b> abre la búsqueda de cupos, con un <b>correo opcional</b> para enviar la confirmación. Elige <b>Asignar este cupo</b> y confirma. Las clases pesadas solo ven bloques D/A5.'
  },
  {
    seccion: 'Reagendar',
    tab: 'reagendar',
    target: '#r-tabla-unificada button[data-desc]',
    fallback: '#r-tabla-unificada',
    listo: tourSinCargando('#r-tabla-unificada'),
    titulo: 'Descartar de la lista',
    icono: '🗑️',
    descripcion: '<b>Descartar</b> retira a un postulante de la lista de reagendamiento (pide confirmación). Úsalo cuando ya no corresponde reagendarlo.'
  },

  /* ---------- Por confirmar ---------- */
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#pc-total-badge',
    listo: tourSinCargando('#pc-total-badge'),
    titulo: 'Por confirmar: citas pendientes',
    icono: '📋',
    descripcion: 'Lista a los postulantes citados que <b>aún no confirman asistencia</b>. El contador muestra cuántos hay y <b>↻ Actualizar</b> recarga la lista.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#pc-q',
    titulo: 'Buscar en la lista',
    icono: '🔍',
    descripcion: 'Filtra al instante por <b>RUT, nombre o teléfono</b> mientras escribes.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#pc-rango',
    titulo: 'Rango de fechas',
    icono: '⏳',
    descripcion: 'Elige ver los próximos <b>7, 15 o 30 días</b>, o <b>todas las fechas futuras</b>.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#pc-tbody .btn-wa',
    fallback: '#pc-tbody',
    listo: tourSinCargando('#pc-total-badge'),
    titulo: 'Contactar al postulante',
    icono: '📞',
    descripcion: 'En cada fila tienes el <b>teléfono</b>, el enlace de <b>WhatsApp</b> con un mensaje que pide confirmar o reagendar, y el <b>correo</b>. Si falta el dato, la fila indica <i>Sin teléfono</i> o <i>Sin correo</i>.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#pc-tbody button[data-si]',
    fallback: '#pc-tbody',
    listo: tourSinCargando('#pc-total-badge'),
    titulo: 'Registrar la respuesta',
    icono: '✔️',
    descripcion: '<b>✔ Confirmó</b> registra la asistencia; <b>✖ No asiste</b> registra que no vendrá. En ambos casos la fila sale de la lista de pendientes.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#pc-tbody button[data-reag]',
    fallback: '#pc-tbody',
    listo: tourSinCargando('#pc-total-badge'),
    titulo: 'Derivar a Reagendar',
    icono: '🔄',
    descripcion: '<b>🔄 Reagendar</b> envía al postulante a la lista de Reagendar y abre su panel para asignarle un nuevo cupo.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#btn-enviar-correos-masivos',
    titulo: 'Enviar correos a pendientes',
    icono: '✉️',
    descripcion: 'Envía el <b>enlace de confirmación por correo</b> a todos los postulantes citados que tengan correo registrado (pide confirmación antes). Si el servicio de correo (SMTP) no está activo, solo se generan los enlaces y el sistema te lo avisa.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#btn-correo-prueba',
    titulo: 'Correo de prueba',
    icono: '🧪',
    descripcion: 'Envía los correos de confirmación de prueba a <b>la dirección que tú indiques</b>, para revisar cómo se ven antes de enviar los reales.'
  },

  /* ---------- Agenda del día ---------- */
  {
    seccion: 'Agenda del día',
    tab: 'dia',
    target: '#dd-fecha',
    titulo: 'Agenda del día: fecha',
    icono: '🖨️',
    descripcion: 'Informe imprimible de la jornada. Elige la <b>fecha</b> del informe; por defecto es la fecha que estabas viendo en la pestaña Agenda.'
  },
  {
    seccion: 'Agenda del día',
    tab: 'dia',
    target: '#dd-formato',
    titulo: 'Formato y orientación de la hoja',
    icono: '📄',
    descripcion: 'Selecciona el <b>formato de hoja</b> y, justo al lado, la <b>orientación</b> (vertical u horizontal). Los cambios se aplican de inmediato a la impresión.'
  },
  {
    seccion: 'Agenda del día',
    tab: 'dia',
    target: '#dd-diseno',
    titulo: 'Diseño del informe',
    icono: '🧩',
    descripcion: 'Imprime a <b>todos los examinadores en una sola hoja</b> o <b>una hoja por examinador/a</b>.'
  },
  {
    seccion: 'Agenda del día',
    tab: 'dia',
    target: '#dd-print',
    titulo: 'Imprimir informe',
    icono: '🖨️',
    descripcion: 'Abre el cuadro de impresión del navegador con la hoja tal como se ve abajo (la barra de filtros no se imprime).'
  },
  {
    seccion: 'Agenda del día',
    tab: 'dia',
    target: '#dd-cont',
    listo: tourSinCargando('#dd-cont'),
    titulo: 'Vista previa del informe',
    icono: '👁️',
    descripcion: 'Así saldrá el informe en papel: las citas del día por examinador. Si la fecha no tiene bloques (fin de semana o feriado), verás un aviso.'
  },

  /* ---------- Estadísticas ---------- */
  {
    seccion: 'Estadísticas',
    tab: 'analitica',
    target: '#view > .panel.no-print',
    listo: '#an-ok',
    titulo: 'Estadísticas: filtro de período',
    icono: '📊',
    descripcion: 'Define el período con <b>Desde / Hasta</b> y pulsa <b>Aplicar filtro</b> para recalcular los indicadores y gráficos.'
  },
  {
    seccion: 'Estadísticas',
    tab: 'analitica',
    target: '#an-kpis',
    listo: '#an-kpis .kpi',
    titulo: 'Indicadores (KPI)',
    icono: '🎯',
    descripcion: 'Resumen del período: <b>bloques, bloqueados, citas agendadas, ocupación, aprobación, inasistencia, reagendadas</b>, lista de espera y agendadas hoy.'
  },
  {
    seccion: 'Estadísticas',
    tab: 'analitica',
    target: '#view .grid2',
    listo: '#an-kpis .kpi',
    titulo: 'Gráficos',
    icono: '📈',
    descripcion: 'Resultado de exámenes, citas por examinador, por clase, por funcionario/a, tipo de cita, citas por día y agendamientos por día.'
  },
  {
    seccion: 'Estadísticas',
    tab: 'analitica',
    target: '.panel:has(#exres-tabla)',
    fallback: '#view .grid2',
    listo: '#an-kpis .kpi',
    titulo: 'Resultados por examinador',
    icono: '🧮',
    descripcion: 'Tabla con <b>Aprobó, Reprobó, No asistió</b> y <b>% de aprobación</b> de cada examinador en el período filtrado.'
  },

  /* ---------- Papelera ---------- */
  {
    seccion: 'Papelera',
    tab: 'papelera',
    target: '#view > .panel',
    listo: '#pap-body',
    titulo: 'Papelera: citas retiradas',
    icono: '🗑️',
    descripcion: 'Guarda las citas que salieron de un bloque al <b>liberarlo, bloquearlo, pisarlo con otra cita o reagendarlo</b>. Se conservan las últimas 200 y se listan las 80 más recientes.',
    pose: 'alerta'
  },
  {
    seccion: 'Papelera',
    tab: 'papelera',
    target: '#pap-body button[data-id]',
    fallback: '#pap-body',
    listo: tourSinCargando('#pap-body'),
    titulo: 'Restaurar una cita',
    icono: '♻️',
    descripcion: '<b>Restaurar</b> devuelve la cita a su bloque original. Solo funciona si ese bloque sigue libre.'
  },
  {
    seccion: 'Papelera',
    tab: 'papelera',
    target: '#pap-body button[data-del]',
    fallback: '#pap-body',
    listo: tourSinCargando('#pap-body'),
    titulo: 'Eliminar una entrada',
    icono: '❌',
    descripcion: '<b>Eliminar</b> borra definitivamente esa entrada (pide confirmación y no se puede deshacer).'
  },
  {
    seccion: 'Papelera',
    tab: 'papelera',
    target: '#pap-vaciar',
    titulo: 'Vaciar la papelera',
    icono: '🧹',
    descripcion: '<b>Vaciar papelera</b> elimina todas las entradas guardadas. Pide confirmación y no se puede deshacer.',
    pose: 'alerta'
  },

  /* ---------- Datos ---------- */
  {
    seccion: 'Datos',
    tab: 'datos',
    target: '.panel:has(#im-btn)',
    fallback: '#im-btn',
    listo: '#im-btn',
    titulo: 'Datos: importar desde Excel',
    icono: '📥',
    descripcion: 'Selecciona un archivo <b>.xlsx o .xls</b> y pulsa <b>Importar</b>. Sin marcar <i>Reemplazar todo</i>, el sistema hace un <b>backup antes</b> y fusiona las citas por fecha, hora y examinador. Con la casilla marcada se <b>borra lo actual</b>: úsala con cuidado.'
  },
  {
    seccion: 'Datos',
    tab: 'datos',
    target: 'a[href="/api/export"]',
    listo: '#im-btn',
    titulo: 'Exportar a Excel',
    icono: '📤',
    descripcion: 'Descarga las citas en <b>formato dashboard</b> o en el <b>formato Excel original</b> (el segundo botón).'
  },
  {
    seccion: 'Datos',
    tab: 'datos',
    target: '#bk-btn',
    listo: '#bk-btn',
    titulo: 'Backup de la base',
    icono: '💾',
    descripcion: '<b>Crear backup de la base</b> guarda una copia de seguridad de todos los datos y te informa el nombre del archivo creado.'
  },
  {
    seccion: 'Datos',
    tab: 'datos',
    target: '.panel:has(#gb-btn)',
    fallback: '#gb-btn',
    listo: '#gb-btn',
    titulo: 'Generar bloques de agenda',
    icono: '🧱',
    descripcion: 'Indica <b>Desde / Hasta</b> y pulsa <b>Generar</b> para crear los bloques que falten (días hábiles, por examinador activo). No pisa lo existente.'
  },
  {
    seccion: 'Datos',
    tab: 'datos',
    target: '.panel:has(#fe-add)',
    fallback: '#fe-add',
    listo: '#fe-add',
    titulo: 'Feriados y días inhábiles',
    icono: '🎌',
    descripcion: 'Agrega un feriado con su fecha (y nombre opcional) o quita uno con la <b>×</b>. Después de cambiarlos, vuelve a generar los bloques del período afectado.'
  },
  {
    seccion: 'Datos',
    tab: 'datos',
    target: '.panel:has(#cat-cont)',
    fallback: '#cat-cont',
    listo: '#cat-cont',
    titulo: 'Listas desplegables',
    icono: '📚',
    descripcion: 'Administra las opciones de los catálogos del sistema (clases, motivos, etc.): agrega un valor nuevo o quítalo con la <b>×</b>.'
  },
  {
    seccion: 'Datos',
    tab: 'datos',
    target: '.grid2:has(#ex-cont)',
    fallback: '#ex-cont',
    listo: '#ex-cont',
    titulo: 'Examinadores y funcionarios/as',
    icono: '👥',
    descripcion: 'Agrega nuevas personas y marca o desmarca <b>activo</b> para que aparezcan (o no) en la agenda y en los formularios.'
  },
  {
    seccion: 'Datos',
    tab: 'datos',
    target: '.panel:has(#mov-body)',
    fallback: '#mov-body',
    listo: '#mov-body',
    titulo: 'Últimos movimientos',
    icono: '🕘',
    descripcion: 'Bitácora de acciones recientes: fecha, acción, quién la hizo y el detalle.'
  },

  /* ---------- Reporte de errores ---------- */
  {
    seccion: 'Reporte de errores',
    tab: 'errores',
    target: '#e-refresh',
    listo: '#e-refresh',
    titulo: 'Reporte de errores',
    icono: '⚠️',
    descripcion: 'Revisa la calidad de los datos: citas incompletas, RUT inválido, duplicados, sin teléfono o correo, conflictos de clase en el bloque D/A5, etc. <b>Recalcular</b> actualiza el análisis.',
    pose: 'alerta'
  },
  {
    seccion: 'Reporte de errores',
    tab: 'errores',
    target: '#e-chips',
    listo: '#e-chips .chip',
    titulo: 'Filtrar por tipo de error',
    icono: '🏷️',
    descripcion: 'Cada chip muestra un tipo de hallazgo con su cantidad. Pulsa uno para filtrar la tabla, o <b>Todos</b> para verlos juntos.'
  },
  {
    seccion: 'Reporte de errores',
    tab: 'errores',
    target: '#e-body button[data-id]',
    fallback: '#e-body',
    listo: tourSinCargando('#e-body'),
    titulo: 'Abrir y corregir la cita',
    icono: '🛠️',
    descripcion: '<b>Abrir</b> muestra la ficha de la cita para corregir sus datos o usar <b>Liberar bloque</b> y <b>Reagendar postulante</b>. Si la tabla dice <i>Nada que mostrar</i>, no hay errores. ¡Eso es lo ideal!',
    pose: 'celebra'
  }
];

let tourKeyHandler = null;

function iniciarGuiaInteractiva() {
  const tip = document.getElementById('tooltip-flotante');
  if (tip) tip.classList.remove('visible');
  cerrarGuiaInteractiva(false);
  tourPasoActual = 0;
  tourTabOrigen = tourTabActual();

  const overlay = document.createElement('div');
  overlay.id = 'tour-overlay';
  overlay.className = 'tour-overlay';
  overlay.innerHTML = `
    <button class="tour-btn-salir-flotante" id="tour-salir-flotante" title="Terminar y cerrar la guía">
      <span>✕</span> Cerrar guía
    </button>
    <div id="tour-spotlight" class="tour-spotlight"></div>
    <div id="tour-card" class="tour-card">
      <div class="tour-card-header">
        <span class="tour-paso-badge" id="tour-badge">Paso 1 de ${PASOS_TOUR.length}</span>
        <button class="tour-btn-cerrar" id="tour-cerrar" title="Cerrar guía">&times;</button>
      </div>
      <div class="tour-card-body">
        <div class="tour-mascota" id="tour-mascota" aria-hidden="true"></div>
        <div class="tour-card-texto">
          <h3 id="tour-titulo" class="tour-card-titulo"></h3>
          <p id="tour-desc" class="tour-card-desc"></p>
        </div>
      </div>
      <span class="tour-progreso" aria-hidden="true"><i id="tour-prog"></i></span>
      <div class="tour-card-footer">
        <button class="btn chico sec" id="tour-prev">Anterior</button>
        <div class="tour-dots" id="tour-dots"></div>
        <button class="btn chico" id="tour-next">Siguiente</button>
      </div>
      <div id="tour-flecha" class="tour-flecha"></div>
    </div>`;
  document.body.appendChild(overlay);

  const ir = (delta) => {
    const nuevo = tourPasoActual + delta;
    if (nuevo < 0 || nuevo > PASOS_TOUR.length - 1) return;
    tourPasoActual = nuevo;
    renderPasoTour();
  };

  $('#tour-cerrar').onclick = () => cerrarGuiaInteractiva();
  $('#tour-salir-flotante').onclick = () => cerrarGuiaInteractiva();
  overlay.onclick = (e) => {
    if (e.target === overlay) cerrarGuiaInteractiva();
  };

  tourKeyHandler = (e) => {
    if (e.key === 'Escape') cerrarGuiaInteractiva();
    else if (e.key === 'ArrowRight') ir(1);
    else if (e.key === 'ArrowLeft') ir(-1);
  };
  window.addEventListener('keydown', tourKeyHandler);

  $('#tour-prev').onclick = () => ir(-1);
  $('#tour-next').onclick = () => {
    if (tourPasoActual < PASOS_TOUR.length - 1) {
      ir(1);
    } else {
      cerrarGuiaInteractiva();
      toast('¡Guía interactiva completada!', 'ok');
    }
  };

  renderPasoTour(true);
}

// Espera (con tope de tiempo) a que la vista del paso haya renderizado.
function tourEsperar(paso, token) {
  const listo = paso.listo || paso.target;
  const ok = () => (typeof listo === 'function' ? listo() : !!tourQuery(listo));
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (token !== tourToken) return resolve(false);
      if (ok() || Date.now() - t0 > 3000) return resolve(true);
      setTimeout(tick, 80);
    };
    tick();
  });
}

async function renderPasoTour(esPrimerRender = false) {
  const token = ++tourToken;
  const paso = PASOS_TOUR[tourPasoActual];
  const card = $('#tour-card');
  const spot = $('#tour-spotlight');
  if (!card || !spot) return;

  // Contenido del paso (se pinta de inmediato; el resaltado llega cuando la vista esté lista)
  $('#tour-badge').textContent = `Paso ${tourPasoActual + 1} de ${PASOS_TOUR.length}`;
  $('#tour-titulo').innerHTML = `<span class="tour-ico">${paso.icono}</span> ${tourPasoActual + 1}. ${paso.titulo}`;
  $('#tour-desc').innerHTML = paso.descripcion;
  // Lico (kit "Lico"): pose del paso; por defecto explica, saluda al inicio y celebra al final
  const poseLico = paso.pose || (tourPasoActual === 0 ? 'saluda' : tourPasoActual === PASOS_TOUR.length - 1 ? 'celebra' : 'explica');
  if (window.Lico) $('#tour-mascota').innerHTML = window.Lico.svg(poseLico);
  $('#tour-prog').style.width = `${Math.round(((tourPasoActual + 1) / PASOS_TOUR.length) * 100)}%`;
  $('#tour-prev').disabled = tourPasoActual === 0;

  const esUltimo = tourPasoActual === PASOS_TOUR.length - 1;
  const btnNext = $('#tour-next');
  if (esUltimo) {
    btnNext.textContent = '✔ ¡Finalizar!';
    btnNext.style.background = '#10b981';
    btnNext.style.borderColor = '#059669';
    btnNext.style.color = '#fff';
    btnNext.style.fontWeight = '700';
  } else {
    btnNext.textContent = 'Siguiente';
    btnNext.style.background = '';
    btnNext.style.borderColor = '';
    btnNext.style.color = '';
    btnNext.style.fontWeight = '';
  }

  // Indicador compacto: sección actual y avance dentro de ella (en lugar de un punto por paso)
  const delaSeccion = PASOS_TOUR.filter((p) => p.seccion === paso.seccion);
  const enSeccion = delaSeccion.indexOf(paso) + 1;
  $('#tour-dots').innerHTML = `<span class="tour-seccion" title="${esc(paso.seccion)}">${esc(paso.seccion)} <small>${enSeccion}/${delaSeccion.length}</small></span>`;

  // Cambio de pestaña si el paso lo pide (y no estamos ya en ella)
  if (paso.tab && tourTabActual() !== paso.tab) {
    spot.classList.remove('visible');
    irA(paso.tab);
    await tourPausa(140);
    if (token !== tourToken) return;
  }
  await tourEsperar(paso, token);
  if (token !== tourToken || !$('#tour-card')) return;

  const target = tourQuery(paso.target) || tourQuery(paso.fallback) || tourQuery('.panel-fijo') || view;
  if (!target) return;

  const posicionar = () => {
    if (token !== tourToken) return;
    const r = target.getBoundingClientRect();
    const flecha = $('#tour-flecha');
    if (!spot || !card) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardW = card.offsetWidth || Math.min(520, vw - 32);
    const cardH = card.offsetHeight || 290;
    const pad = 6;
    const esGrilla = target.id === 'a-grid' || target === view || r.height > vh * 0.55;

    // Al iniciar el tour (paso 1), desactivar temporalmente transiciones para evitar
    // el salto visible ("pestañeo") desde (0,0) hacia la posición calculada.
    if (esPrimerRender) {
      spot.style.transition = 'none';
      card.style.transition = 'none';
    }

    if (esGrilla) {
      const spotTop = Math.max(12, Math.round(r.top));
      const spotH = Math.min(Math.round(r.height), vh - spotTop - 24);
      spot.style.left = `${Math.max(10, Math.round(r.left - pad))}px`;
      spot.style.top = `${spotTop}px`;
      spot.style.width = `${Math.min(vw - 20, Math.round(r.width + pad * 2))}px`;
      spot.style.height = `${Math.max(120, spotH)}px`;

      card.style.left = `${Math.max(16, Math.round((vw - cardW) / 2))}px`;
      card.style.top = `${Math.round(Math.max(16, (vh - cardH) / 2))}px`;
      flecha.style.display = 'none';
    } else {
      flecha.style.display = 'block';

      // Spotlight regular
      spot.style.left = `${Math.max(0, Math.round(r.left - pad))}px`;
      spot.style.top = `${Math.max(0, Math.round(r.top - pad))}px`;
      spot.style.width = `${Math.round(r.width + pad * 2)}px`;
      spot.style.height = `${Math.round(r.height + pad * 2)}px`;

      // Posicionar tarjeta
      let cardLeft = Math.round(r.left + (r.width / 2) - (cardW / 2));
      if (cardLeft + cardW > vw - 16) cardLeft = vw - cardW - 16;
      if (cardLeft < 16) cardLeft = 16;

      let cardTop = Math.round(r.bottom + 14);
      let flechaArriba = true;

      // Si se sale por abajo, poner arriba del elemento
      if (cardTop + cardH > vh - 16) {
        cardTop = Math.round(r.top - cardH - 14);
        flechaArriba = false;
      }

      if (cardTop + cardH > vh - 16) cardTop = vh - cardH - 16;
      if (cardTop < 16) cardTop = 16;

      card.style.left = `${cardLeft}px`;
      card.style.top = `${cardTop}px`;

      // Si la tarjeta quedó encima del elemento (no cabe ni arriba ni abajo), sin flecha
      const solapa = cardTop < r.bottom + 4 && cardTop + cardH > r.top - 4;
      flecha.style.display = solapa ? 'none' : 'block';
      flecha.className = `tour-flecha ${flechaArriba ? 'flecha-arriba' : 'flecha-abajo'}`;
      const flechaX = Math.max(24, Math.min(cardW - 36, (r.left + r.width / 2) - cardLeft));
      flecha.style.left = `${Math.round(flechaX)}px`;
    }

    if (esPrimerRender) {
      // Forzar reflow para que el navegador aplique left/top antes de habilitar transición y opacidad
      void card.offsetHeight;
      spot.style.transition = '';
      card.style.transition = '';
    }

    spot.classList.add('visible');
    card.classList.add('visible');
  };

  // Zona realmente visible: el encabezado y el panel fijo son sticky y tapan lo que quede debajo.
  // Un elemento "dentro del viewport" pero bajo esas barras no se ve, así que se desplaza igual.
  const enBarraFija = !!target.closest('header.top, .panel-fijo, .g-head');
  let topVisible = 0;
  if (!enBarraFija) {
    document.querySelectorAll('header.top, .panel-fijo, .g-head').forEach((el) => {
      if (getComputedStyle(el).position === 'sticky') topVisible = Math.max(topVisible, el.getBoundingClientRect().bottom);
    });
    if (topVisible) topVisible += 8;
  }
  const rect = target.getBoundingClientRect();
  const yaVisible = rect.top >= topVisible && rect.bottom <= window.innerHeight;

  if (yaVisible) {
    posicionar();
  } else {
    // Centrar en la zona visible (bajo las barras fijas), no en todo el viewport
    const grande = rect.height > (window.innerHeight - topVisible) * 0.7;
    const destino = grande
      ? rect.top - topVisible
      : rect.top - topVisible - ((window.innerHeight - topVisible - rect.height) / 2);
    window.scrollBy({ top: destino, behavior: 'auto' });
    setTimeout(posicionar, 80);
  }
}

function cerrarGuiaInteractiva(restaurar = true) {
  tourToken++; // cancela cualquier espera pendiente
  if (tourKeyHandler) {
    window.removeEventListener('keydown', tourKeyHandler);
    tourKeyHandler = null;
  }
  const o = document.getElementById('tour-overlay');
  if (o) o.remove();
  // Volver a la pestaña desde la que se abrió la guía
  if (o && restaurar && tourTabOrigen && tourTabActual() !== tourTabOrigen) irA(tourTabOrigen);
  tourTabOrigen = null;
}

/* ================= INICIALIZACIÓN DE TOOLTIPS ================= */
function iniciarTooltipsGlobales() {
  let tip = document.getElementById('tooltip-flotante');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'tooltip-flotante';
    tip.className = 'tooltip-flotante';
    document.body.appendChild(tip);
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tooltip]');
    if (!el) {
      tip.classList.remove('visible');
      return;
    }
    const texto = el.getAttribute('data-tooltip');
    if (!texto) return;
    tip.textContent = texto;
    tip.classList.add('visible');

    const rect = el.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    if (left < 10) left = 10;
    if (left + tipRect.width > window.innerWidth - 10) left = window.innerWidth - tipRect.width - 10;
    let top = rect.bottom + 8;
    if (top + tipRect.height > window.innerHeight - 8) {
      top = rect.top - tipRect.height - 8;
      tip.classList.add('pos-arriba');
    } else {
      tip.classList.remove('pos-arriba');
    }
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  });

  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[data-tooltip]');
    if (el && !e.relatedTarget?.closest('[data-tooltip]')) {
      tip.classList.remove('visible');
    }
  });
}

// Iniciar tooltips
iniciarTooltipsGlobales();

