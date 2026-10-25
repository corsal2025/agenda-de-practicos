'use strict';
// Mensajes de correo en pantalla (editor-cita.js y porconfirmar.js): funciones puras que arman el texto.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function cargar(archivo) {
  const ctx = { window: {}, esc: (s) => String(s ?? '') };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', archivo), 'utf8'), ctx);
  return ctx;
}

// ---------- aviso al guardar una cita nueva ----------
test('aviso de cita: enviado dice que el comprobante salio por correo', () => {
  const { avisoCorreoCita } = cargar('editor-cita.js');
  const a = avisoCorreoCita({ estado: 'enviado' });
  assert.equal(a.tipo, 'ok');
  assert.match(a.texto, /enviado/i);
});

test('aviso de cita: fallido muestra el motivo y NO afirma que se envio', () => {
  const { avisoCorreoCita } = cargar('editor-cita.js');
  const a = avisoCorreoCita({ estado: 'fallido', motivo: 'EAUTH: Invalid login' });
  assert.notEqual(a.tipo, 'ok');
  assert.match(a.texto, /EAUTH: Invalid login/);
  assert.match(a.texto, /NO se pudo enviar/);
  assert.ok(!/enviadas? por correo/i.test(a.texto));
});

test('aviso de cita: deshabilitado y sin_correo avisan que no se envio nada', () => {
  const { avisoCorreoCita } = cargar('editor-cita.js');
  for (const estado of ['deshabilitado', 'sin_correo']) {
    const a = avisoCorreoCita({ estado });
    assert.notEqual(a.tipo, 'ok', estado);
    assert.match(a.texto, /no se envió/i, estado);
  }
});

test('aviso de cita: sin intento de correo solo confirma la cita', () => {
  const { avisoCorreoCita } = cargar('editor-cita.js');
  const a = avisoCorreoCita(null);
  assert.equal(a.tipo, 'ok');
  assert.ok(!/correo/i.test(a.texto));
});

test('el guardado usa el aviso real y no el texto fijo', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'editor-cita.js'), 'utf8');
  assert.ok(!src.includes('Comprobante e instrucciones enviadas por correo'));
  assert.match(src, /avisoCorreoCita\(r\.correo\)/);
});

// ---------- texto de la prueba a mi correo ----------
test('prueba de correo: enviada', () => {
  const { textoResultadoPrueba } = cargar('porconfirmar.js');
  const r = textoResultadoPrueba({ enviados: 1, smtp_habilitado: true }, 'a@b.cl');
  assert.equal(r.tipo, 'ok');
  assert.match(r.texto, /a@b\.cl/);
});

test('prueba de correo: deshabilitado o fallido no hablan de tokens ni de citas no encontradas', () => {
  const { textoResultadoPrueba } = cargar('porconfirmar.js');
  const casos = [
    { enviados: 0, smtp_habilitado: false },
    { enviados: 0, smtp_habilitado: true, motivo: 'EAUTH: Invalid login' },
    { enviados: 0, smtp_habilitado: true },
  ];
  for (const res of casos) {
    const r = textoResultadoPrueba(res, 'a@b.cl');
    assert.ok(!/Tokens generados/i.test(r.texto), r.texto);
    assert.ok(!/no se encontraron citas/i.test(r.texto), r.texto);
    assert.notEqual(r.tipo, 'ok');
  }
  assert.match(textoResultadoPrueba(casos[1], 'a@b.cl').texto, /EAUTH: Invalid login/);
});

test('porconfirmar.js ya no contiene los textos enganosos', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'porconfirmar.js'), 'utf8');
  assert.ok(!/Tokens generados\./.test(src));
  assert.ok(!src.includes('No se encontraron citas pendientes para enviar'));
});

// ---------- etiqueta del estado del correo ----------
test('etiqueta del correo: modos normales', () => {
  const { textoEstadoCorreo } = cargar('porconfirmar.js');
  assert.equal(textoEstadoCorreo({ modo: 'smtp', smtp_caido: false, ultimo_envio: null }), 'Correo: vía SMTP');
  assert.equal(textoEstadoCorreo({ modo: 'outlook', smtp_caido: false, ultimo_envio: null }), 'Correo: vía Outlook');
  assert.equal(textoEstadoCorreo({ modo: 'ninguno', smtp_caido: false, ultimo_envio: null }), 'Correo: no configurado');
});

test('etiqueta del correo: SMTP caido que paso a Outlook', () => {
  const { textoEstadoCorreo } = cargar('porconfirmar.js');
  assert.equal(textoEstadoCorreo({ modo: 'outlook', smtp_caido: true, ultimo_envio: { ok: true, via: 'outlook', hora: '10:40' } }), 'Correo: vía Outlook (SMTP falló)');
});

test('etiqueta del correo: ultimo envio fallido con codigo y hora', () => {
  const { textoEstadoCorreo } = cargar('porconfirmar.js');
  const t = textoEstadoCorreo({ modo: 'smtp', smtp_caido: false, ultimo_envio: { ok: false, codigo: 'EAUTH', hora: '10:42' } });
  assert.equal(t, 'Correo: último envío falló (EAUTH, 10:42)');
});

test('etiqueta del correo: sin datos del servidor dice no configurado', () => {
  const { textoEstadoCorreo } = cargar('porconfirmar.js');
  assert.equal(textoEstadoCorreo(null), 'Correo: no configurado');
});
