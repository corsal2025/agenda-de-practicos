'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-feriados-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;
const { db } = require('../server/db');
const feriados = require('../server/feriados');

test.after(() => { for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} } });

const resp = (json, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => json });

test('parsear acepta formato digital.gob.cl y boostr, descarta basura', () => {
  assert.deepEqual(feriados.parsear([{ fecha: '2091-01-01', nombre: 'Año Nuevo' }, { fecha: 'x' }, null], 2091),
    [{ fecha: '2091-01-01', nombre: 'Año Nuevo' }]);
  assert.deepEqual(feriados.parsear({ status: 'success', data: [{ date: '2091-05-01', title: 'Trabajo' }, { date: '2090-05-01' }] }, 2091),
    [{ fecha: '2091-05-01', nombre: 'Trabajo' }]);
  assert.deepEqual(feriados.parsear('<html>', 2091), []);
});

test('sincronizar inserta faltantes, es idempotente y no borra manuales', async () => {
  feriados.agregar('2091-12-31', 'MANUAL');
  const f = resp({ data: [{ date: '2091-01-01', title: 'Año Nuevo' }, { date: '2091-09-18', title: 'Independencia' }] });
  const r1 = await feriados.sincronizar(2091, f);
  assert.equal(r1.agregados, 2);
  assert.equal(r1.total, 2);
  const r2 = await feriados.sincronizar(2091, f);
  assert.equal(r2.agregados, 0);
  assert.equal(db.prepare("SELECT nombre FROM feriados WHERE fecha='2091-12-31'").get().nombre, 'MANUAL');
  assert.ok(feriados.set().has('2091-09-18'));
});

test('sincronizar usa la segunda fuente si la primera falla', async () => {
  let n = 0;
  const f = async (url) => {
    n++;
    if (url.includes('digital.gob.cl')) throw new Error('ENOTFOUND');
    return { ok: true, status: 200, json: async () => ({ data: [{ date: '2092-01-01', title: 'X' }] }) };
  };
  const r = await feriados.sincronizar(2092, f);
  assert.equal(n, 2);
  assert.equal(r.fuente, 'api.boostr.cl');
});

test('sincronizar sin red lanza error claro', async () => {
  const f = async () => { throw new Error('fetch failed'); };
  await assert.rejects(feriados.sincronizar(2093, f), /Sin conexion/);
  assert.equal(feriados.cantidadAnio(2093), 0);
});
