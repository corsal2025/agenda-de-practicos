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
    <div class="panel no-print"><div class="fila" style="justify-content:center;align-items:flex-end;gap:14px">
      <div class="campo"><label>Desde</label><input type="date" id="an-desde" value="${esc(r.desde || '')}"></div>
      <div class="campo"><label>Hasta</label><input type="date" id="an-hasta" value="${esc(r.hasta || '')}"></div>
      <button class="btn" id="an-ok">Aplicar filtro</button>
      <button class="btn sec" id="an-xlsx">Descargar informe (Excel)</button>
      <button class="btn sec" id="an-print">Imprimir informe</button>
    </div><p class="muted" id="an-comp" style="text-align:center;font-size:.8rem;margin:.4rem 0 0"></p></div>
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
    </div>
    <div class="panel"><h3>Resultados por escuela de conductores</h3>
      <div class="tabla-scroll"><table class="tabla-escuelas"><thead><tr>
        <th>Escuela</th><th class="c">Citas</th><th class="c">Aprobó</th><th class="c">Reprobó</th><th>% aprobación</th>
      </tr></thead><tbody id="esc-tabla"><tr><td colspan="5">Cargando...</td></tr></tbody></table></div>
      <p class="muted" style="font-size:.8rem">El % se calcula sobre aprobados + reprobados (incluye reprobado por inasistencia).</p>
    </div>
    ${anPanelesExtraHtml()}`;
  const cargar = () => {
    const q = new URLSearchParams();
    if ($('#an-desde').value) q.set('desde', $('#an-desde').value);
    if ($('#an-hasta').value) q.set('hasta', $('#an-hasta').value);
    cargarVista('escuelas', `/estadisticas-escuelas?${q}`, pintarEscuelas).catch((e) => toast(e.message, 'err'));
    return cargarVista('analitica', `/analitica?${q}`, pintarAn);
  };
  const pintarEscuelas = (rows) => {
    AN_ESTADO.escuelas = rows || [];
    if (!$('#esc-tabla')) return;
    $('#esc-tabla').innerHTML = (rows || []).length ? rows.map((x) => `<tr>
      <td>${esc(x.escuela_conductores)}</td><td class="c">${x.total}</td>
      <td class="c" style="color:var(--ok);font-weight:700">${x.aprobados}</td>
      <td class="c" style="color:var(--error);font-weight:700">${x.reprobados}</td>
      <td>${x.pct_aprobacion == null ? '<span class="muted">Sin resultados</span>'
        : `<div class="barra-pct"><span style="width:${Number(x.pct_aprobacion)}%"></span></div><b>${x.pct_aprobacion}%</b>`}</td></tr>`).join('')
      : licoVacioFila(5, 'explica', 'Sin datos', 'No hay citas con escuela de conductores en el período.');
  };
  const pintarAn = (a) => {
    limpiarCharts();
    const k = a.kpis;
    $('#an-kpis').innerHTML = [
      ['Bloques', k.bloques], ['Bloqueados', k.bloqueadas], ['Citas agendadas', k.ocupadas, 'ocupadas'], ['Ocupacion', k.ocupacion + '%', 'ocupacion'],
      ['Con resultado', k.con_resultado], ['Aprobacion', k.aprobacion + '%', 'aprobacion'], ['Inasistencia', k.inasistencia + '%', 'inasistencia'],
      ['Reagendadas', k.reagendadas], ['Tasa reagend.', k.tasa_reagendamiento + '%', 'tasa_reagendamiento'],
      ['En lista espera', k.lista_espera], ['Agendadas hoy', k.agendadas_hoy],
    ].map(([t, n, c]) => `<div class="kpi"><div class="n">${n}</div><div class="t">${t}</div>${c ? anDeltaHtml(a, c) : ''}</div>`).join('');
    $('#an-comp').textContent = a.periodo_anterior
      ? `Comparado con el período anterior: ${fFecha(a.periodo_anterior[0])} al ${fFecha(a.periodo_anterior[1])}` : 'Elige Desde y Hasta para comparar con el período anterior.';
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
      : licoVacioFila(5, 'explica', 'Sin resultados', 'Aún no hay resultados en el período seleccionado.');
    grafico('g-clase', 'bar', ...pares(a.por_clase), 'Citas');
    grafico('g-func', 'bar', ...pares(a.por_funcionario), 'Citas');
    grafico('g-tipo', 'bar', ...pares(a.por_tipo), 'Citas');
    grafico('g-tend', 'line', a.tendencia.map((x) => x.dia), a.tendencia.map((x) => x.n), 'Citas');
    grafico('g-agend', 'line', a.tendencia_agendamiento.map((x) => x.dia), a.tendencia_agendamiento.map((x) => x.n), 'Agendados');
    pintarAnExtra(a);
  };
  $('#an-ok').onclick = cargar;
  $('#an-xlsx').onclick = descargarInformeExcel;
  $('#an-print').onclick = imprimirInforme;
  cargar();
}

/* ================= tab: POR VENCER (tramites D/A5) ================= */
// Decide si el botón "Dar prioridad en lista de espera" se ofrece para una fila, y con qué texto.
function estadoPrioridadVencer(r, hoy) {
  if (r.pendiente_reagendar === 1) return { habilitado: false, texto: 'Ya en lista de espera' };
  if (r.fecha < hoy) return { habilitado: false, texto: 'Cita pasada' };
  if (r.confirmo_asistencia === 1) return { habilitado: false, texto: 'Confirmó asistencia' };
  if (r.dias_restantes_tramite != null && r.dias_restantes_tramite <= 0) return { habilitado: false, texto: 'Trámite vencido' };
  return { habilitado: true, texto: 'Dar prioridad en lista de espera' };
}
async function renderVencimientos() {
  view.innerHTML = `
    <div class="panel">
      <div class="fila" style="align-items:center">
        <h2 style="margin:0;flex:1">Trámites por vencer</h2>
        <div class="campo"><label for="ven-filtro">Mostrar</label>
          <select id="ven-filtro">
            <option value="7">Vencen en 7 días o menos</option>
            <option value="30">Vencen en 30 días o menos</option>
            <option value="vencidos">Vencidos</option>
            <option value="todos" selected>Todos</option>
          </select></div>
      </div>
      <p class="muted">Citas de todas las clases desde hoy en adelante. El trámite vence 6 meses después de su inicio.</p>
      <div class="tabla-scroll"><table class="tabla-vencimientos thead-fijo"><thead><tr>
        <th class="c">Días restantes</th><th>Nombre</th><th>RUT</th><th class="c">Clase</th><th>Teléfono</th>
        <th class="c">Fecha cita</th><th>Examinador</th><th class="c">Vence</th><th class="c">Acción</th>
      </tr></thead><tbody id="ven-body"><tr><td colspan="9">Cargando...</td></tr></tbody></table></div>
    </div>`;
  const cargar = () => cargarVista('vencimientos', `/tramites-por-vencer?filtro=${encodeURIComponent($('#ven-filtro').value)}`, pintar)
    .catch((e) => toast(e.message, 'err'));
  const pintar = (rows) => {
    const body = $('#ven-body');
    if (!body) return;
    const citasValidas = (rows || []).filter((r) => r && r.fecha >= hoy());
    body.innerHTML = citasValidas.length ? citasValidas.map((r) => {
      const estado = estadoPrioridadVencer(r, hoy());
      const puedeEliminar = (r.dias_restantes_tramite != null && r.dias_restantes_tramite <= 0);
      return `<tr data-id="${r.id}">
      <td class="c">${cuentaRegresivaHtml(r.dias_restantes_tramite, r.fecha_vencimiento_tramite)}</td>
      <td>${esc(nom(r.nombre) || '—')}</td><td class="num">${esc(r.rut || '—')}</td><td class="c">${esc(r.clase || '—')}</td>
      <td class="num">${esc(fTel(r.contacto) || '—')}</td><td class="num c">${esc(fFecha(r.fecha))} · ${esc(r.hora)}</td>
      <td>${esc(r.examinador || '—')}</td><td class="num c">${esc(fFecha(r.fecha_vencimiento_tramite))}</td>
      <td class="c">
        <div style="display:inline-flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap">
          <button class="btn chico" data-prioridad="${r.id}" ${estado.habilitado ? '' : 'disabled'}>${esc(estado.texto)}</button>
          ${puedeEliminar ? `<button class="btn chico peligro sec" data-eliminar="${r.id}" title="Liberar cupo / Eliminar cita">🗑️ Eliminar</button>` : ''}
        </div>
      </td></tr>`;
    }).join('')
      : licoVacioFila(9, 'explica', 'Nada por vencer', 'No hay trámites D/A5 en este filtro.');
    body.querySelectorAll('button[data-eliminar]').forEach((btn) => {
      const r = citasValidas.find((x) => x.id === Number(btn.dataset.eliminar));
      if (!r) return;
      btn.onclick = async () => {
        const quien = nom(r.nombre) || r.rut || 'esta persona';
        const motivo = 'Trámite vencido (Trámites por vencer)';
        if (!confirm(`¿Eliminar la cita de ${quien} (${fFecha(r.fecha)} ${r.hora || ''}) y liberar el cupo?\n\nLa cita quedará archivada en la papelera.`)) return;
        btn.disabled = true;
        try {
          await api(`/agenda/${r.id}/liberar`, { method: 'POST', body: { motivo } });
          toast('Cita eliminada y cupo liberado', 'ok');
          actualizarBadgePorConfirmar();
          cargar();
        } catch (e) {
          toast(e.message, 'err');
          btn.disabled = false;
        }
      };
    });
    body.querySelectorAll('button[data-prioridad]').forEach((btn) => {
      if (btn.disabled) return;
      const r = citasValidas.find((x) => x.id === Number(btn.dataset.prioridad));
      btn.onclick = async () => {
        const vence = fFecha(r.fecha_vencimiento_tramite);
        if (!confirm(`¿Dar prioridad en Lista de espera a ${nom(r.nombre) || r.rut || 'esta persona'} (RUT ${r.rut || '—'})?\n\nSu trámite vence el ${vence}.`)) return;
        btn.disabled = true;
        try {
          await api(`/agenda/${r.id}/pendiente`, { method: 'POST', body: { valor: true, nota: `Prioridad: trámite vence el ${vence} (Por vencer)` } });
          toast('Prioridad otorgada en Lista de espera');
          actualizarBadgeEspera();
          cargar();
        } catch (e) {
          toast(e.message, 'err');
          btn.disabled = false;
        }
      };
    });
  };
  $('#ven-filtro').onchange = cargar;
  cargar();
}

/* ================= tab: PAPELERA ================= */
const MOTIVO_TXT = {
  liberar: 'Se liberó el bloque', bloquear: 'Se bloqueó el bloque',
  'bloquear-dia': 'Se bloqueó el día completo', sobrescribir: 'Se pisó con otra cita',
  reagendar: 'Se reagendó a otro bloque',
};
function pintarBadge(id, n) {
  const b = document.getElementById(id);
  if (!b) return;
  b.textContent = n > 99 ? '99+' : n ? String(n) : '';
  b.hidden = !n;
}
// Los contadores se refrescan con cada dibujo de la Agenda; reutilizan una
// respuesta de menos de 1 minuto para no repetir el pedido en cada clic.
async function actualizarBadgePorConfirmar() {
  try {
    const hasta = sumarDias(hoy(), 7);
    const rows = (await apiReciente('/agenda?estado=porconfirmar', 30e3))
      .filter((r) => r.fecha >= hoy() && r.fecha <= hasta);
    pintarBadge('badge-porconfirmar', rows.length);
    if (window.LicoAsistente) window.LicoAsistente.notar('porconfirmar', rows.length);
  } catch (_) {
    pintarBadge('badge-porconfirmar', 0);
  }
}

function actualizarBadgeEspera() {
  if (window.ListaEspera) window.ListaEspera.badge();
}

async function actualizarBadgePapelera() {
  try { pintarBadge('badge-papelera', (await apiReciente('/papelera', 60e3)).length); }
  catch (_) { pintarBadge('badge-papelera', 0); }
}
// Cuenta solo error+warning (los que valen la pena mirar); "info" queda fuera
// para no saturar el numerito con avisos de rutina.
// Regla de negocio: solo citas vigentes y futuras (fecha >= hoy), eliminando errores historicos.
const pintarBadgeErrores = (rep) => {
  const hoyStr = typeof hoy === 'function' ? hoy() : new Date().toISOString().slice(0, 10);
  const n = (rep && rep.hallazgos ? rep.hallazgos : [])
    .filter((h) => (!h.fecha || h.fecha >= hoyStr) && h.severidad !== 'info').length;
  pintarBadge('badge-errores', n);
  if (window.LicoAsistente) window.LicoAsistente.notar('errores', n);
};
// /errores recorre todas las citas (es el pedido mas pesado): el numerito se
// recalcula como maximo 1 vez por minuto aunque entremedio se guarden cambios.
// La pestaña "Reporte de errores" siempre trae el reporte fresco.
let badgeErroresT = 0;
async function actualizarBadgeErrores() {
  if (Date.now() - badgeErroresT < 60e3) return;
  badgeErroresT = Date.now();
  try { pintarBadgeErrores(await api('/errores')); }
  catch (_) { badgeErroresT = 0; pintarBadge('badge-errores', 0); }
}
async function renderPapelera() {
  view.innerHTML = `
    <div class="panel">
      <div class="fila" style="align-items:center">
        <h2 style="margin:0;flex:1">Papelera</h2>
        <button class="btn peligro sec" id="pap-vaciar">Vaciar papelera</button>
      </div>
      <p class="muted">Citas retiradas de un bloque al <b>liberarlo</b>, <b>bloquearlo</b>, <b>pisarlo</b> con otra cita
        o <b>reagendarlo</b>. Se conservan las últimas 200; se listan las 80 más recientes.
        Restaurar solo funciona si el bloque original sigue libre.</p>
      <div class="tabla-scroll tabla-papelera"><table><thead><tr>
        <th class="c">Cuándo</th><th class="c">Motivo</th><th class="c">Bloque original</th>
        <th class="c">Nombre</th><th class="c">RUT</th><th class="c">Clase</th><th class="c">Por</th><th class="c">Acción</th>
      </tr></thead><tbody id="pap-body"><tr><td colspan="8">Cargando...</td></tr></tbody></table></div>
    </div>`;

  const cargar = () => cargarVista('papelera', '/papelera', (pap) => {
    pintarBadge('badge-papelera', pap.length);
    $('#pap-body').innerHTML = pap.length ? pap.map((p) => `<tr>
      <td class="num c">${esc(fFechaHora(p.ts))}</td>
      <td class="c">${esc(MOTIVO_TXT[p.motivo] || p.motivo || '—')}</td>
      <td class="num c">${esc(fFecha(p.fecha))} · ${esc(p.hora)}</td>
      <td>${esc(nom(p.nombre) || p.bloqueo_motivo || '—')}</td>
      <td class="num">${esc(p.rut || '—')}</td>
      <td class="c">${p.clase ? clasesTagsHtml(p.clase) : '—'}</td>
      <td>${esc(p.actor || '—')}</td>
      <td class="c">
        <div class="tabla-acciones-celda">
          <button class="btn chico" data-id="${p.id}">Restaurar</button>
          <button class="btn chico peligro sec" data-del="${p.id}">Eliminar</button>
        </div>
      </td></tr>`).join('')
      : licoVacioFila(8, 'saluda', 'Papelera vacía', 'Aquí no hay nada. Lico ya sacó la basura.');
    $('#pap-body').querySelectorAll('button[data-id]').forEach((el) => {
      el.onclick = async () => {
        try {
          const r = await api(`/papelera/${el.dataset.id}/restaurar`, { method: 'POST' });
          toast(`Restaurada: ${nom(r.bloque.nombre) || r.bloque.rut || 'cita'}`);
          cargar();
        } catch (e) { toast(e.message, 'err'); }
      };
    });
    $('#pap-body').querySelectorAll('button[data-del]').forEach((el) => {
      el.onclick = async () => {
        if (!confirm('Eliminar esta entrada de la papelera? No se puede deshacer.')) return;
        try {
          await api(`/papelera/${el.dataset.del}/eliminar`, { method: 'POST' });
          toast('Entrada eliminada');
          cargar();
        } catch (e) { toast(e.message, 'err'); }
      };
    });
  });
  $('#pap-vaciar').onclick = async () => {
    if (!confirm('Vaciar toda la papelera? Se pierden todas las citas retiradas guardadas ahi. No se puede deshacer.')) return;
    try {
      const r = await api('/papelera/vaciar', { method: 'POST' });
      toast(`Papelera vaciada (${r.eliminadas} entradas)`);
      cargar();
    } catch (e) { toast(e.message, 'err'); }
  };
  cargar();
}
