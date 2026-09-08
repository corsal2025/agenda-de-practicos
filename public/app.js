'use strict';

/* ================= helpers ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
let META = null;

async function api(path, opts = {}) {
  const esForm = opts.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    headers: opts.body && !esForm ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
    body: opts.body && !esForm ? JSON.stringify(opts.body) : opts.body,
  });
  const txt = await res.text();
  const data = txt ? JSON.parse(txt) : null;
  if (res.status === 401 && data && data.login) { pantallaLogin(); throw new Error('Sesion requerida'); }
  if (!res.ok) {
    const e = new Error(data && data.error ? data.error : `Error ${res.status}`);
    e.data = data; e.status = res.status;
    throw e;
  }
  return data;
}

function toast(msg, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = msg;
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), tipo === 'err' ? 6000 : 3200);
}

function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hoy = () => (META ? META.hoy : new Date().toISOString().slice(0, 10));

// Fecha en formato dia/mes/año para MOSTRAR. Los <input type="date"> siguen usando ISO.
function fFecha(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
}
function fFechaHora(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}`;
  return fFecha(v);
}
// Nombres siempre en mayuscula al mostrar.
const nom = (v) => String(v ?? '').toUpperCase();
const DIAS_SEM = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function fFechaLarga(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return fFecha(iso);
  const d = new Date(`${iso}T12:00:00`);
  return `${DIAS_SEM[d.getDay()]} ${Number(m[3])} de ${MESES[d.getMonth()]} de ${m[1]}`;
}
function sumarDias(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
const opt = (arr, sel) => ['<option value="">--</option>']
  .concat(arr.map((v) => `<option ${v === sel ? 'selected' : ''}>${esc(v)}</option>`)).join('');

function modal(titulo, cuerpoHtml, pieHtml) {
  const root = $('#modal-root');
  root.innerHTML = '';
  const ov = h(`<div class="overlay">
    <div class="modal" role="dialog" aria-modal="true">
      <header><h3>${esc(titulo)}</h3><button class="x" aria-label="Cerrar">&times;</button></header>
      <div class="cuerpo"></div>
      <footer></footer>
    </div></div>`);
  ov.querySelector('.cuerpo').innerHTML = cuerpoHtml;
  ov.querySelector('footer').innerHTML = pieHtml || '';
  ov.querySelector('.x').onclick = cerrarModal;
  ov.addEventListener('click', (e) => { if (e.target === ov) cerrarModal(); });
  root.appendChild(ov);
  return ov;
}
const cerrarModal = () => { $('#modal-root').innerHTML = ''; };

/* ================= login ================= */
const ICO = {
  cal: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14M7 2v4M13 2v4"/></svg>',
  check: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 10l4 4 8-9"/></svg>',
  reloj: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 3v7l4 2M17 10A7 7 0 113 10a7 7 0 0114 0z"/></svg>',
};
async function pantallaLogin() {
  const root = $('#modal-root');
  root.innerHTML = '';
  const ov = h(`<div class="login-split">
    <div class="login-marca">
      <div style="display:flex;align-items:center;gap:12px">
        <svg width="42" height="42" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 2l15 5v11c0 9.5-6.2 16.8-15 20-8.8-3.2-15-10.5-15-20V7l15-5z" fill="#fff" opacity=".14"></path>
          <path d="M13 21l4.5 4.5L27 15" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
        <span class="lm-org">Departamento de Licencias de Conducir</span>
      </div>
      <h1>Agenda de Prácticos</h1>
      <p>Gestión de la agenda de exámenes prácticos: reserva de citas, reagendamiento, control de asistencia y reportes.</p>
      <div class="lm-lista">
        <div>${ICO.cal} 33 bloques diarios por 3 examinadores</div>
        <div>${ICO.check} Validación automática de RUT y reglas de clase</div>
        <div>${ICO.reloj} Cada cambio queda registrado con responsable</div>
      </div>
    </div>
    <div class="login-acceso">
      <div class="caja">
        <h2>Ingreso al sistema</h2>
        <p class="intro">Identifícate para registrar tus cambios en la bitácora.</p>
        <div class="campo"><label>Nombre del funcionario/a</label><input id="lg-nombre" autocomplete="off"></div>
        <div class="campo"><label>Clave de acceso</label><input id="lg-pin" type="password" autocomplete="off">
          <span class="muted" style="font-size:11.5px">Clave compartida definida por el administrador del equipo.</span></div>
        <button class="btn" id="lg-ok">Entrar
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h9M8 4l4 4-4 4"/></svg></button>
        <div class="login-nota">Departamento de Licencias de Conducir · uso interno</div>
      </div>
    </div>
  </div>`);
  root.appendChild(ov);
  const entrar = async () => {
    try {
      await api('/login', { method: 'POST', body: { funcionario: $('#lg-nombre').value, pin: $('#lg-pin').value } });
      cerrarModal();
      init();
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#lg-ok').onclick = entrar;
  $('#lg-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
  $('#lg-nombre').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#lg-pin').focus(); });
  $('#lg-nombre').focus();
}

/* ================= router ================= */
const tabs = {
  agenda: renderAgenda, disponibles: renderDisponibles, reagendar: renderReagendar,
  buscar: renderBuscar, errores: renderErrores, dia: renderDia, analitica: renderAnalitica,
  papelera: renderPapelera, datos: renderDatos,
};
function irA(tab) {
  if (location.hash !== `#${tab}`) { location.hash = tab; return; }
  ruta();
}
function ruta() {
  const tab = (location.hash.slice(1) || 'agenda').split('?')[0];
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('activo', b.dataset.tab === tab));
  (tabs[tab] || renderAgenda)();
}
window.addEventListener('hashchange', ruta);

/* ================= editor de bloque ================= */
function editorSlot(b, alGuardar) {
  const c = META.catalogos;
  const funcs = META.funcionarios.filter((f) => f.activo);
  const esPesadaFuera = b.clase && META.clases_pesadas.includes(b.clase) && b.hora !== META.hora_d_a5;
  modal(
    `${fFecha(b.fecha)}  ·  ${b.hora}  ·  ${b.examinador}`,
    `
    <div class="campo ancho" style="background:#f8fafc;padding:.5rem;border-radius:6px">
      <label><input type="checkbox" id="f-bloq" ${b.bloqueado ? 'checked' : ''}> Bloquear este bloque (no disponible: terreno, feriado, dia administrativo...)</label>
      <input id="f-bloq-motivo" placeholder="Motivo del bloqueo" value="${esc(b.bloqueo_motivo)}" ${b.bloqueado ? '' : 'hidden'}>
    </div>
    <div class="campo"><label>RUT</label><input id="f-rut" value="${esc(b.rut)}" placeholder="12.345.678-9"></div>
    <div class="campo"><label>Nombre</label><input id="f-nombre" value="${esc(nom(b.nombre))}" style="text-transform:uppercase"></div>
    <div class="campo"><label>Clase</label><select id="f-clase">${opt(c.clase, b.clase)}</select></div>
    <div class="campo"><label>Telefono</label><input id="f-contacto" value="${esc(b.contacto)}"></div>
    <div class="campo"><label>Correo</label><input id="f-correo" value="${esc(b.correo)}"></div>
    <div class="campo"><label>Tipo de cita</label><select id="f-tipo">${opt(c.tipo_cita, b.tipo_cita)}</select></div>
    <div class="campo ancho"><label>Motivo reagendamiento</label><input id="f-motivo" value="${esc(b.motivo_reagendamiento)}"></div>
    <div class="campo"><label>Lista de espera</label><select id="f-lista">${opt(c.lista_espera, b.lista_espera)}</select></div>
    <div class="campo"><label>Intento</label><select id="f-intento">${opt(c.intento, b.intento)}</select></div>
    <div class="campo"><label>Funcionario/a que agenda</label>
      <select id="f-func">${['<option value="">--</option>']
        .concat(funcs.map((f) => `<option value="${f.id}" ${f.id === b.funcionario_id ? 'selected' : ''}>${esc(f.nombre)}</option>`)).join('')}
        <option value="__nuevo">+ Nuevo...</option></select></div>
    <div class="campo"><label>Fecha inicio tramite</label><input type="date" id="f-fit" value="${esc(b.fecha_inicio_tramite)}"></div>
    <div class="campo"><label>Confirmo asistencia</label>
      <select id="f-conf"><option value="">--</option>
        <option value="1" ${b.confirmo_asistencia === 1 ? 'selected' : ''}>SI</option>
        <option value="0" ${b.confirmo_asistencia === 0 ? 'selected' : ''}>NO</option></select></div>
    <div class="campo"><label>Resultado</label><select id="f-res">${opt(c.resultado, b.resultado)}</select></div>
    <div class="campo ancho"><label>Comentarios</label><textarea id="f-com" rows="2">${esc(b.comentarios)}</textarea></div>
    <div class="campo ancho">
      <label><input type="checkbox" id="f-pend" ${b.pendiente_reagendar ? 'checked' : ''}> Marcar como pendiente de reagendar</label>
      <input id="f-pend-nota" placeholder="Nota (opcional)" value="${esc(b.pendiente_nota)}" ${b.pendiente_reagendar ? '' : 'hidden'}>
    </div>
    <div class="campo ancho" id="zona-forzar" ${esPesadaFuera ? '' : 'hidden'}>
      <label><input type="checkbox" id="f-forzar"> Forzar: clase pesada fuera del bloque ${esc(META.hora_d_a5)}</label></div>
    `,
    `
    ${(b.rut || b.nombre || b.bloqueado) ? '<button class="btn peligro sec" id="btn-liberar">Liberar bloque</button>' : ''}
    <button class="btn sec" id="btn-cancel">Cancelar</button>
    <button class="btn" id="btn-guardar">Guardar</button>
    `
  );

  $('#f-func').onchange = async (e) => {
    if (e.target.value !== '__nuevo') return;
    const nombre = prompt('Nombre del nuevo funcionario/a:');
    e.target.value = '';
    if (!nombre) return;
    const r = await api('/funcionarios', { method: 'POST', body: { nombre } });
    META = await api('/meta');
    const s = $('#f-func');
    s.insertAdjacentHTML('beforeend', `<option value="${r.id}">${esc(nombre.toUpperCase())}</option>`);
    s.value = r.id;
  };
  $('#f-bloq').onchange = (e) => { $('#f-bloq-motivo').hidden = !e.target.checked; };
  $('#f-pend').onchange = (e) => { $('#f-pend-nota').hidden = !e.target.checked; };
  const claseSel = $('#f-clase');
  claseSel.onchange = () => {
    const pesadaFuera = META.clases_pesadas.includes(claseSel.value) && b.hora !== META.hora_d_a5;
    $('#zona-forzar').hidden = !pesadaFuera;
  };
  $('#btn-cancel').onclick = cerrarModal;
  if ($('#btn-liberar')) $('#btn-liberar').onclick = async () => {
    if (!confirm('Liberar el bloque? Los datos quedan en la papelera (pestana Datos) por si hay que recuperarlos.')) return;
    await api(`/agenda/${b.id}/liberar`, { method: 'POST' });
    toast('Bloque liberado');
    cerrarModal(); alGuardar && alGuardar();
  };
  $('#btn-guardar').onclick = async () => {
    const comun = { visto_en: b.actualizado_en, comentarios: $('#f-com').value };
    try {
      if ($('#f-bloq').checked) {
        if ((b.rut || b.nombre) && !b.bloqueado) {
          if (!confirm(`Este bloque tiene la cita de ${nom(b.nombre) || b.rut}.\n\nAl bloquearlo, la cita se retira y queda guardada en la papelera (Datos → Papelera).\n\n¿Bloquear igual?`)) return;
        }
        await api(`/agenda/${b.id}`, { method: 'PUT', body: { ...comun, bloqueado: true, bloqueo_motivo: $('#f-bloq-motivo').value } });
        toast((b.rut || b.nombre) ? 'Bloque bloqueado — la cita fue a la papelera' : 'Bloque marcado como no disponible');
      } else {
        const body = {
          ...comun,
          rut: $('#f-rut').value, nombre: $('#f-nombre').value, clase: $('#f-clase').value,
          contacto: $('#f-contacto').value, correo: $('#f-correo').value, tipo_cita: $('#f-tipo').value,
          motivo_reagendamiento: $('#f-motivo').value, lista_espera: $('#f-lista').value,
          intento: $('#f-intento').value,
          funcionario_id: $('#f-func').value && $('#f-func').value !== '__nuevo' ? Number($('#f-func').value) : null,
          fecha_inicio_tramite: $('#f-fit').value,
          confirmo_asistencia: $('#f-conf').value === '' ? null : Number($('#f-conf').value),
          resultado: $('#f-res').value,
          pendiente_reagendar: $('#f-pend').checked,
          pendiente_nota: $('#f-pend-nota').value,
          forzar: $('#f-forzar') && $('#f-forzar').checked,
        };
        const r = await api(`/agenda/${b.id}`, { method: 'PUT', body });
        (r.avisos || []).forEach((a) => toast(a, 'err'));
        toast('Guardado');
      }
      cerrarModal(); alGuardar && alGuardar();
    } catch (e) {
      toast(e.message, 'err');
      if (e.status === 409 && e.data && e.data.bloque) { editorSlot(e.data.bloque, alGuardar); }
    }
  };
}
async function abrirSlotPorId(id, alGuardar) {
  editorSlot(await api(`/agenda/${id}`), alGuardar);
}

/* ================= tab: AGENDA ================= */
let estadoAgenda = { fecha: null, examinador_id: '', filtro: '' };
async function renderAgenda() {
  if (!estadoAgenda.fecha) estadoAgenda.fecha = hoy();
  view.innerHTML = `
    <div class="panel no-print">
      <div class="fila">
        <button class="btn sec" id="dia-prev">&#8592;</button>
        <div class="campo"><label>Fecha</label><input type="date" id="a-fecha" value="${estadoAgenda.fecha}"></div>
        <button class="btn sec" id="dia-next">&#8594;</button>
        <button class="btn sec" id="a-hoy">Hoy</button>
        <div class="campo"><label>Examinador</label>
          <select id="a-exam"><option value="">Todos</option>
            ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(e.id) === String(estadoAgenda.examinador_id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
          </select></div>
        <span class="pastilla" id="a-libres" style="margin-left:auto">— bloques libres</span>
        <button class="btn sec" id="a-porconfirmar">Por confirmar</button>
        <button class="btn sec" id="a-bloqdia">Bloquear día</button>
      </div>
    </div>
    <div class="panel"><div id="a-grid">Cargando...</div></div>`;

  $('#a-fecha').onchange = (e) => { estadoAgenda.fecha = e.target.value; renderAgenda(); };
  $('#a-exam').onchange = (e) => { estadoAgenda.examinador_id = e.target.value; renderAgenda(); };
  $('#dia-prev').onclick = () => { estadoAgenda.fecha = sumarDias(estadoAgenda.fecha, -1); renderAgenda(); };
  $('#dia-next').onclick = () => { estadoAgenda.fecha = sumarDias(estadoAgenda.fecha, 1); renderAgenda(); };
  $('#a-hoy').onclick = () => { estadoAgenda.fecha = hoy(); renderAgenda(); };
  $('#a-bloqdia').onclick = () => dialogoBloquearDia();
  $('#a-porconfirmar').onclick = () => dialogoPorConfirmar();

  const q = new URLSearchParams({ fecha: estadoAgenda.fecha });
  if (estadoAgenda.examinador_id) q.set('examinador_id', estadoAgenda.examinador_id);
  const filas = await api(`/agenda?${q}`);
  const libres = filas.filter((f) => !f.rut && !f.nombre && !f.bloqueado).length;
  $('#a-libres').textContent = `${libres} ${libres === 1 ? 'bloque libre' : 'bloques libres'}`;
  pintarGrilla($('#a-grid'), filas, estadoAgenda.fecha);
  actualizarBadgePapelera();
}

async function dialogoPorConfirmar() {
  const hasta = sumarDias(hoy(), 7);
  const rows = (await api('/agenda?estado=porconfirmar'))
    .filter((r) => r.fecha <= hasta);
  modal('Citas por confirmar (proximos 7 dias)', `
    <div class="ancho tabla-scroll"><table><thead><tr><th class="c">Fecha</th><th class="c">Hora</th><th>Nombre</th><th>Teléfono</th><th>Correo</th><th class="c"></th></tr></thead>
    <tbody id="pc-body">${rows.length ? rows.map((r) => `<tr data-id="${r.id}">
      <td class="c">${esc(fFecha(r.fecha))}</td><td class="c">${esc(r.hora)}</td><td>${esc(nom(r.nombre))}</td>
      <td>${esc(r.contacto)}</td><td>${esc(r.correo)}</td>
      <td><button class="btn chico" data-si="${r.id}">Confirmo</button>
          <button class="btn chico sec" data-no="${r.id}">No</button></td></tr>`).join('')
      : '<tr><td colspan="6" class="muted">Nada por confirmar.</td></tr>'}</tbody></table></div>
  `, `<button class="btn sec" id="pc-cerrar">Cerrar</button>`);
  $('#pc-cerrar').onclick = () => { cerrarModal(); renderAgenda(); };
  const marcar = async (id, val) => {
    const b = await api(`/agenda/${id}`);
    await api(`/agenda/${id}`, { method: 'PUT', body: {
      visto_en: b.actualizado_en, rut: b.rut, nombre: b.nombre, clase: b.clase,
      contacto: b.contacto, correo: b.correo, tipo_cita: b.tipo_cita,
      motivo_reagendamiento: b.motivo_reagendamiento, lista_espera: b.lista_espera,
      intento: b.intento, funcionario_id: b.funcionario_id, fecha_inicio_tramite: b.fecha_inicio_tramite,
      resultado: b.resultado, comentarios: b.comentarios, confirmo_asistencia: val,
    } });
    const tr = $(`#pc-body tr[data-id="${id}"]`);
    if (tr) tr.remove();
    toast(val ? 'Confirmada' : 'Marcada como no confirma');
  };
  $('#pc-body').querySelectorAll('button[data-si]').forEach((el) => { el.onclick = () => marcar(Number(el.dataset.si), 1); });
  $('#pc-body').querySelectorAll('button[data-no]').forEach((el) => { el.onclick = () => marcar(Number(el.dataset.no), 0); });
}

function dialogoBloquearDia() {
  modal('Bloquear un dia completo', `
    <div class="campo"><label>Fecha</label><input type="date" id="bd-fecha" value="${estadoAgenda.fecha}"></div>
    <div class="campo"><label>Examinador</label><select id="bd-exam"><option value="">Todos</option>
      ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</select></div>
    <div class="campo ancho"><label>Motivo</label><input id="bd-motivo" placeholder="DIA ADMINISTRATIVO, FERIADO, CAPACITACION..."></div>
    <div class="campo ancho"><label><input type="checkbox" id="bd-ocupados"> Incluir bloques que ya tienen cita (van a la papelera)</label></div>
  `, `<button class="btn sec" id="bd-cancel">Cancelar</button>
      <button class="btn sec" id="bd-des">Desbloquear ese dia</button>
      <button class="btn" id="bd-ok">Bloquear</button>`);
  $('#bd-cancel').onclick = cerrarModal;
  $('#bd-ok').onclick = async () => {
    try {
      const r = await api('/bloquear-dia', { method: 'POST', body: {
        fecha: $('#bd-fecha').value, examinador_id: $('#bd-exam').value || null,
        motivo: $('#bd-motivo').value, incluir_ocupados: $('#bd-ocupados').checked,
      } });
      toast(`${r.bloqueados} bloques bloqueados`);
      cerrarModal(); renderAgenda();
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#bd-des').onclick = async () => {
    const r = await api('/desbloquear-dia', { method: 'POST', body: { fecha: $('#bd-fecha').value, examinador_id: $('#bd-exam').value || null } });
    toast(`${r.desbloqueados} bloques desbloqueados`);
    cerrarModal(); renderAgenda();
  };
}

function slotCard(b) {
  if (!b) return '<div class="slot libre">—</div>';
  if (b.bloqueado) {
    return `<button class="slot bloqueado" data-id="${b.id}">
      <span class="nombre">&#128274; ${esc(b.bloqueo_motivo || 'BLOQUEADO')}</span>
      <span class="sub">No disponible</span></button>`;
  }
  const ocupada = b.rut || b.nombre;
  const res = b.resultado === 'APROBADO' ? 'res-aprob'
    : (b.resultado === 'REPROBADO' || b.resultado === 'REPROBADO INASISTENCIA') ? 'res-reprob' : '';
  const cls = ['slot', ocupada ? 'ocupada' : 'libre', b.hora === META.hora_d_a5 ? 'pesada' : '', res]
    .filter(Boolean).join(' ');

  if (!ocupada) {
    return `<button class="${cls}" data-id="${b.id}">
      <span class="mas">+</span><span>Agendar</span>
      ${b.hora === META.hora_d_a5 ? '<span class="badges"><span class="badge dpesada">Bloque para D y A5</span></span>' : ''}
    </button>`;
  }

  const badges = [];
  if (b.tipo_cita === 'REAGENDADO') badges.push('<span class="badge reag">Reagendada</span>');
  if (b.pendiente_reagendar) badges.push('<span class="badge reag">Pendiente de reagendar</span>');
  if (b.confirmo_asistencia === 1) badges.push('<span class="badge aprob">Confirmó asistencia</span>');
  if (b.resultado === 'APROBADO') badges.push('<span class="badge aprob">Aprobó</span>');
  else if (b.resultado === 'REPROBADO') badges.push('<span class="badge reprob">Reprobó</span>');
  else if (b.resultado) badges.push('<span class="badge noasiste">' + esc(b.resultado) + '</span>');

  // Marcado rapido de resultado (solo citas de hoy o pasadas)
  const noAsiste = b.resultado === 'NO ASISTIO' || b.resultado === 'REPROBADO INASISTENCIA';
  const acc = b.fecha <= META.hoy ? `<span class="slot-res" data-id="${b.id}">
    <span class="sr sr-a ${b.resultado === 'APROBADO' ? 'on' : ''}" role="button" tabindex="0" data-r="APROBADO">Aprobó</span>
    <span class="sr sr-r ${b.resultado === 'REPROBADO' ? 'on' : ''}" role="button" tabindex="0" data-r="REPROBADO">Reprobó</span>
    <span class="sr sr-n ${noAsiste ? 'on' : ''}" role="button" tabindex="0" data-r="NO ASISTIO">No asistió</span>
  </span>` : '';

  return `<button class="${cls}" data-id="${b.id}">
    <span class="nombre">${esc(nom(b.nombre) || '(SIN NOMBRE)')}</span>
    <span class="sub">
      <span class="clase-tag ${claseFamilia(b.clase)}">${esc(b.clase || '—')}</span>
      <span class="cita-rut num">${esc(b.rut || 'sin RUT')}</span>
    </span>
    ${badges.length ? `<span class="badges">${badges.join('')}</span>` : ''}
    ${acc}
  </button>`;
}
// Familia de la clase de licencia (para el color del recuadro).
function claseFamilia(c) {
  const x = String(c || '').toUpperCase();
  if (x === 'D' || x === 'A5') return 'pesada';
  if (x === 'E') return 'prof';
  if (x.startsWith('A')) return 'moto';
  return 'liviana';
}

function pintarGrilla(cont, filas, fecha) {
  const exs = estadoAgenda.examinador_id
    ? META.examinadores.filter((e) => String(e.id) === String(estadoAgenda.examinador_id))
    : META.examinadores.filter((e) => e.activo);
  if (!filas.length) {
    cont.className = '';
    cont.style.gridTemplateColumns = '';
    cont.innerHTML = `<p class="muted">No hay bloques para ${esc(fFecha(fecha))}. Puede ser fin de semana o feriado,
      o falta generar la grilla (pestana Datos).</p>`;
    return;
  }
  const porKey = {};
  const cuenta = {};
  filas.forEach((f) => {
    porKey[`${f.hora}|${f.examinador_id}`] = f;
    if (f.rut || f.nombre) cuenta[f.examinador_id] = (cuenta[f.examinador_id] || 0) + 1;
  });
  cont.className = 'grilla';
  cont.style.gridTemplateColumns = `58px repeat(${exs.length}, minmax(0, 1fr))`;
  let html = `<div></div>` + exs.map((e) =>
    `<div class="g-head"><span class="gh-n">${esc(e.nombre)}</span><span class="gh-c">${cuenta[e.id] || 0} citas</span></div>`).join('');
  for (const hora of META.horas) {
    const pesada = hora === META.hora_d_a5;
    html += `<div class="g-hora">${esc(hora)}${pesada ? '<span class="et">D · A5</span>' : ''}</div>`;
    for (const e of exs) html += `<div${pesada ? ' class="fila-pesada"' : ''}>${slotCard(porKey[`${hora}|${e.id}`])}</div>`;
  }
  cont.innerHTML = html;
  cont.querySelectorAll('.slot[data-id]').forEach((el) => {
    el.onclick = () => abrirSlotPorId(Number(el.dataset.id), renderAgenda);
  });
  cont.querySelectorAll('.slot-res .sr').forEach((el) => {
    el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.click(); } };
    el.onclick = async (ev) => {
      ev.stopPropagation();
      const id = Number(el.closest('.slot-res').dataset.id);
      const quitar = el.classList.contains('on');
      try {
        const b = await api(`/agenda/${id}`);
        const r = await api(`/agenda/${id}`, { method: 'PUT', body: {
          visto_en: b.actualizado_en,
          rut: b.rut, nombre: b.nombre, clase: b.clase, contacto: b.contacto, correo: b.correo,
          tipo_cita: b.tipo_cita, motivo_reagendamiento: b.motivo_reagendamiento,
          lista_espera: b.lista_espera, intento: b.intento, funcionario_id: b.funcionario_id,
          fecha_inicio_tramite: b.fecha_inicio_tramite, confirmo_asistencia: b.confirmo_asistencia,
          comentarios: b.comentarios,
          resultado: quitar ? null : el.dataset.r,
        } });
        (r.avisos || []).forEach((a) => toast(a, 'err'));
        toast(quitar ? 'Resultado borrado' : `Marcado: ${el.dataset.r === 'NO ASISTIO' ? 'No asistió' : el.dataset.r === 'APROBADO' ? 'Aprobó' : 'Reprobó'}`);
        renderAgenda();
      } catch (e) { toast(e.message, 'err'); }
    };
  });
}

/* ================= tab: DISPONIBLES ================= */
let filtDisp = { desde: null, hasta: null, clase: '', examinador_id: '' };
async function renderDisponibles() {
  if (!filtDisp.desde) { filtDisp.desde = hoy(); filtDisp.hasta = sumarDias(hoy(), 60); }
  view.innerHTML = `
    <div class="panel no-print"><div class="fila">
      <div class="campo"><label>Desde</label><input type="date" id="d-desde" value="${filtDisp.desde}"></div>
      <div class="campo"><label>Hasta</label><input type="date" id="d-hasta" value="${filtDisp.hasta}"></div>
      <div class="campo"><label>Clase</label><select id="d-clase">${opt(META.catalogos.clase, filtDisp.clase)}</select></div>
      <div class="campo"><label>Examinador</label><select id="d-exam"><option value="">Todos</option>
        ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</select></div>
      <button class="btn" id="d-buscar">Buscar</button>
    </div><p class="muted" id="d-regla"></p></div>
    <div class="panel tabla-scroll"><table><thead><tr>
      <th class="c">Fecha</th><th class="c">Hora</th><th class="c">Examinador</th><th class="c">Regla del bloque</th><th class="c"></th>
    </tr></thead><tbody id="d-body"><tr><td colspan="5">Cargando...</td></tr></tbody></table></div>`;
  $('#d-clase').value = filtDisp.clase;
  $('#d-exam').value = filtDisp.examinador_id;
  const buscar = async () => {
    filtDisp = { desde: $('#d-desde').value, hasta: $('#d-hasta').value, clase: $('#d-clase').value, examinador_id: $('#d-exam').value };
    const pesada = META.clases_pesadas.includes(filtDisp.clase);
    $('#d-regla').textContent = pesada ? `Clase ${filtDisp.clase}: solo bloques de las ${META.hora_d_a5}.` : '';
    const q = new URLSearchParams(Object.fromEntries(Object.entries(filtDisp).filter(([, v]) => v)));
    const rows = await api(`/disponibles?${q}`);
    rows.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora) || a.examinador.localeCompare(b.examinador));
    $('#d-body').innerHTML = rows.length ? rows.map((r) => `<tr>
      <td class="num c">${esc(fFecha(r.fecha))}</td><td class="num c">${esc(r.hora)}</td><td class="c">${esc(r.examinador)}</td>
      <td class="c"><span class="regla ${r.apto_pesada ? 'ok' : ''}">${r.apto_pesada ? 'D · A5 permitidas' : 'B, C, A1-A4 · sin D/A5'}</span></td>
      <td class="c"><button class="btn chico" data-id="${r.id}">Agendar</button></td></tr>`).join('')
      : `<tr><td colspan="5" class="muted">No hay bloques libres entre ${esc(fFecha(filtDisp.desde))} y ${esc(fFecha(filtDisp.hasta))}.
         Los primeros meses suelen estar llenos: ampliá la fecha "Hasta" o probá un mes más adelante.</td></tr>`;
    const base = $('#d-regla').textContent;
    $('#d-regla').textContent = rows.length
      ? `${base ? base + ' · ' : ''}${rows.length} bloque(s) libre(s) en el rango.`
      : base;
    $('#d-body').querySelectorAll('button[data-id]').forEach((el) => {
      el.onclick = () => abrirSlotPorId(Number(el.dataset.id), buscar);
    });
  };
  $('#d-buscar').onclick = buscar;
  buscar();
}

/* ================= tab: REAGENDAR ================= */
async function renderReagendar() {
  view.innerHTML = `
    <div class="panel"><h2>Pendientes de reagendar</h2>
      <div class="tabla-scroll"><table><thead><tr><th class="c">Fecha</th><th class="c">Hora</th><th>Examinador</th><th>Nombre</th><th>RUT</th><th>Nota</th><th class="c"></th></tr></thead>
      <tbody id="rp-body"><tr><td colspan="7">Cargando...</td></tr></tbody></table></div></div>
    <div class="panel"><h2>Reagendar una cita</h2>
      <div class="campo" style="max-width:420px"><label>Buscar por RUT, nombre o telefono</label><input id="r-q" placeholder="minimo 3 caracteres"></div>
      <div id="r-res" class="chips" style="margin-top:.5rem"></div>
    </div>
    <div id="r-detalle"></div>`;

  const cargarPend = async () => {
    const rows = await api('/agenda?estado=pendiente');
    $('#rp-body').innerHTML = rows.length ? rows.map((r) => `<tr>
      <td class="c">${esc(fFecha(r.fecha))}</td><td class="c">${esc(r.hora)}</td><td>${esc(r.examinador)}</td>
      <td>${esc(nom(r.nombre))}</td><td>${esc(r.rut)}</td><td>${esc(r.pendiente_nota)}</td>
      <td class="c"><button class="btn chico" data-id="${r.id}">Reagendar</button></td></tr>`).join('')
      : '<tr><td colspan="7" class="muted">Nada pendiente.</td></tr>';
    $('#rp-body').querySelectorAll('button[data-id]').forEach((el) => {
      el.onclick = () => detalleReagendar(Number(el.dataset.id));
    });
  };
  cargarPend();

  const qi = $('#r-q');
  let tmr;
  qi.oninput = () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const q = qi.value.trim();
      if (q.length < 3) { $('#r-res').innerHTML = ''; return; }
      const rows = await api(`/buscar?q=${encodeURIComponent(q)}`);
      $('#r-res').innerHTML = rows.length
        ? rows.map((r) => `<button class="chip" data-id="${r.id}" style="cursor:pointer">
            ${esc(nom(r.nombre) || r.rut)} — ${esc(fFecha(r.fecha))} ${esc(r.hora)} (${esc(r.examinador)})</button>`).join('')
        : '<span class="muted">Sin resultados</span>';
      $('#r-res').querySelectorAll('button[data-id]').forEach((el) => {
        el.onclick = () => detalleReagendar(Number(el.dataset.id));
      });
    }, 250);
  };
}

async function detalleReagendar(id) {
  const cita = await api(`/agenda/${id}`);
  const pesada = cita.clase && META.clases_pesadas.includes(cita.clase);
  const cont = $('#r-detalle');
  cont.innerHTML = `
    <div class="panel">
      <h3>Cita seleccionada</h3>
      <p><b>${esc(nom(cita.nombre) || '(SIN NOMBRE)')}</b> · ${esc(cita.rut || 'sin RUT')} · Clase ${esc(cita.clase || '-')}
        <br>Actual: ${esc(fFecha(cita.fecha))} ${esc(cita.hora)} — ${esc(cita.examinador)}</p>
      <div class="fila">
        <div class="campo"><label>Destino desde</label><input type="date" id="rd-desde" value="${sumarDias(hoy(), 1)}"></div>
        <div class="campo"><label>hasta</label><input type="date" id="rd-hasta" value="${sumarDias(hoy(), 30)}"></div>
        <div class="campo"><label>Examinador</label><select id="rd-exam"><option value="">Cualquiera</option>
          ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</select></div>
        <button class="btn" id="rd-buscar">Ver bloques libres</button>
      </div>
      ${pesada ? `<p class="muted">Clase ${esc(cita.clase)}: destino limitado al bloque ${esc(META.hora_d_a5)}.</p>` : ''}
      <div class="campo"><label>Motivo del reagendamiento</label><input id="rd-motivo" value="${esc(cita.motivo_reagendamiento)}"></div>
      <div class="tabla-scroll"><table><thead><tr><th class="c">Fecha</th><th class="c">Hora</th><th>Examinador</th><th class="c"></th></tr></thead>
        <tbody id="rd-body"><tr><td colspan="4" class="muted">Elige un rango y busca.</td></tr></tbody></table></div>
    </div>`;
  $('#rd-buscar').onclick = async () => {
    const q = new URLSearchParams({ desde: $('#rd-desde').value, hasta: $('#rd-hasta').value });
    if ($('#rd-exam').value) q.set('examinador_id', $('#rd-exam').value);
    if (pesada) q.set('clase', cita.clase);
    const libres = await api(`/disponibles?${q}`);
    $('#rd-body').innerHTML = libres.length ? libres.map((l) => `<tr>
      <td class="c">${esc(fFecha(l.fecha))}</td><td class="c">${esc(l.hora)}</td><td>${esc(l.examinador)}</td>
      <td class="c"><button class="btn chico" data-id="${l.id}">Mover aquí</button></td></tr>`).join('')
      : '<tr><td colspan="4" class="muted">Sin bloques libres.</td></tr>';
    $('#rd-body').querySelectorAll('button[data-id]').forEach((el) => {
      el.onclick = async () => {
        if (!confirm('Confirmar el reagendamiento?')) return;
        try {
          await api(`/agenda/${id}/reagendar`, { method: 'POST', body: { destino_id: Number(el.dataset.id), motivo: $('#rd-motivo').value } });
          toast('Cita reagendada');
          cont.innerHTML = ''; $('#r-q').value = ''; $('#r-res').innerHTML = '';
          renderReagendar();
        } catch (e) { toast(e.message, 'err'); }
      };
    });
  };
}

/* ================= tab: BUSCAR (historial) ================= */
async function renderBuscar() {
  view.innerHTML = `
    <div class="panel"><h2>Buscar contribuyente</h2>
      <div class="campo" style="max-width:420px"><label>RUT, nombre o telefono</label><input id="bx-q" placeholder="minimo 3 caracteres" autofocus></div>
      <div id="bx-res" class="chips" style="margin-top:.5rem"></div>
    </div>
    <div id="bx-hist"></div>`;
  const qi = $('#bx-q');
  let tmr;
  qi.oninput = () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const q = qi.value.trim();
      if (q.length < 3) { $('#bx-res').innerHTML = ''; return; }
      const rows = await api(`/buscar?q=${encodeURIComponent(q)}`);
      const rutsVistos = new Set();
      const chips = [];
      for (const r of rows) {
        const k = r.rut || r.nombre;
        if (rutsVistos.has(k)) continue;
        rutsVistos.add(k);
        chips.push(`<button class="chip" data-rut="${esc(r.rut || '')}" data-nom="${esc(r.nombre || '')}" style="cursor:pointer">${esc(nom(r.nombre) || r.rut)} · ${esc(r.rut || 'sin RUT')}</button>`);
      }
      $('#bx-res').innerHTML = chips.join('') || '<span class="muted">Sin resultados</span>';
      $('#bx-res').querySelectorAll('button').forEach((el) => {
        el.onclick = () => historial(el.dataset.rut, el.dataset.nom);
      });
    }, 250);
  };
}
async function historial(rutv, nombre) {
  const rows = rutv ? await api(`/historial?rut=${encodeURIComponent(rutv)}`) : [];
  $('#bx-hist').innerHTML = `<div class="panel"><h3>${esc(nom(nombre) || rutv)}</h3>
    ${rutv ? '' : '<p class="muted">Sin RUT registrado; no se puede armar historial.</p>'}
    <div class="tabla-scroll"><table><thead><tr><th class="c">Fecha</th><th class="c">Hora</th><th>Examinador</th><th class="c">Clase</th><th>Tipo</th><th>Resultado</th><th class="c"></th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td class="c">${esc(fFecha(r.fecha))}</td><td class="c">${esc(r.hora)}</td><td>${esc(r.examinador)}</td>
      <td class="c">${esc(r.clase)}</td><td>${esc(r.tipo_cita)}</td><td>${esc(r.resultado)}</td>
      <td class="c"><button class="btn chico" data-id="${r.id}">Abrir</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin citas.</td></tr>'}
    </tbody></table></div></div>`;
  $('#bx-hist').querySelectorAll('button[data-id]').forEach((el) => {
    el.onclick = () => abrirSlotPorId(Number(el.dataset.id), () => historial(rutv, nombre));
  });
}

/* ================= tab: ERRORES ================= */
const ETIQUETA = {
  INCOMPLETA: 'Cita incompleta', RUT_INVALIDO: 'RUT invalido', CLASE_BLOQUE: 'Clase en bloque incorrecto',
  DUPLICADO_FUTURO: 'Duplicado futuro', DUPLICADO_DIA: 'Duplicado el mismo dia', CONFLICTO_TERRENO: 'Conflicto terreno',
  SIN_RESULTADO: 'Sin resultado', SIN_CONTACTO: 'Sin contacto', DIA_INHABIL: 'Cita en dia inhabil',
  PENDIENTE_REAGENDAR: 'Pendiente de reagendar',
};
let filtErr = { tipo: '' };
async function renderErrores() {
  view.innerHTML = `<div class="panel"><div class="fila">
      <h2 style="margin:0;flex:1">Reporte de errores</h2>
      <button class="btn sec" id="e-refresh">Recalcular</button></div>
    <div class="chips" id="e-chips" style="margin:.6rem 0"></div></div>
    <div class="panel tabla-scroll"><table><thead><tr>
      <th class="c">Sev</th><th>Tipo</th><th class="c">Fecha</th><th class="c">Hora</th><th>Examinador</th><th>RUT</th><th>Nombre</th><th>Detalle</th><th class="c"></th>
    </tr></thead><tbody id="e-body"><tr><td colspan="9">Cargando...</td></tr></tbody></table></div>`;
  const cargar = async () => {
    const rep = await api('/errores');
    $('#e-chips').innerHTML = [`<button class="chip" data-t="">Todos (${rep.total})</button>`]
      .concat(Object.entries(rep.resumen).sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `<button class="chip" data-t="${t}">${esc(ETIQUETA[t] || t)} (${n})</button>`)).join('');
    $('#e-chips').querySelectorAll('button').forEach((el) => {
      el.onclick = () => { filtErr.tipo = el.dataset.t; pintar(rep); };
    });
    pintar(rep);
  };
  const pintar = (rep) => {
    const rows = rep.hallazgos.filter((x) => (!filtErr.tipo || x.tipo === filtErr.tipo));
    $('#e-body').innerHTML = rows.length ? rows.slice(0, 600).map((x) => `<tr>
      <td class="c"><span class="sev ${x.severidad}">${x.severidad}</span></td>
      <td>${esc(ETIQUETA[x.tipo] || x.tipo)}</td>
      <td class="c">${esc(fFecha(x.fecha))}</td><td class="c">${esc(x.hora)}</td><td>${esc(x.examinador)}</td>
      <td>${esc(x.rut)}</td><td>${esc(nom(x.nombre))}</td><td>${esc(x.mensaje)}</td>
      <td class="c">${x.agenda_id ? `<button class="btn chico" data-id="${x.agenda_id}">Abrir</button>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="9" class="muted">Nada que mostrar.</td></tr>';
    $('#e-body').querySelectorAll('button[data-id]').forEach((el) => {
      el.onclick = () => abrirSlotPorId(Number(el.dataset.id), cargar);
    });
  };
  $('#e-refresh').onclick = cargar;
  cargar();
}

/* ================= tab: AGENDA DEL DIA (informe de impresion) ================= */
const ESCUDO_SVG = `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="34" height="34">
  <path d="M20 2l15 5v11c0 9.5-6.2 16.8-15 20-8.8-3.2-15-10.5-15-20V7l15-5z" fill="#1b3a75"></path>
  <path d="M13 21l4.5 4.5L27 15" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

// Formato de hoja para imprimir (se elige segun el papel que haya en la impresora).
const PAGINAS = {
  carta:  { etq: 'Carta · 216 × 279 mm', size: '216mm 279mm' },
  a4:     { etq: 'A4 · 210 × 297 mm', size: '210mm 297mm' },
  oficio: { etq: 'Oficio · 216 × 330 mm', size: '216mm 330mm' },
};
function formatoImpresion() {
  try { return PAGINAS[localStorage.getItem('agenda-formato')] ? localStorage.getItem('agenda-formato') : 'carta'; }
  catch (_) { return 'carta'; }
}
function aplicarFormatoImpresion(f) {
  const p = PAGINAS[f] || PAGINAS.carta;
  let st = document.getElementById('estilo-pagina');
  if (!st) { st = document.createElement('style'); st.id = 'estilo-pagina'; document.head.appendChild(st); }
  st.textContent = `@media print { @page { size: ${p.size}; margin: 14mm 12mm; } }`;
  try { localStorage.setItem('agenda-formato', f); } catch (_) { /* ignore */ }
}
aplicarFormatoImpresion(formatoImpresion());

async function renderDia() {
  const fecha = (estadoAgenda.fecha || hoy());
  view.innerHTML = `
    <div class="panel no-print"><div class="fila">
      <div class="campo"><label>Fecha</label><input type="date" id="dd-fecha" value="${fecha}"></div>
      <div class="campo"><label>Formato de hoja</label>
        <select id="dd-formato">${Object.entries(PAGINAS).map(([k, v]) =>
          `<option value="${k}" ${k === formatoImpresion() ? 'selected' : ''}>${esc(v.etq)}</option>`).join('')}</select></div>
      <button class="btn" id="dd-print">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 6V2h8v4M4 12H2V6h12v6h-2M4 10h8v4H4z"/></svg>
        Imprimir informe
      </button>
      <span class="muted">Una hoja por examinador/a, lista para firmar. Elegí el formato según el papel de la impresora.</span>
    </div></div>
    <div id="dd-cont" class="dd-cont">Cargando...</div>`;
  $('#dd-fecha').onchange = (e) => { estadoAgenda.fecha = e.target.value; renderDia(); };
  $('#dd-formato').onchange = (e) => { aplicarFormatoImpresion(e.target.value); toast(`Formato: ${PAGINAS[e.target.value].etq}`); };
  $('#dd-print').onclick = () => window.print();

  const data = await api(`/dia?fecha=${fecha}`);
  const exs = Object.keys(data.examinadores);
  if (!exs.length) {
    $('#dd-cont').innerHTML = `<div class="panel">Sin bloques para ${esc(fFecha(fecha))}.</div>`;
    return;
  }
  const generado = fFechaHora(new Date().toISOString());
  const largaFecha = fFechaLarga(fecha);

  $('#dd-cont').innerHTML = exs.map((ex, i) => {
    const filas = data.examinadores[ex];
    const citas = filas.filter((r) => !r.bloqueado && (r.rut || r.nombre));
    const conf = citas.filter((r) => r.confirmo_asistencia === 1).length;
    const bloq = filas.filter((r) => r.bloqueado).length;
    let n = 0;
    const cuerpo = filas.map((r) => {
      if (r.bloqueado) {
        return `<tr class="hd-bloq"><td>${esc(r.hora)}</td><td colspan="8">NO DISPONIBLE — ${esc(r.bloqueo_motivo || 'BLOQUEADO')}</td></tr>`;
      }
      const ocupada = r.rut || r.nombre;
      if (!ocupada) {
        return `<tr class="hd-libre"><td>${esc(r.hora)}</td><td colspan="8">Disponible</td></tr>`;
      }
      n += 1;
      const res = r.resultado ? esc(r.resultado) : '';
      return `<tr>
        <td class="hd-n">${n}</td>
        <td class="num">${esc(r.hora)}</td>
        <td class="num">${esc(r.rut || '')}</td>
        <td class="hd-nom">${esc(nom(r.nombre))}</td>
        <td class="hd-c">${r.clase ? `<span class="clase-tag ${claseFamilia(r.clase)}">${esc(r.clase)}</span>` : ''}</td>
        <td class="num">${esc(r.contacto || '')}</td>
        <td>${r.tipo_cita === 'REAGENDADO' ? 'Reagendado' : r.tipo_cita === 'TRASLADO EN TERRENO' ? 'Terreno' : ''}${r.pendiente_reagendar ? '<span class="hd-marca">Pendiente de reagendar</span>' : ''}</td>
        <td class="hd-res">${res}</td>
        <td class="hd-obs"></td>
      </tr>`;
    }).join('');

    return `<article class="hoja-dia">
      <header class="hd-cab">
        ${ESCUDO_SVG}
        <div class="hd-org">
          <span>Departamento de Licencias de Conducir</span>
          <b>Agenda de Prácticos</b>
        </div>
        <div class="hd-folio">Hoja ${i + 1} de ${exs.length}</div>
      </header>

      <div class="hd-titulo">
        <h2>Agenda diaria de exámenes prácticos</h2>
        <div class="hd-datos">
          <div><span>Examinador/a</span><b>${esc(nom(ex))}</b></div>
          <div><span>Fecha</span><b>${esc(largaFecha)}</b></div>
          <div><span>Citas</span><b>${citas.length}</b></div>
          <div><span>Confirmadas</span><b>${conf}</b></div>
          <div><span>Bloqueos</span><b>${bloq}</b></div>
        </div>
      </div>

      <table class="hd-tabla">
        <colgroup>
          <col class="c-n"><col class="c-h"><col class="c-r"><col><col class="c-cl">
          <col class="c-t"><col class="c-ti"><col class="c-re"><col class="c-o">
        </colgroup>
        <thead><tr>
          <th>N°</th><th>Hora</th><th>RUT</th><th>Nombre</th><th>Clase</th>
          <th>Teléfono</th><th>Tipo</th><th>Resultado</th><th>Observaciones</th>
        </tr></thead>
        <tbody>${cuerpo}</tbody>
      </table>

      <div class="hd-pie">
        <div class="hd-firma"><div class="hd-linea"></div><span>Firma examinador/a</span></div>
        <div class="hd-firma"><div class="hd-linea"></div><span>Visto bueno jefatura</span></div>
        <div class="hd-gen">Generado ${esc(generado)}<br>Sistema de Agenda de Prácticos</div>
      </div>
    </article>`;
  }).join('');
}

/* ================= tab: ANALITICA ================= */
let charts = [];
function limpiarCharts() { charts.forEach((c) => c.destroy()); charts = []; }
function paletaInst() {
  const oscuro = document.documentElement.dataset.tema === 'oscuro';
  return {
    serie: ['#1b3a75', '#2a5db0', '#5a3fae', '#1f7a3d', '#a8590a', '#ad2b2f', '#8b95a3', '#1b4f8f', '#6f8bd0'],
    linea: oscuro ? '#6d8bff' : '#1b3a75',
    rejilla: oscuro ? 'rgba(255,255,255,.08)' : 'rgba(16,24,40,.08)',
    texto: oscuro ? '#9aa4bd' : '#56616f',
  };
}
function grafico(id, tipo, labels, datos, label) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  const p = paletaInst();
  charts.push(new Chart(ctx, {
    type: tipo,
    data: { labels, datasets: [{
      label: label || '', data: datos,
      backgroundColor: tipo === 'doughnut' ? p.serie
        : tipo === 'line' ? 'rgba(27,58,117,.10)' : p.linea,
      borderColor: p.linea, borderWidth: tipo === 'line' ? 2.5 : 0, tension: .3, fill: tipo === 'line',
      borderRadius: tipo === 'bar' ? 2 : 0, maxBarThickness: 46,
      pointRadius: 0, pointHoverRadius: 4,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: tipo === 'doughnut', labels: { color: p.texto, font: { family: 'Public Sans' } } } },
      scales: tipo === 'doughnut' ? {} : {
        x: { grid: { color: p.rejilla }, ticks: { color: p.texto, font: { family: 'Public Sans' } } },
        y: { beginAtZero: true, grid: { color: p.rejilla }, ticks: { color: p.texto, font: { family: 'Public Sans' } } },
      },
    },
  }));
}
function graficoStack(id, labels, series) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  const p = paletaInst();
  charts.push(new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: series.map((s) => ({ label: s.label, data: s.data, backgroundColor: s.color, borderRadius: 2, maxBarThickness: 70 })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'bottom', labels: { color: p.texto, font: { family: 'Public Sans' }, boxWidth: 12 } } },
      scales: {
        x: { stacked: true, grid: { color: p.rejilla }, ticks: { color: p.texto, font: { family: 'Public Sans' } } },
        y: { stacked: true, beginAtZero: true, grid: { color: p.rejilla }, ticks: { color: p.texto, font: { family: 'Public Sans' }, precision: 0 } },
      },
    },
  }));
}
async function renderAnalitica() {
  const r = META.rango_agenda || {};
  view.innerHTML = `
    <div class="panel no-print"><div class="fila">
      <div class="campo"><label>Desde</label><input type="date" id="an-desde" value="${r.desde || ''}"></div>
      <div class="campo"><label>Hasta</label><input type="date" id="an-hasta" value="${r.hasta || ''}"></div>
      <button class="btn" id="an-ok">Aplicar</button>
    </div></div>
    <div class="kpis" id="an-kpis"></div>
    <div class="grid2">
      <div class="panel"><h3>Resultado de examenes</h3><div class="grafico"><canvas id="g-res"></canvas></div></div>
      <div class="panel"><h3>Citas por examinador</h3><div class="grafico"><canvas id="g-exam"></canvas></div></div>
      <div class="panel"><h3>Resultados por examinador</h3>
        <div class="grafico"><canvas id="g-exres"></canvas></div>
        <div class="tabla-scroll" style="margin-top:.6rem"><table><thead><tr>
          <th>Examinador</th><th class="c">Aprobó</th><th class="c">Reprobó</th><th class="c">No asistió</th><th class="c">% aprobación</th>
        </tr></thead><tbody id="exres-tabla"></tbody></table></div>
      </div>
      <div class="panel"><h3>Citas por clase</h3><div class="grafico"><canvas id="g-clase"></canvas></div></div>
      <div class="panel"><h3>Citas por funcionario/a</h3><div class="grafico"><canvas id="g-func"></canvas></div></div>
      <div class="panel"><h3>Tipo de cita</h3><div class="grafico"><canvas id="g-tipo"></canvas></div></div>
      <div class="panel"><h3>Citas por dia (fecha de la cita)</h3><div class="grafico"><canvas id="g-tend"></canvas></div></div>
      <div class="panel"><h3>Agendados por dia (fecha de agendamiento)</h3><div class="grafico"><canvas id="g-agend"></canvas></div>
        <p class="muted" style="font-size:.8rem">Para citas migradas del Excel el dato es aproximado.</p></div>
    </div>`;
  const cargar = async () => {
    limpiarCharts();
    const q = new URLSearchParams();
    if ($('#an-desde').value) q.set('desde', $('#an-desde').value);
    if ($('#an-hasta').value) q.set('hasta', $('#an-hasta').value);
    const a = await api(`/analitica?${q}`);
    const k = a.kpis;
    $('#an-kpis').innerHTML = [
      ['Bloques', k.bloques], ['Bloqueados', k.bloqueadas], ['Citas agendadas', k.ocupadas], ['Ocupacion', k.ocupacion + '%'],
      ['Con resultado', k.con_resultado], ['Aprobacion', k.aprobacion + '%'], ['Inasistencia', k.inasistencia + '%'],
      ['Reagendadas', k.reagendadas], ['Tasa reagend.', k.tasa_reagendamiento + '%'],
      ['En lista espera', k.lista_espera], ['Agendadas hoy', k.agendadas_hoy],
    ].map(([t, n]) => `<div class="kpi"><div class="n">${n}</div><div class="t">${t}</div></div>`).join('');
    const pares = (arr) => [arr.map((x) => x.k), arr.map((x) => x.n)];
    grafico('g-res', 'doughnut', ...pares(a.por_resultado));
    grafico('g-exam', 'bar', ...pares(a.por_examinador), 'Citas');
    const exr = a.por_examinador_resultado || [];
    graficoStack('g-exres', exr.map((x) => x.examinador), [
      { label: 'Aprobó', data: exr.map((x) => x.aprobados), color: '#1f7a3d' },
      { label: 'Reprobó', data: exr.map((x) => x.reprobados), color: '#ad2b2f' },
      { label: 'No asistió', data: exr.map((x) => x.no_asistio), color: '#98a2b2' },
    ]);
    $('#exres-tabla').innerHTML = exr.length ? exr.map((x) => `<tr>
      <td>${esc(x.examinador)}</td>
      <td class="c" style="color:#1f7a3d;font-weight:700">${x.aprobados}</td>
      <td class="c" style="color:#ad2b2f;font-weight:700">${x.reprobados}</td>
      <td class="c">${x.no_asistio}</td>
      <td class="c" style="font-weight:700">${x.aprobacion}%</td></tr>`).join('')
      : '<tr><td colspan="5" class="muted">Sin resultados en el período.</td></tr>';
    grafico('g-clase', 'bar', ...pares(a.por_clase), 'Citas');
    grafico('g-func', 'bar', ...pares(a.por_funcionario), 'Citas');
    grafico('g-tipo', 'bar', ...pares(a.por_tipo), 'Citas');
    grafico('g-tend', 'line', a.tendencia.map((x) => x.dia), a.tendencia.map((x) => x.n), 'Citas');
    grafico('g-agend', 'line', a.tendencia_agendamiento.map((x) => x.dia), a.tendencia_agendamiento.map((x) => x.n), 'Agendados');
  };
  $('#an-ok').onclick = cargar;
  cargar();
}

/* ================= tab: PAPELERA ================= */
const MOTIVO_TXT = {
  liberar: 'Se liberó el bloque', bloquear: 'Se bloqueó el bloque',
  'bloquear-dia': 'Se bloqueó el día completo', sobrescribir: 'Se pisó con otra cita',
  reagendar: 'Se reagendó a otro bloque',
};
async function actualizarBadgePapelera() {
  const b = document.getElementById('badge-papelera');
  if (!b) return;
  try {
    const n = (await api('/papelera')).length;
    b.textContent = n > 99 ? '99+' : String(n);
    b.hidden = n === 0;
    if (n === 0) b.textContent = '';
  } catch (_) { b.hidden = true; }
}
async function renderPapelera() {
  view.innerHTML = `
    <div class="panel">
      <h2>Papelera</h2>
      <p class="muted">Citas retiradas de un bloque al <b>liberarlo</b>, <b>bloquearlo</b>, <b>pisarlo</b> con otra cita
        o <b>reagendarlo</b>. Se conservan las últimas 200; se listan las 80 más recientes.
        Restaurar solo funciona si el bloque original sigue libre.</p>
      <div class="tabla-scroll"><table><thead><tr>
        <th class="c">Cuándo</th><th class="c">Motivo</th><th class="c">Bloque original</th>
        <th>Nombre</th><th>RUT</th><th class="c">Clase</th><th>Por</th><th class="c"></th>
      </tr></thead><tbody id="pap-body"><tr><td colspan="8">Cargando...</td></tr></tbody></table></div>
    </div>`;

  const cargar = async () => {
    const pap = await api('/papelera');
    $('#pap-body').innerHTML = pap.length ? pap.map((p) => `<tr>
      <td class="num c">${esc(fFechaHora(p.ts))}</td>
      <td class="c">${esc(MOTIVO_TXT[p.motivo] || p.motivo || '—')}</td>
      <td class="num c">${esc(fFecha(p.fecha))} · ${esc(p.hora)}</td>
      <td>${esc(nom(p.nombre) || p.bloqueo_motivo || '—')}</td>
      <td class="num">${esc(p.rut || '—')}</td>
      <td class="c">${p.clase ? `<span class="clase-tag ${claseFamilia(p.clase)}">${esc(p.clase)}</span>` : '—'}</td>
      <td>${esc(p.actor || '—')}</td>
      <td class="c"><button class="btn chico" data-id="${p.id}">Restaurar</button></td></tr>`).join('')
      : '<tr><td colspan="8" class="muted">La papelera está vacía.</td></tr>';
    $('#pap-body').querySelectorAll('button[data-id]').forEach((el) => {
      el.onclick = async () => {
        try {
          const r = await api(`/papelera/${el.dataset.id}/restaurar`, { method: 'POST' });
          toast(`Restaurada: ${nom(r.bloque.nombre) || r.bloque.rut || 'cita'}`);
          cargar(); actualizarBadgePapelera();
        } catch (e) { toast(e.message, 'err'); }
      };
    });
    actualizarBadgePapelera();
  };
  cargar();
}

/* ================= tab: DATOS ================= */
async function renderDatos() {
  view.innerHTML = `
    <div class="panel"><h2>Importar / Exportar</h2>
      <div class="fila">
        <div class="campo"><label>Archivo Excel de origen (.xlsx)</label><input type="file" id="im-file" accept=".xlsx"></div>
        <label style="align-self:center"><input type="checkbox" id="im-limpiar"> Reemplazar todo (borra lo actual)</label>
        <button class="btn" id="im-btn">Importar</button>
      </div>
      <p class="muted">Sin "reemplazar" se hace un backup antes y se fusionan las citas por (fecha, hora, examinador).</p>
      <div class="fila">
        <a class="btn sec" href="/api/export">Exportar (formato dashboard)</a>
        <a class="btn sec" href="/api/export?formato=original">Exportar (formato Excel original)</a>
        <button class="btn sec" id="bk-btn">Crear backup de la base</button>
      </div>
      <div id="im-res"></div>
    </div>

    <div class="panel"><h2>Generar bloques de agenda</h2>
      <div class="fila">
        <div class="campo"><label>Desde</label><input type="date" id="gb-desde"></div>
        <div class="campo"><label>Hasta</label><input type="date" id="gb-hasta"></div>
        <button class="btn" id="gb-btn">Generar</button>
      </div>
      <p class="muted">Crea los bloques faltantes (dias habiles, 11 horarios, por examinador activo). No pisa lo existente.</p>
    </div>

    <div class="panel"><h2>Feriados / dias inhabiles</h2>
      <div class="chips" id="fe-cont" style="margin:.4rem 0"></div>
      <div class="fila"><input type="date" id="fe-fecha"><input id="fe-nombre" placeholder="Nombre (opcional)"><button class="btn chico" id="fe-add">Agregar</button></div>
      <p class="muted">Tras cambiar feriados, volve a generar los bloques del periodo afectado.</p>
    </div>

    <div class="panel"><h2>Listas desplegables</h2><div id="cat-cont"></div></div>

    <div class="grid2">
      <div class="panel"><h2>Examinadores</h2><div id="ex-cont"></div>
        <div class="fila"><input id="ex-nuevo" placeholder="Nombre"><button class="btn chico" id="ex-add">Agregar</button></div></div>
      <div class="panel"><h2>Funcionarios/as</h2><div id="fu-cont"></div>
        <div class="fila"><input id="fu-nuevo" placeholder="Nombre"><button class="btn chico" id="fu-add">Agregar</button></div></div>
    </div>

    <div class="panel"><h2>Ultimos movimientos</h2><div class="tabla-scroll"><table>
      <thead><tr><th class="c">Fecha</th><th>Acción</th><th>Por</th><th>Detalle</th></tr></thead><tbody id="mov-body"></tbody></table></div></div>`;

  $('#im-btn').onclick = async () => {
    const f = $('#im-file').files[0];
    if (!f) return toast('Elige un archivo .xlsx', 'err');
    const fd = new FormData();
    fd.append('archivo', f);
    fd.append('limpiar', $('#im-limpiar').checked ? 'true' : 'false');
    $('#im-res').innerHTML = '<p class="muted">Importando...</p>';
    try {
      const r = await api('/import', { method: 'POST', body: fd });
      $('#im-res').innerHTML = `<div class="aviso">Listo. Leidas ${r.resumen.leidas}, citas ${r.resumen.ocupadas},
        bloques nuevos ${r.resumen.bloques_generados}, rango ${r.resumen.rango.map(fFecha).join(' a ')}.</div>`;
      META = await api('/meta');
      toast('Importacion completada');
    } catch (e) { $('#im-res').innerHTML = `<div class="aviso">${esc(e.message)}</div>`; }
  };
  $('#bk-btn').onclick = async () => {
    const r = await api('/backup', { method: 'POST' });
    toast('Backup: ' + r.archivo.split(/[\\/]/).pop());
  };
  $('#gb-btn').onclick = async () => {
    if (!$('#gb-desde').value || !$('#gb-hasta').value) return toast('Indica el rango', 'err');
    const r = await api('/agenda/generar', { method: 'POST', body: { desde: $('#gb-desde').value, hasta: $('#gb-hasta').value } });
    toast(`${r.creados} bloques nuevos en ${r.dias} dias habiles`);
    META = await api('/meta');
  };

  // feriados
  const fe = $('#fe-cont');
  fe.innerHTML = (META.feriados || []).map((f) => `<span class="chip">${esc(fFecha(f.fecha))}${f.nombre ? ' · ' + esc(f.nombre) : ''}<button data-f="${esc(f.fecha)}">&times;</button></span>`).join('') || '<span class="muted">Sin feriados</span>';
  fe.querySelectorAll('button[data-f]').forEach((b) => {
    b.onclick = async () => { await api(`/feriados?fecha=${b.dataset.f}`, { method: 'DELETE' }); META = await api('/meta'); renderDatos(); };
  });
  $('#fe-add').onclick = async () => {
    if (!$('#fe-fecha').value) return;
    await api('/feriados', { method: 'POST', body: { fecha: $('#fe-fecha').value, nombre: $('#fe-nombre').value } });
    META = await api('/meta'); renderDatos();
  };

  // catalogos
  const cc = $('#cat-cont');
  cc.innerHTML = Object.keys(META.catalogos).map((tipo) => `
    <div style="margin-bottom:.7rem"><b>${tipo}</b>
      <div class="chips" data-tipo="${tipo}" style="margin:.3rem 0">
        ${META.catalogos[tipo].map((v) => `<span class="chip">${esc(v)}<button data-v="${esc(v)}">&times;</button></span>`).join('')}
      </div>
      <div class="fila"><input placeholder="nuevo valor"><button class="btn chico">Agregar</button></div>
    </div>`).join('');
  cc.querySelectorAll('[data-tipo]').forEach((div) => {
    const tipo = div.dataset.tipo;
    div.querySelectorAll('button[data-v]').forEach((b) => {
      b.onclick = async () => {
        await api(`/catalogos?tipo=${tipo}&valor=${encodeURIComponent(b.dataset.v)}`, { method: 'DELETE' });
        META = await api('/meta'); renderDatos();
      };
    });
  });
  cc.querySelectorAll('.fila').forEach((fila) => {
    const tipo = fila.previousElementSibling.dataset.tipo;
    fila.querySelector('button').onclick = async () => {
      const valor = fila.querySelector('input').value.trim();
      if (!valor) return;
      await api('/catalogos', { method: 'POST', body: { tipo, valor } });
      META = await api('/meta'); renderDatos();
    };
  });

  // examinadores / funcionarios
  const listar = (cont, arr, base) => {
    cont.innerHTML = arr.map((x) => `<div class="fila" style="margin-bottom:.3rem">
      <span style="flex:1">${esc(x.nombre)}</span>
      <label><input type="checkbox" ${x.activo ? 'checked' : ''} data-id="${x.id}"> activo</label></div>`).join('');
    cont.querySelectorAll('input[data-id]').forEach((el) => {
      el.onchange = async () => {
        await api(`/${base}/${el.dataset.id}`, { method: 'PUT', body: { activo: el.checked } });
        META = await api('/meta');
      };
    });
  };
  listar($('#ex-cont'), META.examinadores, 'examinadores');
  listar($('#fu-cont'), META.funcionarios, 'funcionarios');
  $('#ex-add').onclick = async () => {
    const nombre = $('#ex-nuevo').value.trim(); if (!nombre) return;
    await api('/examinadores', { method: 'POST', body: { nombre } });
    META = await api('/meta'); renderDatos();
  };
  $('#fu-add').onclick = async () => {
    const nombre = $('#fu-nuevo').value.trim(); if (!nombre) return;
    await api('/funcionarios', { method: 'POST', body: { nombre } });
    META = await api('/meta'); renderDatos();
  };

  const mov = await api('/movimientos');
  $('#mov-body').innerHTML = mov.map((m) => `<tr><td class="num c">${esc(fFechaHora(m.ts))}</td><td>${esc(m.accion)}</td><td>${esc(m.actor)}</td><td>${esc(m.detalle)}</td></tr>`).join('');
}

/* ================= arranque ================= */
async function init() {
  try {
    META = await api('/meta');
    const r = META.rango_agenda || {};
    $('#estado').innerHTML = `${r.desde ? `Agenda ${fFecha(r.desde)} – ${fFecha(r.hasta)} · ` : ''}hoy ${fFecha(META.hoy)}
      ${META.usuario ? `· <b>${esc(META.usuario)}</b> <button id="salir" class="btn chico sec" style="padding:.1rem .4rem">salir</button>` : ''}`;
    const salir = $('#salir');
    if (salir) salir.onclick = async () => { await api('/logout', { method: 'POST' }); pantallaLogin(); };
    if (!location.hash) location.hash = 'agenda';
    ruta();
    actualizarBadgePapelera();
  } catch (e) {
    if (e.message === 'Sesion requerida') return;
    view.innerHTML = `<div class="panel"><h2>No se pudo conectar</h2><p>${esc(e.message)}</p></div>`;
  }
}
document.querySelectorAll('#nav button').forEach((b) => { b.onclick = () => irA(b.dataset.tab); });

/* tema claro / oscuro */
(function tema() {
  const btn = document.getElementById('tema');
  try {
    const g = localStorage.getItem('agenda-tema');
    if (g) document.documentElement.dataset.tema = g;
  } catch (_) { /* ignore */ }
  const pinta = () => { btn.textContent = document.documentElement.dataset.tema === 'oscuro' ? '☀' : '☾'; };
  pinta();
  btn.onclick = () => {
    const nuevo = document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro';
    document.documentElement.dataset.tema = nuevo;
    try { localStorage.setItem('agenda-tema', nuevo); } catch (_) { /* ignore */ }
    pinta();
    if ((location.hash.slice(1) || 'agenda') === 'analitica') renderAnalitica();
  };
})();

init();
