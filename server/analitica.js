'use strict';
const { db } = require('./db');
const { hoyISO } = require('./fechas');

const OCUPADA = `(a.bloqueado = 0 AND (a.rut IS NOT NULL OR a.nombre IS NOT NULL))`;

function porGrupo(col, desde, hasta, extra = '') {
  return db.prepare(`
    SELECT COALESCE(NULLIF(${col}, ''), '(sin dato)') AS k, COUNT(*) AS n
    FROM agenda a
    ${col.startsWith('e.') ? 'JOIN examinadores e ON e.id = a.examinador_id' : ''}
    ${col.startsWith('f.') ? 'LEFT JOIN funcionarios f ON f.id = a.funcionario_id' : ''}
    WHERE ${OCUPADA} AND a.fecha BETWEEN ? AND ? ${extra}
    GROUP BY k ORDER BY n DESC
  `).all(desde, hasta);
}

function resumen(desde, hasta) {
  desde = desde || '2000-01-01';
  hasta = hasta || '2100-01-01';
  const hoy = hoyISO();

  const one = (sql, ...p) => db.prepare(sql).get(desde, hasta, ...p);

  const totBloques = one(`SELECT COUNT(*) n FROM agenda a WHERE a.fecha BETWEEN ? AND ?`).n;
  const bloqueadas = one(`SELECT COUNT(*) n FROM agenda a WHERE a.bloqueado = 1 AND a.fecha BETWEEN ? AND ?`).n;
  const disponiblesTot = totBloques - bloqueadas;
  const totOcupadas = one(`SELECT COUNT(*) n FROM agenda a WHERE ${OCUPADA} AND a.fecha BETWEEN ? AND ?`).n;
  const conResultado = one(`SELECT COUNT(*) n FROM agenda a WHERE ${OCUPADA} AND a.resultado IS NOT NULL AND a.fecha BETWEEN ? AND ?`).n;
  const aprobados = one(`SELECT COUNT(*) n FROM agenda a WHERE ${OCUPADA} AND a.resultado = 'APROBADO' AND a.fecha BETWEEN ? AND ?`).n;
  const noAsiste = one(`SELECT COUNT(*) n FROM agenda a WHERE ${OCUPADA} AND a.resultado IN ('NO ASISTIO','REPROBADO INASISTENCIA') AND a.fecha BETWEEN ? AND ?`).n;
  const reagendadas = one(`SELECT COUNT(*) n FROM agenda a WHERE a.tipo_cita = 'REAGENDADO' AND a.fecha BETWEEN ? AND ?`).n;
  const confirmadas = one(`SELECT COUNT(*) n FROM agenda a WHERE a.confirmo_asistencia = 1 AND a.fecha BETWEEN ? AND ?`).n;
  const listaEspera = one(`SELECT COUNT(*) n FROM agenda a WHERE a.lista_espera = 'SI' AND a.fecha BETWEEN ? AND ?`).n;
  const agendadasHoy = db.prepare(`SELECT COUNT(*) n FROM agenda WHERE substr(agendado_en,1,10) = ?`).get(hoy).n;

  const tendencia = db.prepare(`
    SELECT a.fecha AS dia, COUNT(*) AS n
    FROM agenda a WHERE ${OCUPADA} AND a.fecha BETWEEN ? AND ?
    GROUP BY a.fecha ORDER BY a.fecha
  `).all(desde, hasta);

  // Citas segun el dia en que se AGENDARON (equivale a la hoja "AGENDADOS AL DIA" del Excel).
  // Para citas migradas el dato es aproximado (se asumio la fecha de la cita).
  const tendenciaAgendamiento = db.prepare(`
    SELECT substr(a.agendado_en, 1, 10) AS dia, COUNT(*) AS n
    FROM agenda a
    WHERE a.agendado_en IS NOT NULL AND substr(a.agendado_en, 1, 10) BETWEEN ? AND ?
    GROUP BY dia ORDER BY dia
  `).all(desde, hasta);

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
    por_resultado: porGrupo('a.resultado', desde, hasta, `AND a.resultado IS NOT NULL`),
    por_examinador: porGrupo('e.nombre', desde, hasta),
    por_clase: porGrupo('a.clase', desde, hasta),
    por_funcionario: porGrupo('f.nombre', desde, hasta),
    por_tipo: porGrupo('a.tipo_cita', desde, hasta, `AND a.tipo_cita IS NOT NULL`),
    por_intento: porGrupo('a.intento', desde, hasta, `AND a.intento IS NOT NULL`),
    tendencia,
    tendencia_agendamiento: tendenciaAgendamiento,
  };
}

module.exports = { resumen };
