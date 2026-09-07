'use strict';
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { db, tx, upsertExaminador, upsertFuncionario, log } = require('./db');
const { generar } = require('./slots');
const N = require('./normalizar');
const { aISO, aHora } = require('./fechas');
const { RAIZ } = require('./config');

// Indices de columna en las hojas maestras (AGO-DIC y ENE-JUN 2027).
const COL = {
  fecha: 0, hora: 1, rut: 2, nombre: 3, clase: 4, contacto: 5, correo: 6,
  tipo_cita: 7, motivo: 8, lista_espera: 9, intento: 10, funcionario: 11,
  fecha_tramite: 12, confirmo: 13, examinador: 14, resultado: 15, comentarios: 16,
};

// AGO-DIC / ENE-JUN 2027: formato original (Google Sheets). AGENDA: formato que exporta este dashboard.
const HOJAS_MAESTRAS = ['AGO-DIC', 'ENE-JUN 2027', 'AGENDA'];

function filaABloque(fila) {
  const fecha = aISO(fila[COL.fecha]);
  const hora = aHora(fila[COL.hora]);
  const examinadorNom = N.examinador(fila[COL.examinador]);
  if (!fecha || !hora || !examinadorNom) return null;

  const notas = [];
  const cl = N.clase(fila[COL.clase]);
  if (cl.nota) notas.push(cl.nota);
  const res = N.resultado(fila[COL.resultado]);
  if (res.nota) notas.push(res.nota);
  const r = N.rutNorm(fila[COL.rut]);
  if (r.nota) notas.push(r.nota);
  if (r.invalido && r.valor) notas.push(`RUT con digito verificador invalido: ${r.valor}`);

  let tipo = N.tipoCita(fila[COL.tipo_cita]);
  let intento = N.intento(fila[COL.intento]);
  if (intento && typeof intento === 'object' && intento.mover_a_tipo) {
    tipo = tipo || intento.mover_a_tipo;
    intento = null;
  }

  const comentarioBase = N.s(fila[COL.comentarios]);
  const comentarios = [comentarioBase, ...notas].filter(Boolean).join(' | ') || null;

  const fechaTramite = aISO(fila[COL.fecha_tramite]);
  const nombreRaw = N.nombre(fila[COL.nombre]);
  const motivoBloqueo = !r.valor ? N.bloqueo(nombreRaw) : null;

  if (motivoBloqueo) {
    return {
      fecha, hora, examinadorNom, bloqueado: 1, bloqueo_motivo: motivoBloqueo,
      rut: null, nombre: null, clase: null, contacto: null, correo: null,
      tipo_cita: null, motivo_reagendamiento: null, lista_espera: null, intento: null,
      funcionarioNom: null, fecha_inicio_tramite: null, confirmo_asistencia: null,
      resultado: null, comentarios: comentarioBase || null,
    };
  }

  return {
    fecha, hora, examinadorNom, bloqueado: 0, bloqueo_motivo: null,
    rut: r.valor,
    nombre: nombreRaw,
    clase: cl.valor,
    contacto: N.contacto(fila[COL.contacto]),
    correo: N.correo(fila[COL.correo]),
    tipo_cita: tipo,
    motivo_reagendamiento: N.s(fila[COL.motivo]) || null,
    lista_espera: N.listaEspera(fila[COL.lista_espera]),
    intento: typeof intento === 'string' ? intento : null,
    funcionarioNom: N.funcionario(fila[COL.funcionario]),
    fecha_inicio_tramite: fechaTramite,
    confirmo_asistencia: N.siNoBool(fila[COL.confirmo]),
    resultado: res.valor,
    comentarios,
  };
}

const ocupado = (b) => Boolean(b.rut || b.nombre);

const UPSERT = `
  INSERT INTO agenda (
    fecha, hora, examinador_id, rut, nombre, clase, contacto, correo, tipo_cita,
    motivo_reagendamiento, lista_espera, intento, funcionario_id, fecha_inicio_tramite,
    confirmo_asistencia, resultado, comentarios, bloqueado, bloqueo_motivo, agendado_en
  ) VALUES (
    @fecha, @hora, @examinador_id, @rut, @nombre, @clase, @contacto, @correo, @tipo_cita,
    @motivo_reagendamiento, @lista_espera, @intento, @funcionario_id, @fecha_inicio_tramite,
    @confirmo_asistencia, @resultado, @comentarios, @bloqueado, @bloqueo_motivo, @agendado_en
  )
  ON CONFLICT (fecha, hora, examinador_id) DO UPDATE SET
    bloqueado = excluded.bloqueado,
    bloqueo_motivo = excluded.bloqueo_motivo,
    rut = excluded.rut,
    nombre = excluded.nombre,
    clase = excluded.clase,
    contacto = excluded.contacto,
    correo = excluded.correo,
    tipo_cita = excluded.tipo_cita,
    motivo_reagendamiento = excluded.motivo_reagendamiento,
    lista_espera = excluded.lista_espera,
    intento = excluded.intento,
    funcionario_id = excluded.funcionario_id,
    fecha_inicio_tramite = excluded.fecha_inicio_tramite,
    confirmo_asistencia = excluded.confirmo_asistencia,
    resultado = excluded.resultado,
    comentarios = excluded.comentarios,
    agendado_en = COALESCE(agenda.agendado_en, excluded.agendado_en),
    actualizado_en = datetime('now','localtime')
`;

function importar(rutaXlsx, { limpiar = false } = {}) {
  if (!fs.existsSync(rutaXlsx)) throw new Error(`No existe el archivo: ${rutaXlsx}`);
  const wb = XLSX.readFile(rutaXlsx, { cellDates: true });

  if (limpiar) {
    db.exec('DELETE FROM agenda; DELETE FROM movimientos;');
  }

  // 1) Reunir bloques de las hojas maestras, deduplicando por (fecha,hora,examinador).
  const porSlot = new Map();
  let leidas = 0;
  let saltadas = 0;

  for (const hoja of HOJAS_MAESTRAS) {
    const ws = wb.Sheets[hoja];
    if (!ws) continue;
    const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, cellDates: true, defval: null });
    for (let i = 1; i < filas.length; i++) {
      const b = filaABloque(filas[i]);
      if (!b) { if (filas[i] && filas[i].some((c) => c != null && c !== '')) saltadas++; continue; }
      leidas++;
      const key = `${b.fecha}|${b.hora}|${b.examinadorNom}`;
      const prev = porSlot.get(key);
      const conten = (x) => Boolean(x.rut || x.nombre || x.bloqueado);
      if (!prev || ocupado(b) || (conten(b) && !conten(prev))) {
        porSlot.set(key, b);
      }
    }
  }

  // 2) Rango de fechas para generar la grilla completa.
  const fechas = [...porSlot.values()].map((b) => b.fecha).sort();
  const desde = fechas[0] || '2026-08-01';
  const hasta = fechas[fechas.length - 1] || '2027-06-30';
  const gen = generar(desde, hasta);

  // 3) Upsert.
  const stmt = db.prepare(UPSERT);
  let ocupadas = 0;
  tx(() => {
    for (const b of porSlot.values()) {
      const examinador_id = upsertExaminador(b.examinadorNom);
      const funcionario_id = upsertFuncionario(b.funcionarioNom);
      stmt.run({
        fecha: b.fecha, hora: b.hora, examinador_id,
        rut: b.rut, nombre: b.nombre, clase: b.clase, contacto: b.contacto, correo: b.correo,
        tipo_cita: b.tipo_cita, motivo_reagendamiento: b.motivo_reagendamiento,
        lista_espera: b.lista_espera, intento: b.intento, funcionario_id,
        fecha_inicio_tramite: b.fecha_inicio_tramite,
        confirmo_asistencia: b.confirmo_asistencia, resultado: b.resultado,
        comentarios: b.comentarios,
        bloqueado: b.bloqueado || 0,
        bloqueo_motivo: b.bloqueo_motivo || null,
        agendado_en: ocupado(b) ? (b.fecha_inicio_tramite || b.fecha) : null,
      });
      if (ocupado(b)) ocupadas++;
    }
  });

  // 4) Rescatar reservas sueltas de CITAS DISPONIBLES (solo si el bloque esta libre).
  let rescatadas = 0;
  const wsCD = wb.Sheets['CITAS DISPONIBLES'];
  if (wsCD) {
    const filas = XLSX.utils.sheet_to_json(wsCD, { header: 1, raw: true, cellDates: true, defval: null });
    const upd = db.prepare(`
      UPDATE agenda SET rut=@rut, nombre=@nombre, clase=@clase, contacto=@contacto, correo=@correo,
        tipo_cita=@tipo_cita, funcionario_id=@funcionario_id, agendado_en=COALESCE(agendado_en, @fecha),
        actualizado_en=datetime('now','localtime')
      WHERE fecha=@fecha AND hora=@hora AND examinador_id=@examinador_id
        AND rut IS NULL AND nombre IS NULL AND bloqueado = 0`);
    for (let i = 1; i < filas.length; i++) {
      const f = filas[i];
      if (!f) continue;
      const rr = N.rutNorm(f[4]);
      const nom = N.nombre(f[5]);
      if (!rr.valor && !nom) continue;
      const fecha = aISO(f[1]);
      const hora = aHora(f[2]);
      const examinador_id = upsertExaminador(N.examinador(f[15]));
      if (!fecha || !hora || !examinador_id) continue;
      const r = upd.run({
        fecha, hora, examinador_id, rut: rr.valor, nombre: nom,
        clase: N.clase(f[6]).valor, contacto: N.contacto(f[7]), correo: N.correo(f[8]),
        tipo_cita: N.tipoCita(f[10]), funcionario_id: upsertFuncionario(N.funcionario(f[13])),
      });
      rescatadas += Number(r.changes);
      if (Number(r.changes)) ocupadas++;
    }
  }

  const resumen = { leidas, saltadas, ocupadas, rescatadas, bloques_generados: gen.creados, rango: [desde, hasta] };
  log(null, 'importar', JSON.stringify(resumen));
  return resumen;
}

module.exports = { importar };

// --- CLI ---
if (require.main === module) {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const candidatos = [
    arg,
    path.join(RAIZ, 'data', 'origen.xlsx'),
    path.join(require('os').homedir(), 'Desktop', 'agenda de practicos', 'AGENDA PRÁCTICOS.xlsx'),
    path.join(require('os').homedir(), 'Desktop', 'AGENDA PRÁCTICOS.xlsx'),
  ].filter(Boolean);
  const ruta = candidatos.find((p) => fs.existsSync(p)) || candidatos[0];
  const limpiar = process.argv.includes('--limpiar');
  console.log(`Importando: ${ruta}${limpiar ? ' (limpiando datos previos)' : ''}`);
  const r = importar(ruta, { limpiar });
  console.log(JSON.stringify(r, null, 2));
}
