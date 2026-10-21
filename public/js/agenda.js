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
        <div class="fila" style="align-items:flex-end;gap:10px;flex-wrap:wrap">
          <div class="campo"><label for="af-desde">Desde</label><input type="date" id="af-desde" value="${esc(filtAgenda.desde)}"></div>
          <div class="campo"><label for="af-hasta">Hasta</label><input type="date" id="af-hasta" value="${esc(filtAgenda.hasta)}"></div>
          <div class="campo"><label for="af-clase">Clase</label><select id="af-clase"><option value="">--</option>${opt(META.catalogos.clase, filtAgenda.clase)}</select></div>
          <div class="campo"><label for="af-exam">Examinador</label><select id="af-exam"><option value="">Todos</option>
            ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(e.id) === String(filtAgenda.examinador_id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select>
          </div>
          <button class="btn" id="af-buscar">Buscar</button>
        </div>
        <p class="muted" id="af-regla" style="margin:.4rem 0 0 0"></p>
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
