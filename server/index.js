'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const express = require('express');
const multer = require('multer');

const { db, tx, upsertFuncionario, upsertExaminador, log } = require('./db');
const { PUERTO, RAIZ, HORAS, HORA_D_A5, CLASES_PESADAS } = require('./config');
const { generar } = require('./slots');
const { reporte } = require('./errores');
const { resumen } = require('./analitica');
const { generarXlsx } = require('./export');
const { importar } = require('./migrate');
const { backup } = require('./backup');
const { hoyISO } = require('./fechas');
const rut = require('./rut');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(RAIZ, 'public'), {
  etag: true,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
const subir = multer({ dest: path.join(os.tmpdir(), 'agenda-uploads') });

const wrap = (fn) => (req, res) => {
  try { fn(req, res); }
  catch (e) { console.error(e); res.status(e.status || 400).json({ error: e.message }); }
};
function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }

// ---------- catalogos helpers ----------
function catalogo(tipo) {
  return db.prepare('SELECT valor FROM catalogos WHERE tipo = ? AND activo = 1 ORDER BY orden, valor')
    .all(tipo).map((r) => r.valor);
}
function enCatalogo(tipo, valor) {
  if (valor == null || valor === '') return true;
  return catalogo(tipo).includes(valor);
}

// ---------- META ----------
app.get('/api/meta', wrap((req, res) => {
  res.json({
    horas: HORAS,
    hora_d_a5: HORA_D_A5,
    clases_pesadas: CLASES_PESADAS,
    hoy: hoyISO(),
    examinadores: db.prepare('SELECT id, nombre, activo FROM examinadores ORDER BY nombre').all(),
    funcionarios: db.prepare('SELECT id, nombre, activo FROM funcionarios ORDER BY nombre').all(),
    catalogos: {
      clase: catalogo('clase'),
      tipo_cita: catalogo('tipo_cita'),
      resultado: catalogo('resultado'),
      intento: catalogo('intento'),
      lista_espera: catalogo('lista_espera'),
    },
    rango_agenda: db.prepare('SELECT MIN(fecha) desde, MAX(fecha) hasta FROM agenda').get(),
  });
}));

// ---------- AGENDA (grilla) ----------
const SELECT_BLOQUE = `
  SELECT a.*, e.nombre AS examinador, f.nombre AS funcionario,
         (a.rut IS NOT NULL OR a.nombre IS NOT NULL) AS ocupada
  FROM agenda a
  JOIN examinadores e ON e.id = a.examinador_id
  LEFT JOIN funcionarios f ON f.id = a.funcionario_id
`;

app.get('/api/agenda', wrap((req, res) => {
  const { fecha, desde, hasta, examinador_id, estado } = req.query;
  const cond = [];
  const p = [];
  if (fecha) { cond.push('a.fecha = ?'); p.push(fecha); }
  if (desde) { cond.push('a.fecha >= ?'); p.push(desde); }
  if (hasta) { cond.push('a.fecha <= ?'); p.push(hasta); }
  if (examinador_id) { cond.push('a.examinador_id = ?'); p.push(Number(examinador_id)); }
  if (estado === 'libre') cond.push('a.rut IS NULL AND a.nombre IS NULL AND a.bloqueado = 0');
  if (estado === 'ocupada') cond.push('(a.rut IS NOT NULL OR a.nombre IS NOT NULL) AND a.bloqueado = 0');
  if (estado === 'bloqueada') cond.push('a.bloqueado = 1');
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const rows = db.prepare(`${SELECT_BLOQUE} ${where} ORDER BY a.fecha, a.hora, e.nombre LIMIT 5000`).all(...p);
  res.json(rows);
}));

app.get('/api/agenda/:id', wrap((req, res) => {
  const row = db.prepare(`${SELECT_BLOQUE} WHERE a.id = ?`).get(Number(req.params.id));
  if (!row) throw bad('Bloque no encontrado', 404);
  res.json(row);
}));

app.post('/api/agenda/generar', wrap((req, res) => {
  const { desde, hasta } = req.body || {};
  if (!desde || !hasta) throw bad('Indica desde y hasta (YYYY-MM-DD)');
  res.json(generar(desde, hasta));
}));

const CAMPOS = [
  'rut', 'nombre', 'clase', 'contacto', 'correo', 'tipo_cita', 'motivo_reagendamiento',
  'lista_espera', 'intento', 'fecha_inicio_tramite', 'confirmo_asistencia', 'resultado', 'comentarios',
];

function validarBloque(body, bloque) {
  const avisos = [];
  const clase = (body.clase || '').toUpperCase().trim() || null;
  if (!enCatalogo('clase', clase)) throw bad(`Clase no valida: ${clase}`);
  if (!enCatalogo('tipo_cita', body.tipo_cita)) throw bad(`Tipo de cita no valido: ${body.tipo_cita}`);
  if (!enCatalogo('resultado', body.resultado)) throw bad(`Resultado no valido: ${body.resultado}`);
  if (!enCatalogo('intento', body.intento)) throw bad(`Intento no valido: ${body.intento}`);
  if (!enCatalogo('lista_espera', body.lista_espera)) throw bad(`Lista de espera no valida: ${body.lista_espera}`);

  if (clase && CLASES_PESADAS.includes(clase) && bloque.hora !== HORA_D_A5 && !body.forzar) {
    throw bad(`La clase ${clase} solo se agenda en el bloque ${HORA_D_A5}. Elige ese horario o marca "forzar".`);
  }

  let rutFmt = null;
  if (body.rut && String(body.rut).trim()) {
    rutFmt = rut.formatear(body.rut);
    if (!rut.esValido(body.rut)) avisos.push(`RUT ${rutFmt} tiene digito verificador invalido.`);
  }
  if (body.tipo_cita === 'REAGENDADO' && !body.motivo_reagendamiento) {
    avisos.push('Cita marcada como REAGENDADO sin motivo de reagendamiento.');
  }
  return { avisos, rutFmt, clase };
}

app.put('/api/agenda/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const bloque = db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
  if (!bloque) throw bad('Bloque no encontrado', 404);
  const body = req.body || {};

  // --- Bloqueo administrativo del bloque (terreno, feriado, dia admin, etc.) ---
  if (body.bloqueado) {
    const motivo = String(body.bloqueo_motivo || 'BLOQUEADO').trim().toUpperCase();
    db.prepare(`
      UPDATE agenda SET bloqueado = 1, bloqueo_motivo = @motivo,
        rut=NULL, nombre=NULL, clase=NULL, contacto=NULL, correo=NULL, tipo_cita=NULL,
        motivo_reagendamiento=NULL, lista_espera=NULL, intento=NULL, funcionario_id=NULL,
        fecha_inicio_tramite=NULL, confirmo_asistencia=NULL, resultado=NULL,
        comentarios=@com, agendado_en=NULL, actualizado_en=datetime('now','localtime')
      WHERE id = @id
    `).run({ id, motivo, com: body.comentarios ? String(body.comentarios).trim() : null });
    log(id, 'editar', `bloqueo: ${bloque.fecha} ${bloque.hora} (${motivo})`);
    return res.json({ ok: true, avisos: [], bloque: db.prepare(`${SELECT_BLOQUE} WHERE a.id = ?`).get(id) });
  }

  const { avisos, rutFmt, clase } = validarBloque(body, bloque);

  let funcionario_id = body.funcionario_id ? Number(body.funcionario_id) : null;
  if (!funcionario_id && body.funcionario_nombre) funcionario_id = upsertFuncionario(String(body.funcionario_nombre).trim().toUpperCase());

  const nombre = body.nombre ? String(body.nombre).trim().replace(/\s+/g, ' ') : null;
  const estabaOcupada = Boolean(bloque.rut || bloque.nombre);
  const quedaOcupada = Boolean(rutFmt || nombre);

  let confirmo = bloque.confirmo_asistencia;
  if (body.confirmo_asistencia === true || body.confirmo_asistencia === 1) confirmo = 1;
  else if (body.confirmo_asistencia === false || body.confirmo_asistencia === 0) confirmo = 0;
  else if (body.confirmo_asistencia === null || body.confirmo_asistencia === '') confirmo = null;

  db.prepare(`
    UPDATE agenda SET
      bloqueado = 0, bloqueo_motivo = NULL,
      rut = @rut, nombre = @nombre, clase = @clase, contacto = @contacto, correo = @correo,
      tipo_cita = @tipo_cita, motivo_reagendamiento = @motivo_reagendamiento,
      lista_espera = @lista_espera, intento = @intento, funcionario_id = @funcionario_id,
      fecha_inicio_tramite = @fecha_inicio_tramite, confirmo_asistencia = @confirmo_asistencia,
      resultado = @resultado, comentarios = @comentarios,
      agendado_en = COALESCE(agendado_en, @agendado_en),
      actualizado_en = datetime('now','localtime')
    WHERE id = @id
  `).run({
    id,
    rut: rutFmt,
    nombre,
    clase,
    contacto: body.contacto ? String(body.contacto).trim() : null,
    correo: body.correo ? String(body.correo).trim().toLowerCase() : null,
    tipo_cita: body.tipo_cita || null,
    motivo_reagendamiento: body.motivo_reagendamiento ? String(body.motivo_reagendamiento).trim() : null,
    lista_espera: body.lista_espera || null,
    intento: body.intento || null,
    funcionario_id,
    fecha_inicio_tramite: body.fecha_inicio_tramite || null,
    confirmo_asistencia: confirmo,
    resultado: body.resultado || null,
    comentarios: body.comentarios ? String(body.comentarios).trim() : null,
    agendado_en: quedaOcupada ? (bloque.agendado_en || `${hoyISO()} ${new Date().toTimeString().slice(0, 8)}`) : null,
  });

  const accion = !estabaOcupada && quedaOcupada ? 'agendar'
    : estabaOcupada && !quedaOcupada ? 'liberar' : 'editar';
  log(id, accion, `${bloque.fecha} ${bloque.hora} ${nombre || bloque.nombre || ''}`);

  res.json({ ok: true, avisos, bloque: db.prepare(`${SELECT_BLOQUE} WHERE a.id = ?`).get(id) });
}));

app.post('/api/agenda/:id/liberar', wrap((req, res) => {
  const id = Number(req.params.id);
  const bloque = db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
  if (!bloque) throw bad('Bloque no encontrado', 404);
  db.prepare(`
    UPDATE agenda SET rut=NULL, nombre=NULL, clase=NULL, contacto=NULL, correo=NULL, tipo_cita=NULL,
      motivo_reagendamiento=NULL, lista_espera=NULL, intento=NULL, funcionario_id=NULL,
      fecha_inicio_tramite=NULL, confirmo_asistencia=NULL, resultado=NULL, comentarios=NULL,
      bloqueado=0, bloqueo_motivo=NULL,
      agendado_en=NULL, actualizado_en=datetime('now','localtime')
    WHERE id = ?
  `).run(id);
  log(id, 'liberar', `${bloque.fecha} ${bloque.hora} ${bloque.nombre || bloque.bloqueo_motivo || ''}`);
  res.json({ ok: true });
}));

app.post('/api/agenda/:id/reagendar', wrap((req, res) => {
  const origenId = Number(req.params.id);
  const { destino_id, motivo } = req.body || {};
  const origen = db.prepare('SELECT * FROM agenda WHERE id = ?').get(origenId);
  const destino = db.prepare('SELECT * FROM agenda WHERE id = ?').get(Number(destino_id));
  if (!origen) throw bad('Cita de origen no encontrada', 404);
  if (!destino) throw bad('Bloque de destino no encontrado', 404);
  if (!(origen.rut || origen.nombre)) throw bad('El bloque de origen no tiene una cita.');
  if (destino.rut || destino.nombre) throw bad('El bloque de destino ya esta ocupado.');
  if (destino.bloqueado) throw bad('El bloque de destino esta bloqueado.');
  if (CLASES_PESADAS.includes((origen.clase || '').toUpperCase()) && destino.hora !== HORA_D_A5) {
    throw bad(`La clase ${origen.clase} solo se agenda en el bloque ${HORA_D_A5}.`);
  }

  tx(() => {
    db.prepare(`
      UPDATE agenda SET rut=@rut, nombre=@nombre, clase=@clase, contacto=@contacto, correo=@correo,
        tipo_cita='REAGENDADO', motivo_reagendamiento=@motivo, lista_espera=@lista_espera,
        intento=@intento, funcionario_id=@funcionario_id, fecha_inicio_tramite=@fit,
        confirmo_asistencia=NULL, resultado=NULL,
        comentarios=@comentarios, agendado_en=COALESCE(agendado_en, datetime('now','localtime')),
        actualizado_en=datetime('now','localtime')
      WHERE id=@id
    `).run({
      id: destino.id, rut: origen.rut, nombre: origen.nombre, clase: origen.clase,
      contacto: origen.contacto, correo: origen.correo,
      motivo: motivo || origen.motivo_reagendamiento || 'Reagendada',
      lista_espera: origen.lista_espera, intento: origen.intento, funcionario_id: origen.funcionario_id,
      fit: origen.fecha_inicio_tramite,
      comentarios: [origen.comentarios, `Reagendada desde ${origen.fecha} ${origen.hora}`].filter(Boolean).join(' | '),
    });
    db.prepare(`
      UPDATE agenda SET rut=NULL, nombre=NULL, clase=NULL, contacto=NULL, correo=NULL, tipo_cita=NULL,
        motivo_reagendamiento=NULL, lista_espera=NULL, intento=NULL, funcionario_id=NULL,
        fecha_inicio_tramite=NULL, confirmo_asistencia=NULL, resultado=NULL,
        comentarios=@c, agendado_en=NULL, actualizado_en=datetime('now','localtime')
      WHERE id=@id
    `).run({ id: origen.id, c: `Reagendada a ${destino.fecha} ${destino.hora} (${motivo || 'sin motivo'})` });
  });
  log(origen.id, 'reagendar', `${origen.fecha} ${origen.hora} -> ${destino.fecha} ${destino.hora}`);
  res.json({ ok: true, destino: db.prepare(`${SELECT_BLOQUE} WHERE a.id = ?`).get(destino.id) });
}));

// ---------- DISPONIBLES ----------
app.get('/api/disponibles', wrap((req, res) => {
  const { desde, hasta, clase, examinador_id } = req.query;
  const cond = ['a.rut IS NULL', 'a.nombre IS NULL', 'a.bloqueado = 0'];
  const p = [];
  if (desde) { cond.push('a.fecha >= ?'); p.push(desde); }
  if (hasta) { cond.push('a.fecha <= ?'); p.push(hasta); }
  if (examinador_id) { cond.push('a.examinador_id = ?'); p.push(Number(examinador_id)); }
  if (clase && CLASES_PESADAS.includes(String(clase).toUpperCase())) { cond.push('a.hora = ?'); p.push(HORA_D_A5); }
  const rows = db.prepare(`${SELECT_BLOQUE} WHERE ${cond.join(' AND ')} ORDER BY a.fecha, a.hora, e.nombre LIMIT 2000`).all(...p);
  res.json(rows.map((r) => ({
    ...r,
    apto_pesada: r.hora === HORA_D_A5,
    regla: r.hora === HORA_D_A5 ? 'IDEAL para D y A5 (tambien B, C, profesionales)' : 'B, C, A1-A4 (PROHIBIDO D y A5)',
  })));
}));

// ---------- BUSCAR ----------
app.get('/api/buscar', wrap((req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json([]);
  const like = `%${q}%`;
  const rows = db.prepare(`
    ${SELECT_BLOQUE}
    WHERE (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
      AND (a.rut LIKE ? OR UPPER(a.nombre) LIKE UPPER(?) OR a.contacto LIKE ?)
    ORDER BY a.fecha DESC, a.hora LIMIT 100
  `).all(like, like, like);
  res.json(rows);
}));

// ---------- DIA / IMPRESION ----------
app.get('/api/dia', wrap((req, res) => {
  const fecha = req.query.fecha || hoyISO();
  const rows = db.prepare(`${SELECT_BLOQUE} WHERE a.fecha = ? ORDER BY e.nombre, a.hora`).all(fecha);
  const porExaminador = {};
  for (const r of rows) {
    (porExaminador[r.examinador] ||= []).push(r);
  }
  res.json({ fecha, examinadores: porExaminador });
}));

// ---------- ERRORES ----------
app.get('/api/errores', wrap((req, res) => res.json(reporte())));

// ---------- ANALITICA ----------
app.get('/api/analitica', wrap((req, res) => res.json(resumen(req.query.desde, req.query.hasta))));

// ---------- CATALOGOS ----------
app.post('/api/catalogos', wrap((req, res) => {
  const { tipo, valor } = req.body || {};
  if (!tipo || !valor) throw bad('Indica tipo y valor');
  const orden = (db.prepare('SELECT COALESCE(MAX(orden),0)+1 n FROM catalogos WHERE tipo=?').get(tipo)).n;
  db.prepare('INSERT OR REPLACE INTO catalogos (tipo, valor, orden, activo) VALUES (?, ?, ?, 1)')
    .run(tipo, String(valor).trim().toUpperCase(), orden);
  res.json({ ok: true });
}));
app.delete('/api/catalogos', wrap((req, res) => {
  const { tipo, valor } = req.query;
  db.prepare('UPDATE catalogos SET activo = 0 WHERE tipo = ? AND valor = ?').run(tipo, valor);
  res.json({ ok: true });
}));

// ---------- EXAMINADORES / FUNCIONARIOS ----------
app.post('/api/examinadores', wrap((req, res) => {
  const id = upsertExaminador(String((req.body || {}).nombre || '').trim().toUpperCase());
  res.json({ ok: true, id });
}));
app.put('/api/examinadores/:id', wrap((req, res) => {
  const { nombre, activo } = req.body || {};
  db.prepare('UPDATE examinadores SET nombre = COALESCE(?, nombre), activo = COALESCE(?, activo) WHERE id = ?')
    .run(nombre ? nombre.toUpperCase() : null, activo == null ? null : (activo ? 1 : 0), Number(req.params.id));
  res.json({ ok: true });
}));
app.post('/api/funcionarios', wrap((req, res) => {
  const id = upsertFuncionario(String((req.body || {}).nombre || '').trim().toUpperCase());
  res.json({ ok: true, id });
}));
app.put('/api/funcionarios/:id', wrap((req, res) => {
  const { nombre, activo } = req.body || {};
  db.prepare('UPDATE funcionarios SET nombre = COALESCE(?, nombre), activo = COALESCE(?, activo) WHERE id = ?')
    .run(nombre ? nombre.toUpperCase() : null, activo == null ? null : (activo ? 1 : 0), Number(req.params.id));
  res.json({ ok: true });
}));

// ---------- IMPORT / EXPORT / BACKUP ----------
app.post('/api/import', subir.single('archivo'), wrap((req, res) => {
  if (!req.file) throw bad('Sube un archivo .xlsx en el campo "archivo"');
  const limpiar = String(req.body.limpiar) === 'true' || req.body.limpiar === '1';
  try {
    if (!limpiar) backup();
    const r = importar(req.file.path, { limpiar });
    res.json({ ok: true, resumen: r });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
}));

app.get('/api/export', wrap((req, res) => {
  const buf = generarXlsx();
  res.setHeader('Content-Disposition', `attachment; filename="agenda-practicos-${hoyISO()}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}));

app.post('/api/backup', wrap((req, res) => res.json({ ok: true, archivo: backup() })));

app.get('/api/movimientos', wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM movimientos ORDER BY id DESC LIMIT 200').all());
}));

// Manejador de errores final (incluye errores de multer).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 400).json({ error: err.message || 'Error interno' });
});

app.listen(PUERTO, () => {
  console.log(`\n  Agenda de Practicos  ->  http://localhost:${PUERTO}\n`);
  const r = db.prepare('SELECT COUNT(*) n FROM agenda').get().n;
  if (!r) console.log('  Base vacia. Importa el Excel desde la pestana "Datos" o corre: npm run migrar\n');
});
