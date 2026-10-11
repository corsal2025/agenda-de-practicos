'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/lico-asistente');

const memoria = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('elegirConsejo prioriza por confirmar y enlaza su pestaña', () => {
  const t = L.elegirConsejo({ porconfirmar: 85, errores: 3 });
  assert.equal(t.id, 'porconfirmar');
  assert.equal(t.tab, 'porconfirmar');
  assert.equal(t.texto, 'Tienes 85 citas por confirmar en los próximos 7 días.');
});

test('elegirConsejo no repite el último y cae al siguiente', () => {
  const t = L.elegirConsejo({ porconfirmar: 2, porVencer: 1 }, 'porconfirmar');
  assert.equal(t.id, 'vencer');
  assert.equal(t.tab, 'vencimientos');
  assert.match(t.texto, /^1 trámite vence/);
});

test('elegirConsejo devuelve null sin pendientes o con datos faltantes', () => {
  assert.equal(L.elegirConsejo({}), null);
  assert.equal(L.elegirConsejo({ porconfirmar: null, errores: 0 }), null);
});

test('consejosDesde usa singular y plural', () => {
  const ids = L.consejosDesde({ sinTramiteHoy: 1, reagendar: 1 });
  assert.equal(ids[0].texto, 'Hoy hay 1 cita sin fecha de inicio de trámite.');
  assert.equal(ids[1].texto, '1 persona espera nueva hora en Reagendar.');
});

test('resumenDiario respeta la hora', () => {
  assert.equal(L.resumenDiario({ examenesHoy: 12, porconfirmar: 3, porVencer: 1 }, 9),
    'Buenos días. Hoy: 12 exámenes, 3 por confirmar, 1 trámite por vencer.');
  assert.match(L.resumenDiario({}, 15), /^Buenas tardes\. Hoy: 0 exámenes/);
  assert.match(L.resumenDiario({}, 21), /^Buenas noches/);
});

test('unaVezAlDia solo deja pasar la primera vez de cada fecha', () => {
  const s = memoria();
  assert.equal(L.unaVezAlDia(s, 'k', '2026-10-10'), true);
  assert.equal(L.unaVezAlDia(s, 'k', '2026-10-10'), false);
  assert.equal(L.unaVezAlDia(s, 'k', '2026-10-11'), true);
  assert.equal(L.unaVezAlDia(s, 'otra', '2026-10-11'), true);
});

test('unaVezAlDia falla cerrado si el almacenamiento lanza', () => {
  const roto = { getItem() { throw new Error('bloqueado'); }, setItem() {} };
  assert.equal(L.unaVezAlDia(roto, 'k', '2026-10-10'), false);
  assert.equal(L.unaVezAlDia(null, 'k', '2026-10-10'), false);
});

test('hitosAlcanzados exige pasar de >0 a 0', () => {
  assert.deepEqual(L.hitosAlcanzados({}, { porconfirmar: 0 }).map((h) => h.id), []);
  assert.deepEqual(L.hitosAlcanzados({ porconfirmar: 4 }, { porconfirmar: 0 }).map((h) => h.id), ['porconfirmar0']);
  assert.deepEqual(L.hitosAlcanzados({ errores: 1 }, { errores: 0 }).map((h) => h.id), ['errores0']);
  assert.deepEqual(L.hitosAlcanzados({}, { aprobadosMes: 100 }).map((h) => h.id), ['aprobados100']);
  assert.deepEqual(L.hitosAlcanzados({}, { aprobadosMes: 99 }), []);
});

test('recortar limita a 80 caracteres con elipsis', () => {
  const r = L.recortar('x'.repeat(200));
  assert.equal(r.length, 80);
  assert.ok(r.endsWith('…'));
  assert.equal(L.recortar('  hola   mundo '), 'hola mundo');
});

test('FRASES_TAB coincide con las pestañas reales y no duplica frases generales', () => {
  const tabs = ['disponibles', 'agenda', 'reagendar', 'porconfirmar', 'vencimientos', 'dia', 'analitica', 'papelera', 'datos', 'errores'];
  assert.deepEqual(Object.keys(L.FRASES_TAB).sort(), tabs.slice().sort());
  const generales = new Set(L.FRASES_LICO);
  for (const lista of Object.values(L.FRASES_TAB)) for (const f of lista) assert.ok(!generales.has(f), f);
});

test('fechaLocal formatea en hora local', () => {
  assert.equal(L.fechaLocal(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});
