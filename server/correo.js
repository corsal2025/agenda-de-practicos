'use strict';
// Correos de confirmación (al agendar) y recordatorio (3 días antes).
const nodemailer = require('nodemailer');
const { SMTP, URL_PUBLICA, PUERTO } = require('./config');
const { log } = require('./db');

const habilitado = Boolean(SMTP.host && SMTP.user && SMTP.pass);
const baseUrl = URL_PUBLICA || `http://localhost:${PUERTO}`;

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
    ['Postulante', bloque.nombre || 'No indicado'],
    ['RUT', bloque.rut || 'No indicado'],
    ['Fecha del Examen', fFecha(bloque.fecha)],
    ['Hora citada', bloque.hora],
    ['Examinador/a asignado/a', bloque.examinador || 'Por confirmar'],
    ['Clase de Licencia', bloque.clase || 'B'],
  ];
  const filasHtml = filas.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px">${k}</td><td style="padding:6px 0;font-weight:700;color:#0f172a;font-size:14px">${v}</td></tr>`).join('');
  const filasTexto = filas.map(([k, v]) => `${k}: ${v}`).join('\n');

  const esClaseC = bloque.clase && bloque.clase.toUpperCase().includes('C');

  const instruccionesHtml = `
    <div style="margin-top:22px;padding:16px;background:#f8fafc;border-left:4px solid #2563eb;border-radius:6px">
      <h3 style="margin:0 0 12px;color:#1e3a8a;font-size:14px;text-transform:uppercase;letter-spacing:0.02em">
        📋 INSTRUCCIONES OBLIGATORIAS PARA EL DÍA DEL EXAMEN (Ley N° 18.290 de Tránsito y CONASET)
      </h3>
      <ul style="margin:0;padding-left:18px;color:#334155;font-size:12.5px;line-height:1.6">
        <li><b>Puntualidad rigurosa:</b> Presentarse con <b>15 minutos de anticipación</b> en la Dirección de Tránsito.</li>
        <li><b>Identificación obligatoria:</b> Cédula de Identidad física vigente (original).</li>
        <li><b>Acompañante con Licencia:</b> Si no posee licencia vigente para la clase que rinde, <b>DEBE</b> concurrir con un acompañante habilitado con licencia de conductor de igual o superior clase que conduzca el vehículo hasta el recinto.</li>
        <li><b>Documentación del vehículo al día (Física y Original):</b>
          <br>• Permiso de Circulación vigente.
          <br>• Certificado de Revisión Técnica y Análisis de Gases al día.
          <br>• Seguro Obligatorio de Accidentes Personales (SOAP) vigente.
          <br>• Padrón del vehículo (Certificado de Anotaciones Vigentes) o autorización notarial si no es el dueño.
        </li>
        <li><b>Equipamiento e inspección de seguridad reglamentaria:</b>
          <br>• Cinturones de seguridad operativos en todos los asientos.
          <br>• Chaleco reflectante accesible desde el interior de la cabina.
          <br>• 2 triángulos reflectantes de emergencia.
          <br>• Extintor de incendios cargado, con manómetro en verde y sello de mantención vigente.
          <br>• Rueda de repuesto con presión reglamentaria, gata y llave de rueda en buen estado.
          <br>• Luces 100% operativas (bajas, altas, viraje, frenos, reversa y patente).
          <br>• Neumáticos en buen estado con dibujo reglamentario (mínimo 1.6 mm de profundidad).
        </li>
        ${esClaseC ? `
        <li style="margin-top:8px;color:#b45309"><b>Requisitos específicos para Clase C (Motocicleta):</b>
          <br>• Casco reglamentario certificado con visor transparente que ajuste correctamente.
          <br>• Guantes de motociclista resistentes al roce.
          <br>• Calzado cerrado que cubra completamente el tobillo.
          <br>• Chaqueta y pantalón con protecciones o tela antiabrasión.
        </li>` : ''}
      </ul>
    </div>
  `;

  const instruccionesTexto = `
INSTRUCCIONES OBLIGATORIAS (Ley de Tránsito N° 18.290):
- Presentarse con 15 minutos de anticipación.
- Cédula de Identidad física vigente.
- Acompañante con licencia de igual o superior clase si no posee licencia vigente.
- Documentación original del vehículo al día: Permiso de circulación, Revisión técnica/gases, SOAP y Padrón.
- Elementos de seguridad: Chaleco reflectante, 2 triángulos, extintor cargado vigente, rueda de repuesto y herramientas.
`;

  const botonesHtml = links
    ? `<div style="margin:24px 0 10px;display:flex;gap:12px;flex-wrap:wrap">
        <a href="${links.confirmar}" style="display:inline-block;padding:11px 20px;background:#15803d;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:700;font-size:13px;box-shadow:0 2px 6px rgba(21,128,61,0.3)">
          ✔ Confirmo mi Asistencia
        </a>
        <a href="${links.reagendar}" style="display:inline-block;padding:11px 20px;background:#0284c7;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:700;font-size:13px;box-shadow:0 2px 6px rgba(2,132,199,0.3)">
          🔄 Reagendar mi Hora (Ver Próximas Fechas)
        </a>
      </div>
      <p style="font-size:11.5px;color:#64748b;margin:6px 0 0">
        Si no puedes asistir en esta fecha, presiona "Reagendar mi Hora" para elegir de inmediato otro día disponible en el sistema.
      </p>`
    : '';

  const botonesTexto = links
    ? `\nConfirmar asistencia: ${links.confirmar}\nReagendar a otra fecha disponible: ${links.reagendar}\n`
    : '';

  return {
    text: `${titulo}\n\n${intro}\n\n${filasTexto}\n${instruccionesTexto}${botonesTexto}`,
    html: `<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;max-width:620px;margin:0 auto;line-height:1.5;padding:16px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px">
      <h2 style="margin:0 0 8px;color:#0f172a;font-size:18px">${titulo}</h2>
      <p style="margin:0 0 16px;color:#334155;font-size:13.5px">${intro}</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:12px">${filasHtml}</table>
      ${instruccionesHtml}
      ${botonesHtml}
    </div>`,
  };
}

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

function armarLinks(bloque) {
  if (!bloque.token_confirmacion) return null;
  return {
    confirmar: `${baseUrl}/confirmar/${bloque.id}/${bloque.token_confirmacion}`,
    rechazar: `${baseUrl}/rechazar/${bloque.id}/${bloque.token_confirmacion}`,
    reagendar: `${baseUrl}/reagendar/${bloque.id}/${bloque.token_confirmacion}`,
  };
}

function confirmacion(bloque) {
  const links = armarLinks(bloque);
  const cuerpo = plantilla({
    titulo: 'Confirmación de hora — Examen práctico de conducir',
    intro: 'Se ha registrado tu examen práctico de conducir. Revisa detenidamente los datos y las exigencias legales para tu presentación:',
    bloque,
    links,
  });
  return enviar(bloque.correo, `Confirmación de tu hora de examen práctico - ${fFecha(bloque.fecha)} ${bloque.hora}`, cuerpo);
}

function recordatorio(bloque) {
  const links = armarLinks(bloque);
  const cuerpo = plantilla({
    titulo: 'Recordatorio oficial — Tu examen práctico es en 3 días',
    intro: 'Te recordamos que tu examen práctico de conducir está programado para dentro de 3 días. Por favor confirma tu asistencia o reagenda si tienes un imprevisto:',
    bloque,
    links,
  });
  return enviar(bloque.correo, `Recordatorio oficial (Faltan 3 días) - Examen práctico ${fFecha(bloque.fecha)} ${bloque.hora}`, cuerpo);
}

module.exports = { habilitado, confirmacion, recordatorio };
