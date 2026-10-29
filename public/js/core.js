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
  // 14 dias o menos: rojo y parpadeando (ultimas dos semanas antes de perder el tramite).
  const cls = dias <= 14 ? 'reprob urgente' : dias <= 30 ? 'reag' : 'aprob';
  const txt = dias <= 0 ? `⛔ Vencido hace ${diasTxt(-dias)}` : `⏳ Quedan ${diasTxt(dias)}`;
  return `<span class="badge ${cls} cuenta-tramite" title="El trámite vence el ${esc(fFecha(vence))}">${txt}</span>`;
}
// Badge neutro cuando la cita no tiene fecha de inicio de tramite (para que se complete).
const SIN_INICIO_HTML = '<span class="badge noasiste cuenta-tramite" title="Falta registrar la fecha de inicio del trámite">⏳ Sin fecha de inicio</span>';
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
let META = null;

// Retención de scroll en todo el sistema: captura y restaura posición exacta
function memorizarScroll(root = document) {
  const cajas = [];
  try {
    const contenedor = root || document;
    contenedor.querySelectorAll('.tabla-scroll, .tabla-agenda-scroll, .tabla-agenda-wrap, .panel-scroll, .tabla-agenda-card').forEach((el) => {
      cajas.push({
        el,
        scrollTop: el.scrollTop,
        scrollLeft: el.scrollLeft,
        id: el.id || null,
        clase: el.className || null,
      });
    });
  } catch (_) {}
  const act = document.activeElement;
  const tr = act && act.closest ? act.closest('tr[data-id]') : null;
  return {
    windowY: window.scrollY || (document.documentElement ? document.documentElement.scrollTop : 0) || (document.body ? document.body.scrollTop : 0),
    windowX: window.scrollX || (document.documentElement ? document.documentElement.scrollLeft : 0) || (document.body ? document.body.scrollLeft : 0),
    cajas,
    trId: tr ? tr.dataset.id : null,
  };
}

function reponerScroll(est, root = document) {
  if (!est) return;
  const aplicar = () => {
    try {
      if (typeof est.windowY === 'number') {
        window.scrollTo({ top: est.windowY, left: est.windowX || 0, behavior: 'instant' });
      }
      if (Array.isArray(est.cajas)) {
        const contenedor = root || document;
        est.cajas.forEach((c) => {
          let el = c.el;
          if (!el || !document.contains(el)) {
            if (c.id) el = contenedor.querySelector(`#${c.id}`);
            else if (c.clase) el = contenedor.querySelector(`.${c.clase.split(' ').filter(Boolean).join('.')}`);
            if (!el) el = contenedor.querySelector('.tabla-agenda-scroll') || contenedor.querySelector('.tabla-scroll');
          }
          if (el) {
            el.scrollTop = c.scrollTop;
            el.scrollLeft = c.scrollLeft;
          }
        });
      }
    } catch (_) {}
  };
  aplicar();
  requestAnimationFrame(aplicar);
  setTimeout(aplicar, 10);
  setTimeout(aplicar, 50);
}
window.memorizarScroll = memorizarScroll;
window.reponerScroll = reponerScroll;

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
  if (previo !== undefined) {
    const sc = memorizarScroll();
    pintar(previo ? JSON.parse(previo) : null);
    reponerScroll(sc);
  }
  const fresco = await api(path);
  if (!vigente()) return;
  if (previo !== undefined && cacheGet.get(path)?.txt === previo) return; // sin cambios
  const sc = memorizarScroll();
  pintar(fresco);
  reponerScroll(sc);
}

function toast(msg, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  // Lico en miniatura: alerta en errores, celebra en logros importantes (el mensaje siempre va como texto)
  const pose = tipo === 'err' ? 'alerta' : (tipo === 'ok' && /agendada|asignada|[ée]xito|Aprobó|Importacion completada|bloques nuevos/i.test(String(msg))) ? 'celebra' : '';
  // El Lico de la cabecera reacciona unos segundos (gesto pequeño; no hace nada si Lico esta desactivado)
  if (pose && window.LicoJuegos) window.LicoJuegos.reaccionar(pose);
  // ...y explica en su burbuja que paso (solo con Lico y consejos automaticos activos)
  if (pose && window.LicoAsistente) window.LicoAsistente.explicar(msg);
  if (pose && window.Lico) {
    const ico = document.createElement('span');
    ico.className = 'toast-lico';
    ico.setAttribute('aria-hidden', 'true');
    ico.innerHTML = window.Lico.uso(pose);
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
  const svg = window.Lico ? window.Lico.uso(pose) : '';
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

// ---- Lico en la cabecera: consejos, resumen del dia e hitos viven en lico-asistente.js ----
if (window.LicoAsistente) window.LicoAsistente.iniciar({ apiReciente, irA: (t) => irA(t), hoy: () => hoy(), sumarDias: (f, n) => sumarDias(f, n), licoConfeti, feriados: () => ((META && META.feriados) || []).map((f) => f.fecha) });

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
// Formato progresivo mientras se escribe: "123456789" -> "12.345.678-9".
// Solo actua si el texto tiene unicamente digitos, K, puntos o guion (no toca nombres ni "+56 9...").
function formatoRutProgresivo(v) {
  if (!/^[0-9kK.\-]+$/.test(v)) return v;
  const c = v.toUpperCase().replace(/[^0-9K]/g, '');
  if (c.length < 2 || /K./.test(c)) return v;
  return `${c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${c.slice(-1)}`;
}
function rutEnVivo(input) {
  if (!input) return;
  input.addEventListener('input', (e) => {
    if (e.inputType && e.inputType.startsWith('delete')) return; // borrar no reformatea
    const f = formatoRutProgresivo(input.value);
    if (f !== input.value) { input.value = f; input.setSelectionRange(f.length, f.length); }
  });
}
// Autocompleta puntos y guion al salir del campo, solo si el RUT es valido.
function autoformatoRut(input) {
  if (!input) return;
  input.addEventListener('blur', () => {
    const f = formatearSiEsRut(input.value.trim());
    if (f && f !== input.value) input.value = f;
  });
}
const hoy = () => {
  if (META) return META.hoy;
  const d = new Date(); // fecha LOCAL (toISOString usa UTC y adelanta el dia en la noche)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
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

/* ================= WhatsApp (sin API: enlaces) ================= */
// Numero en formato internacional chileno (solo digitos) o '' si no sirve para WhatsApp.
function telWaDe(contacto) {
  const n = String(contacto || '').replace(/\D/g, '');
  return n.startsWith('56') ? n : (n.length === 9 ? '56' + n : '');
}
// Mensaje con los datos de la cita. `cierre` cambia la peticion final.
function mensajeWaCita(b, examinador, cierre = 'Por favor confirma tu asistencia respondiendo a este mensaje.') {
  const nomP = nom(b.nombre) || 'Estimado/a postulante';
  const claseP = b.clase ? ` (Clase ${b.clase})` : '';
  return `Hola ${nomP}, te contactamos desde la Dirección de Tránsito respecto a tu examen práctico de conducir${claseP}. Te recordamos que tu cita está agendada para el día ${fFecha(b.fecha)} a las ${b.hora || ''} hrs. ${cierre}`;
}
function mensajeSmsCita(b, examinador, cierre = 'Por favor responde para confirmar o reagendar.') {
  const nomP = nom(b.nombre) || 'Estimado/a';
  const claseP = b.clase ? ` Clase ${b.clase}` : '';
  return `Dir. de Tránsito: Hola ${nomP}, recordamos tu examen práctico${claseP} el ${fFecha(b.fecha)} a las ${b.hora || ''} hrs. ${cierre}`;
}
const CORREO_OK_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const correoOk = (c) => CORREO_OK_RE.test(String(c || '').trim());

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
  // Con letra agrandada (zoom en body) las medidas del viewport se pasan a unidades locales.
  const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
  if (header) raiz.setProperty('--alto-header', `${Math.round(Math.max(header.getBoundingClientRect().bottom, header.getBoundingClientRect().height) / z)}px`);
  if (panelFijo) raiz.setProperty('--alto-panel-fijo', `${Math.round(panelFijo.getBoundingClientRect().height / z)}px`);
}
// Recalcula solo cuando el encabezado o la vista cambian de tamaño (fuentes, filtros plegados,
// datos que llegan despues): evita barras fijas que quedan escondidas bajo el panel.
if (typeof ResizeObserver === 'function') {
  const obsOffsets = new ResizeObserver(() => setTimeout(ajustarOffsetsFijos, 0));
  const observarOffsets = () => {
    const h = document.querySelector('header.top');
    const v = document.getElementById('view');
    if (h) obsOffsets.observe(h);
    if (v) obsOffsets.observe(v);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observarOffsets);
  else observarOffsets();
}
// Pestañas eliminadas que redirigen a otra (enlaces o marcadores antiguos).
const ALIAS_TABS = { dia: 'agenda', reagendar: 'espera' };
function ruta() {
  if (!META) return;
  cerrarModal();
  const tab = (location.hash.slice(1) || 'disponibles').split('?')[0];
  if (ALIAS_TABS[tab]) { history.replaceState(null, '', `#${ALIAS_TABS[tab]}`); ruta(); return; }
  document.querySelectorAll('#nav button[data-tab]').forEach((b) => b.classList.toggle('activo', b.dataset.tab === tab));
  genVista++; // las cargas pendientes de la pestaña anterior ya no pintan
  (tabs[tab] || renderAgenda)();
  if (window.Movil) window.Movil.trasRuta(tab);
  setTimeout(ajustarOffsetsFijos, 0);
}
window.addEventListener('resize', () => setTimeout(ajustarOffsetsFijos, 0));
window.addEventListener('hashchange', ruta);

const MARCADOR_RE = /VACACION|LICENCIA|ADMINISTRATIVO|FERIADO|BLOQUE|PERMISO|FIESTAS PATRIAS|CAPACITACI|COMET[IÍ]DO|TRASLADO|NO USAR|POSIBLES|HELLION|NO EXISTE|FALTA RUT|LLAMAR|SIN SISTEMA/i;
function pareceMarcador(v) {
  if (!v) return false;
  return MARCADOR_RE.test(String(v).trim());
}

function textoForzar(b) {
  const horaD = (META && META.hora_d_a5) || '12:30';
  return (b && b.hora === horaD)
    ? 'Forzar: ya hay citas a las horas siguientes (13:00/13:30 no se van a bloquear)'
    : `Forzar: clase pesada fuera del bloque ${horaD}`;
}
