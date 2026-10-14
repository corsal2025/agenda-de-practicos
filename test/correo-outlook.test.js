'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.NODE_ENV = 'test';
const outlook = require('../server/correo-outlook');
const { crearSelector } = require('../server/correo');

function fakeOutlook(disp = true, ok = true) {
  const llamadas = [];
  return {
    llamadas,
    disponibleSync: () => disp,
    disponible: async () => disp,
    enviar: async (m) => { llamadas.push(m); return ok; },
    ultimoError: null,
  };
}
const err = (code) => Object.assign(new Error(code), { code });
const MSG = { to: 'a@b.cl', subject: 's', html: '<p>x</p>', text: 'x' };

test('modo smtp usa solo SMTP y nunca Outlook', async () => {
  const ol = fakeOutlook();
  const s = crearSelector({ modo: 'smtp', smtpConfigurado: true, smtpEnviar: async () => { throw err('EAUTH'); }, outlook: ol });
  const r = await s.enviar(MSG);
  assert.equal(r.ok, false); assert.equal(r.via, 'smtp'); assert.equal(ol.llamadas.length, 0);
  assert.equal(s.modoActual(), 'smtp');
});

test('modo outlook envia por Outlook aunque SMTP este configurado', async () => {
  const ol = fakeOutlook();
  let smtp = 0;
  const s = crearSelector({ modo: 'outlook', smtpConfigurado: true, smtpEnviar: async () => { smtp++; }, outlook: ol });
  const r = await s.enviar(MSG);
  assert.equal(r.via, 'outlook'); assert.equal(r.ok, true); assert.equal(smtp, 0);
  assert.equal(s.modoActual(), 'outlook');
});

test('auto: SMTP primero; tras EAUTH cambia a Outlook para el resto y avisa una vez', async () => {
  const ol = fakeOutlook();
  let smtp = 0; const avisos = [];
  const s = crearSelector({ modo: 'auto', smtpConfigurado: true, smtpEnviar: async () => { smtp++; throw err('EAUTH'); }, outlook: ol, avisar: (t) => avisos.push(t) });
  assert.equal(s.modoActual(), 'smtp');
  assert.equal((await s.enviar(MSG)).via, 'outlook');
  assert.equal((await s.enviar(MSG)).via, 'outlook');
  assert.equal(smtp, 1); assert.equal(ol.llamadas.length, 2); assert.equal(avisos.length, 1);
  assert.equal(s.modoActual(), 'outlook');
});

test('auto: error no sistemico de SMTP no cambia a Outlook', async () => {
  const ol = fakeOutlook();
  const s = crearSelector({ modo: 'auto', smtpConfigurado: true, smtpEnviar: async () => { throw err('EENVELOPE'); }, outlook: ol });
  const r = await s.enviar(MSG);
  assert.equal(r.ok, false); assert.equal(r.via, 'smtp'); assert.equal(ol.llamadas.length, 0);
});

test('auto sin SMTP usa Outlook si esta disponible; si no, ninguno', async () => {
  const s1 = crearSelector({ modo: 'auto', smtpConfigurado: false, smtpEnviar: async () => {}, outlook: fakeOutlook(true) });
  assert.equal(s1.modoActual(), 'outlook');
  const s2 = crearSelector({ modo: 'auto', smtpConfigurado: false, smtpEnviar: async () => {}, outlook: fakeOutlook(false) });
  assert.equal(s2.modoActual(), 'ninguno');
  assert.equal((await s2.enviar(MSG)).ok, false);
});

test('escribirPayload guarda los datos tal cual en JSON (sin interpolar en shell)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-test-'));
  const malicioso = `x"; Remove-Item C:\ -Recurse; $(calc) \`whoami\` 'ñ'`;
  const ruta = outlook.escribirPayload({ to: 'a@b.cl', subject: malicioso, html: '<b>ü</b>', cuenta: 'c@d.cl' }, dir);
  try {
    assert.match(path.basename(ruta), /^agenda-outlook-[0-9a-f]{24}\.json$/);
    const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    assert.deepEqual(datos, { to: 'a@b.cl', subject: malicioso, html: '<b>ü</b>', cuenta: 'c@d.cl' });
    const args = outlook.argsEnvio(ruta);
    assert.deepEqual(args.slice(-4), ['-File', outlook.SCRIPT, '-Payload', ruta]);
    assert.ok(!args.some((a) => a.includes(malicioso)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('bajo NODE_ENV=test Outlook nunca se invoca', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(await outlook.disponible(), false);
  assert.equal(await outlook.enviar(MSG), false);
  assert.equal(outlook.disponibleSync(), false);
});

test('chequeo de Outlook exige perfil configurado antes de instanciar COM (evita el asistente "Agregar un servicio")', () => {
  const cmd = outlook.CMD_CHEQUEO;
  assert.ok(cmd.indexOf('Outlook\Profiles') !== -1);
  assert.ok(cmd.indexOf('Outlook\Profiles') < cmd.indexOf('New-Object -ComObject'));
});
