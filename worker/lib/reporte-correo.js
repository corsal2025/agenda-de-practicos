// Reporte de errores por correo: envio manual (boton en el Reporte de errores) y diario
// automatico (cron de reminder-worker). Equivale a server/reporte-correo.js.
import { reporte } from './errores.js';
import * as correo from './correo.js';
import { hoyISOChile } from './fechas.js';
import { esc } from './html.js';

// Correos separados por coma en AGENDA_REPORTE_DESTINATARIOS.
export function destinatarios(env) {
  return String((env && env.AGENDA_REPORTE_DESTINATARIOS) || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

export function formatear(env, rep) {
  const org = env.AGENDA_ORGANISMO || 'Municipalidad de Valparaíso';
  const hoy = hoyISOChile();
  const vacio = 'Sin hallazgos: la agenda no tiene errores pendientes hoy.';
  const lineas = rep.hallazgos.map((h) =>
    `- [${String(h.severidad).toUpperCase()}] ${String(h.tipo).replace(/_/g, ' ')} · ${h.fecha || ''} ${h.hora || ''} `
    + `${h.examinador || ''} · ${h.nombre || h.rut || ''}: ${h.mensaje}`);
  const texto = [
    `Reporte de errores — Agenda de Prácticos — ${org}`,
    `Fecha: ${hoy} · Total de hallazgos: ${rep.total}`,
    '',
    ...(lineas.length ? lineas : [vacio]),
  ].join('\n');

  // Los datos de los postulantes (nombre, mensaje) van escapados: se insertan en HTML.
  const filas = rep.hallazgos.map((h) => `<tr>
    <td>${esc(h.severidad)}</td><td>${esc(String(h.tipo).replace(/_/g, ' '))}</td><td>${esc(`${h.fecha || ''} ${h.hora || ''}`)}</td>
    <td>${esc(h.examinador || '')}</td><td>${esc(h.nombre || h.rut || '')}</td><td>${esc(h.mensaje)}</td>
  </tr>`).join('');
  const html = `<h2>Reporte de errores — Agenda de Prácticos</h2>
    <p>${esc(org)} · ${hoy} · Total de hallazgos: <b>${rep.total}</b></p>
    ${rep.hallazgos.length
      ? `<table border="1" cellpadding="4" cellspacing="0"><thead><tr>
          <th>Severidad</th><th>Tipo</th><th>Fecha/Hora</th><th>Examinador</th><th>Contribuyente</th><th>Detalle</th>
        </tr></thead><tbody>${filas}</tbody></table>`
      : `<p>${vacio}</p>`}`;

  return { asunto: `[Agenda de Prácticos] Reporte de errores del ${hoy} (${rep.total})`, texto, html };
}

function errConfig(msg) { const e = new Error(msg); e.status = 400; return e; }

export async function enviarReporte(env, db) {
  if (!correo.habilitado(env)) throw errConfig('Correo no configurado (falta RESEND_API_KEY).');
  const para = destinatarios(env);
  if (!para.length) throw errConfig('Falta AGENDA_REPORTE_DESTINATARIOS (correos separados por coma).');
  const rep = await reporte(db);
  const { asunto, texto, html } = formatear(env, rep);
  const ok = await correo.enviar(env, db, para, asunto, { text: texto, html });
  if (!ok) {
    const e = new Error('No se pudo enviar el reporte (revisa RESEND_API_KEY y RESEND_FROM; el detalle quedo en los movimientos).');
    e.status = 422;
    throw e;
  }
  return { total: rep.total, destinatarios: para };
}
