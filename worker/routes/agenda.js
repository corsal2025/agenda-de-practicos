// Rutas de agenda: meta, listar/leer/editar bloques, generar grilla, liberar,
// pendiente, reagendar, bloquear/desbloquear dia, disponibles, buscar,
// historial, dia. Reemplaza el grueso de server/index.js.
//
// Contrato con el frontend (no negociable, ver plan): PUT /api/agenda/:id con
// visto_en desactualizado debe devolver 409 + {error, bloque} (fila fresca).
import { Hono } from 'hono';
import * as auth from '../lib/auth.js';
import { HORAS, HORA_D_A5, CLASES_PESADAS } from '../lib/config.js';
import { hoyISOChile, ahoraChile, mananaISOChile } from '../lib/fechas.js';
import { upsertFuncionario } from '../lib/db.js';
import { generar } from '../lib/slots.js';
import * as feriados from '../lib/feriados.js';
import * as papelera from '../lib/papelera.js';
import { leerRangoBloqueo, filtroBloqueo, MOTIVOS_BLOQUEO } from '../lib/bloqueo.js';
import * as pesada from '../lib/pesada.js';
import * as correo from '../lib/correo.js';
import * as rut from '../lib/rut.js';
import * as telefono from '../lib/telefono.js';
import {
  bad, actorDe, logReq, catalogo, SELECT_BLOQUE, traer,
  LIMPIAR_SQL, LIMPIAR_SQL_BLOQUEAR, LIMPIAR_SQL_REAGENDAR_ORIGEN,
  validarBloque, logoDisponible, exigirCorreo, correoValido,
} from '../lib/comun.js';
import * as cola from '../lib/cola.js';

export const agendaRoutes = new Hono();

// ---------- META ----------
agendaRoutes.get('/meta', async (c) => {
  const db = c.env.DB;
  const sesion = await auth.obtenerSesion(c);
  // Consultas independientes en paralelo: una tras otra sumaban ~9 viajes a D1
  // antes de poder dibujar la primera pantalla.
  const [
    { results: examinadores }, { results: funcionarios },
    clase, tipo_cita, resultado, intento, lista_espera,
    listaFeriados, rango_agenda, logo,
  ] = await Promise.all([
    db.prepare('SELECT id, nombre, activo FROM examinadores ORDER BY nombre').all(),
    db.prepare('SELECT id, nombre, activo, usuario, rol FROM funcionarios ORDER BY nombre').all(),
    catalogo(db, 'clase'), catalogo(db, 'tipo_cita'), catalogo(db, 'resultado'),
    catalogo(db, 'intento'), catalogo(db, 'lista_espera'),
    feriados.listar(db),
    db.prepare('SELECT MIN(fecha) desde, MAX(fecha) hasta FROM agenda').first(),
    logoDisponible(c.env, c.req.url),
  ]);
  return c.json({
    horas: HORAS,
    hora_d_a5: HORA_D_A5,
    clases_pesadas: CLASES_PESADAS,
    motivos_bloqueo: MOTIVOS_BLOQUEO,
    hoy: hoyISOChile(),
    usuario: (sesion && sesion.funcionario) || null,
    rol: (sesion && sesion.rol) || null,
    examinadores,
    funcionarios,
    catalogos: { clase, tipo_cita, resultado, intento, lista_espera },
    feriados: listaFeriados,
    rango_agenda,
    logo,
    organismo: c.env.AGENDA_ORGANISMO || 'Municipalidad de Valparaíso',
    unidad: c.env.AGENDA_UNIDAD || 'Departamento de Licencias de Conducir',
  });
});

// ---------- AGENDA ----------
agendaRoutes.get('/agenda', async (c) => {
  const db = c.env.DB;
  const { fecha, desde, hasta, examinador_id, estado } = c.req.query();
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
  // date('now','localtime') se rompe en silencio bajo D1 (Workers corre en UTC):
  // se reemplaza por el mismo hoyISOChile() que usa el resto de la app.
  if (estado === 'porconfirmar') {
    cond.push('(a.rut IS NOT NULL OR a.nombre IS NOT NULL) AND a.bloqueado = 0 AND (a.confirmo_asistencia IS NULL) AND a.fecha >= ?');
    p.push(hoyISOChile());
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const { results } = await db.prepare(`${SELECT_BLOQUE} ${where} ORDER BY a.fecha, a.hora, e.nombre LIMIT 6000`).bind(...p).all();
  return c.json(results);
});

agendaRoutes.get('/agenda/:id', async (c) => {
  const row = await traer(c.env.DB, c.req.param('id'));
  if (!row) throw bad('Bloque no encontrado', 404);
  return c.json(row);
});

agendaRoutes.post('/agenda/generar', auth.soloAdmin, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const { desde, hasta } = body || {};
  if (!desde || !hasta) throw bad('Indica desde y hasta (YYYY-MM-DD)');
  const r = await generar(db, desde, hasta);
  await logReq(c, db, null, 'generar', `${desde}..${hasta}: ${r.creados}`);
  return c.json(r);
});

agendaRoutes.put('/agenda/:id', async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const bloque = await db.prepare('SELECT * FROM agenda WHERE id = ?').bind(id).first();
  if (!bloque) throw bad('Bloque no encontrado', 404);
  const body = await c.req.json().catch(() => ({}));

  // Bloqueo optimista: el cliente manda el actualizado_en que vio.
  if (body.visto_en && bloque.actualizado_en && body.visto_en !== bloque.actualizado_en) {
    const e = bad('Otra persona modifico este bloque mientras lo editabas. Se recargaron los datos.', 409);
    e.bloque = await traer(db, id);
    throw e;
  }

  const actor = await actorDe(c);
  const ts = ahoraChile();

  // --- Bloqueo administrativo ---
  if (body.bloqueado) {
    await papelera.guardar(db, bloque, 'bloquear', actor);
    const motivo = String(body.bloqueo_motivo || 'BLOQUEADO').trim().toUpperCase();
    // Si el bloque tenia una persona, pasa a la cola de reagendamiento.
    const teniaPersona = Boolean(bloque.rut || bloque.nombre);
    if (teniaPersona) await cola.sentenciaEncolar(db, bloque, motivo, actor).run();
    await db.prepare(`
      UPDATE agenda SET bloqueado = 1, bloqueo_motivo = ?,
        rut=NULL, nombre=NULL, clase=NULL, contacto=NULL, correo=NULL, tipo_cita=NULL,
        motivo_reagendamiento=NULL, lista_espera=NULL, intento=NULL, funcionario_id=NULL,
        fecha_inicio_tramite=NULL, confirmo_asistencia=NULL, resultado=NULL,
        pendiente_reagendar=0, pendiente_nota=NULL,
        comentarios=?, agendado_en=NULL, actualizado_en=?
      WHERE id = ?
    `).bind(motivo, body.comentarios ? String(body.comentarios).trim() : null, ts, id).run();
    if (pesada.esPesadaEnHoraValida(bloque) && (bloque.rut || bloque.nombre)) {
      await pesada.liberar(db, bloque.fecha, bloque.examinador_id);
    }
    await logReq(c, db, id, 'bloquear', `${bloque.fecha} ${bloque.hora} (${motivo})`);
    const avisosBloq = teniaPersona
      ? [`${bloque.nombre || bloque.rut} pasó a la lista de reagendamiento.`] : [];
    return c.json({ ok: true, avisos: avisosBloq, bloque: await traer(db, id) });
  }

  const { avisos, rutFmt, clase } = await validarBloque(db, body, bloque);

  const tel = telefono.normalizar(body.contacto);
  if (!tel.vacio && !tel.valido) {
    throw bad('Teléfono incompleto. Un número chileno tiene 9 dígitos (celular: 9 XXXX XXXX). Se guarda como +56.');
  }

  // Regla principal: dar hora (bloque libre -> ocupado, o cambiar la persona)
  // exige correo valido. Citas antiguas importadas sin correo se pueden seguir
  // editando, pero si se escribe un correo tiene que ser valido.
  const nombreNuevo = body.nombre ? String(body.nombre).trim().replace(/\s+/g, ' ').toUpperCase() : null;
  const personaNueva = Boolean(rutFmt || nombreNuevo)
    && (bloque.rut !== rutFmt || (bloque.nombre || '') !== (nombreNuevo || ''));
  if (personaNueva) exigirCorreo(body.correo);
  else if (body.correo && String(body.correo).trim().toLowerCase() !== (bloque.correo || '') && !correoValido(body.correo)) throw bad(`Correo con formato inválido: ${String(body.correo).trim()}`);

  let funcionario_id = body.funcionario_id ? Number(body.funcionario_id) : null;
  if (!funcionario_id && body.funcionario_nombre) {
    funcionario_id = await upsertFuncionario(db, String(body.funcionario_nombre).trim().toUpperCase());
  }

  const nombre = nombreNuevo;
  const estabaOcupada = Boolean(bloque.rut || bloque.nombre);
  const quedaOcupada = Boolean(rutFmt || nombre);

  // Si se va a pisar una cita distinta, guardar la anterior en papelera.
  if (estabaOcupada && (bloque.rut !== rutFmt || (bloque.nombre || '') !== (nombre || ''))) {
    await papelera.guardar(db, bloque, 'sobrescribir', actor);
  }

  let confirmo = bloque.confirmo_asistencia;
  if (body.confirmo_asistencia === true || body.confirmo_asistencia === 1) confirmo = 1;
  else if (body.confirmo_asistencia === false || body.confirmo_asistencia === 0) confirmo = 0;
  else if (body.confirmo_asistencia === null || body.confirmo_asistencia === '') confirmo = null;

  const pendiente = body.pendiente_reagendar ? 1 : 0;

  await db.prepare(`
    UPDATE agenda SET
      bloqueado = 0, bloqueo_motivo = NULL,
      rut = ?, nombre = ?, clase = ?, contacto = ?, correo = ?,
      tipo_cita = ?, motivo_reagendamiento = ?,
      lista_espera = ?, intento = ?, funcionario_id = ?,
      fecha_inicio_tramite = ?, confirmo_asistencia = ?,
      resultado = ?, comentarios = ?,
      pendiente_reagendar = ?, pendiente_nota = ?,
      agendado_en = CASE WHEN ? = 1 THEN COALESCE(agendado_en, ?) ELSE NULL END,
      actualizado_en = ?
    WHERE id = ?
  `).bind(
    rutFmt,
    nombre,
    clase,
    tel.valor,
    body.correo ? String(body.correo).trim().toLowerCase() : null,
    body.tipo_cita || null,
    body.motivo_reagendamiento ? String(body.motivo_reagendamiento).trim() : null,
    body.lista_espera || null,
    body.intento || null,
    funcionario_id,
    body.fecha_inicio_tramite || null,
    confirmo,
    body.resultado || null,
    body.comentarios ? String(body.comentarios).trim() : null,
    pendiente,
    pendiente && body.pendiente_nota ? String(body.pendiente_nota).trim() : null,
    quedaOcupada ? 1 : 0,
    ts,
    ts,
    id,
  ).run();

  const accion = !estabaOcupada && quedaOcupada ? 'agendar'
    : estabaOcupada && !quedaOcupada ? 'liberar' : 'editar';
  await logReq(c, db, id, accion, `${bloque.fecha} ${bloque.hora} ${nombre || bloque.nombre || ''}`);

  // Clase pesada (D/A5) a las 12:30: bloquea/libera automaticamente los
  // bloques siguientes del mismo examinador ese dia.
  const eraPesada = pesada.esPesadaEnHoraValida(bloque) && estabaOcupada;
  const esPesadaAhora = pesada.esPesadaEnHoraValida({ hora: bloque.hora, clase }) && quedaOcupada;
  if (esPesadaAhora && !eraPesada) {
    avisos.push(...await pesada.aplicar(db, bloque.fecha, bloque.examinador_id));
  } else if (eraPesada && !esPesadaAhora) {
    await pesada.liberar(db, bloque.fecha, bloque.examinador_id);
  }

  const bloqueFinal = await traer(db, id);
  if (accion === 'agendar' && bloqueFinal.correo) {
    // Fire-and-forget: un fallo de correo no debe demorar/romper la respuesta.
    c.executionCtx.waitUntil(
      correo.confirmacion(c.env, db, bloqueFinal)
        .then(async (ok) => { if (ok) await db.prepare('UPDATE agenda SET correo_confirmacion_enviado = 1 WHERE id = ?').bind(id).run(); })
        .catch(() => {})
    );
  }

  return c.json({ ok: true, avisos, bloque: bloqueFinal });
});

agendaRoutes.post('/agenda/:id/liberar', async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const bloque = await db.prepare('SELECT * FROM agenda WHERE id = ?').bind(id).first();
  if (!bloque) throw bad('Bloque no encontrado', 404);
  await papelera.guardar(db, bloque, 'liberar', await actorDe(c));
  await db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL} WHERE id = ?`).bind(ahoraChile(), id).run();
  if (pesada.esPesadaEnHoraValida(bloque) && (bloque.rut || bloque.nombre)) {
    await pesada.liberar(db, bloque.fecha, bloque.examinador_id);
  }
  await logReq(c, db, id, 'liberar', `${bloque.fecha} ${bloque.hora} ${bloque.nombre || bloque.bloqueo_motivo || ''}`);
  return c.json({ ok: true });
});

agendaRoutes.post('/agenda/:id/pendiente', async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const bloque = await db.prepare('SELECT * FROM agenda WHERE id = ?').bind(id).first();
  if (!bloque) throw bad('Bloque no encontrado', 404);
  if (!(bloque.rut || bloque.nombre)) throw bad('El bloque no tiene una cita.');
  const body = await c.req.json().catch(() => ({}));
  const valor = body && body.valor === false ? 0 : 1;
  await db.prepare('UPDATE agenda SET pendiente_reagendar = ?, pendiente_nota = ?, actualizado_en = ? WHERE id = ?')
    .bind(valor, valor && body && body.nota ? String(body.nota).trim() : null, ahoraChile(), id).run();
  await logReq(c, db, id, 'editar', `pendiente reagendar = ${valor}`);
  return c.json({ ok: true, bloque: await traer(db, id) });
});

// Marca o borra solo el resultado (botones Aprobó/Reprobó/No asistió de la
// grilla). Un UPDATE directo: no reescribe ni revalida el resto de la cita.
agendaRoutes.post('/agenda/:id/resultado', async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const body = (await c.req.json().catch(() => ({}))) || {};
  const resultado = body.resultado || null;
  if (resultado && !(await catalogo(db, 'resultado')).includes(resultado)) throw bad(`Resultado no valido: ${resultado}`);
  const r = await db.prepare(`UPDATE agenda SET resultado = ?, actualizado_en = ?
    WHERE id = ? AND (rut IS NOT NULL OR nombre IS NOT NULL) AND bloqueado = 0`)
    .bind(resultado, ahoraChile(), id).run();
  if (!r.meta.changes) throw bad('El bloque no tiene una cita.', 404);
  await logReq(c, db, id, 'editar', `resultado = ${resultado || '(borrado)'}`);
  return c.json({ ok: true });
});

agendaRoutes.post('/agenda/:id/reagendar', async (c) => {
  const db = c.env.DB;
  const origenId = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const { destino_id, motivo, forzar } = body || {};
  const origen = await db.prepare('SELECT * FROM agenda WHERE id = ?').bind(origenId).first();
  if (!origen) throw bad('Cita de origen no encontrada', 404);
  if (!(origen.rut || origen.nombre)) throw bad('El bloque de origen no tiene una cita.');

  if (!destino_id) {
    const mot = String(motivo || 'POSTULANTE SOLICITA CAMBIO').trim();
    await db.prepare('UPDATE agenda SET pendiente_reagendar = 1, pendiente_nota = ?, motivo_reagendamiento = ?, actualizado_en = ? WHERE id = ?')
      .bind(mot, mot, ahoraChile(), origenId).run();
    await audit(c, origenId, 'editar', `pendiente reagendar: ${mot}`);
    return c.json({ ok: true });
  }

  const destino = await db.prepare('SELECT * FROM agenda WHERE id = ?').bind(Number(destino_id)).first();
  if (!destino) throw bad('Bloque de destino no encontrado', 404);
  if (destino.rut || destino.nombre) throw bad('El bloque de destino ya esta ocupado.');
  if (destino.bloqueado) throw bad('El bloque de destino esta bloqueado.');
  // Regla principal: la nueva hora exige correo (el de la cita o uno nuevo).
  origen.correo = exigirCorreo(body.correo || origen.correo);
  const origenTienePesada = String(origen.clase || '').toUpperCase().split(',').map((s) => s.trim())
    .some((cl) => CLASES_PESADAS.includes(cl));
  if (origenTienePesada && destino.hora !== HORA_D_A5) {
    throw bad(`La clase ${origen.clase} solo se agenda en el bloque ${HORA_D_A5}.`);
  }
  if (origenTienePesada && destino.hora === HORA_D_A5 && !forzar) {
    const ocupados = await pesada.ocupadosDependientes(db, destino.fecha, destino.examinador_id);
    if (ocupados.length) {
      const detalle = ocupados.map((o) => `${o.hora} (${o.nombre || o.rut})`).join(' y ');
      throw bad(
        `No se puede reagendar aqui: el examinador ya tiene cita en ${detalle}. `
        + 'Libera esas horas primero o marca "forzar" para reagendar igual.'
      );
    }
  }

  const ts = ahoraChile();
  const comentariosOrigen = [origen.comentarios, `Reagendada desde ${origen.fecha} ${origen.hora}`].filter(Boolean).join(' | ');

  await db.batch([
    db.prepare(`
      UPDATE agenda SET rut=?, nombre=?, clase=?, contacto=?, correo=?,
        tipo_cita='REAGENDADO', motivo_reagendamiento=?, lista_espera=?,
        intento=?, funcionario_id=?, fecha_inicio_tramite=?,
        confirmo_asistencia=NULL, resultado=NULL, pendiente_reagendar=0, pendiente_nota=NULL,
        comentarios=?, agendado_en=COALESCE(agendado_en, ?),
        actualizado_en=?
      WHERE id=?
    `).bind(
      origen.rut, origen.nombre, origen.clase, origen.contacto, origen.correo,
      motivo || origen.motivo_reagendamiento || 'Reagendada', origen.lista_espera,
      origen.intento, origen.funcionario_id, origen.fecha_inicio_tramite,
      comentariosOrigen, ts, ts, destino.id,
    ),
    db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL_REAGENDAR_ORIGEN} WHERE id=?`)
      .bind(`Reagendada a ${destino.fecha} ${destino.hora} (${motivo || 'sin motivo'})`, ts, origen.id),
  ]);

  const avisos = [];
  if (pesada.esPesadaEnHoraValida(origen)) await pesada.liberar(db, origen.fecha, origen.examinador_id);
  if (pesada.esPesadaEnHoraValida({ hora: destino.hora, clase: origen.clase })) {
    avisos.push(...await pesada.aplicar(db, destino.fecha, destino.examinador_id));
  }

  await logReq(c, db, origen.id, 'reagendar', `${origen.fecha} ${origen.hora} -> ${destino.fecha} ${destino.hora}`);

  const destinoFinal = await traer(db, destino.id);
  if (destinoFinal.correo) {
    c.executionCtx.waitUntil(
      correo.confirmacion(c.env, db, destinoFinal)
        .then(async (ok) => { if (ok) await db.prepare('UPDATE agenda SET correo_confirmacion_enviado = 1 WHERE id = ?').bind(destino.id).run(); })
        .catch(() => {})
    );
  }

  return c.json({ ok: true, avisos, destino: destinoFinal });
});

// ---------- BLOQUEAR / DESBLOQUEAR DIAS (uno o un rango) ----------
// Acepta { desde, hasta } o { fecha } (un dia). Con simular:true no escribe
// nada: devuelve cuantos bloques se bloquearian y cuantos tienen cita, para
// mostrarlo en el dialogo antes de confirmar.
agendaRoutes.post('/bloquear-dia', async (c) => {
  const db = c.env.DB;
  const body = (await c.req.json().catch(() => ({}))) || {};
  const rango = leerRangoBloqueo(body);
  const incluirOcupados = !!body.incluir_ocupados;

  if (body.simular) {
    const { where, params } = filtroBloqueo(rango, { bloqueado: 0, incluirOcupados: true });
    const r = await db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN rut IS NOT NULL OR nombre IS NOT NULL THEN 1 ELSE 0 END) con_cita
      FROM agenda WHERE ${where}`).bind(...params).first();
    const total = Number(r?.total || 0);
    const conCita = Number(r?.con_cita || 0);
    return c.json({ ok: true, bloqueables: incluirOcupados ? total : total - conCita, con_cita: conCita });
  }

  const { where, params } = filtroBloqueo(rango, { bloqueado: 0, incluirOcupados });
  const { results: objetivo } = await db.prepare(`SELECT * FROM agenda WHERE ${where}`).bind(...params).all();

  // Todo en db.batch() por lotes: D1 limita la cantidad de consultas por request,
  // y un rango largo con citas haria cientos de consultas sueltas.
  const actor = await actorDe(c);
  const ts = ahoraChile();
  const stmts = [];
  let aPapelera = 0;
  for (const b of objetivo) {
    if (b.rut || b.nombre) {
      stmts.push(papelera.sentenciaGuardar(db, b, 'bloquear-dia', actor));
      stmts.push(cola.sentenciaEncolar(db, b, rango.motivo, actor));
      aPapelera++;
    }
    stmts.push(db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL_BLOQUEAR} WHERE id=?`).bind(rango.motivo, ts, b.id));
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  if (aPapelera) await papelera.recortar(db);

  const quien = rango.examinador_id ? 'exam ' + rango.examinador_id : 'todos';
  await logReq(c, db, null, 'bloquear',
    `${rango.desde}..${rango.hasta} ${quien}: ${objetivo.length} bloques (${rango.motivo})`);
  return c.json({ ok: true, bloqueados: objetivo.length, a_papelera: aPapelera, a_reagendar: aPapelera });
});

// Desbloquea el rango. Sin motivo quita TODOS los bloqueos del rango; con
// motivo solo los de ese motivo (ej. terminar antes una licencia sin tocar un
// feriado del mismo periodo). Con simular:true devuelve el conteo por motivo.
agendaRoutes.post('/desbloquear-dia', async (c) => {
  const db = c.env.DB;
  const body = (await c.req.json().catch(() => ({}))) || {};
  const rango = leerRangoBloqueo(body);
  const { where, params } = filtroBloqueo(rango, { bloqueado: 1, incluirOcupados: true });
  const soloMotivo = body.motivo ? ' AND bloqueo_motivo = ?' : '';
  const pMotivo = soloMotivo ? [rango.motivo] : [];

  if (body.simular) {
    const { results } = await db.prepare(`SELECT COALESCE(bloqueo_motivo, 'BLOQUEADO') motivo, COUNT(*) n
      FROM agenda WHERE ${where}${soloMotivo} GROUP BY 1 ORDER BY n DESC`).bind(...params, ...pMotivo).all();
    const total = results.reduce((s, x) => s + Number(x.n), 0);
    return c.json({ ok: true, desbloqueables: total, por_motivo: results });
  }

  const r = await db.prepare(`UPDATE agenda SET bloqueado=0, bloqueo_motivo=NULL, actualizado_en=? WHERE ${where}${soloMotivo}`)
    .bind(ahoraChile(), ...params, ...pMotivo).run();
  await logReq(c, db, null, 'editar', `desbloquear ${rango.desde}..${rango.hasta}: ${r.meta.changes}`);
  return c.json({ ok: true, desbloqueados: Number(r.meta.changes) });
});

// ---------- DISPONIBLES ----------
agendaRoutes.get('/disponibles', async (c) => {
  const db = c.env.DB;
  const { desde, hasta, clase, examinador_id } = c.req.query();
  const cond = ['a.rut IS NULL', 'a.nombre IS NULL', 'a.bloqueado = 0'];
  const p = [];
  // Igual que "Actualizar Citas Disponibles" del Apps Script: sin fecha
  // indicada, los cupos se ofrecen desde manana (hoy ya no se agenda).
  cond.push('a.fecha >= ?'); p.push(desde || mananaISOChile());
  if (hasta) { cond.push('a.fecha <= ?'); p.push(hasta); }
  if (examinador_id) { cond.push('a.examinador_id = ?'); p.push(Number(examinador_id)); }
  if (clase && CLASES_PESADAS.includes(String(clase).toUpperCase())) { cond.push('a.hora = ?'); p.push(HORA_D_A5); }
  const { results } = await db.prepare(`${SELECT_BLOQUE} WHERE ${cond.join(' AND ')} ORDER BY a.fecha, a.hora, e.nombre LIMIT 3000`).bind(...p).all();
  return c.json(results.map((r) => ({
    ...r,
    apto_pesada: r.hora === HORA_D_A5,
    regla: r.hora === HORA_D_A5 ? 'IDEAL para D y A5 (tambien B, C, profesionales)' : 'B, C, A1-A4 (PROHIBIDO D y A5)',
  })));
});

// ---------- COLA DE REAGENDAMIENTO ----------
// Personas desplazadas por un bloqueo, esperando hora nueva.
agendaRoutes.get('/cola-reagendar', async (c) => c.json(await cola.listarPendientes(c.env.DB)));

agendaRoutes.post('/cola-reagendar/:id/asignar', async (c) => {
  const db = c.env.DB;
  const body = (await c.req.json().catch(() => ({}))) || {};
  const item = await cola.traerPendiente(db, c.req.param('id'));
  if (!item) throw bad('Esta persona ya no está pendiente de reagendar.', 404);
  const destino = await db.prepare('SELECT * FROM agenda WHERE id = ?').bind(Number(body.destino_id)).first();
  if (!destino) throw bad('Bloque de destino no encontrado', 404);
  if (destino.rut || destino.nombre) throw bad('El bloque de destino ya esta ocupado.');
  if (destino.bloqueado) throw bad('El bloque de destino esta bloqueado.');
  const correoFinal = exigirCorreo(body.correo || item.correo);

  const tienePesada = String(item.clase || '').toUpperCase().split(',').map((s) => s.trim())
    .some((cl) => CLASES_PESADAS.includes(cl));
  if (tienePesada && destino.hora !== HORA_D_A5) throw bad(`La clase ${item.clase} solo se agenda en el bloque ${HORA_D_A5}.`);
  if (tienePesada && !body.forzar) {
    const ocupados = await pesada.ocupadosDependientes(db, destino.fecha, destino.examinador_id);
    if (ocupados.length) {
      throw bad(`No se puede asignar aqui: el examinador ya tiene cita en ${ocupados.map((o) => o.hora).join(' y ')}.`);
    }
  }

  const ts = ahoraChile();
  const motivo = body.motivo || `Bloqueo ${item.origen_fecha} ${item.origen_hora} (${item.motivo})`;
  const comentarios = [item.comentarios, `Reagendada desde ${item.origen_fecha} ${item.origen_hora} por bloqueo`].filter(Boolean).join(' | ');
  await db.batch([
    db.prepare(`
      UPDATE agenda SET rut=?, nombre=?, clase=?, contacto=?, correo=?, tipo_cita='REAGENDADO',
        motivo_reagendamiento=?, lista_espera=?, intento=?, funcionario_id=?, fecha_inicio_tramite=?,
        confirmo_asistencia=NULL, resultado=NULL, pendiente_reagendar=0, pendiente_nota=NULL,
        comentarios=?, agendado_en=?, actualizado_en=?
      WHERE id=? AND rut IS NULL AND nombre IS NULL AND bloqueado = 0
    `).bind(item.rut, item.nombre, item.clase, item.contacto, correoFinal, motivo, item.lista_espera,
      item.intento, item.funcionario_id, item.fecha_inicio_tramite, comentarios, ts, ts, destino.id),
    db.prepare(`UPDATE cola_reagendar SET estado='reagendado', destino_agenda_id=?, correo=?, resuelto_en=? WHERE id=?`)
      .bind(destino.id, correoFinal, ts, item.id),
  ]);

  const avisos = [];
  if (pesada.esPesadaEnHoraValida({ hora: destino.hora, clase: item.clase })) {
    avisos.push(...await pesada.aplicar(db, destino.fecha, destino.examinador_id));
  }
  await logReq(c, db, destino.id, 'reagendar',
    `${item.nombre || item.rut}: bloqueo ${item.origen_fecha} ${item.origen_hora} -> ${destino.fecha} ${destino.hora}`);

  const destinoFinal = await traer(db, destino.id);
  c.executionCtx.waitUntil(
    correo.confirmacion(c.env, db, destinoFinal)
      .then(async (ok) => { if (ok) await db.prepare('UPDATE agenda SET correo_confirmacion_enviado = 1 WHERE id = ?').bind(destino.id).run(); })
      .catch(() => {})
  );
  return c.json({ ok: true, avisos, destino: destinoFinal });
});

agendaRoutes.post('/cola-reagendar/:id/descartar', async (c) => {
  const db = c.env.DB;
  const body = (await c.req.json().catch(() => ({}))) || {};
  const item = await cola.traerPendiente(db, c.req.param('id'));
  if (!item) throw bad('Esta persona ya no está pendiente de reagendar.', 404);
  await db.prepare(`UPDATE cola_reagendar SET estado='descartado', comentarios=?, resuelto_en=? WHERE id=?`)
    .bind([item.comentarios, body.nota && `Descartado: ${String(body.nota).trim()}`].filter(Boolean).join(' | ') || null,
      ahoraChile(), item.id).run();
  await logReq(c, db, null, 'editar', `cola reagendar: descartado ${item.nombre || item.rut}`);
  return c.json({ ok: true });
});

// ---------- BUSCAR / HISTORIAL ----------
agendaRoutes.get('/buscar', async (c) => {
  const db = c.env.DB;
  const q = String(c.req.query('q') || '').trim();
  if (q.length < 3) return c.json([]);
  const like = `%${q}%`;
  const rutLimpio = `%${rut.limpiar(q)}%`;
  const { results } = await db.prepare(`
    ${SELECT_BLOQUE}
    WHERE (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
      AND (REPLACE(REPLACE(a.rut,'.',''),'-','') LIKE ? OR UPPER(a.nombre) LIKE UPPER(?) OR a.contacto LIKE ?)
    ORDER BY a.fecha DESC, a.hora LIMIT 100
  `).bind(rutLimpio, like, like).all();
  return c.json(results);
});

agendaRoutes.get('/historial', async (c) => {
  const db = c.env.DB;
  const r = rut.limpiar(c.req.query('rut') || '');
  if (r.length < 2) return c.json([]);
  const { results } = await db.prepare(`
    ${SELECT_BLOQUE}
    WHERE REPLACE(REPLACE(a.rut,'.',''),'-','') = ?
    ORDER BY a.fecha, a.hora
  `).bind(r).all();
  return c.json(results);
});

// ---------- DIA / IMPRESION ----------
agendaRoutes.get('/dia', async (c) => {
  const db = c.env.DB;
  const fecha = c.req.query('fecha') || hoyISOChile();
  const { results } = await db.prepare(`${SELECT_BLOQUE} WHERE a.fecha = ? ORDER BY e.nombre, a.hora`).bind(fecha).all();
  const porExaminador = {};
  for (const r of results) (porExaminador[r.examinador] ||= []).push(r);
  return c.json({ fecha, examinadores: porExaminador });
});
