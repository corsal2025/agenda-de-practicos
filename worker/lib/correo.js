// Correos de confirmacion (al agendar) y recordatorio (un dia antes).
// Reemplaza server/correo.js (que usaba nodemailer + SMTP). nodemailer no corre en
// Workers (depende de sockets TCP crudos que Cloudflare no expone); se usa la API
// HTTP de Resend en su lugar.
//
// Decision confirmada con el usuario: por ahora no hay dominio propio, asi que se
// despliega SIN RESEND_API_KEY configurada -> `habilitado(env)` da false y el envio
// queda deshabilitado, exactamente el mismo comportamiento gracioso que la version
// anterior sin SMTP_HOST: la agenda funciona igual, solo no se manda correo. Nunca
// debe lanzar por falta de configuracion.
import { log } from './db.js';

export function habilitado(env) {
  return Boolean(env && env.RESEND_API_KEY);
}

// 'YYYY-MM-DD' -> 'DD-MM-YYYY' para mostrar en el correo.
function fFecha(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso || '');
}

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

// Envia un correo via la API HTTP de Resend; nunca lanza (un fallo de correo no
// debe romper el agendamiento). `db` es opcional: si se pasa, se deja registro del
// error en `movimientos` igual que hacia la version Node.
async function enviar(env, db, destinatario, asunto, cuerpo) {
  if (!habilitado(env) || !destinatario) return false;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM || 'Agenda de Practicos <onboarding@resend.dev>',
        to: [destinatario],
        subject: asunto,
        text: cuerpo.text,
        html: cuerpo.html,
      }),
    });
    if (!resp.ok) {
      const detalle = await resp.text().catch(() => '');
      if (db) await log(db, null, 'correo_error', `${destinatario}: HTTP ${resp.status} ${detalle}`.slice(0, 500));
      return false;
    }
    return true;
  } catch (e) {
    if (db) await log(db, null, 'correo_error', `${destinatario}: ${e.message}`);
    return false;
  }
}

export function confirmacion(env, db, bloque) {
  const cuerpo = plantilla({
    titulo: 'Confirmación de hora — Examen práctico de conducir',
    intro: 'Se agendó tu examen práctico de licencia de conducir con los siguientes datos:',
    bloque,
  });
  return enviar(env, db, bloque.correo, 'Confirmación de tu hora de examen práctico', cuerpo);
}

// bloque debe traer token_confirmacion si se quiere ofrecer los links de
// confirmar/rechazar (solo se arman si hay AGENDA_URL_PUBLICA configurada).
export function recordatorio(env, db, bloque) {
  const urlPublica = (env.AGENDA_URL_PUBLICA || '').replace(/\/$/, '') || null;
  const links = (urlPublica && bloque.token_confirmacion)
    ? {
        confirmar: `${urlPublica}/confirmar/${bloque.id}/${bloque.token_confirmacion}`,
        rechazar: `${urlPublica}/rechazar/${bloque.id}/${bloque.token_confirmacion}`,
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
  return enviar(env, db, bloque.correo, 'Recordatorio: tu examen práctico es mañana', cuerpo);
}
