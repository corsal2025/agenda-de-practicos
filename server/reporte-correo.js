'use strict';
const { reporte } = require('./errores');
const correo = require('./correo');
const { hoyISO } = require('./fechas');

function formatear(rep) {
  const org = process.env.AGENDA_ORGANISMO || 'Municipalidad de Valparaíso';
  const lineas = rep.hallazgos.map((h) =>
    `- [${h.severidad.toUpperCase()}] ${h.tipo.replace(/_/g, ' ')} · ${h.fecha || ''} ${h.hora || ''} `
    + `${h.examinador || ''} · ${h.nombre || h.rut || ''}: ${h.mensaje}`);
  const texto = [
    `Reporte de errores — Agenda de Prácticos — ${org}`,
    `Fecha: ${hoyISO()} · Total de hallazgos: ${rep.total}`,
    '',
    ...(lineas.length ? lineas : ['Sin hallazgos: la agenda no tiene errores pendientes hoy.']),
  ].join('\n');

  const filas = rep.hallazgos.map((h) => `<tr>
    <td>${h.severidad}</td><td>${h.tipo.replace(/_/g, ' ')}</td><td>${h.fecha || ''} ${h.hora || ''}</td>
    <td>${h.examinador || ''}</td><td>${h.nombre || h.rut || ''}</td><td>${h.mensaje}</td>
  </tr>`).join('');
  const html = `<h2>Reporte de errores — Agenda de Prácticos</h2>
    <p>${org} · ${hoyISO()} · Total de hallazgos: <b>${rep.total}</b></p>
    ${rep.hallazgos.length
      ? `<table border="1" cellpadding="4" cellspacing="0"><thead><tr>
          <th>Severidad</th><th>Tipo</th><th>Fecha/Hora</th><th>Examinador</th><th>Contribuyente</th><th>Detalle</th>
        </tr></thead><tbody>${filas}</tbody></table>`
      : '<p>Sin hallazgos: la agenda no tiene errores pendientes hoy.</p>'}`;

  return { asunto: `[Agenda de Prácticos] Reporte de errores del ${hoyISO()} (${rep.total})`, texto, html };
}

async function enviarReporteDiario() {
  const rep = reporte();
  const { asunto, texto, html } = formatear(rep);
  await correo.enviar({ asunto, texto, html });
  return { total: rep.total, destinatarios: correo.destinatarios() };
}

// Corre enviarReporteDiario() una vez al dia mientras el servidor este arriba,
// solo si hay SMTP configurado.
function programar() {
  if (!correo.configurado()) return;
  setInterval(() => {
    enviarReporteDiario().catch((e) => console.error('Envio del reporte de errores fallo:', e.message));
  }, 24 * 3600 * 1000).unref();
}

module.exports = { formatear, enviarReporteDiario, programar };
