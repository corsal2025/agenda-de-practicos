'use strict';
// Con el almacenamiento del navegador bloqueado (iframe de otro dominio: acceder a la propiedad lanza
// SecurityError) la agenda debe seguir funcionando. Se evalua el cliente en vm con un DOM minimo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const leerFuente = (...partes) => fs.readFileSync(path.join(PUBLIC, ...partes), 'utf8');

// Elemento falso: acepta cualquier propiedad; querySelectorAll devuelve lo registrado por selector.
function elemento(registro = {}) {
  return {
    innerHTML: '', textContent: '', value: '', hidden: false, dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() { return false; }, contains: () => false },
    querySelectorAll: (sel) => registro[sel] || [],
    querySelector: () => null,
    closest: () => null, setAttribute() {}, scrollIntoView() {}, appendChild() {}, remove() {},
    addEventListener() {},
  };
}

// Contexto con almacenamiento que lanza SecurityError al ACCEDER a la propiedad.
function contextoBloqueado(extra = {}) {
  const ctx = { console, ...extra };
  for (const nombre of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(ctx, nombre, {
      get() { const e = new Error('The operation is insecure.'); e.name = 'SecurityError'; throw e; },
      configurable: true,
    });
  }
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(leerFuente('js', 'almacen-seguro.js'), ctx);
  return ctx;
}

const FUTURO = '2999-01-01';

// Llamadas de api registradas; todas resuelven (el POST de reagendar tiene exito).
function apiFalsa(llamadas, respuestas = {}) {
  return async (ruta, opts) => {
    llamadas.push({ ruta, metodo: opts && opts.method });
    for (const [prefijo, valor] of Object.entries(respuestas)) if (ruta.startsWith(prefijo)) return valor;
    return {};
  };
}

test('main.js: init() llega a ruta() y no pinta "No se pudo conectar" con almacenamiento bloqueado', async () => {
  const eventos = [];
  const view = elemento();
  const stubs = {};
  for (const n of ['renderAgenda', 'renderDisponibles', 'renderListaEspera', 'renderPorConfirmar', 'renderErrores',
    'renderAnalitica', 'renderPapelera', 'renderDatos', 'renderVencimientos', 'renderJefatura']) stubs[n] = () => {};
  const ctx = contextoBloqueado({
    ...stubs,
    view, MARCA: { organismo: 'Org', unidad: 'Uni' }, ESCUDO_FALLBACK: '', logoHtml: () => '',
    esc: (s) => String(s ?? ''), fFecha: (s) => String(s),
    api: async () => ({ logo: null, hoy: FUTURO, rango_agenda: {} }),
    $: () => elemento(),
    ruta: () => eventos.push('ruta'),
    actualizarBadgePapelera: () => {}, actualizarBadgeErrores: () => {}, actualizarBadgePorConfirmar: () => {},
    irA: () => {}, ajustarOffsetsFijos: () => {}, iniciarGuiaInteractiva: () => {},
    setTimeout: () => 0,
    location: { hash: '' },
    history: { replaceState() {} },
    matchMedia: () => ({ matches: false }),
  });
  ctx.document = {
    documentElement: { classList: { add() {}, remove() {}, toggle: () => false }, dataset: {} },
    getElementById: () => elemento(),
    querySelectorAll: () => [],
    addEventListener() {}, createElement: () => elemento(), body: elemento(),
  };
  vm.runInContext(leerFuente('js', 'main.js'), ctx);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(eventos, ['ruta'], 'ruta() corrio');
  assert.ok(!view.innerHTML.includes('No se pudo conectar'), 'no se pinto el error de conexion');
});

// Entorno comun para los flujos de reagendar: toasts, navegacion y badges registrados.
function entornoReagendar(registroTbody) {
  const llamadas = [];
  const toasts = [];
  const irA = [];
  const badges = [];
  const tbody = elemento(registroTbody);
  const ctx = contextoBloqueado({
    api: apiFalsa(llamadas, { '/agenda?estado=porconfirmar': [{ id: 7, fecha: FUTURO, hora: '09:00', nombre: 'ANA', rut: '1-9' }] }),
    toast: (msg, tipo) => toasts.push({ msg, tipo: tipo || 'ok' }),
    irA: (tab) => irA.push(tab),
    actualizarBadgeEspera: () => badges.push('espera'),
    actualizarBadgePorConfirmar: () => badges.push('porconfirmar'),
    confirm: () => true,
    esc: (s) => String(s ?? ''), nom: (s) => String(s ?? ''), fFecha: (s) => String(s), fTel: (s) => String(s),
    hoy: () => '2026-01-01', sumarDias: () => '2026-01-08',
    correoOk: () => false, telWaDe: () => '', mensajeSmsCita: () => '', clasesTagsHtml: (c) => c,
    licoVacioFila: () => '', licoConfeti() {}, META: { correo: {} },
    view: elemento(),
    $: (sel) => (sel === '#pc-tbody' ? tbody : elemento()),
    document: { querySelector: () => null, createElement: () => elemento(), addEventListener() {} },
  });
  return { ctx, llamadas, toasts, irA, badges };
}

test('porconfirmar.js: reagendar con almacenamiento bloqueado solo da toast ok, navega a espera y actualiza badges', async () => {
  const btn = Object.assign(elemento(), { dataset: { reag: '7' } });
  const e = entornoReagendar({ 'button[data-reag]': [btn] });
  vm.runInContext(leerFuente('js', 'porconfirmar.js'), e.ctx);
  await e.ctx.renderPorConfirmar();
  await btn.onclick();
  assert.ok(e.llamadas.some((l) => l.metodo === 'POST' && l.ruta === '/agenda/7/reagendar'), 'se llamo a reagendar');
  assert.deepEqual(e.toasts.filter((t) => t.tipo === 'err'), [], 'ningun toast de error falso');
  assert.ok(e.toasts.some((t) => t.tipo === 'ok'), 'toast ok');
  assert.deepEqual(e.irA, ['espera']);
  assert.ok(e.badges.includes('espera'));
});

test('grilla.js: reagendar desde la fila con almacenamiento bloqueado solo da toast ok y navega a espera', async () => {
  const btn = Object.assign(elemento(), { dataset: { id: '7' } });
  const e = entornoReagendar({});
  const cont = elemento({ '.btn-tabla-reagendar': [btn] });
  Object.assign(e.ctx, {
    clasesDisponibles: () => [], abrirSlotPorId: async () => {}, crearBarraLateralTabla: () => null,
    problemaDatos: () => null, claseFamilia: () => '', renderAgenda() {},
  });
  vm.runInContext(leerFuente('js', 'grilla.js'), e.ctx);
  e.ctx.pintarTablaAgenda(cont, [], FUTURO, []);
  assert.equal(typeof btn.onclick, 'function', 'el boton quedo enlazado');
  await btn.onclick({ stopPropagation() {} });
  assert.ok(e.llamadas.some((l) => l.ruta === '/agenda/7/reagendar'));
  assert.deepEqual(e.toasts.filter((t) => t.tipo === 'err'), []);
  assert.ok(e.toasts.some((t) => t.tipo === 'ok'));
  assert.deepEqual(e.irA, ['espera']);
  assert.ok(e.badges.includes('espera'));
});

test('lista-espera.js: pintar() no lanza y destaca la fila guardada en memoria', async () => {
  const fila = { classList: { added: [], add(c) { this.added.push(c); } }, scrollIntoView() {} };
  const body = elemento();
  body.querySelector = (sel) => (sel === '[data-id="9"]' ? fila : null);
  const elems = { '#le-body': body };
  const ctx = contextoBloqueado({
    api: async (ruta) => (ruta === '/lista-espera'
      ? { personas: [{ id: 9, origen: 'cambio', nombre: 'LUIS', rut: '2-7', clase: 'B', cupos_compatibles: 1 }] }
      : {}),
    esc: (s) => String(s ?? ''), nom: (s) => String(s ?? ''), fFecha: (s) => String(s),
    $: (sel) => (elems[sel] || (elems[sel] = elemento())),
    pintarBadge() {}, cuentaRegresivaHtml: () => '', SIN_INICIO_HTML: '', toast() {}, modal() {}, cerrarModal() {},
    buscarCupo() {}, view: elemento(),
    document: { querySelector: () => null, getElementById: () => null, createElement: () => elemento() },
  });
  vm.runInContext(leerFuente('lista-espera.js'), ctx);
  ctx.AlmacenSeguro.sesion.guardar('le_destacado', '9');
  await ctx.ListaEspera.render();
  assert.deepEqual(fila.classList.added, ['fila-destacada-reagendar']);
  assert.equal(ctx.AlmacenSeguro.sesion.leer('le_destacado'), null, 'el destacado se consume');
});

test('funcionario-sesion.js: elegir(1) y actual() devuelven el funcionario sin volver a preguntar en esa carga', () => {
  const ctx = contextoBloqueado({
    META: { funcionarios: [{ id: 1, nombre: 'ACTIVA', activo: 1 }] },
    h: () => {}, esc: (s) => s, document: {},
  });
  vm.runInContext(leerFuente('js', 'funcionario-sesion.js'), ctx);
  assert.equal(ctx.FuncionarioSesion.actual(), null);
  assert.doesNotThrow(() => ctx.FuncionarioSesion.elegir(1));
  assert.equal(ctx.FuncionarioSesion.actual().nombre, 'ACTIVA');
  ctx.FuncionarioSesion.olvidar();
  assert.equal(ctx.FuncionarioSesion.actual(), null);
});
