'use strict';
// Uso manual: node server/probar-correo.js destinatario@dominio.cl
// Envia UN correo de prueba con el modo configurado (CORREO_MODO) e informa el resultado.
const correo = require('./correo');
const outlook = require('./correo-outlook');

async function main() {
  const destino = String(process.argv[2] || '').trim();
  if (!/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(destino)) {
    console.error('Uso: node server/probar-correo.js destinatario@dominio.cl');
    process.exit(2);
  }
  await outlook.disponible();
  console.log(`Modo configurado: ${process.env.CORREO_MODO || 'auto'} | modo efectivo: ${correo.modo()}`);
  const cuerpo = { text: 'Correo de prueba de la Agenda de Practicos.', html: '<p>Correo de prueba de la <b>Agenda de Practicos</b>.</p>' };
  const ok = await correo.enviarPrueba(destino, 'Prueba de correo - Agenda de Practicos', cuerpo);
  console.log(`Enviado por: ${correo.modo()} | resultado: ${ok ? 'OK' : 'FALLO'}`);
  if (!ok && correo.ultimoError) console.log(`Error: ${correo.ultimoError.message}`);
  process.exit(ok ? 0 : 1);
}
main();
