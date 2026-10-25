'use strict';
// Limpieza de codigo muerto (reagendar/buscar/nav-mas/cierre-dia, etc.): se lee el codigo
// fuente como texto, igual que test/funcionario-sesion.test.js, sin levantar un navegador.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');

// Todos los .js/.html bajo public/, menos public/vendor/ (vendorizado, fuera de alcance).
function archivosPublic() {
  const out = [];
  (function recorrer(dir) {
    for (const nombre of fs.readdirSync(dir)) {
      const abs = path.join(dir, nombre);
      if (abs === path.join(PUBLIC, 'vendor')) continue;
      const st = fs.statSync(abs);
      if (st.isDirectory()) { recorrer(abs); continue; }
      if (/\.(js|html)$/.test(nombre)) out.push(abs);
    }
  }(PUBLIC));
  return out;
}
const leer = (abs) => fs.readFileSync(abs, 'utf8');
const indexHtml = leer(path.join(PUBLIC, 'index.html'));
const mainJs = leer(path.join(PUBLIC, 'js', 'main.js'));
const guiaJs = leer(path.join(PUBLIC, 'js', 'guia-pasos.js'));

// Nombres y selectores que la limpieza de codigo muerto debe dejar sin ningun rastro.
const NOMBRES_MUERTOS = [
  'renderReagendar', 'pintarPanelTopReagendar', 'detalleReagendar', 'detalleCola',
  'renderBuscar', 'buscadorGlobal', 'contribuyenteSel', 'irACitaEnAgenda',
  'forzarAgenda', 'esRecarga',
  'acomodarNav', 'navMas', 'data-nav-movible', 'nav-mas', 'badge-mas',
  'bloqueoReagendarConfirmada', 'asegurarBuscadorHome',
  'cargarHistorialCita', 'fichaImprimibleHtml', 'imprimirFicha', 'avisosHtml',
  'dialogoCierreDia', 'pintarCierreDia', 'CIERRE_RESULTADOS',
  'btn-sugerir', 'actualizarBadgeReagendar',
  'd-buscador-slot', 'id="bq"', 'id="buscador"',
];

test('ningun nombre/selector muerto queda bajo public/ (fuera de vendor/)', () => {
  const archivos = archivosPublic();
  for (const nombre of NOMBRES_MUERTOS) {
    for (const abs of archivos) {
      const rel = path.relative(PUBLIC, abs);
      assert.ok(!leer(abs).includes(nombre), `"${nombre}" no debe aparecer en public/${rel}`);
    }
  }
});

test('FICHA_CSS se usa (interpolada) exactamente una vez: solo en estadisticas.js', () => {
  const archivos = archivosPublic();
  let usos = 0;
  for (const abs of archivos) {
    const m = leer(abs).match(/\$\{FICHA_CSS\}/g);
    if (m) usos += m.length;
  }
  assert.equal(usos, 1);
});

test('cada <script src="..."> de index.html apunta a un archivo que existe', () => {
  const srcs = [...indexHtml.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.length > 0);
  for (const src of srcs) {
    const abs = path.join(PUBLIC, src.split('?')[0]);
    assert.ok(fs.existsSync(abs), `no existe el script referenciado: ${src}`);
  }
});

// ---------- guia-pasos.js ----------
function tabsReales() {
  const m = mainJs.match(/const tabs = \{([\s\S]*?)\n\};/);
  assert.ok(m, 'no se encontro el objeto tabs en main.js');
  // Ninguna de las claves/valores del objeto trae comas internas: alcanza con partir por ','.
  return m[1].split(',').map((seg) => seg.trim()).filter(Boolean).map((seg) => seg.split(':')[0].trim());
}
function pasosTour() {
  const m = guiaJs.match(/const PASOS_TOUR = \[([\s\S]*)\];\s*$/);
  assert.ok(m, 'no se encontro PASOS_TOUR en guia-pasos.js');
  // Cada paso es un objeto { ... }; se parte por llaves de nivel superior.
  const cuerpo = m[1];
  const pasos = [];
  let profundidad = 0, inicio = -1;
  for (let i = 0; i < cuerpo.length; i++) {
    if (cuerpo[i] === '{') { if (profundidad === 0) inicio = i; profundidad++; }
    else if (cuerpo[i] === '}') { profundidad--; if (profundidad === 0) pasos.push(cuerpo.slice(inicio, i + 1)); }
  }
  return pasos;
}

test('ningun paso de la guia referencia la pestana "reagendar"', () => {
  for (const paso of pasosTour()) {
    assert.ok(!/tab:\s*'reagendar'/.test(paso), `paso con tab: 'reagendar' -> ${paso.slice(0, 80)}`);
  }
});

test('cada tab: de la guia coincide con una pestana real de main.js', () => {
  const reales = new Set(tabsReales());
  for (const paso of pasosTour()) {
    const m = paso.match(/tab:\s*'([^']+)'/);
    if (!m) continue;
    assert.ok(reales.has(m[1]), `tab '${m[1]}' no existe en main.js`);
  }
});

test('cada #id que referencia la guia existe en index.html o en algun .js', () => {
  const archivos = archivosPublic();
  const contenidos = archivos.map(leer);
  const existeId = (id) => contenidos.some((c) => c.includes(`id="${id}"`) || c.includes(`id='${id}'`));
  const idsDeSelector = (sel) => [...sel.matchAll(/#([A-Za-z][\w-]*)/g)].map((m) => m[1]);
  for (const paso of pasosTour()) {
    for (const campo of ['target', 'fallback', 'listo']) {
      const m = paso.match(new RegExp(`${campo}:\\s*'((?:[^'\\\\]|\\\\.)*)'`));
      if (!m) continue;
      for (const id of idsDeSelector(m[1])) {
        assert.ok(existeId(id), `#${id} (campo ${campo}) no existe en index.html ni en ningun .js`);
      }
    }
  }
});
