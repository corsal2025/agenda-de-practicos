'use strict';
// Reporte de errores por correo: envio manual (boton en el Reporte de errores) y diario automatico.
const { reporte } = require('./errores');
const correo = require('./correo');
const { hoyISO } = require('./fechas');
const { esc } = require('./html');

const organismo = () => process.env.AGENDA_ORGANISMO || 'Municipalidad de Valparaíso';

// Correos separados por coma en AGENDA_REPORTE_DESTINATARIOS.
function destinatarios() {
  return String(process.env.AGENDA_REPORTE_DESTINATARIOS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

function formatear(rep) {
  const org = organismo();
  const hoy = hoyISO();
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

async function enviarReporte() {
  if (!correo.habilitado) throw errConfig('SMTP no configurado (faltan SMTP_HOST/SMTP_USER/SMTP_PASS).');
  const para = destinatarios();
  if (!para.length) throw errConfig('Falta AGENDA_REPORTE_DESTINATARIOS (correos separados por coma).');
  const rep = reporte();
  const { asunto, texto, html } = formatear(rep);
  const ok = await correo.enviar(para.join(', '), asunto, { text: texto, html });
  if (!ok) throw new Error('No se pudo enviar el reporte (revisa el SMTP; el detalle quedo en los movimientos).');
  return { total: rep.total, destinatarios: para };
}

// Una vez al dia mientras el servidor este arriba, solo si hay SMTP y destinatarios.
function programar() {
  if (!correo.habilitado || !destinatarios().length) return;
  setInterval(() => {
    enviarReporte().catch((e) => console.error('Envio del reporte de errores fallo:', e.message));
  }, 24 * 3600 * 1000).unref();
}

module.exports = { formatear, destinatarios, enviarReporte, programar };
