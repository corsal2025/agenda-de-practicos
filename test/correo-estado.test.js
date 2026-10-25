'use strict';
// Estado del correo (GET /api/correo/estado) y enlaces del correo de confirmacion.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDb = path.join(os.tmpdir(), `agenda-estado-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-estado-bk-'));
process.env.NODE_ENV = 'test';
process.env.CORREO_MODO = 'auto';
process.env.SMTP_USER = 'prueba@example.test';
process.env.SMTP_PASS = 'clave-de-prueba-no-real';
process.env.SMTP_HOST = '127.0.0.1';

// Servidor SMTP falso: acepta la conexion y rechaza la autenticacion (535) => nodemailer lanza EAUTH.
const smtpFalso = net.createServer((sock) => {
  sock.write('220 falso ESMTP\r\n');
  sock.on('data', (buf) => {
    for (const linea of buf.toString().split('\r\n').filter(Boolean)) {
      const cmd = linea.toUpperCase();
      if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) sock.write('250-falso\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (cmd.startsWith('AUTH')) sock.write('535 5.7.8 credenciales invalidas\r\n');
      else if (cmd.startsWith('QUIT')) { sock.write('221 adios\r\n'); sock.end(); }
      else sock.write('250 ok\r\n');
    }
  });
  sock.on('error', () => {});
});

let servidor;
let base;
let correo;
const outlookFalso = { llamadas: [], ultimoError: null };
test.before(async () => {
  await new Promise((ok) => smtpFalso.listen(0, '127.0.0.1', ok));
  process.env.SMTP_PORT = String(smtpFalso.address().port);
  // Outlook "disponible" y que envia bien: asi el modo auto puede pasar a Outlook tras el EAUTH.
  const outlook = require('../server/correo-outlook');
  outlook.disponible = async () => true;
  outlook.disponibleSync = () => true;
  outlook.enviar = async (m) => { outlookFalso.llamadas.push(m); return true; };
  correo = require('../server/correo');
  const app = require('../server/index');
  await new Promise((ok) => { servidor = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => {
  servidor.close();
  smtpFalso.close();
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
});

const estado = async () => {
  const r = await fetch(`${base}/api/correo/estado`);
  return { status: r.status, datos: await r.json() };
};

test('antes de enviar nada: modo smtp, smtp no caido, sin ultimo envio', async () => {
  const r = await estado();
  assert.equal(r.status, 200);
  assert.deepEqual(r.datos, { modo: 'smtp', smtp_caido: false, ultimo_envio: null });
});

test('tras EAUTH en modo auto: informa smtp_caido y modo outlook; el envio sale por Outlook', async () => {
  const ok = await correo.enviarPrueba('destino@example.test', 'asunto', { text: 'x', html: '<p>x</p>' });
  assert.equal(ok, true);
  assert.equal(outlookFalso.llamadas.length, 1);
  const r = await estado();
  assert.equal(r.datos.smtp_caido, true);
  assert.equal(r.datos.modo, 'outlook');
  assert.equal(r.datos.ultimo_envio.ok, true);
  assert.equal(r.datos.ultimo_envio.via, 'outlook');
  assert.match(r.datos.ultimo_envio.hora, /^\d{2}:\d{2}$/);
});

test('un envio fallido queda como ultimo_envio con su codigo', async () => {
  const outlook = require('../server/correo-outlook');
  outlook.enviar = async () => false;
  Object.defineProperty(outlook, 'ultimoError', { value: Object.assign(new Error('boom'), { code: 'EOUTLOOK' }), configurable: true });
  const ok = await correo.enviarPrueba('destino@example.test', 'asunto', { text: 'x', html: '<p>x</p>' });
  assert.equal(ok, false);
  const r = await estado();
  assert.equal(r.datos.ultimo_envio.ok, false);
  assert.equal(r.datos.ultimo_envio.codigo, 'EOUTLOOK');
});

test('la respuesta no expone credenciales ni mensajes de error', async () => {
  const r = await fetch(`${base}/api/correo/estado`);
  const texto = await r.text();
  assert.ok(!texto.includes('clave-de-prueba-no-real'));
  assert.ok(!texto.includes('prueba@example.test'));
  assert.ok(!texto.includes('boom'));
});

test('el correo de confirmacion (HTML y texto) trae el enlace para rechazar', () => {
  const bloque = { id: 77, token_confirmacion: 'tok123', nombre: 'ANA', rut: '1-9', fecha: '2026-11-10', hora: '09:00', examinador: 'X', clase: 'B' };
  const links = correo.armarLinks(bloque);
  assert.match(links.rechazar, /\/rechazar\/77\/tok123$/);
  const { html, text } = correo.plantilla({ titulo: 't', intro: 'i', bloque, links });
  assert.ok(html.includes('/rechazar/77/tok123'), 'HTML');
  assert.ok(text.includes('/rechazar/77/tok123'), 'texto plano');
  assert.match(html, /No puedo asistir/);
});
