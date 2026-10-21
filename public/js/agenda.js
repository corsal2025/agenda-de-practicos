/* ================= tab: AGENDA ================= */
let estadoAgenda = { fecha: null, examinador_id: '', filtro: '' };
let filtAgenda = { desde: null, hasta: null, clase: '', examinador_id: '', buscandoRango: false };
const AGENDA_KEY_PLEGADO = 'agenda-filtros-plegado';
function agendaLeerPlegado() { try { return localStorage.getItem(AGENDA_KEY_PLEGADO) === '1'; } catch { return false; } }
function agendaGuardarPlegado(v) { try { localStorage.setItem(AGENDA_KEY_PLEGADO, v ? '1' : '0'); } catch { /* sin almacenamiento */ } }

async function renderAgenda() {
  if (!estadoAgenda.fecha) estadoAgenda.fecha = await fechaInicialAgenda();
  if (!filtAgenda.desde) {
    filtAgenda.desde = estadoAgenda.fecha;
    filtAgenda.hasta = sumarDias(estadoAgenda.fecha, 60);
    filtAgenda.examinador_id = estadoAgenda.examinador_id || '';
  }
  const plegado = agendaLeerPlegado();

  view.innerHTML = `
    <div class="panel no-print panel-fijo disp-filtros agenda-filtros">
      <div class="disp-filtros-cab">
        <button type="button" class="btn-plegar" id="af-plegar" aria-expanded="${!plegado}" aria-controls="af-campos">
          Filtros <span aria-hidden="true">${plegado ? '▸' : '▾'}</span>
        </button>
        <span class="muted disp-resumen" id="af-resumen" aria-live="polite"></span>
      </div>
      <div id="af-campos" class="disp-campos" ${plegado ? 'hidden' : ''}>
        <div class="af-contenedor-grid">
          <!-- Columna 1: Consultar cupos disponibles -->
          <div class="af-seccion af-seccion-busqueda">
            <div class="af-seccion-titulo">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <span>Consultar cupos disponibles</span>
            </div>
            <div class="fila" style="align-items:flex-end;gap:10px;flex-wrap:wrap">
              <div class="campo"><label for="af-desde">Desde</label><input type="date" id="af-desde" value="${esc(filtAgenda.desde)}"></div>
              <div class="campo"><label for="af-hasta">Hasta</label><input type="date" id="af-hasta" value="${esc(filtAgenda.hasta)}"></div>
              <div class="campo"><label for="af-clase">Clase</label><select id="af-clase"><option value="">--</option>${opt(META.catalogos.clase, filtAgenda.clase)}</select></div>
              <div class="campo"><label for="af-exam">Examinador</label><select id="af-exam"><option value="">Todos</option>
                ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(e.id) === String(filtAgenda.examinador_id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select>
              </div>
              <button class="btn" id="af-buscar">Buscar</button>
            </div>
            <p class="muted" id="af-regla" style="margin:.3rem 0 0 0;font-size:12px"></p>
          </div>

          <!-- Divisor visual -->
          <div class="af-divisor" aria-hidden="true"></div>

          <!-- Columna 2: Bloquear horario de examinador en pantalla -->
          <div class="af-seccion af-seccion-bloqueo">
            <div class="af-seccion-titulo" style="color:var(--alerta, #dc2626)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span>Bloquear horario de examinador</span>
            </div>
            <div class="fila" style="align-items:flex-end;gap:10px;flex-wrap:wrap">
              <div class="campo" style="min-width:180px">
                <label for="af-bloq-motivo">Motivo</label>
                <select id="af-bloq-motivo">
                  <option value="FERIADO LEGAL">Vacaciones / Feriado Legal</option>
                  <option value="PERMISO ADMINISTRATIVO">Permiso Administrativo</option>
                  <option value="LICENCIA MEDICA">Licencia Médica</option>
                  <option value="COMPENSATORIO">Día Compensatorio</option>
                  <option value="CAPACITACION">Capacitación</option>
                  <option value="TERRENO">Examen en Terreno</option>
                  <option value="__otro">Otro motivo...</option>
                </select>
              </div>
              <div class="campo" id="af-bloq-otro-c" hidden style="min-width:140px">
                <label for="af-bloq-otro">¿Cuál motivo?</label>
                <input id="af-bloq-otro" placeholder="Ej: Comisión">
              </div>
              <div class="campo" style="min-width:170px">
                <label for="af-bloq-horario">Horario / Franja</label>
                <select id="af-bloq-horario">
                  <option value="dia_completo">Todo el día</option>
                  <option value="manana">Mañana (08:30 – 11:00)</option>
                  <option value="tarde">Mediodía / Tarde (11:30 – 13:30)</option>
                  <optgroup label="Bloques individuales">
                    ${((META && META.horas) || ['08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30']).map((h) => `<option value="${h}">Solo ${h} hrs</option>`).join('')}
                  </optgroup>
                  <option value="__personalizado">⚙ Selección avanzada...</option>
                </select>
              </div>
              <div style="display:inline-flex;gap:8px;align-items:flex-end">
                <button class="btn btn-bloq-accion" id="af-btn-bloquear" title="Bloquea el examinador y horario seleccionado en las fechas Desde/Hasta indicadas">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" style="vertical-align:middle;margin-right:3px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  Bloquear en pantalla
                </button>
                <button class="btn btn-desbloq-accion" id="af-btn-desbloquear" type="button" title="Libera y desbloquea horarios previamente bloqueados">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" style="vertical-align:middle;margin-right:3px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                  Desbloquear
                </button>
              </div>
            </div>
            <p class="muted" style="margin:.3rem 0 0 0;font-size:11px" id="af-bloq-info">
              Aplica a las fechas <strong>Desde/Hasta</strong> y al <strong>Examinador</strong> seleccionado. Citas tomadas pasarán a Lista de Espera.
            </p>
          </div>
        </div>
      </div>

      <div class="fila" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid var(--linea)">
        <div style="display:flex;align-items:flex-end;gap:6px">
          <button class="btn sec" id="dia-prev" style="padding:.45rem .65rem" title="Día anterior">&#8592;</button>
          <div class="campo"><label>Fecha</label><input type="date" id="a-fecha" value="${estadoAgenda.fecha}"></div>
          <button class="btn sec" id="dia-next" style="padding:.45rem .65rem" title="Día siguiente">&#8594;</button>
          <button class="btn sec" id="a-hoy">Hoy</button>
          <div class="campo"><label>Examinador</label>
            <select id="a-exam"><option value="">Todos</option>
              ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(e.id) === String(estadoAgenda.examinador_id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
            </select></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="pastilla" id="a-libres" data-tooltip="Total de horas disponibles para agendar en la fecha seleccionada">— bloques libres</span>
          <div class="vista-selector" title="Elegir modalidad de visualización de la Agenda">
            <button type="button" class="btn-vista ${(estadoAgenda.modoVista || localStorage.getItem('agenda_modo_vista') || 'tabla') === 'tabla' ? 'activo' : ''}" id="btn-vista-tabla" title="Vista en tabla con columnas (distribución corporativa en columnas)">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2zm1 2v2h14V4H1zm0 3v2h14V7H1zm0 3v2h14v-2H1zm0 3v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1H1z"/></svg>
              <span>Tabla</span>
            </button>
            <button type="button" class="btn-vista ${(estadoAgenda.modoVista || localStorage.getItem('agenda_modo_vista') || 'tabla') === 'vertical' ? 'activo' : ''}" id="btn-vista-vertical" title="Vista vertical por examinador">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2zm7 0a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V2z"/></svg>
              <span>Vertical</span>
            </button>
            <button type="button" class="btn-vista ${(estadoAgenda.modoVista || localStorage.getItem('agenda_modo_vista') || 'tabla') === 'horizontal' ? 'activo' : ''}" id="btn-vista-horizontal" title="Vista horizontal continua (Línea de tiempo hacia el lado)">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm0 7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3z"/></svg>
              <span>Horizontal</span>
            </button>
          </div>
          
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
        </div>
      </div>
    </div>
    <div class="panel"><div id="a-grid">Cargando...</div></div>`;

  let totalLibresRango = null;
  const resumen = () => {
    const ex = META.examinadores.find((e) => String(e.id) === String(filtAgenda.examinador_id));
    const resEl = $('#af-resumen');
    if (resEl) {
      resEl.textContent = [
        `${fFecha(filtAgenda.desde)} – ${fFecha(filtAgenda.hasta)}`,
        filtAgenda.clase ? `Clase ${filtAgenda.clase}` : 'Todas las clases',
        ex ? ex.nombre : 'Todos los examinadores',
        totalLibresRango == null ? '' : `${totalLibresRango} libres`,
      ].filter(Boolean).join(' · ');
    }
  };

  const plegar = (v) => {
    $('#af-campos').hidden = v;
    const b = $('#af-plegar');
    b.setAttribute('aria-expanded', String(!v));
    b.querySelector('span').textContent = v ? '▸' : '▾';
    $('#af-resumen').hidden = !v;
    agendaGuardarPlegado(v);
    setTimeout(ajustarOffsetsFijos, 0);
  };
  $('#af-plegar').onclick = () => plegar(!$('#af-campos').hidden);
  $('#af-resumen').hidden = !plegado;

  const actualizarConteoRango = async () => {
    try {
      const qDisp = new URLSearchParams(Object.fromEntries(Object.entries({
        desde: filtAgenda.desde,
        hasta: filtAgenda.hasta,
        clase: filtAgenda.clase,
        examinador_id: filtAgenda.examinador_id,
      }).filter(([, v]) => v)));
      const rows = await apiReciente(`/disponibles?${qDisp}`, 15e3);
      if (Array.isArray(rows)) {
        totalLibresRango = rows.length;
        resumen();
        const pesada = META.clases_pesadas.includes(filtAgenda.clase);
        const reglaPesada = pesada ? `Clase ${filtAgenda.clase}: solo bloques de las ${META.hora_d_a5}.` : '';
        const reglaEl = $('#af-regla');
        if (reglaEl) {
          reglaEl.textContent = rows.length
            ? `${reglaPesada ? reglaPesada + ' · ' : ''}${rows.length} bloque(s) libre(s) en el rango.`
            : (reglaPesada ? reglaPesada + ' · Sin bloques libres en el rango.' : 'Sin bloques libres en el rango.');
        }
      }
    } catch (_) {}
  };
  actualizarConteoRango();

  $('#af-buscar').onclick = async () => {
    filtAgenda.desde = $('#af-desde').value;
    filtAgenda.hasta = $('#af-hasta').value;
    filtAgenda.clase = $('#af-clase').value;
    filtAgenda.examinador_id = $('#af-exam').value;
    estadoAgenda.examinador_id = filtAgenda.examinador_id;
    if ($('#a-exam')) $('#a-exam').value = filtAgenda.examinador_id;

    if (filtAgenda.desde === filtAgenda.hasta) {
      filtAgenda.buscandoRango = false;
      estadoAgenda.fecha = filtAgenda.desde;
      renderAgenda();
      return;
    }

    filtAgenda.buscandoRango = true;
    const qDisp = new URLSearchParams(Object.fromEntries(Object.entries({
      desde: filtAgenda.desde,
      hasta: filtAgenda.hasta,
      clase: filtAgenda.clase,
      examinador_id: filtAgenda.examinador_id,
    }).filter(([, v]) => v)));

    await cargarVista('agenda_rango', `/disponibles?${qDisp}`, (rows) => {
      totalLibresRango = rows.length;
      resumen();
      const pesada = META.clases_pesadas.includes(filtAgenda.clase);
      const reglaPesada = pesada ? `Clase ${filtAgenda.clase}: solo bloques de las ${META.hora_d_a5}.` : '';
      if ($('#af-regla')) {
        $('#af-regla').textContent = rows.length
          ? `${reglaPesada ? reglaPesada + ' · ' : ''}${rows.length} bloque(s) libre(s) en el rango.`
          : (reglaPesada ? reglaPesada + ' · Sin bloques libres en el rango.' : 'Sin bloques libres en el rango.');
      }
      pintarResultadosRangoEnAgenda(rows);
    });
  };

  /* Sincronización y eventos de bloqueo directo en pantalla */
  if ($('#af-desde')) {
    $('#af-desde').onchange = (e) => {
      filtAgenda.desde = e.target.value;
      if ($('#af-hasta') && (!filtAgenda.hasta || filtAgenda.hasta < filtAgenda.desde)) {
        filtAgenda.hasta = filtAgenda.desde;
        $('#af-hasta').value = filtAgenda.desde;
      }
      actualizarConteoRango();
    };
  }
  if ($('#af-hasta')) {
    $('#af-hasta').onchange = (e) => {
      filtAgenda.hasta = e.target.value;
      actualizarConteoRango();
    };
  }
  if ($('#af-exam')) {
    $('#af-exam').onchange = (e) => {
      filtAgenda.examinador_id = e.target.value;
      actualizarConteoRango();
    };
  }
  if ($('#af-clase')) {
    $('#af-clase').onchange = (e) => {
      filtAgenda.clase = e.target.value;
      actualizarConteoRango();
    };
  }

  const bloqMotivoEl = $('#af-bloq-motivo');
  if (bloqMotivoEl) {
    bloqMotivoEl.onchange = () => {
      const esOtro = bloqMotivoEl.value === '__otro';
      const cOtro = $('#af-bloq-otro-c');
      if (cOtro) cOtro.hidden = !esOtro;
    };
  }

  const bloqHorarioEl = $('#af-bloq-horario');
  if (bloqHorarioEl) {
    bloqHorarioEl.onchange = () => {
      if (bloqHorarioEl.value === '__personalizado') {
        bloqHorarioEl.value = 'dia_completo';
        dialogoBloquearDia();
      }
    };
  }

  if ($('#af-btn-desbloquear')) {
    $('#af-btn-desbloquear').onclick = () => dialogoDesbloquearDia();
  }

  if ($('#af-btn-bloquear')) {
    $('#af-btn-bloquear').onclick = async () => {
      const desde = $('#af-desde') ? $('#af-desde').value : (filtAgenda.desde || estadoAgenda.fecha);
      const hasta = $('#af-hasta') ? $('#af-hasta').value : (filtAgenda.hasta || desde);
      if (!desde || hasta < desde) {
        return toast('Revisa las fechas: "Hasta" no puede ser anterior a "Desde".', 'err');
      }

      const examVal = $('#af-exam') ? $('#af-exam').value : (filtAgenda.examinador_id || '');
      const examId = examVal ? Number(examVal) : null;
      const examObj = examId ? META.examinadores.find((e) => String(e.id) === String(examId)) : null;

      let motivo = $('#af-bloq-motivo') ? $('#af-bloq-motivo').value : 'FERIADO LEGAL';
      if (motivo === '__otro') {
        motivo = ($('#af-bloq-otro') ? $('#af-bloq-otro').value : '').trim().toUpperCase();
        if (!motivo) return toast('Por favor escribe el motivo del bloqueo.', 'err');
      }

      const horVal = $('#af-bloq-horario') ? $('#af-bloq-horario').value : 'dia_completo';
      let horas = null;
      let labelHoras = 'todo el día';
      if (horVal === 'manana') {
        horas = ['08:30', '09:00', '09:30', '10:00', '10:30', '11:00'];
        labelHoras = 'mañana (08:30 a 11:00)';
      } else if (horVal === 'tarde') {
        horas = ['11:30', '12:00', '12:30', '13:00', '13:30'];
        labelHoras = 'mediodía / tarde (11:30 a 13:30)';
      } else if (horVal !== 'dia_completo') {
        horas = [horVal];
        labelHoras = `a las ${horVal} hrs`;
      }

      const dicMotivo = {
        'FERIADO LEGAL': 'Vacaciones / Feriado Legal',
        'PERMISO ADMINISTRATIVO': 'Permiso Administrativo',
        'LICENCIA MEDICA': 'Licencia Médica',
        'COMPENSATORIO': 'Día Compensatorio',
        'CAPACITACION': 'Capacitación',
        'TERRENO': 'Examen en Terreno',
        'BLOQUEADO': 'Bloqueo Administrativo'
      };
      const motivoTexto = dicMotivo[motivo] || motivo;
      const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 864e5) + 1;
      const targetExaminador = examObj ? examObj.nombre : 'TODOS los examinadores';
      const targetRango = desde === hasta ? `el día ${fFecha(desde)}` : `del ${fFecha(desde)} al ${fFecha(hasta)} (${dias} días)`;

      const confirmMsg = `¿Confirmas bloquear ${labelHoras} para ${targetExaminador} ${targetRango}?\n\nMotivo: ${motivoTexto}\n\nNota: Si existen postulantes citados, se enviarán automáticamente a la Lista de Espera con alta prioridad para reagendar.`;
      if (!confirm(confirmMsg)) return;

      try {
        $('#af-btn-bloquear').disabled = true;
        const body = {
          desde,
          hasta,
          examinador_id: examId,
          motivo,
          incluir_ocupados: true,
          horas,
        };
        const r = await api('/bloquear-dia', { method: 'POST', body });
        if (!r.bloqueados) {
          toast('No había bloques disponibles en ese horario para bloquear', 'err');
        } else {
          let msg = `🔒 ${r.bloqueados} ${r.bloqueados === 1 ? 'bloque bloqueado' : 'bloques bloqueados'}`;
          if (r.a_reagendar) msg += ` · ${r.a_reagendar} cita(s) enviada(s) a Lista de Espera`;
          toast(msg, 'ok');
          actualizarBadgeReagendar();
          vaciarCache();
          if (window.ListaEspera) window.ListaEspera.badge();
          estadoAgenda.fecha = desde;
          if (examId) estadoAgenda.examinador_id = String(examId);
          filtAgenda.buscandoRango = false;
          await renderAgenda();
          if (r.a_reagendar && confirm(`Se bloquearon los cupos y ${r.a_reagendar} postulante(s) fueron enviados a la Lista de Espera.\n\n¿Deseas ir a la Lista de Espera ahora?`)) {
            irA('espera');
          }
        }
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        if ($('#af-btn-bloquear')) $('#af-btn-bloquear').disabled = false;
      }
    };
  }

  $('#a-fecha').onchange = (e) => {
    estadoAgenda.fecha = e.target.value;
    filtAgenda.buscandoRango = false;
    renderAgenda();
  };
  $('#a-exam').onchange = (e) => {
    estadoAgenda.examinador_id = e.target.value;
    filtAgenda.examinador_id = e.target.value;
    if ($('#af-exam')) $('#af-exam').value = e.target.value;
    filtAgenda.buscandoRango = false;
    renderAgenda();
  };
  $('#dia-prev').onclick = async () => {
    estadoAgenda.fecha = await proximoDiaConAgenda(estadoAgenda.fecha, -1);
    filtAgenda.buscandoRango = false;
    renderAgenda();
  };
  $('#dia-next').onclick = async () => {
    estadoAgenda.fecha = await proximoDiaConAgenda(estadoAgenda.fecha, 1);
    filtAgenda.buscandoRango = false;
    renderAgenda();
  };
  $('#a-hoy').onclick = async () => {
    estadoAgenda.fecha = await fechaInicialAgenda();
    filtAgenda.buscandoRango = false;
    renderAgenda();
  };
  $('#a-bloqdia').onclick = () => dialogoBloquearDia();
  $('#a-desbloqdia').onclick = () => dialogoDesbloquearDia();
  $('#a-imprimir').onclick = () => dialogoImprimirDia(estadoAgenda.fecha, estadoAgenda.examinador_id);
  if ($('#a-porconfirmar')) $('#a-porconfirmar').onclick = () => irA('porconfirmar');

  const btnT = $('#btn-vista-tabla');
  const btnV = $('#btn-vista-vertical');
  const btnH = $('#btn-vista-horizontal');
  if (btnT) {
    btnT.onclick = () => {
      estadoAgenda.modoVista = 'tabla';
      localStorage.setItem('agenda_modo_vista', 'tabla');
      renderAgenda();
    };
  }
  if (btnV) {
    btnV.onclick = () => {
      estadoAgenda.modoVista = 'vertical';
      localStorage.setItem('agenda_modo_vista', 'vertical');
      renderAgenda();
    };
  }
  if (btnH) {
    btnH.onclick = () => {
      estadoAgenda.modoVista = 'horizontal';
      localStorage.setItem('agenda_modo_vista', 'horizontal');
      renderAgenda();
    };
  }

  if (!filtAgenda.buscandoRango) {
    const q = new URLSearchParams({ fecha: estadoAgenda.fecha });
    if (estadoAgenda.examinador_id) q.set('examinador_id', estadoAgenda.examinador_id);
    const fecha = estadoAgenda.fecha;
    await cargarVista('agenda', `/agenda?${q}`, (filas) => {
      const libres = filas.filter((f) => !f.rut && !f.nombre && !f.bloqueado).length;
      $('#a-libres').textContent = `${libres} ${libres === 1 ? 'bloque libre' : 'bloques libres'}`;
      pintarGrilla($('#a-grid'), filas, fecha);
      restaurarScroll();
      setTimeout(ajustarOffsetsFijos, 0);
    });
  }

  actualizarBadgePapelera();
  if (window.ListaEspera) window.ListaEspera.badge();
  actualizarBadgeErrores();
  actualizarBadgeReagendar();
  actualizarBadgePorConfirmar();
}

function pintarResultadosRangoEnAgenda(rows) {
  const cont = $('#a-grid');
  if (!cont) return;

  rows.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora) || a.examinador.localeCompare(b.examinador));

  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;background:var(--elev);padding:10px 14px;border-radius:var(--r-sm);border:1px solid var(--linea);flex-wrap:wrap;gap:8px">
      <div>
        <strong style="color:var(--azul)">🔎 ${rows.length} bloque(s) libre(s) encontrados</strong>
        <span class="muted" style="margin-left:8px">Entre ${fFecha(filtAgenda.desde)} y ${fFecha(filtAgenda.hasta)}</span>
        ${filtAgenda.clase ? `<span class="badge ok" style="margin-left:8px">Clase ${esc(filtAgenda.clase)}</span>` : ''}
      </div>
      <button class="btn sec chico" id="af-btn-volver-dia">
        📅 Ver día a día en Agenda (${fFecha(estadoAgenda.fecha)})
      </button>
    </div>
    <div class="tabla-scroll">
      <table>
        <thead>
          <tr>
            <th class="c">Fecha</th>
            <th class="c">Hora</th>
            <th class="c">Examinador</th>
            <th class="c">Regla del bloque</th>
            <th class="c">Acciones</th>
          </tr>
        </thead>
        <tbody id="af-body-rango">
          ${rows.length ? rows.map((r) => `
            <tr>
              <td class="num c"><strong>${esc(fFecha(r.fecha))}</strong></td>
              <td class="num c">${esc(r.hora)}</td>
              <td class="c">${esc(r.examinador)}</td>
              <td class="c"><span class="regla ${r.apto_pesada ? 'ok' : ''}">${r.apto_pesada ? 'D · A5 permitidas' : 'B, C, A1-A4 · sin D/A5'}</span></td>
              <td class="c" style="display:flex;gap:6px;justify-content:center">
                <button class="btn chico" data-agendar="${Number(r.id)}">Agendar</button>
                <button class="btn chico sec" data-ver-dia="${esc(r.fecha)}">Ver día en Agenda</button>
              </td>
            </tr>
          `).join('') : licoVacioFila(5, 'explica', 'Sin bloques libres en este rango', `No hay bloques libres entre ${fFecha(filtAgenda.desde)} y ${fFecha(filtAgenda.hasta)}.`)}
        </tbody>
      </table>
    </div>
  `;

  $('#af-btn-volver-dia').onclick = () => {
    filtAgenda.buscandoRango = false;
    renderAgenda();
  };

  cont.querySelectorAll('button[data-agendar]').forEach((btn) => {
    btn.onclick = () => abrirSlotPorId(Number(btn.dataset.agendar), recargar(renderAgenda));
  });

  cont.querySelectorAll('button[data-ver-dia]').forEach((btn) => {
    btn.onclick = () => {
      estadoAgenda.fecha = btn.dataset.verDia;
      filtAgenda.buscandoRango = false;
      renderAgenda();
    };
  });
}

async function dialogoPorConfirmar() {
  irA('porconfirmar');
}
