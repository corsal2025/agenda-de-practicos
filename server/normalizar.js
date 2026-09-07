'use strict';
const { CATALOGOS } = require('./config');
const rut = require('./rut');

const s = (v) => (v == null ? '' : String(v)).trim();
const up = (v) => s(v).toUpperCase().replace(/\s+/g, ' ');

// --- Funcionarios: correige typos vistos en el Excel de origen ---
const MAP_FUNCIONARIO = {
  'CAROLINA CUADRO': 'CAROLINA CUADRA',
  'CAROLINA CUADRA': 'CAROLINA CUADRA',
  'JARED LOPEZ': 'JARED LOPEZ',
  'SUSANA CAMPANA': 'SUSANA CAMPANA',
  'SUSANA CAMPAÑA': 'SUSANA CAMPANA',
  'MATIAS': 'MATIAS BOZZO',
  'MATÍAS': 'MATIAS BOZZO',
  'MATIAS BOZZO': 'MATIAS BOZZO',
  'MATÍAS BOZZO': 'MATIAS BOZZO',
};
function funcionario(v) {
  const k = up(v).replace(/[ÁÀ]/g, 'A').replace(/[ÉÈ]/g, 'E').replace(/[ÍÌ]/g, 'I')
    .replace(/[ÓÒ]/g, 'O').replace(/[ÚÙ]/g, 'U');
  if (!k) return null;
  return MAP_FUNCIONARIO[k] || up(v);
}

const MAP_EXAMINADOR = {
  'DANIEL LAGOS': 'DANIEL LAGOS',
  'DOMINGO NAVARRO': 'DOMINGO NAVARRO',
  'LUIS FERNANDEZ': 'LUIS FERNANDEZ',
  'LUIS FERNÁNDEZ': 'LUIS FERNANDEZ',
};
function examinador(v) {
  const k = up(v).replace(/Á/g, 'A').replace(/É/g, 'E').replace(/Í/g, 'I').replace(/Ó/g, 'O').replace(/Ú/g, 'U');
  return MAP_EXAMINADOR[k] || (k || null);
}

// --- Clase: extrae la clase canonica y devuelve tambien una nota si venia sucia ---
function clase(v) {
  const t = up(v);
  if (!t) return { valor: null, nota: null };
  const validas = CATALOGOS.clase;
  if (validas.includes(t)) return { valor: t, nota: null };
  const m = t.match(/A[1-5]|[BCDE]/);
  if (m) {
    const nota = t !== m[0] ? `Clase original: "${s(v)}"` : null;
    return { valor: m[0], nota };
  }
  return { valor: null, nota: `Clase no reconocida: "${s(v)}"` };
}

const MAP_RESULTADO = {
  'APROBADO': 'APROBADO',
  'REPROBADO': 'REPROBADO',
  'REPROBADO INASISTENCIA': 'REPROBADO INASISTENCIA',
  'NO ASISTIO': 'NO ASISTIO',
  'NO ASISTIÓ': 'NO ASISTIO',
};
function resultado(v) {
  const t = up(v).replace(/Ó/g, 'O');
  if (!t) return { valor: null, nota: null };
  if (MAP_RESULTADO[t]) return { valor: MAP_RESULTADO[t], nota: null };
  // texto libre ("luces", "reagenda", "documentacion"...) -> se mueve a comentarios
  return { valor: null, nota: `Resultado original: "${s(v)}"` };
}

function tipoCita(v) {
  const t = up(v).replace(/Ó/g, 'O');
  if (!t) return null;
  if (t.startsWith('NORMAL')) return 'NORMAL';
  if (t.startsWith('REAGEND')) return 'REAGENDADO';
  if (t.includes('TERRENO') || t.includes('TRASLADO')) return 'TRASLADO EN TERRENO';
  return t;
}

function intento(v) {
  const t = up(v);
  if (!t) return null;
  if (t.includes('1')) return '1° VEZ';
  if (t.includes('2')) return '2° VEZ';
  if (t.includes('TERRENO') || t.includes('TRASLADO')) return { mover_a_tipo: 'TRASLADO EN TERRENO' };
  return null;
}

function listaEspera(v) {
  const t = up(v);
  if (t === 'SI' || t === 'SÍ') return 'SI';
  if (t === 'NO') return 'NO';
  return null;
}

function siNoBool(v) {
  if (v === true || v === 1) return 1;
  if (v === false || v === 0) return 0;
  const t = up(v);
  if (t === 'TRUE' || t === 'SI' || t === 'SÍ' || t === 'VERDADERO' || t === '1') return 1;
  if (t === 'FALSE' || t === 'NO' || t === 'FALSO' || t === '0') return 0;
  return null;
}

function correo(v) {
  const t = s(v).toLowerCase();
  return t || null;
}

function contacto(v) {
  if (v == null || v === '') return null;
  return s(v).replace(/\.0$/, '');
}

function nombre(v) {
  const t = s(v).replace(/\s+/g, ' ');
  return t || null;
}

// Detecta si el texto de "nombre" es en realidad un bloqueo administrativo del bloque
// (no un contribuyente). Devuelve el motivo normalizado o null.
const PATRONES_BLOQUEO = [
  /^\[?BLOQUEAD/, /TERRENO/, /^TRASLADO$/, /TRASLADO REGRESO/, /D[IÍ]A ADMINISTRATIVO/, /ADMINISTRATIVO/,
  /FIESTAS PATRIAS/, /FERIADO/, /RESERVAD/, /LICENCIA M[EÉ]DICA/, /VACACIONES/, /CAPACITACI[OÓ]N/,
  /SIN SISTEMA/, /NO AGENDAR/, /PERMISO/, /COMET[IÍ]DO/, /INDUCCI[OÓ]N/, /REUNI[OÓ]N/,
];
function bloqueo(v) {
  const t = up(v);
  if (!t) return null;
  if (!PATRONES_BLOQUEO.some((re) => re.test(t))) return null;
  return s(v).toUpperCase().replace(/^\[BLOQUEADO\]\s*/, '').trim() || 'BLOQUEADO';
}

// RUT: devuelve { valor, nota }. Marcadores tipo "FALTA RUT" -> valor null + nota.
function rutNorm(v) {
  const t = s(v);
  if (!t) return { valor: null, nota: null, invalido: false };
  if (rut.pareceMarcador(t)) return { valor: null, nota: `RUT original: "${t}"`, invalido: false };
  const fmt = rut.formatear(t);
  const ok = rut.esValido(t);
  return { valor: fmt, nota: null, invalido: !ok };
}

module.exports = {
  funcionario, examinador, clase, resultado, tipoCita, intento,
  listaEspera, siNoBool, correo, contacto, nombre, bloqueo, rutNorm, s, up,
};
