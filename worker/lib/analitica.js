// Reemplaza server/analitica.js. Ya usaba parametros posicionales; el cambio es
// pasar a async/await sobre D1 y usar hoyISOChile() para "agendadas hoy".
import { hoyISOChile } from './fechas.js';

const OCUPADA = `(a.bloqueado = 0 AND (a.rut IS NOT NULL OR a.nombre IS NOT NULL))`;

async function porGrupo(db, col, desde, hasta, extra = '') {
  const { results } = await db.prepare(`
    SELECT COALESCE(NULLIF(${col}, ''), '(sin dato)') AS k, COUNT(*) AS n
    FROM agenda a
    ${col.startsWith('e.') ? 'JOIN examinadores e ON e.id = a.examinador_id' : ''}
    ${col.startsWith('f.') ? 'LEFT JOIN funcionarios f ON f.id = a.funcionario_id' : ''}
    WHERE ${OCUPADA} AND a.fecha BETWEEN ? AND ? ${extra}
    GROUP BY k ORDER BY n DESC
  `).bind(desde, hasta).all();
  return results;
}

export async function resumen(db, desde, hasta) {
  desde = desde || '2000-01-01';
  hasta = hasta || '2100-01-01';
  const hoy = hoyISOChile();

  const one = (sql, ...p) => db.prepare(sql).bind(desde, hasta, ...p).first();

  // Las consultas de abajo son todas independientes entre si (ninguna usa el
  // resultado de otra -- disponiblesTot y los porcentajes son calculos locales
  // que se hacen DESPUES de que todo resuelva), asi que se disparan en paralelo
  // con Promise.all en vez de una por una. Promise.all conserva el orden de
  // resultados del array de entrada aunque D1 las resuelva en otro orden.
  const [
    totBloquesRow,
    bloqueadasRow,
    totOcupadasRow,
    conResultadoRow,
    aprobadosRow,
    noAsisteRow,
    reagendadasRow,
    confirmadasRow,
    listaEsperaRow,
    agendadasHoyRow,
    tendenciaRes,
    tendenciaAgendamientoRes,
    porExamResRawRes,
    porResultado,
    porExaminador,
    porClase,
    porFuncionario,
    porTipo,
    porIntento,
  ] = await Promise.all([
    one(`SELECT COUNT(*) n FROM agenda a WHERE a.fecha BETWEEN ? AND ?`),
    one(`SELECT COUNT(*) n FROM agenda a WHERE a.bloqueado = 1 AND a.fecha BETWEEN ? AND ?`),
    one(`SELECT COUNT(*) n FROM agenda a WHERE ${OCUPADA} AND a.fecha BETWEEN ? AND ?`),
    one(`SELECT COUNT(*) n FROM agenda a WHERE ${OCUPADA} AND a.resultado IS NOT NULL AND a.fecha BETWEEN ? AND ?`),
    one(`SELECT COUNT(*) n FROM agenda a WHERE ${OCUPADA} AND a.resultado = 'APROBADO' AND a.fecha BETWEEN ? AND ?`),
    one(`SELECT COUNT(*) n FROM agenda a WHERE ${OCUPADA} AND a.resultado IN ('NO ASISTIO','REPROBADO INASISTENCIA') AND a.fecha BETWEEN ? AND ?`),
    one(`SELECT COUNT(*) n FROM agenda a WHERE a.tipo_cita = 'REAGENDADO' AND a.fecha BETWEEN ? AND ?`),
    one(`SELECT COUNT(*) n FROM agenda a WHERE a.confirmo_asistencia = 1 AND a.fecha BETWEEN ? AND ?`),
    one(`SELECT COUNT(*) n FROM agenda a WHERE a.lista_espera = 'SI' AND a.fecha BETWEEN ? AND ?`),
    db.prepare(`SELECT COUNT(*) n FROM agenda WHERE substr(agendado_en,1,10) = ?`).bind(hoy).first(),
    db.prepare(`
      SELECT a.fecha AS dia, COUNT(*) AS n
      FROM agenda a WHERE ${OCUPADA} AND a.fecha BETWEEN ? AND ?
      GROUP BY a.fecha ORDER BY a.fecha
    `).bind(desde, hasta).all(),
    // Citas segun el dia en que se AGENDARON (equivale a la hoja "AGENDADOS AL DIA" del
    // Excel). Para citas migradas el dato es aproximado (se asumio la fecha de la cita).
    db.prepare(`
      SELECT substr(a.agendado_en, 1, 10) AS dia, COUNT(*) AS n
      FROM agenda a
      WHERE a.agendado_en IS NOT NULL AND substr(a.agendado_en, 1, 10) BETWEEN ? AND ?
      GROUP BY dia ORDER BY dia
    `).bind(desde, hasta).all(),
    // Resultados por examinador: cuantos aprueba, reprueba y no asisten con cada uno.
    db.prepare(`
      SELECT e.nombre AS examinador,
        SUM(CASE WHEN a.resultado = 'APROBADO' THEN 1 ELSE 0 END) AS aprobados,
        SUM(CASE WHEN a.resultado = 'REPROBADO' THEN 1 ELSE 0 END) AS reprobados,
        SUM(CASE WHEN a.resultado IN ('NO ASISTIO','REPROBADO INASISTENCIA') THEN 1 ELSE 0 END) AS no_asistio,
        SUM(CASE WHEN a.resultado IS NOT NULL THEN 1 ELSE 0 END) AS con_resultado
      FROM agenda a JOIN examinadores e ON e.id = a.examinador_id
      WHERE ${OCUPADA} AND a.fecha BETWEEN ? AND ?
      GROUP BY e.nombre ORDER BY e.nombre
    `).bind(desde, hasta).all(),
    porGrupo(db, 'a.resultado', desde, hasta, `AND a.resultado IS NOT NULL`),
    porGrupo(db, 'e.nombre', desde, hasta),
    porGrupo(db, 'a.clase', desde, hasta),
    porGrupo(db, 'f.nombre', desde, hasta),
    porGrupo(db, 'a.tipo_cita', desde, hasta, `AND a.tipo_cita IS NOT NULL`),
    porGrupo(db, 'a.intento', desde, hasta, `AND a.intento IS NOT NULL`),
  ]);

  const totBloques = totBloquesRow.n;
  const bloqueadas = bloqueadasRow.n;
  const disponiblesTot = totBloques - bloqueadas;
  const totOcupadas = totOcupadasRow.n;
  const conResultado = conResultadoRow.n;
  const aprobados = aprobadosRow.n;
  const noAsiste = noAsisteRow.n;
  const reagendadas = reagendadasRow.n;
  const confirmadas = confirmadasRow.n;
  const listaEspera = listaEsperaRow.n;
  const agendadasHoy = agendadasHoyRow.n;
  const tendencia = tendenciaRes.results;
  const tendenciaAgendamiento = tendenciaAgendamientoRes.results;
  const porExamResRaw = porExamResRawRes.results;
  const porExamRes = porExamResRaw.map((r) => ({
    ...r,
    aprobacion: r.con_resultado ? +(r.aprobados / r.con_resultado * 100).toFixed(1) : 0,
    reprobacion: r.con_resultado ? +((r.reprobados + r.no_asistio) / r.con_resultado * 100).toFixed(1) : 0,
  }));

  return {
    rango: [desde === '2000-01-01' ? null : desde, hasta === '2100-01-01' ? null : hasta],
    kpis: {
      bloques: totBloques,
      bloqueadas,
      ocupadas: totOcupadas,
      ocupacion: disponiblesTot ? +(totOcupadas / disponiblesTot * 100).toFixed(1) : 0,
      con_resultado: conResultado,
      aprobados,
      aprobacion: conResultado ? +(aprobados / conResultado * 100).toFixed(1) : 0,
      inasistencia: conResultado ? +(noAsiste / conResultado * 100).toFixed(1) : 0,
      reagendadas,
      tasa_reagendamiento: totOcupadas ? +(reagendadas / totOcupadas * 100).toFixed(1) : 0,
      confirmadas,
      lista_espera: listaEspera,
      agendadas_hoy: agendadasHoy,
    },
    por_resultado: porResultado,
    por_examinador: porExaminador,
    por_examinador_resultado: porExamRes,
    por_clase: porClase,
    por_funcionario: porFuncionario,
    por_tipo: porTipo,
    por_intento: porIntento,
    tendencia,
    tendencia_agendamiento: tendenciaAgendamiento,
  };
}
