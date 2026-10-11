/* ================= Tablero de Jefatura: una página imprimible con lo esencial =================
   Usa helpers globales: $, esc, fFecha, hoy, sumarDias, api, cargarVista, toast, MARCA,
   anDeltaHtml, anCapacidadTexto, anCargaAvisoHtml (public/estadisticas.js). */
'use strict';

const JF_DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];

function jfRango(modo, desde, hasta) {
  const h = hoy();
  const [y, m] = h.split('-').map(Number);
  const iso = (yy, mm, dd) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const ultimo = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (modo === 'anterior') {
    const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1;
    return [iso(py, pm, 1), iso(py, pm, ultimo(py, pm))];
  }
  if (modo === 'rango' && desde && hasta) return desde <= hasta ? [desde, hasta] : [hasta, desde];
  return [iso(y, m, 1), iso(y, m, ultimo(y, m))];
}

function jfKpi(titulo, valor, delta = '', extra = '') {
  return `<div class="jf-kpi"><div class="jf-n">${valor}</div><div class="jf-t">${esc(titulo)}</div>${delta}${extra}</div>`;
}

function jfTopInasistencia(h) {
  const top = [...((h && h.celdas) || [])].filter((c) => c.pct > 0).sort((a, b) => b.pct - a.pct || b.total - a.total).slice(0, 3);
  if (!top.length) return '<p class="muted">Sin inasistencias registradas en el período.</p>';
  return `<ol class="jf-lista">${top.map((c) => `<li><b>${esc(JF_DIAS[c.dia] || '')} ${esc(c.hora)}</b> · ${c.pct}% <span class="muted">(${c.inasist} de ${c.total})</span></li>`).join('')}</ol>`;
}

function jfPintar(a, extras) {
  const k = a.kpis;
  const [d, h] = a.rango || [];
  const tv = a.tramites_vencidos || {};
  $('#jf-periodo').textContent = `Período: ${d ? fFecha(d) : 'inicio'} al ${h ? fFecha(h) : 'hoy'}${a.periodo_anterior && a.kpis_anterior
    ? ` · comparado con ${fFecha(a.periodo_anterior[0])} al ${fFecha(a.periodo_anterior[1])}` : ''}`;
  $('#jf-kpis').innerHTML = jfKpi('Citas agendadas', k.ocupadas, anDeltaHtml(a, 'ocupadas'))
    + jfKpi('Ocupación', `${k.ocupacion}%`, anDeltaHtml(a, 'ocupacion'))
    + jfKpi('Aprobación', `${k.aprobacion}%`, anDeltaHtml(a, 'aprobacion'))
    + jfKpi('Inasistencia', `${k.inasistencia}%`, anDeltaHtml(a, 'inasistencia'));
  $('#jf-pend').innerHTML = jfKpi('Trámites vencidos en cita', tv.vencido_en_cita ?? 0)
    + jfKpi('Vencidos hoy sin resultado', tv.vencidos_sin_resultado_hoy ?? 0)
    + jfKpi('En lista de espera', extras.espera == null ? '—' : extras.espera)
    + jfKpi('Por confirmar (7 días)', extras.porConfirmar == null ? '—' : extras.porConfirmar);
  $('#jf-cap').textContent = anCapacidadTexto(a.capacidad) || 'Sin datos de capacidad.';
  const c = a.capacidad;
  $('#jf-cap-n').innerHTML = c ? `<span><b>${c.libres_30}</b> cupos libres en 30 días</span><span><b>${c.libres_60}</b> en 60 días</span><span><b>${c.libres_1230_30}</b> bloques 12:30 para D/A5 (30 días)</span>` : '';
  const ce = a.carga_examinadores;
  $('#jf-carga').innerHTML = anCargaAvisoHtml(ce)
    || `<p class="jf-ok">Carga equilibrada entre examinadores (ninguno se desvía más de ±${(ce && ce.umbral) || 20}% del promedio).</p>`;
  $('#jf-inas').innerHTML = jfTopInasistencia(a.inasistencia_dia_hora);
}

async function jfExtras() {
  const desde = hoy(); const hasta = sumarDias(desde, 7);
  const [esp, pc] = await Promise.allSettled([api('/lista-espera'), api('/agenda?estado=porconfirmar')]);
  return {
    espera: esp.status === 'fulfilled' ? ((esp.value && esp.value.personas) || []).length : null,
    porConfirmar: pc.status === 'fulfilled' ? (pc.value || []).filter((r) => r.fecha >= desde && r.fecha <= hasta).length : null,
  };
}

function jfImprimir() {
  document.body.classList.add('jf-imprimiendo');
  const fin = () => { document.body.classList.remove('jf-imprimiendo'); window.removeEventListener('afterprint', fin); };
  window.addEventListener('afterprint', fin);
  const img = $('#jf-logo');
  const go = () => { window.print(); setTimeout(fin, 1000); };
  if (img && !img.complete) { img.onload = go; img.onerror = go; } else go();
}

async function renderJefatura() {
  view.innerHTML = `
    <div class="panel no-print jf-filtros"><div class="fila" style="justify-content:center;align-items:flex-end;gap:14px;flex-wrap:wrap">
      <div class="campo"><label for="jf-modo">Período</label><select id="jf-modo">
        <option value="actual">Mes actual</option><option value="anterior">Mes anterior</option><option value="rango">Rango…</option></select></div>
      <div class="campo jf-rango" hidden><label for="jf-desde">Desde</label><input type="date" id="jf-desde"></div>
      <div class="campo jf-rango" hidden><label for="jf-hasta">Hasta</label><input type="date" id="jf-hasta"></div>
      <button class="btn" id="jf-ok">Actualizar</button>
      <button class="btn sec" id="jf-print">Imprimir</button>
    </div></div>
    <article class="jf-hoja" id="jf-root">
      <header class="jf-hd"><img id="jf-logo" src="logo.png" alt="${esc(MARCA.organismo || 'Logo')}">
        <div><h1>Tablero de Jefatura</h1><p class="jf-sub">Exámenes prácticos de conducir · ${esc(MARCA.unidad || '')}</p>
        <p class="jf-sub" id="jf-periodo">Cargando…</p></div></header>
      <section><h2>Indicadores del período</h2><div class="jf-kpis" id="jf-kpis"></div></section>
      <section><h2>Capacidad de la agenda</h2><p class="jf-linea" id="jf-cap"></p><p class="jf-cap-n" id="jf-cap-n"></p></section>
      <section class="jf-dos">
        <div><h2>Carga por examinador</h2><div id="jf-carga"></div></div>
        <div><h2>Horarios con más inasistencia</h2><div id="jf-inas"></div></div>
      </section>
      <section><h2>Pendientes</h2><div class="jf-kpis" id="jf-pend"></div></section>
      <p class="jf-pie">Emitido el ${esc(fFecha(hoy()))} · Agenda de Prácticos</p>
    </article>`;
  const rango = () => jfRango($('#jf-modo').value, $('#jf-desde').value, $('#jf-hasta').value);
  $('#jf-modo').onchange = () => {
    const r = $('#jf-modo').value === 'rango';
    document.querySelectorAll('.jf-rango').forEach((el) => { el.hidden = !r; });
    if (r && !$('#jf-desde').value) { const [d, h] = jfRango('actual'); $('#jf-desde').value = d; $('#jf-hasta').value = h; }
    if (!r) cargar();
  };
  let extras = { espera: null, porConfirmar: null };
  let ultimo = null;
  const cargar = () => {
    const [d, h] = rango();
    return cargarVista('jefatura', `/analitica?desde=${encodeURIComponent(d)}&hasta=${encodeURIComponent(h)}`, (a) => { ultimo = a; if (a && $('#jf-kpis')) jfPintar(a, extras); })
      .catch((e) => toast(e.message, 'err'));
  };
  $('#jf-ok').onclick = cargar;
  $('#jf-print').onclick = jfImprimir;
  const gv = genVista;
  const [, ex] = await Promise.all([cargar(), jfExtras()]);
  extras = ex;
  if (gv === genVista && ultimo && $('#jf-pend')) jfPintar(ultimo, extras);
}
