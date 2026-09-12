'use strict';
const { db } = require('./db');
const { hoyISO, sumarDias } = require('./fechas');

const SELECT = `
  SELECT a.*, e.nombre AS examinador
  FROM agenda a JOIN examinadores e ON e.id = a.examinador_id
`;

// Citas ocupadas, no bloqueadas, con telefono y sin recordatorio ya enviado, para
// el dia que cae `diasAntes` desde hoy (por defecto: manana).
function pendientes(diasAntes = 1) {
  const fecha = sumarDias(hoyISO(), diasAntes);
  return db.prepare(`
    ${SELECT}
    WHERE a.fecha = ? AND a.bloqueado = 0 AND (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
      AND a.contacto IS NOT NULL AND a.recordatorio_enviado_en IS NULL
    ORDER BY a.hora
  `).all(fecha);
}

function mensaje(cita, organismo) {
  const nombre = (cita.nombre || '').trim().split(/\s+/)[0] || 'Hola';
  const org = organismo || process.env.AGENDA_ORGANISMO || 'Municipalidad de Valparaíso';
  return `${nombre}: te recordamos tu hora para el examen práctico de conducir el `
    + `${cita.fecha} a las ${cita.hora} (examinador ${cita.examinador}). ${org}.`;
}

// Proveedor de envio real (SMS/WhatsApp/etc). Se conecta despues con registrarProveedor(fn),
// donde fn(telefono, texto) hace el envio y devuelve una Promise. Sin proveedor registrado,
// procesar() solo informa cuantos recordatorios quedan pendientes, sin marcar nada como
// enviado (para que no se "pierdan" recordatorios mientras no hay con que mandarlos).
let proveedor = null;
function registrarProveedor(fn) { proveedor = fn; }

async function procesar(diasAntes = 1) {
  const citas = pendientes(diasAntes);
  if (!citas.length) return { enviados: 0, pendientes: 0, motivo: null };
  if (!proveedor) {
    return { enviados: 0, pendientes: citas.length, motivo: 'Sin proveedor de SMS/WhatsApp configurado (registrarProveedor).' };
  }
  let enviados = 0;
  for (const cita of citas) {
    try {
      await proveedor(cita.contacto, mensaje(cita));
      db.prepare("UPDATE agenda SET recordatorio_enviado_en = datetime('now','localtime') WHERE id = ?").run(cita.id);
      enviados += 1;
    } catch (e) {
      console.error(`Recordatorio a ${cita.contacto} (cita ${cita.id}) fallo:`, e.message);
    }
  }
  return { enviados, pendientes: citas.length - enviados, motivo: null };
}

// Corre procesar() una vez al dia mientras el servidor este arriba. Tambien lo corre
// al arrancar: si no, tras un restart el primer envio quedaria colgado hasta la
// primera marca de 24 h y las citas de manana no se avisarian a tiempo.
function programar() {
  const correr = () => procesar(1).catch((e) => console.error('Recordatorios automaticos fallaron:', e.message));
  correr();
  setInterval(correr, 24 * 3600 * 1000).unref();
}

module.exports = { pendientes, mensaje, registrarProveedor, procesar, programar };
