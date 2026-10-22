/* ================= tab: AGENDA ================= */
let estadoAgenda = { fecha: null, examinador_id: '', filtro: '' };
let filtAgenda = { desde: null, hasta: null, clase: '', examinador_id: '', esRango: false };
const AGENDA_KEY_PLEGADO = 'agenda-filtros-plegado';
function agendaLeerPlegado() { try { return localStorage.getItem(AGENDA_KEY_PLEGADO) === '1'; } catch { return false; } }
function agendaGuardarPlegado(v) { try { localStorage.setItem(AGENDA_KEY_PLEGADO, v ? '1' : '0'); } catch { /* sin almacenamiento */ } }

async function renderAgenda() {
  if (!estadoAgenda.fecha) estadoAgenda.fecha = await fechaInicialAgenda();
  if (!filtAgenda.desde) {
    filtAgenda.desde = estadoAgenda.fecha;
    filtAgenda.hasta = estadoAgenda.fecha;
    filtAgenda.examinador_id = estadoAgenda.examinador_id || '';
    filtAgenda.esRango = false;
  }
  const plegado = agendaLeerPlegado();
  view.innerHTML = `
    <div class="panel no-print panel-fijo agenda-toolbar">
      <div class="disp-filtros-cab" style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:.75rem">
          <button type="button" class="btn-plegar" id="a-plegar" aria-expanded="${!plegado}" aria-controls="a-campos" style="font-size:13px;font-weight:800;color:var(--azul-900,#172b4d);letter-spacing:0.04em">
            FILTROS <span aria-hidden="true" id="a-plegar-flecha">${plegado ? '▸' : '▾'}</span>
          </button>
          <span class="muted disp-resumen" id="a-resumen" aria-live="polite" style="font-size:13px;font-weight:600;color:var(--muted)"></span>
        </div>
        <div id="a-pills-slot" class="tabla-filtros-rapidos-slot" style="margin-left:auto;display:flex;align-items:center;gap:6px"></div>
      </div>

      <!-- Fila 1 Desplegable: Búsqueda y Rango de Fechas -->
      <div id="a-campos" ${plegado ? 'hidden' : ''} style="margin-bottom:10px">
        <div class="fila" style="align-items:flex-end;gap:6px;flex-wrap:wrap">
          <button class="btn sec" id="dia-prev" style="padding:.45rem .65rem;height:38px" title="Día anterior">&#8592;</button>
          <div class="campo">
            <label for="a-fecha" style="font-weight:700;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted)">FECHA / DESDE</label>
            <input type="date" id="a-fecha" value="${esc(estadoAgenda.fecha)}">
          </div>
          <button class="btn sec" id="dia-next" style="padding:.45rem .65rem;height:38px" title="Día siguiente">&#8594;</button>
          <button class="btn sec" id="a-hoy" style="height:38px" title="Ir al día actual o primer día con agenda">Hoy</button>

          <div class="campo">
            <label for="a-hasta" style="font-weight:700;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted)">HASTA</label>
            <input type="date" id="a-hasta" value="${esc(filtAgenda.hasta || estadoAgenda.fecha)}">
          </div>

          <div class="campo">
            <label for="a-clase" style="font-weight:700;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted)">CLASE</label>
            <select id="a-clase">
              <option value="">--</option>
              ${opt(META.catalogos.clase, filtAgenda.clase)}
            </select>
          </div>

          <div class="campo">
            <label for="a-exam" style="font-weight:700;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted)">EXAMINADOR</label>
            <select id="a-exam">
              <option value="">Todos</option>
              ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(e.id) === String(estadoAgenda.examinador_id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
            </select>
          </div>

          <button class="btn" id="a-buscar" style="height:38px;padding:0 18px;border-radius:20px;font-weight:700" title="Ver agenda completa de cupos y citas en el rango seleccionado">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" style="vertical-align:middle;margin-right:4px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Buscar
          </button>

          <span class="muted" id="a-regla" style="font-size:12px;font-weight:600;align-self:center;margin-left:6px;line-height:1.2"></span>
        </div>
      </div>

      <!-- Fila 2: Acciones permanentes de la Agenda (Vistas, Bloqueos, Imprimir y Buscador de RUT) -->
      <div style="width:100%;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px solid rgba(0,0,0,0.06)">
        <span class="pastilla" id="a-libres" data-tooltip="Total de horas disponibles para agendar en la fecha seleccionada">— bloques libres</span>
        
        <button class="btn btn-bloq-accion" id="a-bloqdia" data-tooltip="Inhabilita franjas horarias por licencias, feriados, capacitaciones o terreno (envía citas a Reagendar)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Bloquear
        </button>
        <button class="btn btn-desbloq-accion" id="a-desbloqdia" data-tooltip="Libera y reactiva bloques previamente bloqueados para volver a citar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
          Desbloquear
        </button>
        <span class="agenda-acciones-dia" id="a-acciones-dia" style="display:inline-flex;gap:6px;flex-wrap:wrap">
          <button class="btn sec" id="a-imprimir" type="button" data-tooltip="Imprime la agenda de la fecha y examinador seleccionados, ordenada por hora">🖨 Imprimir día</button>
        </span>
        <div class="tabla-busc-wrap" style="flex:1 1 360px;min-width:280px;max-width:560px;margin-left:auto">
          <svg class="tabla-busc-ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.5 12.5l4.5 4.5"/></svg>
          <input type="search" id="tabla-busc-input" class="tabla-busc-input" placeholder="Buscar RUT o nombre" autocomplete="off" style="height:38px">
        </div>
      </div>
    </div>
    <div class="panel"><div id="a-grid">Cargando...</div></div>`;

  const resumenAgenda = () => {
    const ex = META.examinadores.find((e) => String(e.id) === String(estadoAgenda.examinador_id));
    const rEl = $('#a-resumen');
    if (rEl) {
      const periodo = filtAgenda.esRango && filtAgenda.desde && filtAgenda.hasta && filtAgenda.desde !== filtAgenda.hasta
        ? `${fFecha(filtAgenda.desde)} – ${fFecha(filtAgenda.hasta)}`
        : fFecha(estadoAgenda.fecha);
      rEl.textContent = [
        `📅 ${periodo}`,
        filtAgenda.clase ? `Clase ${filtAgenda.clase}` : '',
        ex ? ex.nombre : 'Todos los examinadores',
      ].filter(Boolean).join(' · ');
    }
  };

  const plegarAgenda = (v) => {
    const campos = $('#a-campos');
    if (campos) campos.hidden = v;
    const b = $('#a-plegar');
    if (b) {
      b.setAttribute('aria-expanded', String(!v));
      const f = $('#a-plegar-flecha');
      if (f) f.textContent = v ? '▸' : '▾';
    }
    const rEl = $('#a-resumen');
    if (rEl) rEl.hidden = !v;
    agendaGuardarPlegado(v);
    setTimeout(ajustarOffsetsFijos, 0);
  };

  if ($('#a-plegar')) $('#a-plegar').onclick = () => plegarAgenda(!$('#a-campos').hidden);
  if ($('#a-resumen')) $('#a-resumen').hidden = !plegado;
  resumenAgenda();

  let totalLibresRango = null;
  const actualizarConteoRango = async () => {
    try {
      const desde = ($('#a-fecha') && $('#a-fecha').value) || filtAgenda.desde || estadoAgenda.fecha;
      const hasta = ($('#a-hasta') && $('#a-hasta').value) || filtAgenda.hasta;
      const clase = ($('#a-clase') && $('#a-clase').value) || filtAgenda.clase;
      const exam = ($('#a-exam') && $('#a-exam').value) || filtAgenda.examinador_id;
      if (!desde || !hasta || hasta < desde) return;

      const qDisp = new URLSearchParams(Object.fromEntries(Object.entries({
        desde,
        hasta,
        clase,
        examinador_id: exam,
      }).filter(([, v]) => v)));
      const rows = await apiReciente(`/disponibles?${qDisp}`, 15e3);
      if (Array.isArray(rows)) {
        totalLibresRango = rows.length;
        const pesada = META.clases_pesadas.includes(clase);
        const reglaPesada = pesada ? `Clase ${clase}: solo bloques de las ${META.hora_d_a5}.` : '';
        const reglaEl = $('#a-regla');
        if (reglaEl) {
          reglaEl.textContent = rows.length
            ? `${reglaPesada ? reglaPesada + ' · ' : ''}${rows.length} bloque(s) libre(s) en el rango.`
            : (reglaPesada ? reglaPesada + ' · Sin bloques libres en el rango.' : 'Sin bloques libres en el rango.');
        }
      }
    } catch (_) {}
  };
  actualizarConteoRango();

  $('#a-buscar').onclick = async () => {
    filtAgenda.desde = $('#a-fecha').value;
    filtAgenda.hasta = $('#a-hasta').value;
    filtAgenda.clase = $('#a-clase').value;
    filtAgenda.examinador_id = $('#a-exam').value;
    estadoAgenda.examinador_id = filtAgenda.examinador_id;
    estadoAgenda.fecha = filtAgenda.desde;
    filtAgenda.esRango = Boolean(filtAgenda.hasta && filtAgenda.desde && filtAgenda.desde !== filtAgenda.hasta);
    actualizarConteoRango();
    renderAgenda();
  };

  $('#a-fecha').onchange = (e) => {
    estadoAgenda.fecha = e.target.value;
    filtAgenda.desde = e.target.value;
    if ($('#a-hasta') && (!filtAgenda.hasta || filtAgenda.hasta < filtAgenda.desde)) {
      filtAgenda.hasta = filtAgenda.desde;
      $('#a-hasta').value = filtAgenda.desde;
    }
    if (filtAgenda.desde === filtAgenda.hasta) {
      filtAgenda.esRango = false;
    }
    actualizarConteoRango();
    renderAgenda();
  };
  $('#a-hasta').onchange = (e) => {
    filtAgenda.hasta = e.target.value;
    actualizarConteoRango();
  };
  $('#a-clase').onchange = (e) => {
    filtAgenda.clase = e.target.value;
    actualizarConteoRango();
  };
  $('#a-exam').onchange = (e) => {
    estadoAgenda.examinador_id = e.target.value;
    filtAgenda.examinador_id = e.target.value;
    renderAgenda();
  };
  $('#dia-prev').onclick = async () => {
    estadoAgenda.fecha = await proximoDiaConAgenda(estadoAgenda.fecha, -1);
    filtAgenda.desde = estadoAgenda.fecha;
    filtAgenda.hasta = estadoAgenda.fecha;
    filtAgenda.esRango = false;
    renderAgenda();
  };
  $('#dia-next').onclick = async () => {
    estadoAgenda.fecha = await proximoDiaConAgenda(estadoAgenda.fecha, 1);
    filtAgenda.desde = estadoAgenda.fecha;
    filtAgenda.hasta = estadoAgenda.fecha;
    filtAgenda.esRango = false;
    renderAgenda();
  };
  $('#a-hoy').onclick = async () => {
    estadoAgenda.fecha = await fechaInicialAgenda();
    filtAgenda.desde = estadoAgenda.fecha;
    filtAgenda.hasta = estadoAgenda.fecha;
    filtAgenda.esRango = false;
    renderAgenda();
  };
  $('#a-bloqdia').onclick = () => dialogoBloquearDia();
  $('#a-desbloqdia').onclick = () => dialogoDesbloquearDia();
  $('#a-imprimir').onclick = () => dialogoImprimirDia(estadoAgenda.fecha, estadoAgenda.examinador_id);
  if ($('#a-porconfirmar')) $('#a-porconfirmar').onclick = () => irA('porconfirmar');


  const q = new URLSearchParams();
  if (filtAgenda.esRango && filtAgenda.desde && filtAgenda.hasta && filtAgenda.desde !== filtAgenda.hasta) {
    q.set('desde', filtAgenda.desde);
    q.set('hasta', filtAgenda.hasta);
  } else {
    q.set('fecha', estadoAgenda.fecha || filtAgenda.desde);
  }
  if (estadoAgenda.examinador_id) q.set('examinador_id', estadoAgenda.examinador_id);
  if (filtAgenda.clase) q.set('clase', filtAgenda.clase);

  const fechaRef = estadoAgenda.fecha || filtAgenda.desde;
  await cargarVista('agenda', `/agenda?${q}`, (filas) => {
    const libres = filas.filter((f) => !f.rut && !f.nombre && !f.bloqueado).length;
    $('#a-libres').textContent = `${libres} ${libres === 1 ? 'bloque libre' : 'bloques libres'}`;
    pintarGrilla($('#a-grid'), filas, fechaRef);
    restaurarScroll();
    setTimeout(ajustarOffsetsFijos, 0);
  });

  actualizarBadgePapelera();
  if (window.ListaEspera) window.ListaEspera.badge();
  actualizarBadgeErrores();
  actualizarBadgeReagendar();
  actualizarBadgePorConfirmar();
}

