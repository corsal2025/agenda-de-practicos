/* ================= Estadísticas: comparación, desgloses e informe mensual =================
   Complementa renderAnalitica (public/js/). Usa helpers globales: $, esc, fFecha, grafico, MARCA, FICHA_CSS. */
'use strict';

const AN_ESTADO = { a: null, escuelas: [] };
// true = subir es bueno; false = subir es malo.
const AN_KPI_SENTIDO = { ocupadas: true, ocupacion: true, aprobacion: true, inasistencia: false, tasa_reagendamiento: false };
const AN_KPI_PCT = (k) => k !== 'ocupadas';

function anDeltaHtml(a, clave) {
  if (!a.deltas || !(clave in a.deltas)) return '';
  const d = a.deltas[clave];
  const suf = AN_KPI_PCT(clave) ? ' pp' : '';
  if (d === 0) return `<div class="kpi-delta neutro" title="Sin cambio vs período anterior">= 0${suf}</div>`;
  const bueno = (d > 0) === AN_KPI_SENTIDO[clave];
  return `<div class="kpi-delta ${bueno ? 'bueno' : 'malo'}" title="Vs período anterior (${esc(a.kpis_anterior[clave])}${AN_KPI_PCT(clave) ? '%' : ''})">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${suf}</div>`;
}

function anPanelesExtraHtml() {
  return `
    <div class="grid2">
      <div class="panel"><h3>Aprobación por clase</h3><div class="grafico"><canvas id="g-apclase"></canvas></div>
        <div class="tabla-scroll"><table><thead><tr><th>Clase</th><th class="c">Citas</th><th class="c">Con resultado</th><th class="c">Aprobó</th><th class="c">% aprobación</th></tr></thead>
        <tbody id="apclase-tabla"></tbody></table></div>
        <p class="muted" style="font-size:.8rem">Una cita con varias clases cuenta en cada una.</p></div>
      <div class="panel"><h3>Aprobación por intento</h3><div class="grafico"><canvas id="g-apint"></canvas></div>
        <div class="tabla-scroll"><table><thead><tr><th>Intento</th><th class="c">Citas</th><th class="c">Con resultado</th><th class="c">Aprobó</th><th class="c">% aprobación</th></tr></thead>
        <tbody id="apint-tabla"></tbody></table></div></div>
    </div>
    <div class="panel"><h3>Inasistencia por día y hora</h3>
      <div class="tabla-scroll"><table class="tabla-heat" id="heat-tabla"></table></div>
      <p class="muted" style="font-size:.8rem">% de inasistencia (No asistió + Reprobado inasistencia) sobre citas con resultado. Se destacan las celdas peores.</p></div>
    <div class="grid2">
      <div class="panel"><h3>Tiempo de espera (agendamiento → cita)</h3><div class="kpis" id="espera-kpis"></div>
        <div class="tabla-scroll"><table><thead><tr><th>Mes</th><th class="c">Citas</th><th class="c">Promedio</th><th class="c">Mediana</th><th class="c">P90</th></tr></thead>
        <tbody id="espera-tabla"></tbody></table></div>
        <p class="muted" style="font-size:.8rem">En días. Para citas migradas del Excel el dato es aproximado.</p></div>
      <div class="panel"><h3>Trámites vencidos</h3><div class="kpis" id="vencidos-kpis"></div>
        <p class="muted" style="font-size:.8rem">El trámite vence 6 meses después de su inicio. Se cuentan citas del período cuya fecha fue posterior al vencimiento.</p></div>
    </div>
    <div class="panel"><h3>Proyección de capacidad</h3><div class="kpis" id="cap-kpis"></div>
      <p class="cap-linea" id="cap-linea"></p>
      <div class="grafico"><canvas id="g-cap"></canvas></div>
      <p class="muted" style="font-size:.8rem">Desde hoy, sin importar el filtro. Solo días hábiles y bloques no bloqueados. Un 12:30 sirve para D/A5 si 13:00 y 13:30 del mismo examinador también están libres.</p></div>
    <div class="panel"><h3>Carga por examinador</h3><div id="carga-aviso"></div>
      <div class="tabla-scroll"><table><thead><tr><th>Examinador</th><th class="c">Citas</th><th>Participación</th><th class="c">Días</th><th class="c">Citas/día</th><th class="c">Desviación</th><th class="c">Próx. 30 días</th></tr></thead>
      <tbody id="carga-tabla"></tbody></table></div>
      <p class="muted" style="font-size:.8rem">Desviación respecto del promedio de citas por examinador en el período. Se marca desbalance sobre ±20%.</p></div>`;
}

/* ---------- Capacidad y carga (también los usa el tablero de Jefatura) ---------- */
function anCapacidadTexto(c) {
  if (!c) return '';
  const primer = c.primer_cupo
    ? `Primer cupo libre: ${fFecha(c.primer_cupo)} (${c.dias_hasta_primer_cupo === 0 ? 'hoy' : `en ${c.dias_hasta_primer_cupo} día${c.dias_hasta_primer_cupo === 1 ? '' : 's'}`}).`
    : 'No hay cupos libres en la agenda generada.';
  const lleno = c.ritmo_diario <= 0 ? 'Sin agendamientos en los últimos 30 días: no se puede proyectar el llenado.'
    : c.fecha_lleno ? `Al ritmo actual (${c.ritmo_diario} agendamientos/día) la agenda se llena aprox. el ${fFecha(c.fecha_lleno)}.`
      : `Al ritmo actual (${c.ritmo_diario} agendamientos/día) la agenda no se llena en los próximos 120 días.`;
  return `${lleno} ${primer}`;
}
function anCargaAvisoHtml(ce) {
  const d = (ce && ce.filas || []).filter((f) => f.desbalance);
  if (!d.length) return '';
  return `<div class="chips carga-avisos">${d.map((f) => `<span class="chip chip-desbalance ${f.desbalance}">⚠ ${esc(f.examinador)}: ${f.desviacion > 0 ? '+' : ''}${f.desviacion}% ${f.desbalance === 'alto' ? 'sobre' : 'bajo'} el promedio</span>`).join('')}</div>`;
}
function anCargaFilasHtml(ce) {
  const filas = (ce && ce.filas) || [];
  if (!filas.length) return '<tr><td colspan="7" class="muted">Sin datos en el período.</td></tr>';
  const max = Math.max(...filas.map((f) => f.participacion), 1);
  return filas.map((f) => `<tr><td>${esc(f.examinador)}${f.desbalance ? ` <span class="chip chip-desbalance ${f.desbalance}" title="Desbalance de carga">${f.desbalance === 'alto' ? 'sobrecarga' : 'baja carga'}</span>` : ''}</td>
    <td class="c">${f.citas}</td>
    <td><div class="barra-pct"><span style="width:${(f.participacion / max * 100).toFixed(0)}%"></span></div><b>${f.participacion}%</b></td>
    <td class="c">${f.dias_trabajados}</td><td class="c">${f.citas_por_dia}</td>
    <td class="c" style="font-weight:700;color:${f.desbalance ? 'var(--error)' : 'inherit'}">${f.desviacion > 0 ? '+' : ''}${f.desviacion}%</td>
    <td class="c">${f.proximas_30}</td></tr>`).join('');
}
function pintarCapacidadCarga(a) {
  const c = a.capacidad;
  if (c && $('#cap-kpis')) {
    $('#cap-kpis').innerHTML = anKpi('Libres próx. 30 días', c.libres_30) + anKpi('Libres próx. 60 días', c.libres_60)
      + anKpi('12:30 libres D/A5 (30 d)', c.libres_1230_30) + anKpi('12:30 libres D/A5 (60 d)', c.libres_1230_60)
      + anKpi('Agendamientos/día (30 d)', c.ritmo_diario)
      + anKpi('Días al primer cupo', c.dias_hasta_primer_cupo == null ? '—' : c.dias_hasta_primer_cupo);
    $('#cap-linea').textContent = anCapacidadTexto(c);
    grafico('g-cap', 'bar', c.por_dia.map((d) => d.fecha), c.por_dia.map((d) => d.libres), 'Cupos libres');
  }
  if ($('#carga-tabla')) {
    $('#carga-aviso').innerHTML = anCargaAvisoHtml(a.carga_examinadores);
    $('#carga-tabla').innerHTML = anCargaFilasHtml(a.carga_examinadores);
  }
}

const anFilaAprob = (x) => `<tr><td>${esc(x.k)}</td><td class="c">${x.citas}</td><td class="c">${x.con_resultado}</td>
  <td class="c" style="color:var(--ok);font-weight:700">${x.aprobados}</td><td class="c" style="font-weight:700">${x.aprobacion}%</td></tr>`;
const anKpi = (t, n) => `<div class="kpi"><div class="n">${n}</div><div class="t">${esc(t)}</div></div>`;

function anHeatHtml(h) {
  if (!h.celdas.length) return '<tbody><tr><td>Sin resultados en el período.</td></tr></tbody>';
  const mapa = new Map(h.celdas.map((c) => [`${c.dia}|${c.hora}`, c]));
  const peores = [...h.celdas].filter((c) => c.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 3).map((c) => `${c.dia}|${c.hora}`);
  const cab = `<thead><tr><th>Hora</th>${h.dias.map((d) => `<th class="c">${esc(d)}</th>`).join('')}</tr></thead>`;
  const filas = h.horas.map((hora) => `<tr><th>${esc(hora)}</th>${h.dias.map((_, i) => {
    const c = mapa.get(`${i}|${hora}`);
    if (!c) return '<td class="c muted">—</td>';
    const alfa = h.max ? (c.pct / h.max * 0.55).toFixed(2) : 0;
    const peor = peores.includes(`${i}|${hora}`);
    return `<td class="c${peor ? ' heat-peor' : ''}" style="background:rgba(173,43,47,${alfa})" title="${c.inasist} de ${c.total}">${c.pct}%</td>`;
  }).join('')}</tr>`).join('');
  return `${cab}<tbody>${filas}</tbody>`;
}

function pintarAnExtra(a) {
  AN_ESTADO.a = a;
  if (!$('#apclase-tabla')) return;
  const vacia = '<tr><td colspan="5" class="muted">Sin datos en el período.</td></tr>';
  const apc = a.aprobacion_por_clase || [];
  const api_ = a.aprobacion_por_intento || [];
  $('#apclase-tabla').innerHTML = apc.length ? apc.map(anFilaAprob).join('') : vacia;
  $('#apint-tabla').innerHTML = api_.length ? api_.map(anFilaAprob).join('') : vacia;
  grafico('g-apclase', 'bar', apc.map((x) => x.k), apc.map((x) => x.aprobacion), '% aprobación');
  grafico('g-apint', 'bar', api_.map((x) => x.k), api_.map((x) => x.aprobacion), '% aprobación');
  $('#heat-tabla').innerHTML = anHeatHtml(a.inasistencia_dia_hora);
  const te = a.tiempo_espera;
  $('#espera-kpis').innerHTML = anKpi('Promedio (días)', te.promedio) + anKpi('Mediana', te.mediana) + anKpi('P90', te.p90);
  $('#espera-tabla').innerHTML = te.por_mes.length ? te.por_mes.map((m) => `<tr><td>${esc(m.mes)}</td><td class="c">${m.n}</td>
    <td class="c">${m.promedio}</td><td class="c">${m.mediana}</td><td class="c">${m.p90}</td></tr>`).join('') : vacia;
  const tv = a.tramites_vencidos;
  $('#vencidos-kpis').innerHTML = anKpi('Citas con trámite vencido', tv.vencido_en_cita) + anKpi('De ellas con resultado', tv.vencido_en_cita_con_resultado)
    + anKpi('Personas', tv.personas) + anKpi('Vencidos hoy sin resultado', tv.vencidos_sin_resultado_hoy);
  pintarCapacidadCarga(a);
}

/* ---------- Informe: filas comunes para Excel e impresión ---------- */
function anPeriodoTxt(a) {
  const [d, h] = a.rango || [];
  return `${d ? fFecha(d) : 'inicio'} al ${h ? fFecha(h) : 'hoy'}`;
}
function anTablasInforme(a, escuelas) {
  const k = a.kpis;
  const resumen = [['Indicador', 'Valor', 'Período anterior', 'Diferencia']];
  const base = [['Bloques', 'bloques'], ['Bloqueados', 'bloqueadas'], ['Citas agendadas', 'ocupadas'], ['Ocupación %', 'ocupacion'],
    ['Con resultado', 'con_resultado'], ['Aprobación %', 'aprobacion'], ['Inasistencia %', 'inasistencia'], ['Reagendadas', 'reagendadas'],
    ['Tasa reagend. %', 'tasa_reagendamiento'], ['En lista espera', 'lista_espera']];
  for (const [t, c] of base) {
    const ant = a.kpis_anterior && c in a.kpis_anterior ? a.kpis_anterior[c] : '';
    const dif = a.deltas && c in a.deltas ? a.deltas[c] : '';
    resumen.push([t, k[c], ant, dif]);
  }
  const tv = a.tramites_vencidos;
  resumen.push(['Citas con trámite vencido', tv.vencido_en_cita, '', ''], ['Vencidos hoy sin resultado', tv.vencidos_sin_resultado_hoy, '', '']);
  const aprob = (arr, t) => [[t, 'Citas', 'Con resultado', 'Aprobó', '% aprobación'], ...arr.map((x) => [x.k, x.citas, x.con_resultado, x.aprobados, x.aprobacion])];
  const h = a.inasistencia_dia_hora;
  const mapa = new Map(h.celdas.map((c) => [`${c.dia}|${c.hora}`, c.pct]));
  const te = a.tiempo_espera;
  return [
    ['Resumen', resumen],
    ['Por examinador', [['Examinador', 'Aprobó', 'Reprobó', 'No asistió', 'Con resultado', '% aprobación'],
      ...(a.por_examinador_resultado || []).map((x) => [x.examinador, x.aprobados, x.reprobados, x.no_asistio, x.con_resultado, x.aprobacion])]],
    ['Por clase', aprob(a.aprobacion_por_clase || [], 'Clase')],
    ['Por intento', aprob(a.aprobacion_por_intento || [], 'Intento')],
    ['Inasistencia dia-hora (%)', [['Hora', ...h.dias], ...h.horas.map((hr) => [hr, ...h.dias.map((_, i) => (mapa.has(`${i}|${hr}`) ? mapa.get(`${i}|${hr}`) : ''))])]],
    ['Por escuela', [['Escuela', 'Citas', 'Aprobó', 'Reprobó', '% aprobación'],
      ...(escuelas || []).map((x) => [x.escuela_conductores, x.total, x.aprobados, x.reprobados, x.pct_aprobacion == null ? '' : x.pct_aprobacion])]],
    ['Tiempo de espera', [['Mes', 'Citas', 'Promedio (días)', 'Mediana', 'P90'],
      ['TOTAL', te.n, te.promedio, te.mediana, te.p90], ...te.por_mes.map((m) => [m.mes, m.n, m.promedio, m.mediana, m.p90])]],
    ['Carga examinadores', [['Examinador', 'Citas', '% participación', 'Días', 'Citas/día', 'Desviación %', 'Desbalance', 'Próx. 30 días'],
      ...((a.carga_examinadores && a.carga_examinadores.filas) || []).map((f) => [f.examinador, f.citas, f.participacion, f.dias_trabajados, f.citas_por_dia, f.desviacion, f.desbalance || '', f.proximas_30])]],
    ['Capacidad', [['Indicador', 'Valor'], ...(a.capacidad ? [['Libres próx. 30 días', a.capacidad.libres_30], ['Libres próx. 60 días', a.capacidad.libres_60],
      ['12:30 libres D/A5 (30 días)', a.capacidad.libres_1230_30], ['12:30 libres D/A5 (60 días)', a.capacidad.libres_1230_60],
      ['Agendamientos por día (últimos 30)', a.capacidad.ritmo_diario], ['Agenda llena aprox.', a.capacidad.fecha_lleno ? fFecha(a.capacidad.fecha_lleno) : ''],
      ['Primer cupo libre', a.capacidad.primer_cupo ? fFecha(a.capacidad.primer_cupo) : '']] : [])]],
  ];
}

function anNombreArchivo(a) {
  const [d, h] = a.rango || [];
  return `informe-agenda-${d || 'inicio'}_${h || 'hoy'}.xlsx`;
}

function descargarInformeExcel() {
  const a = AN_ESTADO.a;
  if (!a) { toast('Primero carga las estadísticas', 'err'); return; }
  if (typeof XLSX === 'undefined') { toast('No se pudo cargar el generador de Excel', 'err'); return; }
  const wb = XLSX.utils.book_new();
  for (const [nombre, filas] of anTablasInforme(a, AN_ESTADO.escuelas)) {
    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws['!cols'] = filas[0].map((_, i) => ({ wch: i === 0 ? 28 : 16 }));
    XLSX.utils.book_append_sheet(wb, ws, nombre.slice(0, 31));
  }
  XLSX.writeFile(wb, anNombreArchivo(a));
}

function informeImprimibleHtml(a, escuelas, logoUrl) {
  const tabla = ([titulo, filas]) => `<h2>${esc(titulo)}</h2><table><thead><tr>${filas[0].map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${filas.length > 1 ? filas.slice(1).map((f) => `<tr>${f.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${filas[0].length}">Sin datos</td></tr>`}</tbody></table>`;
  const ahora = new Date();
  const emitido = `${fFecha(hoy())} ${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')} hrs`;
  const comp = !a.periodo_anterior ? ''
    : a.kpis_anterior ? ` · Comparado con ${fFecha(a.periodo_anterior[0])} al ${fFecha(a.periodo_anterior[1])}`
      : ` · Sin datos del período anterior (${fFecha(a.periodo_anterior[0])} al ${fFecha(a.periodo_anterior[1])}) para comparar`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe de agenda</title>
    <style>${FICHA_CSS} table{margin-bottom:10px}</style></head><body>
    <header class="doc-hd"><img id="ficha-logo" src="${esc(logoUrl)}" alt="${esc(MARCA.organismo)}">
      <div class="org"><b>Ilustre ${esc(MARCA.organismo)}</b><span>Dirección de Tránsito y Transporte Público · ${esc(MARCA.unidad)}</span></div>
      <div class="emi">Emitido el<br>${esc(emitido)}</div></header>
    <h1>Informe de Exámenes Prácticos de Conducir</h1>
    <p class="sub">Período: ${esc(anPeriodoTxt(a) + comp)}</p>
    ${anTablasInforme(a, escuelas).map(tabla).join('')}
    <p class="sub">Tiempo de espera en días; para citas migradas del Excel el dato es aproximado.</p>
    <footer class="pie"><span>Documento generado por Agenda de Prácticos</span></footer>
    </body></html>`;
}

function imprimirInforme() {
  const a = AN_ESTADO.a;
  if (!a) { toast('Primero carga las estadísticas', 'err'); return; }
  const w = window.open('', '_blank');
  if (!w) { toast('El navegador bloqueó la ventana de impresión', 'err'); return; }
  w.document.write(informeImprimibleHtml(a, AN_ESTADO.escuelas, `${location.origin}/logo.png`));
  w.document.close();
  w.focus();
  const img = w.document.getElementById('ficha-logo');
  let impreso = false;
  const imprimir = () => { if (!impreso) { impreso = true; w.print(); } };
  if (img && !img.complete) { img.onload = imprimir; img.onerror = imprimir; setTimeout(imprimir, 3000); } else imprimir();
}
