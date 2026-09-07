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
const { generarXlsx, generarXlsxOriginal } = require('./export');
const { importar } = require('./migrate');
const backupMod = require('./backup');
const { hoyISO } = require('./fechas');
const feriados = require('./feriados');
const papelera = require('./papelera');
const auth = require('./auth');
const rut = require('./rut');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use(auth.middleware);
app.use(express.static(path.join(RAIZ, 'public'), {
  etag: true,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
const subir = multer({ dest: path.join(os.tmpdir(), 'agenda-uploads'), limits: { fileSize: 25 * 1024 * 1024 } });

// ---------- login (antes del guard) ----------
app.post('/api/login', (req, res) => auth.login(req, res));
app.get('/api/sesion', (req, res) => auth.sesion(req, res));
app.post('/api/logout', (req, res) => auth.logout(req, res));

app.use(auth.guard);

const wrap = (fn) => (req, res, next) => {
  try { fn(req, res, next); }
  catch (e) { next(e); }
};
function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const actorDe = (req) => auth.actor(req);
const logReq = (req, id, accion, detalle) => log(id, accion, detalle, actorDe(req));

// ---------- catalogos ----------
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
    usuario: actorDe(req),
    examinadores: db.prepare('SELECT id, nombre, activo FROM examinadores ORDER BY nombre').all(),
    funcionarios: db.prepare('SELECT id, nombre, activo FROM funcionarios ORDER BY nombre').all(),
    catalogos: {
      clase: catalogo('clase'),
      tipo_cita: catalogo('tipo_cita'),
      resultado: catalogo('resultado'),
      intento: catalogo('intento'),
      lista_espera: catalogo('lista_espera'),
    },
    feriados: feriados.listar(),
    rango_agenda: db.prepare('SELECT MIN(fecha) desde, MAX(fecha) hasta FROM agenda').get(),
  });
}));

// ---------- AGENDA ----------
const SELECT_BLOQUE = `
  SELECT a.*, e.nombre AS examinador, f.nombre AS funcionario,
         (a.rut IS NOT NULL OR a.nombre IS NOT NULL) AS ocupada
  FROM agenda a
  JOIN examinadores e ON e.id = a.examinador_id
  LEFT JOIN funcionarios f ON f.id = a.funcionario_id
`;
const traer = (id) => db.prepare(`${SELECT_BLOQUE} WHERE a.id = ?`).get(Number(id));

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
  if (estado === 'pendiente') cond.push('a.pendiente_reagendar = 1');
  if (estado === 'porconfirmar') cond.push("(a.rut IS NOT NULL OR a.nombre IS NOT NULL) AND a.bloqueado = 0 AND (a.confirmo_asistencia IS NULL) AND a.fecha >= date('now','localtime')");
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const rows = db.prepare(`${SELECT_BLOQUE} ${where} ORDER BY a.fecha, a.hora, e.nombre LIMIT 6000`).all(...p);
  res.json(rows);
}));

app.get('/api/agenda/:id', wrap((req, res) => {
  const row = traer(req.params.id);
  if (!row) throw bad('Bloque no encontrado', 404);
  res.json(row);
}));

app.post('/api/agenda/generar', wrap((req, res) => {
  const { desde, hasta } = req.body || {};
  if (!desde || !hasta) throw bad('Indica desde y hasta (YYYY-MM-DD)');
  const r = generar(desde, hasta);
  logReq(req, null, 'generar', `${desde}..${hasta}: ${r.creados}`);
  res.json(r);
}));

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

  // Bloqueo optimista: el cliente manda el actualizado_en que vio.
  if (body.visto_en && bloque.actualizado_en && body.visto_en !== bloque.actualizado_en) {
    const e = bad('Otra persona modifico este bloque mientras lo editabas. Se recargaron los datos.', 409);
    e.bloque = traer(id);
    throw e;
  }

  // --- Bloqueo administrativo ---
  if (body.bloqueado) {
    papelera.guardar(bloque, 'bloquear', actorDe(req));
    const motivo = String(body.bloqueo_motivo || 'BLOQUEADO').trim().toUpperCase();
    db.prepare(`
      UPDATE agenda SET bloqueado = 1, bloqueo_motivo = @motivo,
        rut=NULL, nombre=NULL, clase=NULL, contacto=NULL, correo=NULL, tipo_cita=NULL,
        motivo_reagendamiento=NULL, lista_espera=NULL, intento=NULL, funcionario_id=NULL,
        fecha_inicio_tramite=NULL, confirmo_asistencia=NULL, resultado=NULL,
        pendiente_reagendar=0, pendiente_nota=NULL,
        comentarios=@com, agendado_en=NULL, actualizado_en=datetime('now','localtime')
      WHERE id = @id
    `).run({ id, motivo, com: body.comentarios ? String(body.comentarios).trim() : null });
    logReq(req, id, 'bloquear', `${bloque.fecha} ${bloque.hora} (${motivo})`);
    return res.json({ ok: true, avisos: [], bloque: traer(id) });
  }

  const { avisos, rutFmt, clase } = validarBloque(body, bloque);

  let funcionario_id = body.funcionario_id ? Number(body.funcionario_id) : null;
  if (!funcionario_id && body.funcionario_nombre) funcionario_id = upsertFuncionario(String(body.funcionario_nombre).trim().toUpperCase());

  const nombre = body.nombre ? String(body.nombre).trim().replace(/\s+/g, ' ') : null;
  const estabaOcupada = Boolean(bloque.rut || bloque.nombre);
  const quedaOcupada = Boolean(rutFmt || nombre);

  // Si se va a pisar una cita distinta, guardar la anterior en papelera.
  if (estabaOcupada && (bloque.rut !== rutFmt || (bloque.nombre || '') !== (nombre || ''))) {
    papelera.guardar(bloque, 'sobrescribir', actorDe(req));
  }

  let confirmo = bloque.confirmo_asistencia;
  if (body.confirmo_asistencia === true || body.confirmo_asistencia === 1) confirmo = 1;
  else if (body.confirmo_asistencia === false || body.confirmo_asistencia === 0) confirmo = 0;
  else if (body.confirmo_asistencia === null || body.confirmo_asistencia === '') confirmo = null;

  const pendiente = body.pendiente_reagendar ? 1 : 0;

  db.prepare(`
    UPDATE agenda SET
      bloqueado = 0, bloqueo_motivo = NULL,
      rut = @rut, nombre = @nombre, clase = @clase, contacto = @contacto, correo = @correo,
      tipo_cita = @tipo_cita, motivo_reagendamiento = @motivo_reagendamiento,
      lista_espera = @lista_espera, intento = @intento, funcionario_id = @funcionario_id,
      fecha_inicio_tramite = @fecha_inicio_tramite, confirmo_asistencia = @confirmo_asistencia,
      resultado = @resultado, comentarios = @comentarios,
      pendiente_reagendar = @pendiente, pendiente_nota = @pnota,
      agendado_en = CASE WHEN @quedaOcupada = 1 THEN COALESCE(agendado_en, @agendado_en) ELSE NULL END,
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
    pendiente,
    pnota: pendiente && body.pendiente_nota ? String(body.pendiente_nota).trim() : null,
    quedaOcupada: quedaOcupada ? 1 : 0,
    agendado_en: `${hoyISO()} ${new Date().toTimeString().slice(0, 8)}`,
  });

  const accion = !estabaOcupada && quedaOcupada ? 'agendar'
    : estabaOcupada && !quedaOcupada ? 'liberar' : 'editar';
  logReq(req, id, accion, `${bloque.fecha} ${bloque.hora} ${nombre || bloque.nombre || ''}`);
  res.json({ ok: true, avisos, bloque: traer(id) });
}));

const LIMPIAR_SQL = `
  rut=NULL, nombre=NULL, clase=NULL, contacto=NULL, correo=NULL, tipo_cita=NULL,
  motivo_reagendamiento=NULL, lista_espera=NULL, intento=NULL, funcionario_id=NULL,
  fecha_inicio_tramite=NULL, confirmo_asistencia=NULL, resultado=NULL, comentarios=NULL,
  bloqueado=0, bloqueo_motivo=NULL, pendiente_reagendar=0, pendiente_nota=NULL,
  agendado_en=NULL, actualizado_en=datetime('now','localtime')`;

app.post('/api/agenda/:id/liberar', wrap((req, res) => {
  const id = Number(req.params.id);
  const bloque = db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
  if (!bloque) throw bad('Bloque no encontrado', 404);
  papelera.guardar(bloque, 'liberar', actorDe(req));
  db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL} WHERE id = ?`).run(id);
  logReq(req, id, 'liberar', `${bloque.fecha} ${bloque.hora} ${bloque.nombre || bloque.bloqueo_motivo || ''}`);
  res.json({ ok: true });
}));

app.post('/api/agenda/:id/pendiente', wrap((req, res) => {
  const id = Number(req.params.id);
  const bloque = db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
  if (!bloque) throw bad('Bloque no encontrado', 404);
  if (!(bloque.rut || bloque.nombre)) throw bad('El bloque no tiene una cita.');
  const valor = req.body && req.body.valor === false ? 0 : 1;
  db.prepare('UPDATE agenda SET pendiente_reagendar = ?, pendiente_nota = ?, actualizado_en = datetime(\'now\',\'localtime\') WHERE id = ?')
    .run(valor, valor && req.body && req.body.nota ? String(req.body.nota).trim() : null, id);
  logReq(req, id, 'editar', `pendiente reagendar = ${valor}`);
  res.json({ ok: true, bloque: traer(id) });
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
        confirmo_asistencia=NULL, resultado=NULL, pendiente_reagendar=0, pendiente_nota=NULL,
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
    db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL.replace('comentarios=NULL', 'comentarios=@c')} WHERE id=@id`)
      .run({ id: origen.id, c: `Reagendada a ${destino.fecha} ${destino.hora} (${motivo || 'sin motivo'})` });
  });
  logReq(req, origen.id, 'reagendar', `${origen.fecha} ${origen.hora} -> ${destino.fecha} ${destino.hora}`);
  res.json({ ok: true, destino: traer(destino.id) });
}));

// ---------- BLOQUEAR / DESBLOQUEAR DIA ----------
app.post('/api/bloquear-dia', wrap((req, res) => {
  const { fecha, examinador_id, motivo, incluir_ocupados } = req.body || {};
  if (!fecha) throw bad('Indica la fecha');
  const cond = ['fecha = ?', 'bloqueado = 0'];
  const p = [fecha];
  if (examinador_id) { cond.push('examinador_id = ?'); p.push(Number(examinador_id)); }
  if (!incluir_ocupados) cond.push('rut IS NULL AND nombre IS NULL');
  const m = String(motivo || 'BLOQUEADO').trim().toUpperCase();
  const objetivo = db.prepare(`SELECT * FROM agenda WHERE ${cond.join(' AND ')}`).all(...p);
  tx(() => {
    for (const b of objetivo) {
      if (b.rut || b.nombre) papelera.guardar(b, 'bloquear-dia', actorDe(req));
      db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL.replace('bloqueado=0, bloqueo_motivo=NULL', 'bloqueado=1, bloqueo_motivo=@m')} WHERE id=@id`)
        .run({ id: b.id, m });
    }
  });
  logReq(req, null, 'bloquear', `dia ${fecha} ${examinador_id ? 'exam ' + examinador_id : 'todos'}: ${objetivo.length} bloques (${m})`);
  res.json({ ok: true, bloqueados: objetivo.length });
}));

app.post('/api/desbloquear-dia', wrap((req, res) => {
  const { fecha, examinador_id } = req.body || {};
  if (!fecha) throw bad('Indica la fecha');
  const cond = ['fecha = ?', 'bloqueado = 1'];
  const p = [fecha];
  if (examinador_id) { cond.push('examinador_id = ?'); p.push(Number(examinador_id)); }
  const r = db.prepare(`UPDATE agenda SET bloqueado=0, bloqueo_motivo=NULL, actualizado_en=datetime('now','localtime') WHERE ${cond.join(' AND ')}`).run(...p);
  logReq(req, null, 'editar', `desbloquear dia ${fecha}: ${r.changes}`);
  res.json({ ok: true, desbloqueados: Number(r.changes) });
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
  const rows = db.prepare(`${SELECT_BLOQUE} WHERE ${cond.join(' AND ')} ORDER BY a.fecha, a.hora, e.nombre LIMIT 3000`).all(...p);
  res.json(rows.map((r) => ({
    ...r,
    apto_pesada: r.hora === HORA_D_A5,
    regla: r.hora === HORA_D_A5 ? 'IDEAL para D y A5 (tambien B, C, profesionales)' : 'B, C, A1-A4 (PROHIBIDO D y A5)',
  })));
}));

// ---------- BUSCAR / HISTORIAL ----------
app.get('/api/buscar', wrap((req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json([]);
  const like = `%${q}%`;
  const rutLimpio = `%${rut.limpiar(q)}%`;
  const rows = db.prepare(`
    ${SELECT_BLOQUE}
    WHERE (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
      AND (REPLACE(REPLACE(a.rut,'.',''),'-','') LIKE ? OR UPPER(a.nombre) LIKE UPPER(?) OR a.contacto LIKE ?)
    ORDER BY a.fecha DESC, a.hora LIMIT 100
  `).all(rutLimpio, like, like);
  res.json(rows);
}));

app.get('/api/historial', wrap((req, res) => {
  const r = rut.limpiar(req.query.rut || '');
  if (r.length < 2) return res.json([]);
  const rows = db.prepare(`
    ${SELECT_BLOQUE}
    WHERE REPLACE(REPLACE(a.rut,'.',''),'-','') = ?
    ORDER BY a.fecha, a.hora
  `).all(r);
  res.json(rows);
}));

// ---------- DIA / IMPRESION ----------
app.get('/api/dia', wrap((req, res) => {
  const fecha = req.query.fecha || hoyISO();
  const rows = db.prepare(`${SELECT_BLOQUE} WHERE a.fecha = ? ORDER BY e.nombre, a.hora`).all(fecha);
  const porExaminador = {};
  for (const r of rows) (porExaminador[r.examinador] ||= []).push(r);
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
  db.prepare('UPDATE catalogos SET activo = 0 WHERE tipo = ? AND valor = ?').run(req.query.tipo, req.query.valor);
  res.json({ ok: true });
}));

// ---------- FERIADOS ----------
app.get('/api/feriados', wrap((req, res) => res.json(feriados.listar())));
app.post('/api/feriados', wrap((req, res) => {
  const { fecha, nombre } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) throw bad('Fecha invalida (YYYY-MM-DD)');
  feriados.agregar(fecha, nombre);
  logReq(req, null, 'editar', `feriado + ${fecha}`);
  res.json({ ok: true });
}));
app.delete('/api/feriados', wrap((req, res) => {
  feriados.quitar(req.query.fecha);
  logReq(req, null, 'editar', `feriado - ${req.query.fecha}`);
  res.json({ ok: true });
}));

// ---------- EXAMINADORES / FUNCIONARIOS ----------
app.post('/api/examinadores', wrap((req, res) => {
  res.json({ ok: true, id: upsertExaminador(String((req.body || {}).nombre || '').trim().toUpperCase()) });
}));
app.put('/api/examinadores/:id', wrap((req, res) => {
  const { nombre, activo } = req.body || {};
  db.prepare('UPDATE examinadores SET nombre = COALESCE(?, nombre), activo = COALESCE(?, activo) WHERE id = ?')
    .run(nombre ? nombre.toUpperCase() : null, activo == null ? null : (activo ? 1 : 0), Number(req.params.id));
  res.json({ ok: true });
}));
app.post('/api/funcionarios', wrap((req, res) => {
  res.json({ ok: true, id: upsertFuncionario(String((req.body || {}).nombre || '').trim().toUpperCase()) });
}));
app.put('/api/funcionarios/:id', wrap((req, res) => {
  const { nombre, activo } = req.body || {};
  db.prepare('UPDATE funcionarios SET nombre = COALESCE(?, nombre), activo = COALESCE(?, activo) WHERE id = ?')
    .run(nombre ? nombre.toUpperCase() : null, activo == null ? null : (activo ? 1 : 0), Number(req.params.id));
  res.json({ ok: true });
}));

// ---------- PAPELERA ----------
app.get('/api/papelera', wrap((req, res) => res.json(papelera.listar(80))));
app.post('/api/papelera/:id/restaurar', wrap((req, res) => {
  const b = papelera.restaurar(Number(req.params.id));
  logReq(req, b.id, 'editar', `restaurado desde papelera: ${b.fecha} ${b.hora}`);
  res.json({ ok: true, bloque: traer(b.id) });
}));

// ---------- IMPORT / EXPORT / BACKUP ----------
app.post('/api/import', subir.single('archivo'), wrap((req, res) => {
  if (!req.file) throw bad('Sube un archivo .xlsx en el campo "archivo"');
  const limpiar = String(req.body.limpiar) === 'true' || req.body.limpiar === '1';
  try {
    if (!limpiar) backupMod.backup('pre-import');
    const r = importar(req.file.path, { limpiar });
    logReq(req, null, 'importar', JSON.stringify(r));
    res.json({ ok: true, resumen: r });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
}));

app.get('/api/export', wrap((req, res) => {
  const original = req.query.formato === 'original';
  const buf = original ? generarXlsxOriginal() : generarXlsx();
  res.setHeader('Content-Disposition', `attachment; filename="agenda-practicos${original ? '-formato-excel' : ''}-${hoyISO()}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}));

app.post('/api/backup', wrap((req, res) => res.json({ ok: true, archivo: backupMod.backup('manual') })));

app.get('/api/movimientos', wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM movimientos ORDER BY id DESC LIMIT 300').all());
}));

// ---------- errores ----------
app.use((err, req, res, next) => {
  if (!err.status || err.status >= 500) console.error(err);
  const cuerpo = { error: err.message || 'Error interno' };
  if (err.bloque) cuerpo.bloque = err.bloque;
  if (err.login) cuerpo.login = true;
  res.status(err.status || 400).json(cuerpo);
});

app.listen(PUERTO, () => {
  console.log(`\n  Agenda de Practicos  ->  http://localhost:${PUERTO}`);
  console.log(auth.SIN_LOGIN ? '  (modo sin login)\n' : '  (login con PIN)\n');
  const n = db.prepare('SELECT COUNT(*) n FROM agenda').get().n;
  if (!n) console.log('  Base vacia. Importa el Excel desde "Datos" o corre: npm run migrar\n');
  backupMod.programar();
});
