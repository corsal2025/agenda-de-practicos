'use strict';
// Regla de tercer intento: quien reprobo 2 veces una clase (REPROBADO o REPROBADO
// INASISTENCIA; NO ASISTIO no cuenta) no se agenda de nuevo en esa clase sin autorizacion.

const rutMod = require('./rut');

const RESULTADOS_REPROBADOS = ['REPROBADO', 'REPROBADO INASISTENCIA'];
const LIMITE_REPROBADOS = 2;
const MOTIVO_MINIMO = 10;

const clasesDe = (clase) => String(clase || '').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);

// { [clase]: cantidad de reprobados } para un RUT, excluyendo opcionalmente un bloque.
function reprobadosPorClase(db, rut, excluirId) {
  const r = rutMod.limpiar(rut);
  if (r.length < 2) return {};
  const filas = db.prepare(`
    SELECT clase FROM agenda
    WHERE UPPER(REPLACE(REPLACE(REPLACE(rut,'.',''),'-',''),' ','')) = ?
      AND resultado IN (${RESULTADOS_REPROBADOS.map(() => '?').join(',')})
      AND id <> ?
  `).all(r, ...RESULTADOS_REPROBADOS, Number(excluirId) || -1);
  const cuenta = {};
  for (const f of filas) for (const c of clasesDe(f.clase)) cuenta[c] = (cuenta[c] || 0) + 1;
  return cuenta;
}

function bloqueoTercerIntento(db, { rut, clase, excluirId }) {
  const cuenta = reprobadosPorClase(db, rut, excluirId);
  for (const c of clasesDe(clase)) {
    const n = cuenta[c] || 0;
    if (n >= LIMITE_REPROBADOS) {
      return {
        clase: c,
        reprobados: n,
        mensaje: `Tercer intento bloqueado: ${rut} reprobó ${n} veces la clase ${c}. Requiere autorización con motivo.`,
      };
    }
  }
  return null;
}

function compartenClase(claseA, claseB) {
  const listaA = clasesDe(claseA);
  const listaB = clasesDe(claseB);
  if (!listaA.length || !listaB.length) return true; // sin clase explícita se asume conflicto
  const setB = new Set(listaB);
  return listaA.some((c) => setB.has(c));
}

module.exports = { reprobadosPorClase, bloqueoTercerIntento, clasesDe, compartenClase, MOTIVO_MINIMO, LIMITE_REPROBADOS };
