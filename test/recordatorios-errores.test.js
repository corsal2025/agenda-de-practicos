'use strict';
// Recordatorios: que pasa con cada tipo de fallo (formato invalido, rechazo del servidor, error general).
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDb = path.join(os.tmpdir(), `agenda-recerr-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-recerr-bk-'));

const { db } = require('../server/db');
const correo = require('../server/correo');
const limpieza = require('../server/limpieza');
const { hoyISO, sumarDias } = require('../server/fechas');
const { enviarPendientes } = require('../server/recordatorios');

test.after(() => { for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} } });

const exId = db.prepare('SELECT id FROM examinadores LIMIT 1').get().id;
let hora = 0;
const cita = (dias, correoCita = 'p@x.cl') => db.prepare(`INSERT INTO agenda (fecha, hora, examinador_id, rut, nombre, correo, clase)
  VALUES (?, ?, ?, '11.111.111-1', 'PRUEBA', ?, 'B')`).run(sumarDias(hoyISO(), dias), `0${9 + (hora++ % 4)}:00`, exId, correoCita).lastInsertRowid;
const marca = (id) => db.prepare('SELECT correo_recordatorio_enviado v FROM agenda WHERE id = ?').get(id).v;
const error = (code, extra = {}) => Object.assign(new Error(`fallo ${code}`), { code, ...extra });

// Ejecuta enviarPendientes con un recordatorio falso; devuelve los ids que se intentaron.
async function correr(falso) {
  const intentados = [];
  const orig = correo.recordatorio;
  correo.habilitado = true;
  correo.recordatorio = async (b) => { intentados.push(b.id); return falso(b); };
  try { await enviarPendientes(); } finally { correo.recordatorio = orig; correo.habilitado = null; correo.ultimoError = null; }
  return intentados;
}
const limpiar = () => db.prepare('DELETE FROM agenda').run();

test('un correo con formato invalido se salta sin intentar y sin gastar la marca', async () => {
  limpiar();
  const malo = cita(1, 'no-es-correo');
  const bueno = cita(1);
  const intentados = await correr(() => true);
  assert.deepEqual(intentados, [bueno]);
  assert.equal(marca(malo), 0);
  assert.equal(marca(bueno), 1);
});

test('rechazo del destinatario (EENVELOPE en RCPT TO 550) marca 2 y no se reintenta', async () => {
  limpiar();
  const id = cita(1);
  const rechazar = () => { correo.ultimoError = error('EENVELOPE', { command: 'RCPT TO', responseCode: 550 }); return false; };
  assert.deepEqual(await correr(rechazar), [id]);
  assert.equal(marca(id), 2);
  assert.deepEqual(await correr(rechazar), [], 'ya no se vuelve a intentar');
});

test('rechazo SMTP 550-553 en RCPT TO tambien marca 2', async () => {
  limpiar();
  const ids = [550, 553].map(() => cita(1));
  const codigos = [550, 553];
  let i = 0;
  await correr(() => { correo.ultimoError = error('EENVELOPE', { command: 'RCPT TO', responseCode: codigos[i++] }); return false; });
  assert.deepEqual(ids.map(marca), [2, 2]);
});

test('cuota o remitente (EENVELOPE en MAIL FROM) no marca la cita y corta la tanda', async () => {
  limpiar();
  const a = cita(1);
  const b = cita(2);
  const intentados = await correr(() => { correo.ultimoError = error('EENVELOPE', { command: 'MAIL FROM', responseCode: 452 }); return false; });
  assert.equal(intentados.length, 1);
  assert.equal(marca(a), 0);
  assert.equal(marca(b), 0);
});

test('rechazo de un destinatario fuera de 550-553 no corta la tanda: el siguiente recibe su recordatorio', async () => {
  for (const codigo of [554, 451, 452, 501]) {
    limpiar();
    const malo = cita(3, 'malo@x.cl');
    const bueno = cita(3, 'bueno@x.cl');
    db.prepare('UPDATE agenda SET hora = ? WHERE id = ?').run('08:00', malo);
    db.prepare('UPDATE agenda SET hora = ? WHERE id = ?').run('08:30', bueno);
    const envio = (b) => {
      if (b.id === malo) { correo.ultimoError = error('EENVELOPE', { command: 'RCPT TO', responseCode: codigo }); return false; }
      return true;
    };
    for (let ciclo = 1; ciclo <= 3; ciclo++) {
      const intentados = await correr(envio);
      assert.ok(intentados.includes(malo), `${codigo}: malo se reintenta en el ciclo ${ciclo}`);
      assert.equal(marca(malo), 0, `${codigo}: malo queda reintentable`);
      assert.equal(marca(bueno), 1, `${codigo}: bueno ya recibio el recordatorio desde el primer ciclo`);
    }
  }
});

test('mensaje rechazado tras DATA (EMESSAGE 552) no marca y no corta: se reintenta en el ciclo siguiente', async () => {
  limpiar();
  const malo = cita(3, 'malo@x.cl');
  const bueno = cita(3, 'bueno@x.cl');
  db.prepare('UPDATE agenda SET hora = ? WHERE id = ?').run('08:00', malo);
  db.prepare('UPDATE agenda SET hora = ? WHERE id = ?').run('08:30', bueno);
  const envio = (b) => {
    if (b.id === malo) { correo.ultimoError = error('EMESSAGE', { responseCode: 552 }); return false; }
    return true;
  };
  for (let ciclo = 1; ciclo <= 2; ciclo++) {
    const intentados = await correr(envio);
    assert.ok(intentados.includes(malo), 'malo se reintenta en cada ciclo');
    if (ciclo === 1) assert.ok(intentados.includes(bueno), 'no corta la tanda');
    assert.equal(marca(malo), 0, 'no se marca: se reintenta');
    assert.equal(marca(bueno), 1);
  }
});

test('error general (EAUTH) no marca la cita y corta la tanda', async () => {
  limpiar();
  const a = cita(1);
  const b = cita(2);
  const intentados = await correr(() => { correo.ultimoError = error('EAUTH'); return false; });
  assert.equal(intentados.length, 1, 'corta la tanda tras el primer error general');
  assert.equal(marca(a), 0);
  assert.equal(marca(b), 0);
});

test('sin canal de correo (sin error informado) tampoco marca y corta la tanda', async () => {
  limpiar();
  const a = cita(1);
  cita(2);
  const intentados = await correr(() => false);
  assert.equal(intentados.length, 1);
  assert.equal(marca(a), 0);
});

test('envio exitoso marca 1', async () => {
  limpiar();
  const id = cita(1);
  await correr(() => true);
  assert.equal(marca(id), 1);
});

test('limpieza lista CORREO_FALLIDO solo para citas de hoy en adelante con marca 2', () => {
  limpiar();
  const futura = cita(2);
  const pasada = cita(-2);
  const normal = cita(3);
  db.prepare('UPDATE agenda SET correo_recordatorio_enviado = 2 WHERE id IN (?, ?)').run(futura, pasada);
  const filas = limpieza.listar().filas;
  assert.deepEqual(filas.find((f) => f.id === futura).problemas, ['CORREO_FALLIDO']);
  assert.equal(filas.find((f) => f.id === pasada), undefined);
  assert.equal(filas.find((f) => f.id === normal), undefined);
});

test('aplicarContacto con un correo nuevo devuelve la marca a 0', () => {
  limpiar();
  const id = cita(2);
  db.prepare('UPDATE agenda SET correo_recordatorio_enviado = 2 WHERE id = ?').run(id);
  limpieza.aplicarContacto(id, { nombre: 'OTRO NOMBRE' });
  assert.equal(marca(id), 2, 'otros campos no tocan la marca');
  limpieza.aplicarContacto(id, { correo: 'nuevo@x.cl' });
  assert.equal(marca(id), 0);
});

test('correo.js centraliza los errores generales y el rechazo inmediato', () => {
  for (const code of ['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EOUTLOOK']) assert.equal(correo.esErrorGeneral(error(code)), true, code);
  assert.equal(correo.esErrorGeneral(error('EENVELOPE', { command: 'RCPT TO', responseCode: 550 })), false);
  assert.equal(correo.esErrorGeneral(null), false);
  assert.equal(correo.esRechazoInmediato(error('EENVELOPE', { command: 'RCPT TO', responseCode: 552 })), true);
  assert.equal(correo.esRechazoInmediato(error('EENVELOPE')), false);
  assert.equal(correo.esRechazoInmediato(error('EMESSAGE', { responseCode: 421 })), false);
  assert.equal(correo.esRechazoInmediato(error('EAUTH')), false);
});
