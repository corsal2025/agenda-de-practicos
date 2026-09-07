'use strict';

/* ================= helpers ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
let META = null;

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
  });
  const txt = await res.text();
  const data = txt ? JSON.parse(txt) : null;
  if (!res.ok) throw new Error(data && data.error ? data.error : `Error ${res.status}`);
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

/* ================= router ================= */
const tabs = {
  agenda: renderAgenda, disponibles: renderDisponibles, reagendar: renderReagendar,
  errores: renderErrores, dia: renderDia, analitica: renderAnalitica, datos: renderDatos,
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
document.querySelectorAll('#nav button').forEach((b) => { b.onclick = () => irA(b.dataset.tab); });

/* ================= editor de bloque ================= */
function editorSlot(b, alGuardar) {
  const c = META.catalogos;
  const funcs = META.funcionarios.filter((f) => f.activo);
  const esPesadaFuera = b.clase && META.clases_pesadas.includes(b.clase) && b.hora !== META.hora_d_a5;
  modal(
    `${b.fecha}  ${b.hora}  ·  ${b.examinador}`,
    `
    <div class="campo ancho" style="background:#f8fafc;padding:.5rem;border-radius:6px">
      <label><input type="checkbox" id="f-bloq" ${b.bloqueado ? 'checked' : ''}> Bloquear este bloque (no disponible: terreno, feriado, dia administrativo...)</label>
      <input id="f-bloq-motivo" placeholder="Motivo del bloqueo" value="${esc(b.bloqueo_motivo)}" ${b.bloqueado ? '' : 'hidden'}>
    </div>
    <div class="campo"><label>RUT</label><input id="f-rut" value="${esc(b.rut)}" placeholder="12.345.678-9"></div>
    <div class="campo"><label>Nombre</label><input id="f-nombre" value="${esc(b.nombre)}"></div>
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
  const bloqChk = $('#f-bloq');
  bloqChk.onchange = () => { $('#f-bloq-motivo').hidden = !bloqChk.checked; };
  const claseSel = $('#f-clase');
  claseSel.onchange = () => {
    const pesadaFuera = META.clases_pesadas.includes(claseSel.value) && b.hora !== META.hora_d_a5;
    $('#zona-forzar').hidden = !pesadaFuera;
  };
  $('#btn-cancel').onclick = cerrarModal;
  if ($('#btn-liberar')) $('#btn-liberar').onclick = async () => {
    if (!confirm('Liberar el bloque y borrar los datos de la cita?')) return;
    await api(`/agenda/${b.id}/liberar`, { method: 'POST' });
    toast('Bloque liberado');
    cerrarModal(); alGuardar && alGuardar();
  };
  $('#btn-guardar').onclick = async () => {
    if ($('#f-bloq').checked) {
      try {
        await api(`/agenda/${b.id}`, { method: 'PUT', body: { bloqueado: true, bloqueo_motivo: $('#f-bloq-motivo').value, comentarios: $('#f-com').value } });
        toast('Bloque marcado como no disponible');
        cerrarModal(); alGuardar && alGuardar();
      } catch (e) { toast(e.message, 'err'); }
      return;
    }
    const body = {
      rut: $('#f-rut').value, nombre: $('#f-nombre').value, clase: $('#f-clase').value,
      contacto: $('#f-contacto').value, correo: $('#f-correo').value, tipo_cita: $('#f-tipo').value,
      motivo_reagendamiento: $('#f-motivo').value, lista_espera: $('#f-lista').value,
      intento: $('#f-intento').value,
      funcionario_id: $('#f-func').value && $('#f-func').value !== '__nuevo' ? Number($('#f-func').value) : null,
      fecha_inicio_tramite: $('#f-fit').value,
      confirmo_asistencia: $('#f-conf').value === '' ? null : Number($('#f-conf').value),
      resultado: $('#f-res').value, comentarios: $('#f-com').value,
      forzar: $('#f-forzar') && $('#f-forzar').checked,
    };
    try {
      const r = await api(`/agenda/${b.id}`, { method: 'PUT', body });
      (r.avisos || []).forEach((a) => toast(a, 'err'));
      toast('Guardado');
      cerrarModal(); alGuardar && alGuardar();
    } catch (e) { toast(e.message, 'err'); }
  };
}

async function abrirSlotPorId(id, alGuardar) {
  const b = await api(`/agenda/${id}`);
  editorSlot(b, alGuardar);
}

/* ================= tab: AGENDA ================= */
let estadoAgenda = { fecha: null, examinador_id: '' };
async function renderAgenda() {
  if (!estadoAgenda.fecha) estadoAgenda.fecha = hoy();
  view.innerHTML = `
    <div class="panel no-print">
      <div class="fila">
        <button class="btn sec" id="dia-prev">&#8592; Dia anterior</button>
        <div class="campo"><label>Fecha</label><input type="date" id="a-fecha" value="${estadoAgenda.fecha}"></div>
        <button class="btn sec" id="dia-next">Dia siguiente &#8594;</button>
        <div class="campo"><label>Examinador</label>
          <select id="a-exam"><option value="">Todos</option>
            ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(e.id) === String(estadoAgenda.examinador_id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
          </select></div>
        <button class="btn sec" id="a-hoy">Hoy</button>
      </div>
    </div>
    <div class="panel"><div id="a-grid">Cargando...</div></div>`;

  $('#a-fecha').onchange = (e) => { estadoAgenda.fecha = e.target.value; renderAgenda(); };
  $('#a-exam').onchange = (e) => { estadoAgenda.examinador_id = e.target.value; renderAgenda(); };
  $('#dia-prev').onclick = () => { estadoAgenda.fecha = sumarDias(estadoAgenda.fecha, -1); renderAgenda(); };
  $('#dia-next').onclick = () => { estadoAgenda.fecha = sumarDias(estadoAgenda.fecha, 1); renderAgenda(); };
  $('#a-hoy').onclick = () => { estadoAgenda.fecha = hoy(); renderAgenda(); };

  const q = new URLSearchParams({ fecha: estadoAgenda.fecha });
  if (estadoAgenda.examinador_id) q.set('examinador_id', estadoAgenda.examinador_id);
  const filas = await api(`/agenda?${q}`);
  pintarGrilla($('#a-grid'), filas, estadoAgenda.fecha);
}

function slotCard(b) {
  if (!b) return '<div class="slot libre muted">sin bloque</div>';
  if (b.bloqueado) {
    return `<button class="slot bloqueado" data-id="${b.id}">
      <span class="hora">${esc(b.hora)}${estadoAgenda.examinador_id ? '' : ' · ' + esc(b.examinador)}</span>
      <span class="nom">&#128274; ${esc(b.bloqueo_motivo || 'BLOQUEADO')}</span>
      <span class="meta">Bloque no disponible</span></button>`;
  }
  const ocupada = b.rut || b.nombre;
  const cls = ['slot', ocupada ? 'ocupada' : 'libre', b.hora === META.hora_d_a5 ? 'pesada' : ''].join(' ');
  const badges = [];
  if (b.hora === META.hora_d_a5) badges.push('<span class="badge dpesada">D/A5</span>');
  if (b.tipo_cita === 'REAGENDADO') badges.push('<span class="badge reag">REAG</span>');
  if (b.resultado === 'APROBADO') badges.push('<span class="badge aprob">APROB</span>');
  else if (b.resultado === 'REPROBADO') badges.push('<span class="badge reprob">REPROB</span>');
  else if (b.resultado) badges.push('<span class="badge noasiste">' + esc(b.resultado) + '</span>');
  return `<button class="${cls}" data-id="${b.id}">
    <span class="hora">${esc(b.hora)}${estadoAgenda.examinador_id ? '' : ' · ' + esc(b.examinador)}</span>
    ${ocupada
      ? `<span class="nom">${esc(b.nombre || '(sin nombre)')}</span>
         <span class="meta">${esc(b.rut || 'sin RUT')} · ${esc(b.clase || 's/clase')}</span>
         <span class="chips">${badges.join('')}</span>`
      : `<span class="meta">Libre · clic para agendar</span><span class="chips">${badges.join('')}</span>`}
  </button>`;
}

function pintarGrilla(cont, filas, fecha) {
  const exs = estadoAgenda.examinador_id
    ? META.examinadores.filter((e) => String(e.id) === String(estadoAgenda.examinador_id))
    : META.examinadores.filter((e) => e.activo);
  if (!filas.length) {
    cont.innerHTML = `<p class="muted">No hay bloques para ${esc(fecha)}.
      Puede ser fin de semana o feriado, o falta generar la grilla (pestana Datos).</p>`;
    return;
  }
  const porKey = {};
  filas.forEach((f) => { porKey[`${f.hora}|${f.examinador_id}`] = f; });
  const cols = exs.length;
  cont.className = 'grilla';
  cont.style.gridTemplateColumns = `70px repeat(${cols}, 1fr)`;
  let html = `<div class="cab"></div>` + exs.map((e) => `<div class="cab">${esc(e.nombre)}</div>`).join('');
  for (const hora of META.horas) {
    html += `<div class="cab" style="align-self:center">${esc(hora)}</div>`;
    for (const e of exs) html += `<div>${slotCard(porKey[`${hora}|${e.id}`])}</div>`;
  }
  cont.innerHTML = html;
  cont.querySelectorAll('.slot[data-id]').forEach((el) => {
    el.onclick = () => abrirSlotPorId(Number(el.dataset.id), renderAgenda);
  });
}

/* ================= tab: DISPONIBLES ================= */
let filtDisp = { desde: null, hasta: null, clase: '', examinador_id: '' };
async function renderDisponibles() {
  if (!filtDisp.desde) { filtDisp.desde = hoy(); filtDisp.hasta = sumarDias(hoy(), 21); }
  view.innerHTML = `
    <div class="panel no-print"><div class="fila">
      <div class="campo"><label>Desde</label><input type="date" id="d-desde" value="${filtDisp.desde}"></div>
      <div class="campo"><label>Hasta</label><input type="date" id="d-hasta" value="${filtDisp.hasta}"></div>
      <div class="campo"><label>Clase</label><select id="d-clase">${opt(META.catalogos.clase, filtDisp.clase)}</select></div>
      <div class="campo"><label>Examinador</label><select id="d-exam"><option value="">Todos</option>
        ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</select></div>
      <button class="btn" id="d-buscar">Buscar</button>
    </div>
    <p class="muted" id="d-regla"></p></div>
    <div class="panel tabla-scroll"><table><thead><tr>
      <th>Fecha</th><th>Hora</th><th>Examinador</th><th>Regla del bloque</th><th></th>
    </tr></thead><tbody id="d-body"><tr><td colspan="5">Cargando...</td></tr></tbody></table></div>`;

  $('#d-clase').value = filtDisp.clase;
  $('#d-exam').value = filtDisp.examinador_id;
  const buscar = async () => {
    filtDisp = {
      desde: $('#d-desde').value, hasta: $('#d-hasta').value,
      clase: $('#d-clase').value, examinador_id: $('#d-exam').value,
    };
    const pesada = META.clases_pesadas.includes(filtDisp.clase);
    $('#d-regla').textContent = pesada
      ? `Clase ${filtDisp.clase}: solo se muestran bloques de las ${META.hora_d_a5} (unico horario permitido).`
      : '';
    const q = new URLSearchParams(Object.fromEntries(Object.entries(filtDisp).filter(([, v]) => v)));
    const rows = await api(`/disponibles?${q}`);
    $('#d-body').innerHTML = rows.length ? rows.map((r) => `<tr>
      <td>${esc(r.fecha)}</td><td>${esc(r.hora)}</td><td>${esc(r.examinador)}</td>
      <td>${r.apto_pesada ? '&#9989; ' : '&#128663; '}${esc(r.regla)}</td>
      <td><button class="btn chico" data-id="${r.id}">Agendar</button></td></tr>`).join('')
      : '<tr><td colspan="5" class="muted">Sin bloques libres con esos filtros.</td></tr>';
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
    <div class="panel"><h2>Reagendar una cita</h2>
      <div class="fila">
        <div class="campo" style="flex:1"><label>Buscar por RUT, nombre o telefono</label>
          <input id="r-q" placeholder="minimo 3 caracteres"></div>
      </div>
      <div id="r-res" class="chips" style="margin-top:.5rem"></div>
    </div>
    <div id="r-detalle"></div>`;
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
            ${esc(r.nombre || r.rut)} — ${esc(r.fecha)} ${esc(r.hora)} (${esc(r.examinador)})</button>`).join('')
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
      <p><b>${esc(cita.nombre || '(sin nombre)')}</b> · ${esc(cita.rut || 'sin RUT')} · Clase ${esc(cita.clase || '-')}
        <br>Actual: ${esc(cita.fecha)} ${esc(cita.hora)} — ${esc(cita.examinador)}</p>
      <div class="fila">
        <div class="campo"><label>Buscar destino desde</label><input type="date" id="rd-desde" value="${sumarDias(hoy(), 1)}"></div>
        <div class="campo"><label>hasta</label><input type="date" id="rd-hasta" value="${sumarDias(hoy(), 30)}"></div>
        <div class="campo"><label>Examinador</label><select id="rd-exam"><option value="">Cualquiera</option>
          ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</select></div>
        <button class="btn" id="rd-buscar">Ver bloques libres</button>
      </div>
      ${pesada ? `<p class="muted">Clase ${esc(cita.clase)}: destino limitado al bloque ${esc(META.hora_d_a5)}.</p>` : ''}
      <div class="campo"><label>Motivo del reagendamiento</label><input id="rd-motivo" value="${esc(cita.motivo_reagendamiento)}"></div>
      <div class="tabla-scroll"><table><thead><tr><th>Fecha</th><th>Hora</th><th>Examinador</th><th></th></tr></thead>
        <tbody id="rd-body"><tr><td colspan="4" class="muted">Elige un rango y busca.</td></tr></tbody></table></div>
    </div>`;
  $('#rd-buscar').onclick = async () => {
    const q = new URLSearchParams({ desde: $('#rd-desde').value, hasta: $('#rd-hasta').value });
    if ($('#rd-exam').value) q.set('examinador_id', $('#rd-exam').value);
    if (pesada) q.set('clase', cita.clase);
    const libres = await api(`/disponibles?${q}`);
    $('#rd-body').innerHTML = libres.length ? libres.map((l) => `<tr>
      <td>${esc(l.fecha)}</td><td>${esc(l.hora)}</td><td>${esc(l.examinador)}</td>
      <td><button class="btn chico" data-id="${l.id}">Mover aqui</button></td></tr>`).join('')
      : '<tr><td colspan="4" class="muted">Sin bloques libres.</td></tr>';
    $('#rd-body').querySelectorAll('button[data-id]').forEach((el) => {
      el.onclick = async () => {
        if (!confirm(`Mover la cita a ${el.closest('tr').children[0].textContent} ${el.closest('tr').children[1].textContent}?`)) return;
        try {
          await api(`/agenda/${id}/reagendar`, { method: 'POST', body: { destino_id: Number(el.dataset.id), motivo: $('#rd-motivo').value } });
          toast('Cita reagendada');
          cont.innerHTML = '';
          $('#r-q').value = ''; $('#r-res').innerHTML = '';
        } catch (e) { toast(e.message, 'err'); }
      };
    });
  };
}

/* ================= tab: ERRORES ================= */
const ETIQUETA = {
  INCOMPLETA: 'Cita incompleta', RUT_INVALIDO: 'RUT invalido', CLASE_BLOQUE: 'Clase en bloque incorrecto',
  DUPLICADO_FUTURO: 'Duplicado futuro', CONFLICTO_TERRENO: 'Conflicto terreno',
  SIN_RESULTADO: 'Sin resultado', SIN_FUNCIONARIO: 'Sin funcionario',
};
let filtErr = { tipo: '', sev: '' };
async function renderErrores() {
  view.innerHTML = `<div class="panel"><div class="fila">
      <h2 style="margin:0;flex:1">Reporte de errores</h2>
      <button class="btn sec" id="e-refresh">Recalcular</button></div>
    <div class="chips" id="e-chips" style="margin:.6rem 0"></div></div>
    <div class="panel tabla-scroll"><table><thead><tr>
      <th>Sev</th><th>Tipo</th><th>Fecha</th><th>Hora</th><th>Examinador</th><th>RUT</th><th>Nombre</th><th>Detalle</th><th></th>
    </tr></thead><tbody id="e-body"><tr><td colspan="9">Cargando...</td></tr></tbody></table></div>`;
  const cargar = async () => {
    const rep = await api('/errores');
    const chips = [`<button class="chip" data-t="">Todos (${rep.total})</button>`]
      .concat(Object.entries(rep.resumen).sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `<button class="chip" data-t="${t}">${esc(ETIQUETA[t] || t)} (${n})</button>`));
    $('#e-chips').innerHTML = chips.join('');
    $('#e-chips').querySelectorAll('button').forEach((el) => {
      el.onclick = () => { filtErr.tipo = el.dataset.t; pintar(rep); };
    });
    pintar(rep);
  };
  const pintar = (rep) => {
    const rows = rep.hallazgos.filter((x) => (!filtErr.tipo || x.tipo === filtErr.tipo));
    $('#e-body').innerHTML = rows.length ? rows.slice(0, 500).map((x) => `<tr>
      <td><span class="sev ${x.severidad}">${x.severidad}</span></td>
      <td>${esc(ETIQUETA[x.tipo] || x.tipo)}</td>
      <td>${esc(x.fecha)}</td><td>${esc(x.hora)}</td><td>${esc(x.examinador)}</td>
      <td>${esc(x.rut)}</td><td>${esc(x.nombre)}</td><td>${esc(x.mensaje)}</td>
      <td>${x.agenda_id ? `<button class="btn chico" data-id="${x.agenda_id}">Abrir</button>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="9" class="muted">Nada que mostrar.</td></tr>';
    $('#e-body').querySelectorAll('button[data-id]').forEach((el) => {
      el.onclick = () => abrirSlotPorId(Number(el.dataset.id), cargar);
    });
  };
  $('#e-refresh').onclick = cargar;
  cargar();
}

/* ================= tab: AGENDA DEL DIA (imprimir) ================= */
async function renderDia() {
  const fecha = (estadoAgenda.fecha || hoy());
  view.innerHTML = `
    <div class="panel no-print"><div class="fila">
      <div class="campo"><label>Fecha</label><input type="date" id="dd-fecha" value="${fecha}"></div>
      <button class="btn" id="dd-print">Imprimir</button>
    </div></div>
    <div id="dd-cont">Cargando...</div>`;
  $('#dd-fecha').onchange = (e) => { estadoAgenda.fecha = e.target.value; renderDia(); };
  $('#dd-print').onclick = () => window.print();
  const data = await api(`/dia?fecha=${fecha}`);
  const exs = Object.keys(data.examinadores);
  if (!exs.length) { $('#dd-cont').innerHTML = `<div class="panel">Sin bloques para ${esc(fecha)}.</div>`; return; }
  $('#dd-cont').innerHTML = `<div class="grid2 imprimible">` + exs.map((ex) => `
    <div class="panel col-print">
      <h3>${esc(ex)} — ${esc(fecha)}</h3>
      <table><thead><tr><th>Hora</th><th>RUT</th><th>Nombre</th><th>Clase</th><th>Tel.</th></tr></thead>
      <tbody>${data.examinadores[ex].map((r) => (r.bloqueado
        ? `<tr class="muted"><td>${esc(r.hora)}</td><td colspan="4">&#128274; ${esc(r.bloqueo_motivo || 'BLOQUEADO')}</td></tr>`
        : `<tr>
        <td>${esc(r.hora)}</td><td>${esc(r.rut)}</td><td>${esc(r.nombre)}</td>
        <td>${esc(r.clase)}</td><td>${esc(r.contacto)}</td></tr>`)).join('')}</tbody></table>
    </div>`).join('') + `</div>`;
}

/* ================= tab: ANALITICA ================= */
let charts = [];
function limpiarCharts() { charts.forEach((c) => c.destroy()); charts = []; }
function grafico(id, tipo, labels, datos, label) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  charts.push(new Chart(ctx, {
    type: tipo,
    data: {
      labels,
      datasets: [{
        label: label || '',
        data: datos,
        backgroundColor: ['#1d4ed8', '#0ea5e9', '#15803d', '#b45309', '#7c3aed', '#be123c', '#64748b', '#0891b2', '#ca8a04'],
        borderColor: '#1d4ed8',
        tension: .25,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: tipo === 'doughnut' } },
      scales: tipo === 'doughnut' ? {} : { y: { beginAtZero: true } },
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
      <div class="panel"><h3>Citas por clase</h3><div class="grafico"><canvas id="g-clase"></canvas></div></div>
      <div class="panel"><h3>Citas por funcionario/a</h3><div class="grafico"><canvas id="g-func"></canvas></div></div>
      <div class="panel"><h3>Tipo de cita</h3><div class="grafico"><canvas id="g-tipo"></canvas></div></div>
      <div class="panel"><h3>Tendencia de citas por dia</h3><div class="grafico"><canvas id="g-tend"></canvas></div></div>
    </div>`;
  const cargar = async () => {
    limpiarCharts();
    const q = new URLSearchParams();
    if ($('#an-desde').value) q.set('desde', $('#an-desde').value);
    if ($('#an-hasta').value) q.set('hasta', $('#an-hasta').value);
    const a = await api(`/analitica?${q}`);
    const k = a.kpis;
    $('#an-kpis').innerHTML = [
      ['Bloques', k.bloques], ['Citas agendadas', k.ocupadas], ['Ocupacion', k.ocupacion + '%'],
      ['Con resultado', k.con_resultado], ['Aprobacion', k.aprobacion + '%'], ['Inasistencia', k.inasistencia + '%'],
      ['Reagendadas', k.reagendadas], ['Tasa reagend.', k.tasa_reagendamiento + '%'],
      ['En lista espera', k.lista_espera], ['Agendadas hoy', k.agendadas_hoy],
    ].map(([t, n]) => `<div class="kpi"><div class="n">${n}</div><div class="t">${t}</div></div>`).join('');
    const pares = (arr) => [arr.map((x) => x.k), arr.map((x) => x.n)];
    grafico('g-res', 'doughnut', ...pares(a.por_resultado));
    grafico('g-exam', 'bar', ...pares(a.por_examinador), 'Citas');
    grafico('g-clase', 'bar', ...pares(a.por_clase), 'Citas');
    grafico('g-func', 'bar', ...pares(a.por_funcionario), 'Citas');
    grafico('g-tipo', 'bar', ...pares(a.por_tipo), 'Citas');
    grafico('g-tend', 'line', a.tendencia.map((x) => x.dia), a.tendencia.map((x) => x.n), 'Citas');
  };
  $('#an-ok').onclick = cargar;
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
        <a class="btn sec" href="/api/export">Exportar a Excel</a>
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

    <div class="panel"><h2>Listas desplegables</h2><div id="cat-cont"></div></div>

    <div class="grid2">
      <div class="panel"><h2>Examinadores</h2><div id="ex-cont"></div>
        <div class="fila"><input id="ex-nuevo" placeholder="Nombre"><button class="btn chico" id="ex-add">Agregar</button></div></div>
      <div class="panel"><h2>Funcionarios/as</h2><div id="fu-cont"></div>
        <div class="fila"><input id="fu-nuevo" placeholder="Nombre"><button class="btn chico" id="fu-add">Agregar</button></div></div>
    </div>

    <div class="panel"><h2>Ultimos movimientos</h2><div class="tabla-scroll"><table>
      <thead><tr><th>Fecha</th><th>Accion</th><th>Detalle</th></tr></thead><tbody id="mov-body"></tbody></table></div></div>`;

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
        bloques nuevos ${r.resumen.bloques_generados}, rango ${r.resumen.rango.join(' a ')}.</div>`;
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
    const inp = div.nextElementSibling;
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
  $('#mov-body').innerHTML = mov.map((m) => `<tr><td>${esc(m.ts)}</td><td>${esc(m.accion)}</td><td>${esc(m.detalle)}</td></tr>`).join('');
}

/* ================= arranque ================= */
(async function init() {
  try {
    META = await api('/meta');
    const r = META.rango_agenda || {};
    $('#estado').textContent = r.desde ? `Agenda ${r.desde} a ${r.hasta} · hoy ${META.hoy}` : 'Base vacia — importa el Excel en Datos';
    if (!location.hash) location.hash = 'agenda';
    ruta();
  } catch (e) {
    view.innerHTML = `<div class="panel"><h2>No se pudo conectar</h2><p>${esc(e.message)}</p></div>`;
  }
})();
