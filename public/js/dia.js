/* ================= Agenda: impresion del dia ================= */
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

// "25/10/2026 23:30" con la hora local del PC (toISOString entrega UTC y de noche ya es otro dia).
function generadoLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Una sola hoja (horizontal): filas = horas, columnas = examinadores. Cada
// celda trae solo nombre, RUT y clase, o el motivo si esta bloqueado. Si la hora
// tiene varias personas (cupos), se apilan todas ordenadas por cupo.
function hojaUnicaDia(data, exs, largaFecha, generado) {
  const horas = [...new Set(exs.flatMap((ex) => data.examinadores[ex].map((r) => r.hora)))].sort();
  const ocupada = (r) => Boolean(r.rut || r.nombre);
  const contenido = (r) => {
    const claseTag = r.clase ? `<span class="hu-tag-clase">${esc(r.clase)}</span>` : '<span class="hu-tag-clase s-clase">s/c</span>';
    return `<div class="hu-nom">${esc(nom(r.nombre))}</div>
      <div class="hu-meta">
        <span class="hu-rut">${esc(r.rut || '-')}</span>
        <span class="hu-badges">${claseTag}</span>
      </div>`;
  };
  const apilada = (r) => {
    if (r.bloqueado) return `<div class="hu-fila hu-bloq-f">${esc(r.bloqueo_motivo || 'BLOQUEADO')}</div>`;
    if (!ocupada(r)) return '<div class="hu-fila hu-libre-f">Disponible</div>';
    return `<div class="hu-fila">${contenido(r)}</div>`;
  };
  const celda = (rows) => {
    if (!rows.length) return '<td class="hu-vacio">—</td>';
    if (rows.length > 1) return `<td class="hu-celda hu-multi">${[...rows].sort((a, b) => (a.cupo || 1) - (b.cupo || 1)).map(apilada).join('')}</td>`;
    const r = rows[0];
    if (r.bloqueado) return `<td class="hu-bloq">${esc(r.bloqueo_motivo || 'BLOQUEADO')}</td>`;
    if (!ocupada(r)) return '<td class="hu-libre">Disponible</td>';
    return `<td class="hu-celda">${contenido(r)}</td>`;
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
        exs.map((ex) => celda(data.examinadores[ex].filter((r) => r.hora === h))).join('')}</tr>`).join('')}</tbody>
    </table>
    <div class="hd-pie"><div class="hd-firmas">
      ${exs.map((ex) => `<div class="hd-firma"><div class="hd-linea"></div><span>${esc(nom(ex))}</span></div>`).join('')}
    </div><div class="hd-gen">Generado ${esc(generado)} · Sistema de Agenda de Prácticos</div></div>
  </article>`;
}

// Una hoja por examinador/a con N°, hora, RUT, nombre y clase.
function hojasPorExaminador(data, exs, largaFecha, generado) {
  return exs.map((ex, i) => {
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
}

// Informe imprimible del dia (fecha y, si se elige, solo un examinador).
// Se pinta en #impresion-dia (fuera de la vista) y solo eso sale en papel.
async function imprimirAgendaDia(fecha, examinadorId) {
  let data;
  try { data = await api(`/dia?fecha=${fecha}`); } catch (e) { toast(e.message, 'err'); return; }
  let exs = Object.keys(data.examinadores || {});
  const ex = examinadorId && META.examinadores.find((e) => String(e.id) === String(examinadorId));
  if (ex) exs = exs.filter((n) => n === ex.nombre);
  if (!exs.length) { toast(`No hay bloques para ${fFecha(fecha)}`, 'err'); return; }
  const generado = generadoLocal();
  const largaFecha = fFechaLarga(fecha);
  let cont = document.getElementById('impresion-dia');
  if (!cont) {
    cont = document.createElement('div');
    cont.id = 'impresion-dia';
    cont.className = 'dd-cont';
    document.body.appendChild(cont);
  }
  const unica = disenoDia() === 'unica';
  cont.innerHTML = unica ? hojaUnicaDia(data, exs, largaFecha, generado) : hojasPorExaminador(data, exs, largaFecha, generado);
  document.body.classList.toggle('dia-unica', unica);
  document.body.classList.add('dia-imprimiendo');
  const limpiar = () => { document.body.classList.remove('dia-imprimiendo'); window.removeEventListener('afterprint', limpiar); };
  window.addEventListener('afterprint', limpiar);
  window.print();
}

// Dialogo previo: formato, orientacion y diseno de la hoja, luego imprime.
function dialogoImprimirDia(fecha, examinadorId) {
  const ex = examinadorId && META.examinadores.find((e) => String(e.id) === String(examinadorId));
  modal(`Imprimir agenda · ${fFecha(fecha)}`, `
    <p class="muted">${ex ? `Solo ${esc(ex.nombre)}` : 'Todos los examinadores'}, ordenado por hora.</p>
    <div class="fila" style="flex-wrap:wrap;gap:10px">
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
    </div>`, '<button class="btn sec" id="dd-cancelar">Cancelar</button> <button class="btn" id="dd-print">Imprimir</button>');
  $('#dd-cancelar').onclick = cerrarModal;
  $('#dd-print').onclick = () => {
    const ori = $('#dd-orientacion').value;
    aplicarFormatoImpresion($('#dd-formato').value, ori);
    document.body.classList.toggle('orientacion-horizontal', ori === 'horizontal');
    try { localStorage.setItem('agenda-diseno-dia', $('#dd-diseno').value); } catch (_) { /* ignore */ }
    cerrarModal();
    imprimirAgendaDia(fecha, examinadorId);
  };
}
