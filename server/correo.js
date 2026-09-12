'use strict';
const nodemailer = require('nodemailer');

// Configuracion SMTP generica (Gmail, Outlook, el proveedor de correo de la
// municipalidad, etc.) por variables de entorno. Sin AGENDA_SMTP_HOST configurado,
// el envio queda deshabilitado: se informa por consola en vez de fallar.
function configurado() {
  return Boolean(process.env.AGENDA_SMTP_HOST && process.env.AGENDA_SMTP_USER);
}

let transporte = null;
function obtenerTransporte() {
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: process.env.AGENDA_SMTP_HOST,
      port: Number(process.env.AGENDA_SMTP_PORT) || 587,
      secure: String(process.env.AGENDA_SMTP_SECURE) === '1',
      auth: { user: process.env.AGENDA_SMTP_USER, pass: process.env.AGENDA_SMTP_PASS },
    });
  }
  return transporte;
}

function destinatarios() {
  return String(process.env.AGENDA_REPORTE_DESTINATARIOS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

function errConfig(msg) { const e = new Error(msg); e.status = 400; return e; }

async function enviar({ asunto, texto, html }) {
  if (!configurado()) throw errConfig('SMTP no configurado (falta AGENDA_SMTP_HOST / AGENDA_SMTP_USER).');
  const to = destinatarios();
  if (!to.length) throw errConfig('Falta AGENDA_REPORTE_DESTINATARIOS (correos separados por coma).');
  await obtenerTransporte().sendMail({
    from: process.env.AGENDA_SMTP_FROM || process.env.AGENDA_SMTP_USER,
    to: to.join(','),
    subject: asunto,
    text: texto,
    html,
  });
  return { to };
}

module.exports = { configurado, destinatarios, enviar };
