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
function orientacionImpresion() {
  try { return localStorage.getItem('agenda-orientacion') || 'vertical'; }
  catch (_) { return 'vertical'; }
}
function aplicarFormatoImpresion(f, ori) {
  const formato = f || formatoImpresion();
  const orientacion = ori || orientacionImpresion();
  const p = PAGINAS[formato] || PAGINAS.carta;
  let st = document.getElementById('estilo-pagina');
  if (!st) { st = document.createElement('style'); st.id = 'estilo-pagina'; document.head.appendChild(st); }
  
  const dim = p.size.split(' ');
  const w = orientacion === 'horizontal' ? dim[1] : dim[0];
  const h = orientacion === 'horizontal' ? dim[0] : dim[1];
  const pageSize = `${w} ${h}`;
  const margins = orientacion === 'horizontal' ? '8mm' : '8mm 6mm';
  
  st.textContent = `@media print {
    @page { size: ${pageSize}; margin: ${margins}; }
    @page unica { size: ${pageSize}; margin: ${margins}; }
    .hoja-unica { page: unica; }
  }`;
  try {
    localStorage.setItem('agenda-formato', formato);
    localStorage.setItem('agenda-orientacion', orientacion);
  } catch (_) { /* ignore */ }
}
aplicarFormatoImpresion(formatoImpresion(), orientacionImpresion());

function disenoDia() {
  try { return localStorage.getItem('agenda-diseno-dia') === 'porexam' ? 'porexam' : 'unica'; }
  catch (_) { return 'unica'; }
}

// Una sola hoja (horizontal): filas = horas, columnas = examinadores. Cada
// celda trae solo nombre, RUT y clase, o el motivo si esta bloqueado.
function hojaUnicaDia(data, exs, largaFecha, generado) {
  const horas = [...new Set(exs.flatMap((ex) => data.examinadores[ex].map((r) => r.hora)))].sort();
  const celda = (r) => {
    if (!r) return '<td class="hu-vacio">—</td>';
    if (r.bloqueado) return `<td class="hu-bloq">${esc(r.bloqueo_motivo || 'BLOQUEADO')}</td>`;
    if (!(r.rut || r.nombre)) return '<td class="hu-libre">Disponible</td>';
    const claseTag = r.clase ? `<span class="hu-tag-clase">${esc(r.clase)}</span>` : '<span class="hu-tag-clase s-clase">s/c</span>';
    return `<td class="hu-celda">
      <div class="hu-nom">${esc(nom(r.nombre))}</div>
      <div class="hu-meta">
        <span class="hu-rut">${esc(r.rut || '-')}</span>
        <span class="hu-badges">${claseTag}</span>
      </div>
    </td>`;
  };
  const tot = exs.map((ex) => data.examinadores[ex].filter((r) => !r.bloqueado && (r.rut || r.nombre)).length);
  return `<article class="hoja-dia hoja-unica">
    <header class="hd-cab">
      ${MARCA.logo ? `<img src="${MARCA.logo}" alt="${esc(MARCA.organismo)}" class="hd-logo">` : ESCUDO_SVG}
      <div class="hd-org"><span>${esc(MARCA.organismo)} · ${esc(MARCA.unidad)}</span><b>Agenda de Prácticos</b></div>
      <div class="hd-folio">${esc(largaFecha)}</div>
    </header>
    <h2 class="hu-titulo">Agenda diaria — todos los examinadores (${tot.reduce((a, b) => a + b, 0)} citas)</h2>
    <table class="hd-tabla hu-tabla">
      <thead><tr><th class="hu-hora">Hora</th>${exs.map((ex, i) => `<th>${esc(nom(ex))}<span class="hu-det">${tot[i]} citas</span></th>`).join('')}</tr></thead>
      <tbody>${horas.map((h) => `<tr><td class="hu-hora num">${esc(h)}</td>${
        exs.map((ex) => celda(data.examinadores[ex].find((r) => r.hora === h))).join('')}</tr>`).join('')}</tbody>
    </table>
    <div class="hd-pie"><div class="hd-firmas">
      ${exs.map((ex) => `<div class="hd-firma"><div class="hd-linea"></div><span>${esc(nom(ex))}</span></div>`).join('')}
    </div><div class="hd-gen">Generado ${esc(generado)} · Sistema de Agenda de Prácticos</div></div>
  </article>`;
}

async function renderDia() {
  const fecha = (estadoAgenda.fecha || hoy());
  view.innerHTML = `
    <div class="panel no-print"><div class="fila">
      <div class="campo"><label>Fecha</label><input type="date" id="dd-fecha" value="${fecha}"></div>
      <div class="campo"><label>Formato de hoja</label>
        <select id="dd-formato">${Object.entries(PAGINAS).map(([k, v]) =>
          `<option value="${k}" ${k === formatoImpresion() ? 'selected' : ''}>${esc(v.etq)}</option>`).join('')}</select></div>
      <div class="campo"><label>Orientación</label>
        <select id="dd-orientacion">
          <option value="vertical" ${orientacionImpresion() === 'vertical' ? 'selected' : ''}>Vertical</option>
          <option value="horizontal" ${orientacionImpresion() === 'horizontal' ? 'selected' : ''}>Horizontal</option>
        </select></div>
      <div class="campo"><label>Diseño</label>
        <select id="dd-diseno">
          <option value="unica" ${disenoDia() === 'unica' ? 'selected' : ''}>Todos los examinadores en una hoja</option>
          <option value="porexam" ${disenoDia() === 'porexam' ? 'selected' : ''}>Una hoja por examinador/a</option>
        </select></div>
      <button class="btn" id="dd-print">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 6V2h8v4M4 12H2V6h12v6h-2M4 10h8v4H4z"/></svg>
        Imprimir informe
      </button>
      <button class="btn sec" id="dd-sala" type="button" title="Pantalla para TV de la sala de espera (solo iniciales, sin RUT)">Abrir pantalla sala de espera</button>
    </div></div>
    <div id="dd-cierre" class="no-print"></div>
    <div id="dd-cont" class="dd-cont">Cargando...</div>`;
  pintarCierreDia(fecha);
  $('#dd-fecha').onchange = (e) => { estadoAgenda.fecha = e.target.value; renderDia(); };
  $('#dd-formato').onchange = (e) => { aplicarFormatoImpresion(e.target.value); toast(`Formato: ${PAGINAS[e.target.value].etq}`); };
  $('#dd-orientacion').onchange = (e) => { aplicarFormatoImpresion(null, e.target.value); toast(`Orientación: ${e.target.value === 'vertical' ? 'Vertical' : 'Horizontal'}`); document.body.classList.toggle('orientacion-horizontal', e.target.value === 'horizontal'); };
  $('#dd-print').onclick = () => window.print();
  $('#dd-sala').onclick = () => window.open('/sala.html', 'sala-espera');
  $('#dd-diseno').onchange = (e) => { try { localStorage.setItem('agenda-diseno-dia', e.target.value); } catch (_) { /* ignore */ } renderDia(); };

  await cargarVista('dia', `/dia?fecha=${fecha}`, (data) => {
  const exs = Object.keys(data.examinadores);
  if (!exs.length) {
    $('#dd-cont').innerHTML = `<div class="panel">${licoVacio('explica', 'Sin bloques este día', `No hay bloques para ${fFecha(fecha)}.`)}</div>`;
    return;
  }
  const generado = fFechaHora(new Date().toISOString());
  const largaFecha = fFechaLarga(fecha);
  document.body.classList.toggle('dia-unica', disenoDia() === 'unica');
  if (disenoDia() === 'unica') {
    $('#dd-cont').innerHTML = hojaUnicaDia(data, exs, largaFecha, generado);
    return;
  }

  $('#dd-cont').innerHTML = exs.map((ex, i) => {
    const filas = data.examinadores[ex];
    const citas = filas.filter((r) => !r.bloqueado && (r.rut || r.nombre));
    const conf = citas.filter((r) => r.confirmo_asistencia === 1).length;
    const bloq = filas.filter((r) => r.bloqueado).length;
    let n = 0;
    const cuerpo = filas.map((r) => {
      if (r.bloqueado) {
        return `<tr class="hd-bloq"><td></td><td class="num">${esc(r.hora)}</td><td colspan="3">NO DISPONIBLE — ${esc(r.bloqueo_motivo || 'BLOQUEADO')}</td></tr>`;
      }
      const ocupada = r.rut || r.nombre;
      if (!ocupada) {
        return `<tr class="hd-libre"><td></td><td class="num">${esc(r.hora)}</td><td colspan="3">Disponible</td></tr>`;
      }
      n += 1;
      return `<tr>
        <td class="hd-n">${n}</td>
        <td class="num">${esc(r.hora)}</td>
        <td class="num">${esc(r.rut || '')}</td>
        <td class="hd-nom">${esc(nom(r.nombre))}</td>
        <td class="hd-c">${r.clase ? clasesTagsHtml(r.clase) : ''}</td>
      </tr>`;
    }).join('');

    return `<article class="hoja-dia">
      <header class="hd-cab">
        ${MARCA.logo ? `<img src="${MARCA.logo}" alt="${esc(MARCA.organismo)}" class="hd-logo">` : ESCUDO_SVG}
        <div class="hd-org">
          <span>${esc(MARCA.organismo)} · ${esc(MARCA.unidad)}</span>
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
        </colgroup>
        <thead><tr>
          <th>N°</th><th>Hora</th><th>RUT</th><th>Nombre</th><th>Clase</th>
        </tr></thead>
        <tbody>${cuerpo}</tbody>
      </table>

      <div class="hd-pie">
        <div class="hd-firmas">
          <div class="hd-firma"><div class="hd-linea"></div><span>Firma examinador/a</span></div>
          <div class="hd-firma"><div class="hd-linea"></div><span>Visto bueno jefatura</span></div>
        </div>
        <div class="hd-gen">Generado ${esc(generado)} · Sistema de Agenda de Prácticos</div>
      </div>
    </article>`;
  }).join('');
  });
}

/* ---------- Cierre del dia: citas sin resultado ---------- */
const CIERRE_RESULTADOS = [
  { v: 'APROBADO', etq: 'Aprobó', cls: '' },
  { v: 'REPROBADO', etq: 'Reprobó', cls: 'sec' },
  { v: 'NO ASISTIO', etq: 'No asistió', cls: 'sec' },
];
async function pintarCierreDia(fecha) {
  const cont = $('#dd-cierre');
  if (!cont) return;
  let data;
  try { data = await api(`/cierre-dia?fecha=${fecha}`); } catch (e) {
    cont.innerHTML = `<div class="panel"><p class="muted" style="color:var(--error)">Cierre del día: ${esc(e.message)}</p></div>`;
    return;
  }
  if ($('#dd-cierre') !== cont) return; // cambio de vista mientras cargaba
  if (!data.total) {
    cont.innerHTML = fecha <= hoy()
      ? '<div class="panel cierre-dia"><h2>Cierre del día</h2><p class="muted">Todas las citas de este día tienen resultado.</p></div>'
      : '';
    return;
  }
  cont.innerHTML = `<div class="panel cierre-dia">
    <div class="fila" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <h2 style="margin:0">Cierre del día · ${data.total} ${data.total === 1 ? 'cita' : 'citas'} sin resultado</h2>
      <div class="fila" style="gap:6px;align-items:center">
        <label class="muted"><input type="checkbox" id="cd-todos"> Seleccionar todas</label>
        <button class="btn chico sec" id="cd-noasist" disabled>Marcar seleccionadas como No asistió</button>
      </div>
    </div>
    ${data.grupos.map((g) => `<h3 class="cierre-ex">${esc(nom(g.examinador))} <span class="muted">(${g.citas.length})</span></h3>
      <div class="tabla-scroll"><table class="cierre-tabla"><tbody>${g.citas.map((c) => `<tr data-id="${c.id}">
        <td class="c"><input type="checkbox" data-cd="${c.id}" aria-label="Seleccionar"></td>
        <td class="num">${esc(c.hora)}</td>
        <td class="num">${esc(c.rut || '')}</td>
        <td>${esc(nom(c.nombre))}</td>
        <td>${c.clase ? esc(c.clase) : ''}</td>
        <td class="cierre-acc">${CIERRE_RESULTADOS.map((r) => `<button class="btn chico ${r.cls}" data-res="${esc(r.v)}" data-id="${c.id}">${esc(r.etq)}</button>`).join(' ')}</td>
      </tr>`).join('')}</tbody></table></div>`).join('')}
  </div>`;
  const marcados = () => [...cont.querySelectorAll('input[data-cd]:checked')].map((el) => Number(el.dataset.cd));
  const refrescarBoton = () => {
    const n = marcados().length;
    $('#cd-noasist').disabled = !n;
    $('#cd-noasist').textContent = n ? `Marcar ${n} como No asistió` : 'Marcar seleccionadas como No asistió';
  };
  cont.querySelectorAll('input[data-cd]').forEach((el) => { el.onchange = refrescarBoton; });
  $('#cd-todos').onchange = (e) => {
    cont.querySelectorAll('input[data-cd]').forEach((el) => { el.checked = e.target.checked; });
    refrescarBoton();
  };
  cont.querySelectorAll('button[data-res]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        await api(`/agenda/${b.dataset.id}/resultado`, { method: 'POST', body: { resultado: b.dataset.res } });
        toast('Resultado guardado');
        pintarCierreDia(fecha);
      } catch (e) { b.disabled = false; toast(e.message, 'err'); }
    };
  });
  $('#cd-noasist').onclick = async () => {
    const ids = marcados();
    if (!ids.length) return;
    if (!confirm(`¿Marcar ${ids.length} ${ids.length === 1 ? 'cita' : 'citas'} como "No asistió"?`)) return;
    try {
      const r = await api('/cierre-dia', { method: 'POST', body: { fecha, ids, resultado: 'NO ASISTIO' } });
      toast(`${r.actualizados} ${r.actualizados === 1 ? 'cita marcada' : 'citas marcadas'} como No asistió`);
      pintarCierreDia(fecha);
    } catch (e) { toast(e.message, 'err'); }
  };
}

// Aviso discreto en la pestaña Agenda: despues de las 13:30 (ultimo bloque) si hoy quedan citas sin resultado.
const CIERRE_HORA_MIN = 13 * 60 + 30;
async function avisoCierreDia(fechaVista) {
  const ahora = new Date();
  if (fechaVista !== hoy() || ahora.getHours() * 60 + ahora.getMinutes() < CIERRE_HORA_MIN) return;
  let data;
  try { data = await apiReciente(`/cierre-dia?fecha=${fechaVista}`, 30e3); } catch (_) { return; }
  const grid = $('#a-grid');
  if (!data || !data.total || !grid || $('#a-cierre-aviso')) return;
  const div = document.createElement('div');
  div.id = 'a-cierre-aviso';
  div.className = 'cierre-aviso no-print';
  div.innerHTML = `<span>Hoy quedan <b>${data.total}</b> ${data.total === 1 ? 'cita' : 'citas'} sin resultado</span>
    <button class="btn chico" type="button">Cerrar el día →</button>`;
  div.querySelector('button').onclick = () => { estadoAgenda.fecha = fechaVista; irA('dia'); };
  grid.closest('.panel').insertAdjacentElement('beforebegin', div);
}
