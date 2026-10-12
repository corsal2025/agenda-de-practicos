/* ================= tab: DISPONIBLES ================= */
let filtDisp = { desde: null, hasta: null, clase: '', examinador_id: '', rango: '' };
const DISP_RANGOS = [['7', 'Próximos 7 días'], ['15', 'Próximos 15 días'], ['30', 'Próximos 30 días'], ['mes', 'Este mes'], ['prox', 'Próximo mes'], ['', 'Personalizado']];
const DISP_KEY_PLEGADO = 'disp-filtros-plegado';
const DISP_DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
// Devuelve [desde, hasta] para un rango rápido, o null si es "Personalizado".
function dispRangoFechas(r) {
  const h = hoy();
  if (/^\d+$/.test(r)) return [h, sumarDias(h, Number(r))];
  const [y, m] = h.split('-').map(Number);
  const iso = (yy, mm, dd) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const ultimo = (yy, mm) => new Date(yy, mm, 0).getDate(); // mm 1-12
  if (r === 'mes') return [h, iso(y, m, ultimo(y, m))];
  if (r === 'prox') {
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return [iso(ny, nm, 1), iso(ny, nm, ultimo(ny, nm))];
  }
  return null;
}
function dispLeerPlegado() { try { return localStorage.getItem(DISP_KEY_PLEGADO) === '1'; } catch { return false; } }
function dispGuardarPlegado(v) { try { localStorage.setItem(DISP_KEY_PLEGADO, v ? '1' : '0'); } catch { /* sin almacenamiento */ } }
async function renderDisponibles() {
  if (!filtDisp.desde) { filtDisp.desde = hoy(); filtDisp.hasta = sumarDias(hoy(), 60); }
  const plegado = dispLeerPlegado();
  view.innerHTML = `
    <div class="panel no-print panel-fijo disp-filtros">
      <div class="disp-filtros-cab">
        <button type="button" class="btn-plegar" id="d-plegar" aria-expanded="${!plegado}" aria-controls="d-campos">Filtros <span aria-hidden="true">${plegado ? '▸' : '▾'}</span></button>
        <span class="muted disp-resumen" id="d-resumen" aria-live="polite"></span>
      </div>
      <div id="d-campos" ${plegado ? 'hidden' : ''}><div class="fila">
      <div class="campo"><label for="d-rango">Rango</label><select id="d-rango">${DISP_RANGOS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></div>
      <div class="campo"><label for="d-desde">Desde</label><input type="date" id="d-desde" value="${esc(filtDisp.desde)}"></div>
      <div class="campo"><label for="d-hasta">Hasta</label><input type="date" id="d-hasta" value="${esc(filtDisp.hasta)}"></div>
      <div class="campo"><label for="d-clase">Clase</label><select id="d-clase">${opt(META.catalogos.clase, filtDisp.clase)}</select></div>
      <div class="campo"><label for="d-exam">Examinador</label><select id="d-exam"><option value="">Todos</option>
        ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</select></div>
      <button class="btn" id="d-buscar">Buscar</button>
    </div><p class="muted" id="d-regla"></p></div></div>
    <div class="disp-acciones no-print" id="d-acciones" hidden>
      <button type="button" class="btn chico" id="d-expandir">Expandir todo</button>
      <button type="button" class="btn chico" id="d-contraer">Contraer todo</button>
    </div>
    <div class="disp-cab-fija" id="d-cab" aria-hidden="true" hidden><span>Hora</span><span>Examinador</span><span>Regla del bloque</span><span></span></div>
    <div id="d-body"><div class="panel">Cargando...</div></div>`;
  $('#d-clase').value = filtDisp.clase;
  $('#d-exam').value = filtDisp.examinador_id;
  $('#d-rango').value = filtDisp.rango || '';
  let total = null;
  const resumen = () => {
    const ex = META.examinadores.find((e) => String(e.id) === String(filtDisp.examinador_id));
    $('#d-resumen').textContent = [
      `${fFecha(filtDisp.desde)} – ${fFecha(filtDisp.hasta)}`,
      filtDisp.clase ? `Clase ${filtDisp.clase}` : 'Todas las clases',
      ex ? ex.nombre : 'Todos los examinadores',
      total == null ? '' : `${total} libres`,
    ].filter(Boolean).join(' · ');
  };
  const plegar = (v) => {
    $('#d-campos').hidden = v;
    const b = $('#d-plegar');
    b.setAttribute('aria-expanded', String(!v));
    b.querySelector('span').textContent = v ? '▸' : '▾';
    $('#d-resumen').hidden = !v;
    dispGuardarPlegado(v);
    setTimeout(ajustarOffsetsFijos, 0);
  };
  $('#d-plegar').onclick = () => plegar(!$('#d-campos').hidden);
  $('#d-resumen').hidden = !plegado;
  const buscar = async () => {
    filtDisp = { desde: $('#d-desde').value, hasta: $('#d-hasta').value, clase: $('#d-clase').value, examinador_id: $('#d-exam').value, rango: $('#d-rango').value };
    const pesada = META.clases_pesadas.includes(filtDisp.clase);
    $('#d-regla').textContent = pesada ? `Clase ${filtDisp.clase}: solo bloques de las ${META.hora_d_a5}.` : '';
    const { rango, ...params } = filtDisp;
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)));
    const base = $('#d-regla').textContent;
    total = null;
    resumen();
    await cargarVista('disponibles', `/disponibles?${q}`, (rows) => pintarDisp(rows, base));
  };
  const filaDisp = (r) => `<tr>
      <td class="num c">${esc(r.hora)}</td><td class="c">${esc(r.examinador)}</td>
      <td class="c"><span class="regla ${r.apto_pesada ? 'ok' : ''}">${r.apto_pesada ? 'D · A5 permitidas' : 'B, C, A1-A4 · sin D/A5'}</span></td>
      <td class="c"><button class="btn chico" data-id="${Number(r.id)}">Agendar</button></td></tr>`;
  const resumenDia = (fecha, lista) => {
    const aptos = lista.filter((r) => r.apto_pesada);
    const dia = DISP_DIAS[new Date(`${fecha}T12:00:00`).getDay()];
    const n = lista.length;
    const extra = aptos.length ? ` (${aptos.length} a las ${[...new Set(aptos.map((r) => r.hora))].join('/')} aptos D/A5)` : '';
    return `<strong>${esc(dia)} ${esc(fFecha(fecha))}</strong> — ${n} cupo${n === 1 ? '' : 's'} libre${n === 1 ? '' : 's'}${esc(extra)}`;
  };
  const pintarDisp = (rows, base) => {
    rows.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora) || a.examinador.localeCompare(b.examinador));
    total = rows.length;
    resumen();
    const grupos = new Map();
    rows.forEach((r) => { if (!grupos.has(r.fecha)) grupos.set(r.fecha, []); grupos.get(r.fecha).push(r); });
    $('#d-acciones').hidden = grupos.size < 2;
    $('#d-cab').hidden = !rows.length;
    $('#d-body').innerHTML = rows.length
      ? [...grupos].map(([fecha, lista], i) => `<details class="disp-dia"${i === 0 ? ' open' : ''}>
        <summary>${resumenDia(fecha, lista)}</summary>
        <table class="disp-tabla"><thead><tr><th class="c">Hora</th><th class="c">Examinador</th><th class="c">Regla del bloque</th><th class="c"></th></tr></thead>
        <tbody>${lista.map(filaDisp).join('')}</tbody></table></details>`).join('')
      : `<div class="panel"><table><tbody>${licoVacioFila(1, 'explica', 'Sin bloques libres en este rango', `No hay bloques libres entre ${fFecha(filtDisp.desde)} y ${fFecha(filtDisp.hasta)}. Los primeros meses suelen estar llenos: amplía la fecha "Hasta" o prueba un mes más adelante.`)}</tbody></table></div>`;
    $('#d-regla').textContent = rows.length
      ? `${base ? base + ' · ' : ''}${rows.length} bloque(s) libre(s) en el rango.`
      : base;
    $('#d-body').querySelectorAll('button[data-id]').forEach((el) => {
      el.onclick = () => abrirSlotPorId(Number(el.dataset.id), recargar(buscar));
    });
    setTimeout(ajustarOffsetsFijos, 0);
  };
  const todos = (abrir) => $('#d-body').querySelectorAll('details.disp-dia').forEach((d) => { d.open = abrir; });
  $('#d-expandir').onclick = () => todos(true);
  $('#d-contraer').onclick = () => todos(false);
  $('#d-rango').onchange = () => {
    const f = dispRangoFechas($('#d-rango').value);
    if (!f) return;
    [$('#d-desde').value, $('#d-hasta').value] = f;
    buscar();
  };
  ['#d-desde', '#d-hasta'].forEach((s) => { $(s).addEventListener('input', () => { $('#d-rango').value = ''; }); });
  $('#d-buscar').onclick = buscar;
  buscar();
}

/* ================= tab: REAGENDAR ================= */
let reagendarSeleccion = null; // null | { tipo: 'agenda', id, cita } | { tipo: 'cola', id, item }
let filtReag = { desde: null, hasta: null, examinador_id: '' };
let filtroOrigenReag = 'todos'; // 'todos' | 'bloqueo' | 'cambio'

async function renderReagendar() {
  if (!filtReag.desde) filtReag.desde = sumarDias(hoy(), 1);
  if (!filtReag.hasta) filtReag.hasta = sumarDias(hoy(), 30);

  view.innerHTML = `
    <div id="r-detalle"></div>

    <div class="panel">
      <div class="fila" style="justify-content:space-between;align-items:center;margin-bottom:.75rem;flex-wrap:wrap;gap:8px">
        <div>
          <h2 style="margin:0 0 .2rem">Personas por Reagendar</h2>
          <p class="muted" style="margin:0;font-size:13px">Listado unificado con prioridad inteligente: afectados por bloqueo municipal (urgentes) y solicitudes de cambio.</p>
        </div>
        <div id="r-filtros-origen" style="display:flex;align-items:center;gap:6px">
          <span class="pastilla" style="font-weight:700">Cargando...</span>
        </div>
      </div>
      <div class="tabla-scroll">
        <table class="thead-fijo">
          <thead>
            <tr>
              <th class="c" style="width:145px">Prioridad / Origen</th>
              <th class="c" style="width:105px">Fecha cita</th>
              <th class="c" style="width:75px">Hora</th>
              <th class="c">Postulante</th>
              <th class="c" style="width:125px">RUT</th>
              <th class="c" style="width:65px">Clase</th>
              <th class="c" style="width:170px">Examinador</th>
              <th>Motivo / Causa</th>
              <th class="c" style="width:180px">Acción</th>
            </tr>
          </thead>
          <tbody id="r-tabla-unificada"><tr><td colspan="9" class="c muted" style="padding:1.5rem">Cargando postulantes...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  pintarPanelTopReagendar();

  try {
    const [pend, cola] = await Promise.all([
      api('/agenda?estado=pendiente').catch(() => []),
      api('/cola-reagendar').catch(() => [])
    ]);

    const itemsBloqueo = cola.map((c) => ({
      tipo: 'cola',
      prioridad: 1, // Urgente
      id: c.id,
      fecha: c.origen_fecha,
      hora: c.origen_hora,
      nombre: c.nombre,
      rut: c.rut,
      clase: c.clase,
      examinador: c.origen_examinador || 'No asignado',
      motivo: c.motivo || 'Bloqueo por ausencia',
      raw: c
    }));

    const itemsCambio = pend.map((p) => ({
      tipo: 'agenda',
      prioridad: 2, // Solicitud normal
      id: p.id,
      fecha: p.fecha,
      hora: p.hora,
      nombre: p.nombre,
      rut: p.rut,
      clase: p.clase,
      examinador: p.examinador || 'No asignado',
      motivo: p.pendiente_nota || p.motivo_reagendamiento || 'POSTULANTE SOLICITA CAMBIO',
      raw: p
    }));

    // Prioridad 1 (bloqueo) primero; luego por fecha y hora
    const todos = [...itemsBloqueo, ...itemsCambio].sort((a, b) => {
      if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;
      return String(a.fecha).localeCompare(String(b.fecha)) || String(a.hora).localeCompare(String(b.hora));
    });

    const fCont = $('#r-filtros-origen');
    if (fCont) {
      fCont.innerHTML = `
        <button type="button" class="btn chico ${filtroOrigenReag === 'todos' ? '' : 'sec'}" id="r-f-todos" style="font-weight:700">Todos (${todos.length})</button>
        <button type="button" class="btn chico ${filtroOrigenReag === 'bloqueo' ? '' : 'sec'}" id="r-f-bloq" style="font-weight:700;${filtroOrigenReag === 'bloqueo' ? 'background:#dc2626;border-color:#b91c1c;color:#fff' : 'color:#dc2626'}">🚨 Por Bloqueo (${itemsBloqueo.length})</button>
        <button type="button" class="btn chico ${filtroOrigenReag === 'cambio' ? '' : 'sec'}" id="r-f-camb" style="font-weight:700;${filtroOrigenReag === 'cambio' ? 'background:#1d4ed8;color:#fff' : 'color:#1d4ed8'}">Solicitud de cambio (${itemsCambio.length})</button>
      `;
      $('#r-f-todos').onclick = () => { filtroOrigenReag = 'todos'; pintarFilas(); };
      $('#r-f-bloq').onclick = () => { filtroOrigenReag = 'bloqueo'; pintarFilas(); };
      $('#r-f-camb').onclick = () => { filtroOrigenReag = 'cambio'; pintarFilas(); };
    }

    const pintarFilas = () => {
      const btnTodos = $('#r-f-todos');
      const btnBloq = $('#r-f-bloq');
      const btnCamb = $('#r-f-camb');
      if (btnTodos) btnTodos.className = `btn chico ${filtroOrigenReag === 'todos' ? '' : 'sec'}`;
      if (btnBloq) {
        btnBloq.className = `btn chico ${filtroOrigenReag === 'bloqueo' ? '' : 'sec'}`;
        btnBloq.style = `font-weight:700;${filtroOrigenReag === 'bloqueo' ? 'background:#dc2626;border-color:#b91c1c;color:#fff' : 'color:#dc2626'}`;
      }
      if (btnCamb) {
        btnCamb.className = `btn chico ${filtroOrigenReag === 'cambio' ? '' : 'sec'}`;
        btnCamb.style = `font-weight:700;${filtroOrigenReag === 'cambio' ? 'background:#1d4ed8;color:#fff' : 'color:#1d4ed8'}`;
      }

      const filtrados = todos.filter((it) => {
        if (filtroOrigenReag === 'bloqueo') return it.tipo === 'cola';
        if (filtroOrigenReag === 'cambio') return it.tipo === 'agenda';
        return true;
      });

      const tb = $('#r-tabla-unificada');
      if (!tb) return;

      if (!filtrados.length) {
        tb.innerHTML = licoVacioFila(9, 'celebra', '¡Sin pendientes!', 'No hay personas pendientes en esta categoría.');
        return;
      }

      tb.innerHTML = filtrados.map((r) => {
        const estaActivo = reagendarSeleccion && reagendarSeleccion.tipo === r.tipo && reagendarSeleccion.id === r.id;
        const esBloqueo = r.tipo === 'cola';
        const badgeTipo = esBloqueo
          ? '<span class="badge" style="background:#fee2e2;color:#991b1b;border:1px solid #f87171;font-weight:800;padding:3px 7px;border-radius:4px;font-size:11px">🚨 BLOQUEO</span>'
          : '<span class="badge" style="background:#dbeafe;color:#1e40af;border:1px solid #93c5fd;font-weight:700;padding:3px 7px;border-radius:4px;font-size:11px">SOLICITUD</span>';

        return `<tr style="${estaActivo ? 'background:#eff6ff;outline:2px solid #3b82f6;outline-offset:-2px' : ''}">
          <td class="c">${badgeTipo}</td>
          <td class="c"><b>${esc(fFecha(r.fecha))}</b></td>
          <td class="c"><b>${esc(r.hora)}</b></td>
          <td class="c"><b>${esc(nom(r.nombre))}</b></td>
          <td class="c num" style="white-space:nowrap;font-weight:600">${esc(r.rut)}</td>
          <td class="c">${r.clase ? clasesTagsHtml(r.clase) : '<span class="muted">-</span>'}</td>
          <td class="c">${esc(r.examinador)}</td>
          <td>${esc(r.motivo)}</td>
          <td class="c" style="white-space:nowrap">
            ${esBloqueo
              ? `<button class="btn chico" data-cola="${r.id}" style="${estaActivo ? 'background:#059669;color:#fff' : 'background:#10b981;border-color:#059669;color:#fff'};font-weight:700;margin-right:4px">${estaActivo ? '✓ Seleccionado' : 'Asignar hora'}</button>
                 <button class="btn chico sec" data-desc="${r.id}" style="color:#b91c1c;font-weight:600">Descartar</button>`
              : `<button class="btn chico" data-id="${r.id}" style="${estaActivo ? 'background:#059669;color:#fff' : 'background:#1d4ed8'};font-weight:700">${estaActivo ? '✓ Seleccionado' : 'Reagendar'}</button>`
            }
          </td>
        </tr>`;
      }).join('');

      tb.querySelectorAll('button[data-id]').forEach((el) => {
        el.onclick = () => detalleReagendar(Number(el.dataset.id));
      });
      tb.querySelectorAll('button[data-cola]').forEach((el) => {
        el.onclick = () => detalleCola(cola.find((c) => c.id === Number(el.dataset.cola)));
      });
      tb.querySelectorAll('button[data-desc]').forEach((el) => {
        el.onclick = async () => {
          if (!confirm('¿Seguro que deseas descartar a este postulante de la lista de reagendamiento?')) return;
          try {
            await api(`/cola-reagendar/${el.dataset.desc}/descartar`, { method: 'POST', body: { nota: 'Descartado por funcionario' } });
            toast('Postulante descartado');
            if (reagendarSeleccion && reagendarSeleccion.tipo === 'cola' && reagendarSeleccion.id === Number(el.dataset.desc)) {
              reagendarSeleccion = null;
            }
            renderReagendar();
            actualizarBadgeReagendar();
          } catch (e) { toast(e.message, 'err'); }
        };
      });
    };

    pintarFilas();
  } catch (err) {
    const tb = $('#r-tabla-unificada');
    if (tb) tb.innerHTML = `<tr><td colspan="9" class="c muted" style="color:var(--error);padding:1.5rem">Error al cargar listado: ${esc(err.message)}</td></tr>`;
  }
}

function pintarPanelTopReagendar() {
  const cont = $('#r-detalle');
  if (!cont) return;

  if (!filtReag.desde) filtReag.desde = sumarDias(hoy(), 1);
  if (!filtReag.hasta) filtReag.hasta = sumarDias(hoy(), 30);

  if (!reagendarSeleccion) {
    cont.innerHTML = `
      <div class="panel" style="border:1px solid var(--linea);box-shadow:0 3px 12px rgba(27,58,117,.06);margin-bottom:1.25rem;background:#f8fafc">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
          <div>
            <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--azul)">Reagendamiento de Citas</div>
            <h3 style="margin:2px 0 0;color:var(--azul-900);font-size:1.15rem">Búsqueda y Reubicación de Cupos Libres</h3>
          </div>
          <span class="pastilla" style="font-weight:600;background:#e2e8f0;color:var(--tinta-2)">Selecciona un postulante para moverlo</span>
        </div>

        <div class="fila" style="align-items:flex-end;gap:12px;background:#fff;padding:.85rem;border-radius:6px;border:1px solid var(--linea)">
          <div class="campo"><label>Destino desde</label><input type="date" id="rd-desde" value="${filtReag.desde}"></div>
          <div class="campo"><label>Hasta</label><input type="date" id="rd-hasta" value="${filtReag.hasta}"></div>
          <div class="campo"><label>Examinador</label>
            <select id="rd-exam">
              <option value="">Cualquiera</option>
              ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(filtReag.examinador_id) === String(e.id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
            </select>
          </div>
          <button class="btn" id="rd-buscar" style="background:#1d4ed8;font-weight:700">Ver bloques libres</button>
        </div>

        <div id="rd-ayuda" style="margin-top:.75rem;padding:.65rem .85rem;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;color:#1e40af;font-size:13px;display:flex;align-items:center;gap:8px">
          <span style="font-size:16px">👉</span>
          <div>Haz clic en <b>Reagendar</b> en cualquiera de los postulantes de abajo (o en <b>Asignar hora</b> si fue por bloqueo) para asignarle un nuevo cupo libre.</div>
        </div>

        <div id="rd-tabla-prev" class="tabla-scroll" style="display:none;margin-top:.75rem;max-height:300px;overflow-y:auto">
          <table>
            <thead>
              <tr>
                <th class="c" style="width:110px">Fecha</th>
                <th class="c" style="width:80px">Hora</th>
                <th class="c">Examinador disponible</th>
                <th class="c" style="width:140px">Estado</th>
              </tr>
            </thead>
            <tbody id="rd-body"></tbody>
          </table>
        </div>
      </div>`;

    $('#rd-buscar').onclick = async () => {
      filtReag.desde = $('#rd-desde').value;
      filtReag.hasta = $('#rd-hasta').value;
      filtReag.examinador_id = $('#rd-exam').value;
      const q = new URLSearchParams({ desde: filtReag.desde, hasta: filtReag.hasta });
      if (filtReag.examinador_id) q.set('examinador_id', filtReag.examinador_id);
      $('#rd-tabla-prev').style.display = 'block';
      $('#rd-body').innerHTML = '<tr><td colspan="4" class="c muted" style="padding:1rem">Buscando cupos libres...</td></tr>';
      try {
        const libres = await api(`/disponibles?${q}`);
        $('#rd-body').innerHTML = libres.length ? libres.map((l) => `<tr>
          <td class="c"><b>${esc(fFecha(l.fecha))}</b></td>
          <td class="c"><b>${esc(l.hora)}</b></td>
          <td class="c">${esc(l.examinador)}</td>
          <td class="c"><span class="badge-ok" style="background:#e0f2fe;color:#0369a1;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:700">Cupo libre</span></td></tr>`).join('')
          : licoVacioFila(4, 'alerta', 'Sin cupos en este rango', 'No hay bloques libres en este rango de fechas. Prueba ampliarlo.');
      } catch (e) {
        $('#rd-body').innerHTML = `<tr><td colspan="4" class="c muted" style="color:var(--error);padding:1rem">Error al buscar: ${esc(e.message)}</td></tr>`;
      }
    };
    return;
  }

  // Si hay postulante de agenda seleccionado:
  if (reagendarSeleccion.tipo === 'agenda') {
    const cita = reagendarSeleccion.cita;
    const pesada = cita.clase && META.clases_pesadas.includes(cita.clase);
    cont.innerHTML = `
      <div class="panel" style="border:2px solid var(--azul);box-shadow:0 6px 20px rgba(27,58,117,.15);margin-bottom:1.25rem;background:#f8fafc">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.75rem">
          <div>
            <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--azul)">Reagendamiento en curso</div>
            <h3 style="margin:2px 0 4px;color:var(--azul-900);font-size:1.25rem">
              <b>${esc(nom(cita.nombre) || '(SIN NOMBRE)')}</b>
              <span style="font-weight:400;font-size:13.5px;color:var(--tinta-2);margin-left:8px">RUT: <b style="font-family:monospace">${esc(cita.rut || 'sin RUT')}</b> · Clase: <b>${esc(cita.clase || '-')}</b></span>
            </h3>
            <p class="muted" style="margin:0;font-size:13px">
              Cita actual que se cambiará: <b>${esc(fFecha(cita.fecha))} a las ${esc(cita.hora)} hrs</b> con <b>${esc(cita.examinador || 'No asignado')}</b>
            </p>
          </div>
          <button type="button" class="btn chico sec" id="rd-cerrar" style="font-weight:700">✕ Cancelar selección</button>
        </div>

        <div class="fila" style="align-items:flex-end;gap:12px;background:#fff;padding:.85rem;border-radius:6px;border:1px solid var(--linea)">
          <div class="campo"><label>Destino desde</label><input type="date" id="rd-desde" value="${filtReag.desde}"></div>
          <div class="campo"><label>Hasta</label><input type="date" id="rd-hasta" value="${filtReag.hasta}"></div>
          <div class="campo"><label>Examinador</label>
            <select id="rd-exam">
              <option value="">Cualquiera</option>
              ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(filtReag.examinador_id) === String(e.id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
            </select>
          </div>
          <button class="btn" id="rd-buscar" style="background:#1d4ed8;font-weight:700">Ver bloques libres</button>
        </div>

        ${pesada ? `<p class="muted" style="margin:.5rem 0 0;color:var(--pesada);font-weight:700">⚠ Clase ${esc(cita.clase)}: destino limitado al bloque ${esc(META.hora_d_a5)}.</p>` : ''}

        <div class="campo" style="margin-top:.75rem">
          <label>Motivo del reagendamiento</label>
          <input id="rd-motivo" value="${esc(cita.motivo_reagendamiento || cita.pendiente_nota || 'POSTULANTE SOLICITA CAMBIO')}">
        </div>

        <div class="tabla-scroll" style="margin-top:.75rem;max-height:360px;overflow-y:auto">
          <table>
            <thead>
              <tr>
                <th class="c" style="width:110px">Fecha</th>
                <th class="c" style="width:80px">Hora</th>
                <th class="c">Examinador disponible</th>
                <th class="c" style="width:140px">Acción</th>
              </tr>
            </thead>
            <tbody id="rd-body"><tr><td colspan="4" class="c muted" style="padding:1.5rem">Buscando bloques libres...</td></tr></tbody>
          </table>
        </div>
      </div>`;

    $('#rd-cerrar').onclick = () => {
      reagendarSeleccion = null;
      renderReagendar();
    };

    const buscarLibres = async () => {
      filtReag.desde = $('#rd-desde').value;
      filtReag.hasta = $('#rd-hasta').value;
      filtReag.examinador_id = $('#rd-exam').value;
      const q = new URLSearchParams({ desde: filtReag.desde, hasta: filtReag.hasta });
      if (filtReag.examinador_id) q.set('examinador_id', filtReag.examinador_id);
      if (pesada) q.set('clase', cita.clase);
      try {
        const libres = await api(`/disponibles?${q}`);
        $('#rd-body').innerHTML = libres.length ? libres.map((l) => `<tr>
          <td class="c"><b>${esc(fFecha(l.fecha))}</b></td>
          <td class="c"><b>${esc(l.hora)}</b></td>
          <td class="c">${esc(l.examinador)}</td>
          <td class="c"><button class="btn chico" data-id="${l.id}" style="background:#10b981;border-color:#059669;color:#fff;font-weight:700">Mover aquí</button></td></tr>`).join('')
          : '<tr><td colspan="4" class="c muted" style="padding:1.5rem">No se encontraron bloques libres en este rango de fechas. Amplía el rango "Hasta" para buscar más adelante.</td></tr>';

        $('#rd-body').querySelectorAll('button[data-id]').forEach((el) => {
          el.onclick = async () => {
            const lId = Number(el.dataset.id);
            const selSlot = libres.find((x) => x.id === lId);
            const fechaTxt = selSlot ? `${fFecha(selSlot.fecha)} a las ${selSlot.hora}` : 'el nuevo horario';
            if (!confirm(`¿Confirmar el reagendamiento de ${nom(cita.nombre) || cita.rut} para ${fechaTxt}?`)) return;
            try {
              await api(`/agenda/${cita.id}/reagendar`, { method: 'POST', body: { destino_id: lId, motivo: $('#rd-motivo').value } });
              toast('¡Cita reagendada con éxito!', 'ok');
              reagendarSeleccion = null;
              actualizarBadgeReagendar();
              renderReagendar();
            } catch (e) { toast(e.message, 'err'); }
          };
        });
      } catch (e) {
        $('#rd-body').innerHTML = `<tr><td colspan="4" class="c muted" style="color:var(--error);padding:1.5rem">Error al buscar: ${esc(e.message)}</td></tr>`;
      }
    };

    $('#rd-buscar').onclick = buscarLibres;
    buscarLibres();
    cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  // Si hay postulante de cola de bloqueos seleccionado:
  if (reagendarSeleccion.tipo === 'cola') {
    const item = reagendarSeleccion.item;
    const pesada = String(item.clase || '').split(',').some((c) => META.clases_pesadas.includes(c.trim()));
    cont.innerHTML = `
      <div class="panel" style="border:2px solid #10b981;box-shadow:0 6px 20px rgba(16,185,129,.15);margin-bottom:1.25rem;background:#f0fdf4">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.75rem">
          <div>
            <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#047857">Asignación de cupo por bloqueo</div>
            <h3 style="margin:2px 0 4px;color:#065f46;font-size:1.25rem">
              <b>${esc(nom(item.nombre) || '(SIN NOMBRE)')}</b>
              <span style="font-weight:400;font-size:13.5px;color:var(--tinta-2);margin-left:8px">RUT: <b style="font-family:monospace">${esc(item.rut || 'sin RUT')}</b> · Clase: <b>${esc(item.clase || '-')}</b></span>
            </h3>
            <p class="muted" style="margin:0;font-size:13px">
              Cita original afectada: <b>${esc(fFecha(item.origen_fecha))} a las ${esc(item.origen_hora)} hrs</b> con <b>${esc(item.origen_examinador || 'No asignado')}</b> (${esc(item.motivo || 'Bloqueo')})
            </p>
          </div>
          <button type="button" class="btn chico sec" id="rd-cerrar" style="font-weight:700">✕ Cancelar selección</button>
        </div>

        <div class="fila" style="align-items:flex-end;gap:12px;background:#fff;padding:.85rem;border-radius:6px;border:1px solid var(--linea)">
          <div class="campo"><label>Destino desde</label><input type="date" id="rd-desde" value="${filtReag.desde}"></div>
          <div class="campo"><label>Hasta</label><input type="date" id="rd-hasta" value="${filtReag.hasta}"></div>
          <div class="campo"><label>Examinador</label>
            <select id="rd-exam">
              <option value="">Cualquiera</option>
              ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(filtReag.examinador_id) === String(e.id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
            </select>
          </div>
          <button class="btn" id="rd-buscar" style="background:#10b981;border-color:#059669;color:#fff;font-weight:700">Ver bloques libres</button>
        </div>

        ${pesada ? `<p class="muted" style="margin:.5rem 0 0;color:var(--pesada);font-weight:700">⚠ Clase ${esc(item.clase)}: solo bloques de las ${esc(META.hora_d_a5)}.</p>` : ''}

        <div class="campo" style="margin-top:.75rem">
          <label>Correo para confirmación (opcional)</label>
          <input id="rd-cola-correo" type="email" value="${esc(item.correo || '')}" placeholder="ejemplo@correo.cl">
        </div>

        <div class="tabla-scroll" style="margin-top:.75rem;max-height:360px;overflow-y:auto">
          <table>
            <thead>
              <tr>
                <th class="c" style="width:110px">Fecha</th>
                <th class="c" style="width:80px">Hora</th>
                <th class="c">Examinador disponible</th>
                <th class="c" style="width:160px">Acción</th>
              </tr>
            </thead>
            <tbody id="rd-body"><tr><td colspan="4" class="c muted" style="padding:1.5rem">Buscando bloques libres...</td></tr></tbody>
          </table>
        </div>
      </div>`;

    $('#rd-cerrar').onclick = () => {
      reagendarSeleccion = null;
      renderReagendar();
    };

    const buscarLibresCola = async () => {
      filtReag.desde = $('#rd-desde').value;
      filtReag.hasta = $('#rd-hasta').value;
      filtReag.examinador_id = $('#rd-exam').value;
      const q = new URLSearchParams({ desde: filtReag.desde, hasta: filtReag.hasta });
      if (filtReag.examinador_id) q.set('examinador_id', filtReag.examinador_id);
      if (pesada) q.set('clase', 'D');
      try {
        const libres = await api(`/disponibles?${q}`);
        $('#rd-body').innerHTML = libres.length ? libres.map((l) => `<tr>
          <td class="c"><b>${esc(fFecha(l.fecha))}</b></td>
          <td class="c"><b>${esc(l.hora)}</b></td>
          <td class="c">${esc(l.examinador)}</td>
          <td class="c"><button class="btn chico" data-id="${l.id}" style="background:#10b981;border-color:#059669;color:#fff;font-weight:700">Asignar este cupo</button></td></tr>`).join('')
          : '<tr><td colspan="4" class="c muted" style="padding:1.5rem">No se encontraron bloques libres en este rango de fechas. Amplía el rango "Hasta" para buscar más adelante.</td></tr>';

        $('#rd-body').querySelectorAll('button[data-id]').forEach((el) => {
          el.onclick = async () => {
            const lId = Number(el.dataset.id);
            const selSlot = libres.find((x) => x.id === lId);
            const fechaTxt = selSlot ? `${fFecha(selSlot.fecha)} a las ${selSlot.hora}` : 'el nuevo horario';
            if (!confirm(`¿Confirmar asignación de hora para ${nom(item.nombre) || item.rut} el ${fechaTxt}?`)) return;
            try {
              const r = await api(`/cola-reagendar/${item.id}/asignar`, {
                method: 'POST',
                body: { destino_id: lId, correo: $('#rd-cola-correo').value }
              });
              toast('¡Hora asignada exitosamente!', 'ok');
              (r.avisos || []).forEach((a) => toast(a, 'alerta'));
              reagendarSeleccion = null;
              actualizarBadgeReagendar();
              renderReagendar();
            } catch (e) { toast(e.message, 'err'); }
          };
        });
      } catch (e) {
        $('#rd-body').innerHTML = `<tr><td colspan="4" class="c muted" style="color:var(--error);padding:1.5rem">Error al buscar: ${esc(e.message)}</td></tr>`;
      }
    };

    $('#rd-buscar').onclick = buscarLibresCola;
    buscarLibresCola();
    cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
}

async function detalleReagendar(id) {
  try {
    const cita = await api(`/agenda/${id}`);
    reagendarSeleccion = { tipo: 'agenda', id, cita };
    renderReagendar();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function detalleCola(item) {
  reagendarSeleccion = { tipo: 'cola', id: item.id, item };
  renderReagendar();
}
