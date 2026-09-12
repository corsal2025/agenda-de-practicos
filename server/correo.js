'use strict';
// Correos de confirmacion (al agendar) y recordatorio (un dia antes).
// Si no hay SMTP configurado (variables SMTP_*), el envio queda deshabilitado
// y las funciones no hacen nada: la agenda sigue funcionando igual sin correo.
const nodemailer = require('nodemailer');
const { SMTP, URL_PUBLICA } = require('./config');
const { log } = require('./db');

const habilitado = Boolean(SMTP.host && SMTP.user && SMTP.pass);

// 'YYYY-MM-DD' -> 'DD-MM-YYYY' para mostrar en el correo.
function fFecha(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso || '');
}

const transporte = habilitado
  ? nodemailer.createTransport({
      host: SMTP.host, port: SMTP.port, secure: SMTP.secure,
      auth: { user: SMTP.user, pass: SMTP.pass },
    })
  : null;

function plantilla({ titulo, intro, bloque, links }) {
  const filas = [
    ['Fecha', fFecha(bloque.fecha)],
    ['Hora', bloque.hora],
    ['Examinador/a', bloque.examinador],
  ];
  const filasHtml = filas.map(([k, v]) => `<tr><td style="padding:4px 10px 4px 0;color:#64748b">${k}</td><td style="padding:4px 0;font-weight:600">${v}</td></tr>`).join('');
  const filasTexto = filas.map(([k, v]) => `${k}: ${v}`).join('\n');
  const botonesHtml = links
    ? `<p style="margin:18px 0 0">
        <a href="${links.confirmar}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;margin-right:10px">Confirmo mi asistencia</a>
        <a href="${links.rechazar}" style="display:inline-block;padding:10px 18px;background:#fff;color:#334155;text-decoration:none;border-radius:6px;font-weight:700;border:1px solid #cbd5e1">No puedo asistir</a>
      </p>`
    : '';
  const botonesTexto = links
    ? `\nConfirmar asistencia: ${links.confirmar}\nNo puedo asistir: ${links.rechazar}\n`
    : '';
  return {
    text: `${titulo}\n\n${intro}\n\n${filasTexto}\n${botonesTexto}`,
    html: `<div style="font-family:sans-serif;color:#1e293b">
      <h2 style="margin:0 0 6px">${titulo}</h2>
      <p style="margin:0 0 14px;color:#334155">${intro}</p>
      <table>${filasHtml}</table>
      ${botonesHtml}
    </div>`,
  };
}

// Envia un correo; nunca lanza (un fallo de correo no debe romper el agendamiento).
async function enviar(destinatario, asunto, cuerpo) {
  if (!habilitado || !destinatario) return false;
  try {
    await transporte.sendMail({ from: SMTP.from, to: destinatario, subject: asunto, text: cuerpo.text, html: cuerpo.html });
    return true;
  } catch (e) {
    log(null, 'correo_error', `${destinatario}: ${e.message}`);
    return false;
  }
}

function confirmacion(bloque) {
  const cuerpo = plantilla({
    titulo: 'Confirmación de hora — Examen práctico de conducir',
    intro: 'Se agendó tu examen práctico de licencia de conducir con los siguientes datos:',
    bloque,
  });
  return enviar(bloque.correo, 'Confirmación de tu hora de examen práctico', cuerpo);
}

// bloque debe traer token_confirmacion si se quiere ofrecer los links de
// confirmar/rechazar (solo se arman si hay AGENDA_URL_PUBLICA configurada).
function recordatorio(bloque) {
  const links = (URL_PUBLICA && bloque.token_confirmacion)
    ? {
        confirmar: `${URL_PUBLICA}/confirmar/${bloque.id}/${bloque.token_confirmacion}`,
        rechazar: `${URL_PUBLICA}/rechazar/${bloque.id}/${bloque.token_confirmacion}`,
      }
    : null;
  const cuerpo = plantilla({
    titulo: 'Recordatorio — Tu examen práctico es mañana',
    intro: links
      ? 'Te recordamos que mañana tienes tu examen práctico de licencia de conducir. Por favor confirma tu asistencia:'
      : 'Te recordamos que mañana tienes tu examen práctico de licencia de conducir:',
    bloque,
    links,
  });
  return enviar(bloque.correo, 'Recordatorio: tu examen práctico es mañana', cuerpo);
}

module.exports = { habilitado, confirmacion, recordatorio };
