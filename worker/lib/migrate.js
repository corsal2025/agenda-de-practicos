// Reemplaza server/migrate.js. El .xlsx YA NO se parsea aca: un archivo real
// (cientos de KB) tarda mas CPU parseandolo de lo que el plan gratis de
// Workers permite por request (10ms) -- Cloudflare mataba el request a mitad
// de camino con su propio error HTML (1102). Por eso XLSX.read()/sheet_to_json
// se movieron al navegador (public/app.js, sin ese limite de CPU); aca llega
// `hojas` ya como `{ [nombreHoja]: filas[][] }` -- exactamente lo que
// sheet_to_json(ws,{header:1,...}) devolvia antes, solo que armado del otro
// lado. El UPSERT y el rescate de "CITAS DISPONIBLES" siguen en `?`
// posicionales (sin cambios ahi).
import { upsertExaminador, upsertFuncionario, log } from './db.js';
import { generar } from './slots.js';
import * as pesada from './pesada.js';
import * as N from './normalizar.js';
import { aISO, aHora, ahoraChile } from './fechas.js';

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

const UPSERT_SQL = `
  INSERT INTO agenda (
    fecha, hora, examinador_id, rut, nombre, clase, contacto, correo, tipo_cita,
    motivo_reagendamiento, lista_espera, intento, funcionario_id, fecha_inicio_tramite,
    confirmo_asistencia, resultado, comentarios, bloqueado, bloqueo_motivo, agendado_en, actualizado_en
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    actualizado_en = excluded.actualizado_en
`;

// D1 no documenta un tope duro de statements por batch(), pero mandar miles de
// UPSERT en una sola llamada es fragil (limite de tamaño de request). Se parte
// en lotes: cada lote es atomico, y como el UPSERT es idempotente (ON CONFLICT
// DO UPDATE), repetir un lote si algo falla a mitad de camino no duplica nada.
// Esto es una desviacion menor del plan ("un solo batch()"): en la practica, un
// solo batch() por lote acotado en vez de uno gigante para toda la importacion.
//
// OJO: D1 no soporta una transaccion que abarque varias llamadas a batch() (cada
// batch() es atomico por si solo, pero no hay BEGIN/COMMIT entre lotes). Si un
// lote falla a mitad de la importacion, los lotes anteriores ya quedaron
// guardados en la base y la importacion queda parcial. La recuperacion es
// simplemente volver a subir el mismo Excel: como el UPSERT es idempotente,
// el reintento retoma/sobrescribe correctamente sin duplicar nada.
const TAMANO_LOTE = 50;
async function ejecutarPorLotes(db, statements) {
  const totalLotes = Math.ceil(statements.length / TAMANO_LOTE) || 0;
  for (let i = 0; i < statements.length; i += TAMANO_LOTE) {
    const indiceLote = i / TAMANO_LOTE;
    try {
      await db.batch(statements.slice(i, i + TAMANO_LOTE));
    } catch (err) {
      console.error(`importar: fallo el lote ${indiceLote + 1}/${totalLotes} de la importacion (statements ${i}-${Math.min(i + TAMANO_LOTE, statements.length) - 1}):`, err);
      throw new Error(
        `La importacion fallo en el lote ${indiceLote + 1} de ${totalLotes}. La importacion quedo ` +
        `PARCIAL: los lotes anteriores a este ya se guardaron en la base. Es seguro volver a subir ` +
        `el mismo archivo Excel para reintentar -- el UPSERT es idempotente y va a retomar/sobrescribir ` +
        `desde donde quedo, sin duplicar nada. Detalle: ${err && err.message}`
      );
    }
  }
}

export async function importar(db, hojas, { limpiar = false } = {}) {
  if (limpiar) {
    await db.batch([db.prepare('DELETE FROM agenda'), db.prepare('DELETE FROM movimientos')]);
  }

  // 1) Reunir bloques de las hojas maestras, deduplicando por (fecha,hora,examinador).
  const porSlot = new Map();
  let leidas = 0;
  let saltadas = 0;

  for (const hoja of HOJAS_MAESTRAS) {
    const filas = hojas[hoja];
    if (!filas) continue;
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
  const gen = await generar(db, desde, hasta);

  // 3) Upsert.
  const ts = ahoraChile();
  let ocupadas = 0;

  // Resolver examinador_id/funcionario_id una sola vez por nombre distinto (evita
  // N+1: antes se llamaba upsertExaminador/upsertFuncionario por cada FILA, aunque
  // en la practica se repiten un puñado de examinadores/funcionarios miles de veces).
  const nombresExaminador = new Set();
  const nombresFuncionario = new Set();
  for (const b of porSlot.values()) {
    if (b.examinadorNom) nombresExaminador.add(b.examinadorNom);
    if (b.funcionarioNom) nombresFuncionario.add(b.funcionarioNom);
  }
  const idsExaminador = new Map();
  for (const nom of nombresExaminador) idsExaminador.set(nom, await upsertExaminador(db, nom));
  const idsFuncionario = new Map();
  for (const nom of nombresFuncionario) idsFuncionario.set(nom, await upsertFuncionario(db, nom));

  const stmts = [];
  for (const b of porSlot.values()) {
    const examinador_id = b.examinadorNom ? idsExaminador.get(b.examinadorNom) : null;
    const funcionario_id = b.funcionarioNom ? idsFuncionario.get(b.funcionarioNom) : null;
    stmts.push(db.prepare(UPSERT_SQL).bind(
      b.fecha, b.hora, examinador_id,
      b.rut, b.nombre, b.clase, b.contacto, b.correo,
      b.tipo_cita, b.motivo_reagendamiento, b.lista_espera, b.intento, funcionario_id,
      b.fecha_inicio_tramite, b.confirmo_asistencia, b.resultado, b.comentarios,
      b.bloqueado || 0, b.bloqueo_motivo || null,
      ocupado(b) ? (b.fecha_inicio_tramite || b.fecha) : null,
      ts,
    ));
    if (ocupado(b)) ocupadas++;
  }
  await ejecutarPorLotes(db, stmts);

  // 4) Rescatar reservas sueltas de CITAS DISPONIBLES (solo si el bloque esta libre).
  let rescatadas = 0;
  const filasCD = hojas['CITAS DISPONIBLES'];
  if (filasCD) {
    const filas = filasCD;
    const tsRescate = ahoraChile();

    // Resolver examinador_id/funcionario_id distintos una sola vez (mismo motivo
    // que en el paso 3: evita llamar upsertExaminador/upsertFuncionario por fila).
    const nombresExamRescate = new Set();
    const nombresFuncRescate = new Set();
    for (let i = 1; i < filas.length; i++) {
      const f = filas[i];
      if (!f) continue;
      const exNom = N.examinador(f[15]);
      if (exNom) nombresExamRescate.add(exNom);
      const funNom = N.funcionario(f[13]);
      if (funNom) nombresFuncRescate.add(funNom);
    }
    const idsExamRescate = new Map();
    for (const nom of nombresExamRescate) idsExamRescate.set(nom, await upsertExaminador(db, nom));
    const idsFuncRescate = new Map();
    for (const nom of nombresFuncRescate) idsFuncRescate.set(nom, await upsertFuncionario(db, nom));

    // Igual que en ejecutarPorLotes: D1 no soporta una transaccion que abarque
    // varias filas/llamadas run(). Si una fila falla a mitad de camino, las
    // filas de rescate anteriores a esta ya quedaron guardadas. Volver a subir
    // el mismo Excel es seguro: el UPDATE de abajo solo toca bloques libres
    // (WHERE rut IS NULL AND nombre IS NULL AND bloqueado = 0), asi que
    // reintentar no duplica ni pisa datos ya rescatados.
    let filaActual = 0;
    try {
      for (let i = 1; i < filas.length; i++) {
        filaActual = i;
        const f = filas[i];
        if (!f) continue;
        const rr = N.rutNorm(f[4]);
        const nom = N.nombre(f[5]);
        if (!rr.valor && !nom) continue;
        const fecha = aISO(f[1]);
        const hora = aHora(f[2]);
        const exNom = N.examinador(f[15]);
        const examinador_id = exNom ? idsExamRescate.get(exNom) : null;
        if (!fecha || !hora || !examinador_id) continue;
        const funNom = N.funcionario(f[13]);
        const funcionario_id = funNom ? idsFuncRescate.get(funNom) : null;
        const r = await db.prepare(`
          UPDATE agenda SET rut=?, nombre=?, clase=?, contacto=?, correo=?,
            tipo_cita=?, funcionario_id=?, agendado_en=COALESCE(agendado_en, ?),
            actualizado_en=?
          WHERE fecha=? AND hora=? AND examinador_id=?
            AND rut IS NULL AND nombre IS NULL AND bloqueado = 0
        `).bind(
          rr.valor, nom, N.clase(f[6]).valor, N.contacto(f[7]), N.correo(f[8]),
          N.tipoCita(f[10]), funcionario_id, fecha, tsRescate,
          fecha, hora, examinador_id,
        ).run();
        const cambios = Number(r.meta.changes);
        rescatadas += cambios;
        if (cambios) ocupadas++;
      }
    } catch (err) {
      console.error(`importar: fallo el rescate de CITAS DISPONIBLES en la fila ${filaActual + 1} de la hoja:`, err);
      throw new Error(
        `La importacion del rescate de CITAS DISPONIBLES fallo en la fila ${filaActual + 1}. El upsert ` +
        `principal y las filas de rescate anteriores a esta ya quedaron guardados. Es seguro volver a ` +
        `subir el mismo archivo Excel para reintentar -- tanto el UPSERT como este UPDATE son idempotentes ` +
        `y van a retomar desde donde quedo. Detalle: ${err && err.message}`
      );
    }
  }

  // 5) Clases pesadas (D/A5) a las 12:30: bloquear automaticamente 13:00 y 13:30.
  const sync = await pesada.sincronizarTodo(db);

  const resumen = {
    leidas, saltadas, ocupadas, rescatadas, bloques_generados: gen.creados, rango: [desde, hasta],
    pesadas_sincronizadas: sync.procesados,
  };
  await log(db, null, 'importar', JSON.stringify(resumen));
  return resumen;
}
