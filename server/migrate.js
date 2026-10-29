'use strict';
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { db, tx, upsertExaminador, upsertFuncionario, log } = require('./db');
const { generar } = require('./slots');
const pesada = require('./pesada');
const papelera = require('./papelera');
const { reservarCupoLibre } = require('./cupos');
const { compartenClase } = require('./intentos');
const N = require('./normalizar');
const rut = require('./rut');
const { aISO, aHora } = require('./fechas');
const { RAIZ } = require('./config');

// Indices de columna en las hojas maestras (AGO-DIC y ENE-JUN 2027).
const COL = {
  fecha: 0, hora: 1, rut: 2, nombre: 3, clase: 4, contacto: 5, correo: 6,
  tipo_cita: 7, motivo: 8, lista_espera: 9, intento: 10, funcionario: 11,
  fecha_tramite: 12, confirmo: 13, examinador: 14, resultado: 15, comentarios: 16,
  // Columnas extendidas (las agrega el export de este dashboard): -1 = no presentes en el archivo.
  cupo: -1, escuela: -1, tipo_reagendamiento: -1, avisado_por: -1, pendiente_reagendar: -1, pendiente_nota: -1,
};

// AGO-DIC / ENE-JUN 2027: formato original (Google Sheets). AGENDA: formato que exporta este dashboard.
const HOJAS_MAESTRAS = ['AGO-DIC', 'ENE-JUN 2027', 'AGENDA'];
// Nombres de hoja que reconoce el importador (ver matchHojaMaestra mas abajo):
// AGENDA, CITAS DISPONIBLES, ENE-JUN <año>, JUL-DIC <año> y el nombre antiguo AGO-DIC <año>,
// con el año siempre opcional.
const RE_HOJA_MAESTRA = /^(AGENDA|ENE-JUN|JUL-DIC|AGO-DIC)(\s+\d{4})?$/i;
function esHojaMaestra(nombre) {
  return RE_HOJA_MAESTRA.test(String(nombre || '').trim());
}

// Cabeceras exactas que agrega el export de este dashboard (ver server/export.js): se detectan
// antes que las heuristicas de abajo para no confundirlas con columnas de otro origen.
const COLUMNAS_EXACTAS = {
  CUPO: 'cupo',
  'ESCUELA CONDUCTORES': 'escuela',
  'TIPO REAGENDAMIENTO': 'tipo_reagendamiento',
  'AVISADO POR': 'avisado_por',
  'PENDIENTE REAGENDAR': 'pendiente_reagendar',
  'NOTA PENDIENTE': 'pendiente_nota',
};

// Las filas con fecha anterior a esta se descartan al importar. Una fecha mal digitada (por ejemplo 2001)
// haria que la grilla se generara desde ese anio y crearia cientos de miles de bloques vacios.
const FECHA_MINIMA = '2020-01-01';

function detectarColumnas(filaEncabezado) {
  if (!Array.isArray(filaEncabezado)) return COL;
  const normalizar = (s) => String(s || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const encabezados = filaEncabezado.map(normalizar);
  const map = { ...COL };
  encabezados.forEach((h, idx) => {
    if (COLUMNAS_EXACTAS[h]) { map[COLUMNAS_EXACTAS[h]] = idx; return; }
    if (h.includes('FECHA') && !h.includes('TRAMITE') && !h.includes('INICIO')) map.fecha = idx;
    else if (h.includes('HORA') && !h.includes('INICIO')) map.hora = idx;
    else if (h === 'RUT') map.rut = idx;
    else if (h.includes('NOMBRE') && !h.includes('FUNCIONARIO')) map.nombre = idx;
    else if (h.includes('CLASE')) map.clase = idx;
    else if (h.includes('CONTACTO') || h.includes('TELEFONO')) map.contacto = idx;
    else if (h.includes('CORREO') || h.includes('EMAIL')) map.correo = idx;
    else if (h.includes('TIPO') && h.includes('CITA')) map.tipo_cita = idx;
    else if (h.includes('MOTIVO') && h.includes('REAGEND')) map.motivo = idx;
    else if (h.includes('ESPERA')) map.lista_espera = idx;
    else if (h.includes('INTENTO')) map.intento = idx;
    else if (h.includes('FUNCIONARI')) map.funcionario = idx;
    else if (h.includes('TRAMITE') || h.includes('INICIO')) map.fecha_tramite = idx;
    else if (h.includes('CONFIRM')) map.confirmo = idx;
    else if (h.includes('EXAMINADOR')) map.examinador = idx;
    else if (h.includes('RESULTADO')) map.resultado = idx;
    else if (h.includes('COMENTARIO') || h.includes('OBSERVACION')) map.comentarios = idx;
  });
  return map;
}

// Cupo real de la fila: sin columna o en blanco significa 1 (nunca se fuerza a otro valor).
function cupoDesdeFila(v) {
  if (v == null || String(v).trim() === '') return 1;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function filaABloque(fila, colMap = COL) {
  const c = colMap;
  const fecha = aISO(fila[c.fecha]);
  const hora = aHora(fila[c.hora]);
  const examinadorNom = N.examinador(fila[c.examinador]);
  if (!fecha || !hora || !examinadorNom) return null;

  const notas = [];
  const cl = N.clase(fila[c.clase]);
  if (cl.nota) notas.push(cl.nota);
  const res = N.resultado(fila[c.resultado]);
  if (res.nota) notas.push(res.nota);
  const r = N.rutNorm(fila[c.rut]);
  if (r.nota) notas.push(r.nota);
  if (r.invalido && r.valor) notas.push(`RUT con digito verificador invalido: ${r.valor}`);

  let tipo = N.tipoCita(fila[c.tipo_cita]);
  let intento = N.intento(fila[c.intento]);
  if (intento && typeof intento === 'object' && intento.mover_a_tipo) {
    tipo = tipo || intento.mover_a_tipo;
    intento = null;
  }

  const comentarioBase = N.s(fila[c.comentarios]);
  const comentarios = [comentarioBase, ...notas].filter(Boolean).join(' | ') || null;

  const fechaTramite = aISO(fila[c.fecha_tramite]);
  const nombreRaw = N.nombre(fila[c.nombre]);
  const motivoBloqueo = !r.valor ? N.bloqueo(nombreRaw) : null;

  // Columnas extendidas (export de este dashboard): se leen igual este de bloqueos u ocupadas.
  const cupo = cupoDesdeFila(fila[c.cupo]);
  const presente = {
    escuela: c.escuela !== -1, tipo_reagendamiento: c.tipo_reagendamiento !== -1,
    avisado_por: c.avisado_por !== -1, pendiente_reagendar: c.pendiente_reagendar !== -1,
    pendiente_nota: c.pendiente_nota !== -1,
  };
  const escuela_conductores = N.s(fila[c.escuela]) || null;
  const tipoReag = N.s(fila[c.tipo_reagendamiento]);
  const tipo_reagendamiento = tipoReag ? tipoReag.toUpperCase() : null;
  const avisado_por = N.s(fila[c.avisado_por]) || null;
  const pendiente_reagendar = N.siNoBool(fila[c.pendiente_reagendar]) ? 1 : 0;
  const pendiente_nota = N.s(fila[c.pendiente_nota]) || null;

  if (motivoBloqueo) {
    return {
      fecha, hora, examinadorNom, bloqueado: 1, bloqueo_motivo: motivoBloqueo,
      rut: null, nombre: null, clase: null, contacto: null, correo: null,
      tipo_cita: null, motivo_reagendamiento: null, lista_espera: null, intento: null,
      funcionarioNom: null, fecha_inicio_tramite: null, confirmo_asistencia: null,
      resultado: null, comentarios: comentarioBase || null,
      cupo, presente, escuela_conductores: null, tipo_reagendamiento: null, avisado_por: null,
      pendiente_reagendar: 0, pendiente_nota: null,
    };
  }

  return {
    fecha, hora, examinadorNom, bloqueado: 0, bloqueo_motivo: null,
    rut: r.valor,
    nombre: nombreRaw,
    clase: cl.valor,
    contacto: N.contacto(fila[c.contacto]),
    correo: N.correo(fila[c.correo]),
    tipo_cita: tipo,
    motivo_reagendamiento: N.s(fila[c.motivo]) || null,
    lista_espera: N.listaEspera(fila[c.lista_espera]),
    intento: (intento && typeof intento === 'object' ? intento.valor : intento) || null,
    funcionarioNom: N.funcionario(fila[c.funcionario]),
    fecha_inicio_tramite: fechaTramite,
    confirmo_asistencia: N.siNoBool(fila[c.confirmo]),
    resultado: res.valor,
    comentarios,
    cupo, presente, escuela_conductores, tipo_reagendamiento, avisado_por,
    pendiente_reagendar, pendiente_nota,
  };
}

const ocupado = (b) => Boolean(b.rut || b.nombre);

// Mismo ocupante: si alguno de los dos trae RUT, se comparan los RUT normalizados; sin RUT en
// ninguno, se compara el nombre normalizado (mismas reglas que usa el PUT de la agenda).
const normNombre = (n) => String(n || '').toUpperCase().replace(/\s+/g, ' ').trim();
function mismaPersona(a, b) {
  const ra = rut.limpiar(a.rut);
  const rb = rut.limpiar(b.rut);
  if (ra || rb) return ra === rb;
  return normNombre(a.nombre) === normNombre(b.nombre);
}

function errorImport(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

const UPSERT = `
  INSERT INTO agenda (
    fecha, hora, examinador_id, rut, nombre, clase, contacto, correo, tipo_cita,
    motivo_reagendamiento, lista_espera, intento, funcionario_id, fecha_inicio_tramite,
    confirmo_asistencia, resultado, comentarios, bloqueado, bloqueo_motivo, agendado_en, cupo
  ) VALUES (
    @fecha, @hora, @examinador_id, @rut, @nombre, @clase, @contacto, @correo, @tipo_cita,
    @motivo_reagendamiento, @lista_espera, @intento, @funcionario_id, @fecha_inicio_tramite,
    @confirmo_asistencia, @resultado, @comentarios, @bloqueado, @bloqueo_motivo, @agendado_en, @cupo
  )
  ON CONFLICT (fecha, hora, examinador_id, cupo) DO UPDATE SET
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
    actualizado_en = datetime('now','localtime'),
    -- Cambia el ocupante (otro RUT/nombre): el token y las banderas de correo del ocupante
    -- anterior no deben pasar al nuevo. Re-importar al MISMO ocupante no los toca.
    token_confirmacion = CASE WHEN @resetear = 1 THEN NULL ELSE agenda.token_confirmacion END,
    correo_confirmacion_enviado = CASE WHEN @resetear = 1 THEN 0 ELSE agenda.correo_confirmacion_enviado END,
    correo_recordatorio_enviado = CASE WHEN @resetear = 1 THEN 0 ELSE agenda.correo_recordatorio_enviado END,
    -- Columnas extendidas: si el archivo trae la columna se usa su valor (aunque venga en
    -- blanco); si no la trae, se mantiene el valor actual salvo que cambie el ocupante.
    escuela_conductores = CASE WHEN @escuela_presente = 1 THEN @escuela_conductores
      WHEN @resetear = 1 THEN NULL ELSE agenda.escuela_conductores END,
    tipo_reagendamiento = CASE WHEN @tipo_reagendamiento_presente = 1 THEN @tipo_reagendamiento
      WHEN @resetear = 1 THEN NULL ELSE agenda.tipo_reagendamiento END,
    avisado_por = CASE WHEN @avisado_por_presente = 1 THEN @avisado_por
      WHEN @resetear = 1 THEN NULL ELSE agenda.avisado_por END,
    pendiente_reagendar = CASE WHEN @pendiente_reagendar_presente = 1 THEN @pendiente_reagendar
      WHEN @resetear = 1 THEN 0 ELSE agenda.pendiente_reagendar END,
    pendiente_nota = CASE WHEN @pendiente_nota_presente = 1 THEN @pendiente_nota
      WHEN @resetear = 1 THEN NULL ELSE agenda.pendiente_nota END
`;

function importar(fuente, { limpiar = false } = {}) {
  let hojas = {};
  if (typeof fuente === 'string') {
    if (!fs.existsSync(fuente)) throw new Error(`No existe el archivo: ${fuente}`);
    const wb = XLSX.readFile(fuente, { cellDates: true });
    for (const nombre of wb.SheetNames) {
      if (nombre !== 'CITAS DISPONIBLES' && !esHojaMaestra(nombre)) continue;
      const ws = wb.Sheets[nombre];
      if (!ws) continue;
      hojas[nombre] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, cellDates: true, defval: null });
    }
  } else if (fuente && typeof fuente === 'object') {
    hojas = fuente;
  } else {
    throw new Error('Fuente de importación inválida');
  }

  // 1) Reunir bloques de las hojas maestras. Si en el archivo Excel vienen dos o más
  //    citas ocupadas en la misma fecha, hora y examinador (un sobrecupo anotado manualmente
  //    o doble carga de hora), se asigna la primera a cupo principal (cupo = 1) y las siguientes
  //    como sobrecupo (cupo = 2, 3...) para que ambas personas queden integradas en la grilla.
  const porHorario = new Map();
  const citasPorRutFecha = new Map();
  let leidas = 0;
  let saltadas = 0;
  let fueraDeRango = 0;

  const hojasAProcesar = Object.keys(hojas).filter((h) => h !== 'CITAS DISPONIBLES' && esHojaMaestra(h));
  const listaHojas = hojasAProcesar.length > 0 ? hojasAProcesar : Object.keys(hojas).filter((h) => h !== 'CITAS DISPONIBLES');

  for (const hoja of listaHojas) {
    const filas = hojas[hoja];
    if (!filas || filas.length < 2) continue;
    const colMap = detectarColumnas(filas[0]);
    for (let i = 1; i < filas.length; i++) {
      const b = filaABloque(filas[i], colMap);
      if (!b) { if (filas[i] && filas[i].some((c) => c != null && c !== '')) saltadas++; continue; }
      if (b.fecha < FECHA_MINIMA) { fueraDeRango++; continue; }
      leidas++;

      // Regla: no se permite la misma persona (RUT) con dos examinadores distintos para la misma licencia
      if (ocupado(b)) {
        const rLimpio = rut.limpiar(b.rut);
        if (rLimpio) {
          const rfKey = `${rLimpio}|${b.fecha}`;
          let previas = citasPorRutFecha.get(rfKey);
          if (!previas) {
            previas = [];
            citasPorRutFecha.set(rfKey, previas);
          }
          for (const prev of previas) {
            if (prev.examinadorNom !== b.examinadorNom && compartenClase(prev.clase, b.clase)) {
              throw errorImport(
                `Conflicto de examinador: la persona "${b.nombre || b.rut}" (RUT ${b.rut}) ya está asignada el ${b.fecha} `
                + `con el examinador "${prev.examinadorNom}" (hoja "${prev._hoja}", fila ${prev._fila}) para la clase `
                + `"${b.clase || 'indicada'}", y aparece con el examinador distinto "${b.examinadorNom}" (hoja "${hoja}", fila ${i + 1}). `
                + `No se permite la misma persona con dos examinadores distintos para la misma licencia.`
              );
            }
          }
          previas.push({ ...b, _hoja: hoja, _fila: i + 1 });

          if (!limpiar) {
            const enDb = db.prepare(`
              SELECT a.hora, a.clase, e.nombre AS examinadorNom
              FROM agenda a
              JOIN examinadores e ON e.id = a.examinador_id
              WHERE a.fecha = ?
                AND a.rut IS NOT NULL
                AND a.bloqueado = 0
                AND UPPER(REPLACE(REPLACE(REPLACE(a.rut,'.',''),'-',''),' ','')) = ?
            `).all(b.fecha, rLimpio);
            for (const fDb of enDb) {
              if (fDb.examinadorNom !== b.examinadorNom && compartenClase(fDb.clase, b.clase)) {
                throw errorImport(
                  `Conflicto de examinador: la persona "${b.nombre || b.rut}" (RUT ${b.rut}) ya tiene una cita agendada en el sistema `
                  + `el ${b.fecha} a las ${fDb.hora} con el examinador "${fDb.examinadorNom}" para la clase "${fDb.clase || 'indicada'}". `
                  + `No se permite la misma persona con dos examinadores distintos para la misma licencia.`
                );
              }
            }
          }
        }
      }

      const baseKey = `${b.fecha}|${b.hora}|${b.examinadorNom}`;
      let cupos = porHorario.get(baseKey);
      if (!cupos) {
        cupos = new Map();
        porHorario.set(baseKey, cupos);
      }

      const conten = (x) => Boolean(x.rut || x.nombre || x.bloqueado);

      if (ocupado(b)) {
        // Cita ocupada (trae RUT o nombre)
        let cupoMismaPersona = null;
        for (const [c, prev] of cupos.entries()) {
          if (ocupado(prev) && mismaPersona(prev, b)) {
            cupoMismaPersona = c;
            break;
          }
        }

        if (cupoMismaPersona !== null) {
          // Reaparicion o actualizacion de la misma persona en este horario
          b.cupo = cupoMismaPersona;
          cupos.set(cupoMismaPersona, { ...b, _hoja: hoja, _fila: i + 1 });
        } else {
          // Persona distinta en este horario.
          // Si el cupo sugerido (b.cupo) no esta ocupado por otra persona (esta vacio o no ocupado):
          const prevEnCupo = cupos.get(b.cupo);
          if (!prevEnCupo || !ocupado(prevEnCupo)) {
            cupos.set(b.cupo, { ...b, _hoja: hoja, _fila: i + 1 });
          } else {
            // Doble carga / sobrecupo en el Excel: b.cupo ya esta ocupado por otra persona.
            // Asigna el siguiente cupo disponible para esta hora (cupo = 2, 3...)
            let siguienteCupo = 1;
            while (cupos.has(siguienteCupo) && ocupado(cupos.get(siguienteCupo))) {
              siguienteCupo++;
            }
            b.cupo = siguienteCupo;
            cupos.set(siguienteCupo, { ...b, _hoja: hoja, _fila: i + 1 });
          }
        }
      } else {
        // Bloque no ocupado (bloqueo o vacio).
        // Solo aplica si el horario no tiene ya una persona ocupada en cupo 1
        const prev1 = cupos.get(1);
        if (!prev1 || (!ocupado(prev1) && (conten(b) || !conten(prev1)))) {
          b.cupo = 1;
          cupos.set(1, { ...b, _hoja: hoja, _fila: i + 1 });
        }
      }
    }
  }

  const porSlot = new Map();
  for (const cupos of porHorario.values()) {
    for (const b of cupos.values()) {
      const key = `${b.fecha}|${b.hora}|${b.examinadorNom}|${b.cupo}`;
      porSlot.set(key, b);
    }
  }

  // 2) Rango de fechas para generar la grilla completa.
  const fechas = [...porSlot.values()].map((b) => b.fecha).sort();
  const desde = fechas[0] || '2026-08-01';
  const hasta = fechas[fechas.length - 1] || '2027-06-30';

  // 3) Limpiar (si se pidio), generar la grilla y hacer el upsert: todo en una sola transaccion,
  //    ya validado el archivo arriba. limpiar ya NO borra movimientos (ver server/historial.js).
  const stmt = db.prepare(UPSERT);
  const existente = db.prepare('SELECT * FROM agenda WHERE fecha=? AND hora=? AND examinador_id=? AND cupo=?');
  let ocupadas = 0;
  const gen = tx(() => {
    if (limpiar) db.exec('DELETE FROM agenda; DELETE FROM cola_reagendar; DELETE FROM papelera;');
    const generado = generar(desde, hasta);
    for (const b of porSlot.values()) {
      const examinador_id = upsertExaminador(b.examinadorNom);
      const funcionario_id = upsertFuncionario(b.funcionarioNom);
      const previo = existente.get(b.fecha, b.hora, examinador_id, b.cupo);
      const resetear = previo && !mismaPersona(previo, b) ? 1 : 0;
      if (resetear === 1 && previo && (previo.rut || previo.nombre)) {
        papelera.guardar(previo, 'sobrescribir-importacion', 'importacion');
      }
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
        cupo: b.cupo,
        resetear,
        escuela_conductores: b.escuela_conductores, escuela_presente: b.presente.escuela ? 1 : 0,
        tipo_reagendamiento: b.tipo_reagendamiento, tipo_reagendamiento_presente: b.presente.tipo_reagendamiento ? 1 : 0,
        avisado_por: b.avisado_por, avisado_por_presente: b.presente.avisado_por ? 1 : 0,
        pendiente_reagendar: b.pendiente_reagendar, pendiente_reagendar_presente: b.presente.pendiente_reagendar ? 1 : 0,
        pendiente_nota: b.pendiente_nota, pendiente_nota_presente: b.presente.pendiente_nota ? 1 : 0,
      });
      if (ocupado(b)) ocupadas++;
    }
    return generado;
  });

  // 4) Rescatar reservas sueltas de CITAS DISPONIBLES (solo si el bloque esta libre).
  let rescatadas = 0;
  const filasCD = hojas['CITAS DISPONIBLES'];
  if (filasCD) {
    for (let i = 1; i < filasCD.length; i++) {
      const f = filasCD[i];
      if (!f) continue;
      const rr = N.rutNorm(f[4]);
      const nom = N.nombre(f[5]);
      if (!rr.valor && !nom) continue;
      const fecha = aISO(f[1]);
      const hora = aHora(f[2]);
      const examinador_id = upsertExaminador(N.examinador(f[15]));
      if (!fecha || !hora || !examinador_id || fecha < FECHA_MINIMA) continue;
      // Cada reserva suelta ocupa un cupo libre distinto de esa hora
      const reservadas = reservarCupoLibre(fecha, hora, examinador_id, {
        rut: rr.valor, nombre: nom,
        clase: N.clase(f[6]).valor, contacto: N.contacto(f[7]), correo: N.correo(f[8]),
        tipo_cita: N.tipoCita(f[10]), funcionario_id: upsertFuncionario(N.funcionario(f[13])),
      });
      rescatadas += reservadas;
      if (reservadas) ocupadas++;
    }
  }

  // 5) Clases pesadas (D/A5) a las 12:30: bloquear automaticamente 13:00 y 13:30.
  const sync = pesada.sincronizarTodo();

  const resumen = {
    leidas, saltadas, fuera_de_rango: fueraDeRango, ocupadas, rescatadas, bloques_generados: gen.creados, rango: [desde, hasta],
    pesadas_sincronizadas: sync.procesados,
  };
  log(null, 'importar', JSON.stringify(resumen));
  return resumen;
}

module.exports = { importar, esHojaMaestra };

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
