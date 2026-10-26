/* ================= tab: DISPONIBLES ================= */
let filtDisp = { desde: null, hasta: null, clase: '', examinador_id: '' };
const DISP_KEY_PLEGADO = 'disp-filtros-plegado';
function dispLeerPlegado() { return AlmacenSeguro.local.leer(DISP_KEY_PLEGADO) === '1'; }
function dispGuardarPlegado(v) { AlmacenSeguro.local.guardar(DISP_KEY_PLEGADO, v ? '1' : '0'); }
async function renderDisponibles() {
  if (!filtDisp.desde) { filtDisp.desde = hoy(); filtDisp.hasta = sumarDias(hoy(), 60); }
  const plegado = dispLeerPlegado();
  view.innerHTML = `
    <div class="panel no-print panel-fijo disp-filtros">
      <div class="disp-filtros-cab" style="margin-bottom:8px">
        <button type="button" class="btn-plegar" id="d-plegar" aria-expanded="${!plegado}" aria-controls="d-campos" style="font-size:13px;font-weight:800;color:var(--azul-900,#172b4d);letter-spacing:0.04em">
          FILTROS <span aria-hidden="true">${plegado ? '▸' : '▾'}</span>
        </button>
        <span class="muted disp-resumen" id="d-resumen" aria-live="polite"></span>
      </div>
      <div id="d-campos" ${plegado ? 'hidden' : ''}>
        <div class="fila" style="align-items:flex-end;gap:12px;flex-wrap:wrap">
          <div class="campo">
            <label for="d-desde" style="font-weight:700;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted)">DESDE</label>
            <input type="date" id="d-desde" value="${esc(filtDisp.desde)}">
          </div>
          <div class="campo">
            <label for="d-hasta" style="font-weight:700;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted)">HASTA</label>
            <input type="date" id="d-hasta" value="${esc(filtDisp.hasta)}">
          </div>
          <div class="campo">
            <label for="d-clase" style="font-weight:700;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted)">CLASE</label>
            <select id="d-clase">
              <option value="">--</option>
              ${opt(META.catalogos.clase, filtDisp.clase)}
            </select>
          </div>
          <div class="campo">
            <label for="d-exam" style="font-weight:700;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted)">EXAMINADOR</label>
            <select id="d-exam">
              <option value="">Todos</option>
              ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(e.id) === String(filtDisp.examinador_id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
            </select>
          </div>
          <button class="btn" id="d-buscar" style="height:38px;padding:0 22px;border-radius:20px;font-weight:700" title="Buscar cupos disponibles en el rango de fechas">
            Buscar
          </button>
        </div>
        <div style="margin-top:10px">
          <span class="muted" id="d-regla" style="font-size:13px;font-weight:600;line-height:1.4"></span>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="tabla-agenda-card">
        <div class="tabla-agenda-scroll">
          <table class="tabla-agenda-elegante" id="tabla-disponibles-main">
            <thead>
              <tr>
                <th class="th-fecha col-disp-fecha">FECHA</th>
                <th class="th-hora col-disp-hora">HORA</th>
                <th class="th-examinador col-disp-sede">EXAMINADOR</th>
                <th class="th-clase col-disp-clase">APTITUD DE CLASE</th>
                <th class="th-resultado col-disp-accion" style="text-align:center">ACCIÓN</th>
              </tr>
            </thead>
            <tbody id="d-body">
              <tr><td colspan="5" class="c" style="padding:2rem">Cargando cupos disponibles...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>`;

  if ($('#d-clase')) $('#d-clase').value = filtDisp.clase;
  if ($('#d-exam')) $('#d-exam').value = filtDisp.examinador_id;
  let total = null;

  const resumen = () => {
    const ex = META.examinadores.find((e) => String(e.id) === String(filtDisp.examinador_id));
    const rEl = $('#d-resumen');
    if (rEl) {
      rEl.textContent = [
        `${fFecha(filtDisp.desde)} – ${fFecha(filtDisp.hasta)}`,
        filtDisp.clase ? `Clase ${filtDisp.clase}` : 'Todas las clases',
        ex ? ex.nombre : 'Todos los examinadores',
        total == null ? '' : `${total} libres`,
      ].filter(Boolean).join(' · ');
    }
  };

  const plegar = (v) => {
    $('#d-campos').hidden = v;
    const b = $('#d-plegar');
    b.setAttribute('aria-expanded', String(!v));
    b.querySelector('span').textContent = v ? '▸' : '▾';
    if ($('#d-resumen')) $('#d-resumen').hidden = !v;
    dispGuardarPlegado(v);
    setTimeout(ajustarOffsetsFijos, 0);
  };
  $('#d-plegar').onclick = () => plegar(!$('#d-campos').hidden);
  if ($('#d-resumen')) $('#d-resumen').hidden = !plegado;

  const actualizarConteoDisp = async () => {
    try {
      const desde = ($('#d-desde') && $('#d-desde').value) || filtDisp.desde;
      const hasta = ($('#d-hasta') && $('#d-hasta').value) || filtDisp.hasta;
      const clase = ($('#d-clase') && $('#d-clase').value) || filtDisp.clase;
      const exam = ($('#d-exam') && $('#d-exam').value) || filtDisp.examinador_id;
      if (!desde || !hasta || hasta < desde) return;

      const qDisp = new URLSearchParams(Object.fromEntries(Object.entries({
        desde,
        hasta,
        clase,
        examinador_id: exam,
      }).filter(([, v]) => v)));
      const rows = await apiReciente(`/disponibles?${qDisp}`, 15e3);
      if (Array.isArray(rows)) {
        const pesada = META.clases_pesadas.includes(clase);
        const reglaPesada = pesada ? `Clase ${clase}: solo bloques de las ${META.hora_d_a5}.` : '';
        const reglaEl = $('#d-regla');
        if (reglaEl) {
          reglaEl.textContent = rows.length
            ? `${reglaPesada ? reglaPesada + ' · ' : ''}${rows.length} bloque(s) libre(s) en el rango.`
            : (reglaPesada ? reglaPesada + ' · Sin bloques libres en el rango.' : 'Sin bloques libres en el rango.');
        }
      }
    } catch (_) {}
  };

  const buscar = async () => {
    filtDisp = {
      desde: $('#d-desde').value,
      hasta: $('#d-hasta').value,
      clase: $('#d-clase').value,
      examinador_id: $('#d-exam').value,
    };
    const pesada = META.clases_pesadas.includes(filtDisp.clase);
    const reglaPesada = pesada ? `Clase ${filtDisp.clase}: solo bloques de las ${META.hora_d_a5}.` : '';
    const q = new URLSearchParams(Object.fromEntries(Object.entries(filtDisp).filter(([, v]) => v)));
    total = null;
    resumen();
    await cargarVista('disponibles', `/disponibles?${q}`, (rows) => pintarDisp(rows, reglaPesada));
  };

  const pintarDisp = (rows, base) => {
    rows.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || (a.hora || '').localeCompare(b.hora || '') || (a.examinador || '').localeCompare(b.examinador || ''));
    total = rows.length;
    resumen();
    const contBody = $('#d-body');
    if (!contBody) return;

    if (!rows.length) {
      contBody.innerHTML = `
        <tr>
          <td colspan="5" style="padding:3rem 1rem;text-align:center">
            ${licoVacio('explica', 'Sin bloques libres en este rango', `No hay bloques libres entre ${fFecha(filtDisp.desde)} y ${fFecha(filtDisp.hasta)} para los filtros seleccionados.`)}
          </td>
        </tr>
      `;
    } else {
      let html = '';
      // Sin examinador elegido, la fecha ocupa una sola celda que abarca todas las horas del dia
      // (rowspan) y queda centrada verticalmente. Con un examinador elegido, cada fila lleva su fecha.
      const agrupar = !filtDisp.examinador_id;
      const horasPorDia = new Map();
      for (const r of rows) horasPorDia.set(r.fecha, (horasPorDia.get(r.fecha) || 0) + 1);
      let fechaAnterior = null;
      for (const r of rows) {
        const pesada = r.hora === META.hora_d_a5 || r.apto_pesada;
        // Primera fila de cada dia: separador visible respecto al dia anterior
        const inicioDia = fechaAnterior !== null && r.fecha !== fechaAnterior ? ' dia-inicio' : '';
        const primeraDelDia = r.fecha !== fechaAnterior;
        fechaAnterior = r.fecha;
        const span = agrupar && horasPorDia.get(r.fecha) > 1 ? ` rowspan="${horasPorDia.get(r.fecha)}"` : '';
        const celdaFecha = agrupar && !primeraDelDia ? '' : `
            <td class="num c fecha-celda col-disp-fecha" style="font-weight:700;color:var(--azul, #1e40af)"${span}>
              <span class="fecha-slot-tabla">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" style="vertical-align:middle;margin-right:5px;margin-top:-2px"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${esc(fFechaDia(r.fecha))}
              </span>
            </td>`;
        html += `
          <tr class="fila-agenda-tabla fila-libre${inicioDia}" data-fecha="${esc(r.fecha)}">${celdaFecha}
            <td class="num c col-disp-hora">
              <span class="hora-badge ${pesada ? 'hora-pesada' : ''}">
                ${esc(r.hora)}
                ${pesada ? '<span class="et-d">D·A5</span>' : ''}
              </span>
            </td>
            <td class="td-sede col-disp-sede">
              <span class="sede-pill-badge">${esc(r.examinador || '—')}</span>
            </td>
            <td class="td-clase col-disp-clase">
              <span class="badge ${pesada ? 'dpesada' : 'ok'}" style="font-size:11px;font-weight:600">
                ${pesada ? '✓ D · A5 permitidas (y livianas)' : 'B, C, A1-A4 (sin D/A5)'}
              </span>
            </td>
            <td class="td-resultado col-disp-accion" style="text-align:center">
              <button type="button" class="btn-agendar-tabla" data-id="${Number(r.id)}" title="Agendar postulante en este cupo libre">
                + Agendar
              </button>
            </td>
          </tr>
        `;
      }
      contBody.innerHTML = html;
      reubicarFechasDisponibles(contBody);
    }

    // Si se ocultan filas por filtros dinamicos, reubica la celda con rowspan a la primera fila visible
    function reubicarFechasDisponibles(contenedor) {
      if (!agrupar) return;
      const grupos = new Map();
      contenedor.querySelectorAll('.fila-agenda-tabla[data-fecha]').forEach((tr) => {
        if (!grupos.has(tr.dataset.fecha)) grupos.set(tr.dataset.fecha, []);
        grupos.get(tr.dataset.fecha).push(tr);
      });
      for (const filas of grupos.values()) {
        const celda = filas.map((tr) => tr.querySelector('td.fecha-celda')).find(Boolean);
        if (!celda) continue;
        const visibles = filas.filter((tr) => tr.style.display !== 'none');
        if (!visibles.length) continue;
        if (celda.parentElement !== visibles[0]) visibles[0].insertBefore(celda, visibles[0].firstElementChild);
        celda.rowSpan = visibles.length;
      }
    }

    const reglaEl = $('#d-regla');
    if (reglaEl) {
      reglaEl.textContent = rows.length
        ? `${base ? base + ' · ' : ''}${rows.length} bloque(s) libre(s) en el rango.`
        : (base ? base + ' · Sin bloques libres en el rango.' : 'Sin bloques libres en el rango.');
    }

    contBody.querySelectorAll('button[data-id]').forEach((el) => {
      el.onclick = () => abrirSlotPorId(Number(el.dataset.id), recargar(buscar));
    });
    setTimeout(ajustarOffsetsFijos, 0);
  };

  $('#d-desde').onchange = (e) => {
    filtDisp.desde = e.target.value;
    if ($('#d-hasta') && (!filtDisp.hasta || filtDisp.hasta < filtDisp.desde)) {
      filtDisp.hasta = filtDisp.desde;
      $('#d-hasta').value = filtDisp.desde;
    }
    actualizarConteoDisp();
  };
  $('#d-hasta').onchange = (e) => {
    filtDisp.hasta = e.target.value;
    actualizarConteoDisp();
  };
  $('#d-clase').onchange = (e) => {
    filtDisp.clase = e.target.value;
    actualizarConteoDisp();
  };
  $('#d-exam').onchange = (e) => {
    filtDisp.examinador_id = e.target.value;
    actualizarConteoDisp();
  };

  $('#d-buscar').onclick = buscar;
  actualizarConteoDisp();
  buscar();
}
