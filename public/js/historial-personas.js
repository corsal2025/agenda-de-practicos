/* ================= tab: HISTORIAL DE PERSONAS ================= */
let filtHP = { q: '', chip: 'registro' };
const HP_CHIPS = [['registro', 'Con faltas o cambios'], ['todas', 'Todas'], ['faltas', 'Con faltas'], ['cambios', 'Con cambios de hora']];

// Badge numerico: rojo con 3 o mas, ambar con 1 o 2, gris en cero.
function hpBadgeFaltas(n) {
  if (!n) return '<span class="muted">0</span>';
  return `<span class="hp-badge ${n >= 3 ? 'hp-rojo' : 'hp-ambar'}">${n}</span>`;
}
const hpClave = (p) => encodeURIComponent(p.clave);

async function renderHistorialPersonas() {
  view.innerHTML = `<div class="panel">
    <div class="fila hp-barra">
      <h2 style="margin:0;flex:1">Historial de personas</h2>
      <input type="search" id="hp-q" placeholder="Buscar por RUT o nombre..." aria-label="Buscar por RUT o nombre" class="input-chico hp-buscar" value="${esc(filtHP.q)}">
      <a class="btn" id="hp-excel" href="/api/export?formato=completo">📥 Descargar Excel completo (con historial)</a>
    </div>
    <div class="chips" id="hp-chips" style="margin:.6rem 0"></div>
    <p class="muted" id="hp-total" style="margin:0" aria-live="polite"></p>
  </div>
  <div class="panel tabla-scroll">
    <table class="tabla-hp">
      <thead><tr>
        <th>Persona</th><th class="c">Faltas</th><th class="c">Cambios de hora</th><th class="c">Exámenes</th>
        <th class="c">Aprobados</th><th class="c">Reprobados</th><th class="c">Última falta</th><th class="c">Último cambio</th><th class="c">Ficha</th>
      </tr></thead>
      <tbody id="hp-body"><tr><td colspan="9">Cargando...</td></tr></tbody>
    </table>
  </div>`;

  let personas = [];
  const pintar = () => {
    const filas = personas.filter((p) => (filtHP.chip === 'faltas' ? p.faltas > 0 : filtHP.chip === 'cambios' ? p.cambios_hora > 0 : filtHP.chip === 'registro' ? (p.faltas > 0 || p.cambios_hora > 0) : true));
    $('#hp-total').textContent = `${filas.length} persona${filas.length === 1 ? '' : 's'}`;
    const hayFaltas = personas.some((p) => p.faltas > 0);
    $('#hp-body').innerHTML = filas.length ? filas.map((p) => `
      <tr class="hp-fila" data-clave="${esc(hpClave(p))}">
        <td><b>${esc(nom(p.nombre) || '—')}</b><div class="muted hp-rut">${esc(p.rut || 'Sin RUT')}</div></td>
        <td class="c">${hpBadgeFaltas(p.faltas)}</td>
        <td class="c">${p.cambios_hora || '<span class="muted">0</span>'}</td>
        <td class="c">${p.examenes || 0}</td>
        <td class="c">${p.aprobados || 0}</td>
        <td class="c">${p.reprobados || 0}</td>
        <td class="c">${p.ultima_falta ? esc(fFecha(p.ultima_falta)) : '—'}</td>
        <td class="c">${p.ultimo_cambio ? esc(fFecha(p.ultimo_cambio)) : '—'}</td>
        <td class="c"><button class="btn chico" data-ficha="${esc(hpClave(p))}">Ver ficha</button></td>
      </tr>`).join('')
      : ((filtHP.chip === 'faltas' || filtHP.chip === 'registro') && !hayFaltas && !personas.some((p) => p.cambios_hora > 0) && !filtHP.q
        ? licoVacioFila(9, 'feliz', 'Aún no hay faltas registradas', 'Cuando alguien no asista a su cita aparecerá aquí.')
        : licoVacioFila(9, 'saluda', 'Sin resultados', 'No hay personas que coincidan con la búsqueda o el filtro.'));
    $('#hp-body').querySelectorAll('[data-ficha]').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); abrirFichaPersona(decodeURIComponent(b.dataset.ficha)); };
    });
    $('#hp-body').querySelectorAll('tr.hp-fila').forEach((tr) => {
      tr.onclick = () => abrirFichaPersona(decodeURIComponent(tr.dataset.clave));
    });
  };

  const pintarChips = () => {
    $('#hp-chips').innerHTML = HP_CHIPS.map(([k, t]) => `<button class="chip ${filtHP.chip === k ? 'activo' : ''}" data-c="${k}">${t}</button>`).join('');
    $('#hp-chips').querySelectorAll('button').forEach((b) => {
      b.onclick = () => { filtHP.chip = b.dataset.c; pintarChips(); pintar(); };
    });
  };

  const cargar = () => cargarVista('hp', `/personas-historial?q=${encodeURIComponent(filtHP.q.trim())}`, (r) => {
    personas = (r && r.personas) || [];
    pintar();
  });

  pintarChips();
  let t = null;
  $('#hp-q').oninput = (e) => {
    filtHP.q = e.target.value;
    clearTimeout(t);
    t = setTimeout(cargar, 250);
  };
  cargar();
}

/* ---------- ficha de persona ---------- */
const HP_TIPO = {
  falta: { ico: '🚫', cls: 'hp-t-falta', txt: 'Falta' },
  cambio_hora: { ico: '🔄', cls: 'hp-t-cambio', txt: 'Cambio de hora' },
};
function hpExamenTipo(det) {
  const d = String(det || '').toUpperCase();
  if (d.includes('REPROB')) return { ico: '❌', cls: 'hp-t-rep' };
  if (d.includes('APROB')) return { ico: '✅', cls: 'hp-t-apr' };
  return { ico: '📝', cls: 'hp-t-exa' };
}
const hpDia = (f, h) => `${esc(fFecha(f))}${h ? ` ${esc(h)}` : ''}`;

const HP_TIPO_ESPERA = { no_vino: 'no vino a su examen', reprobo: 'reprobó, vuelve a rendir', reagendar: 'por reagendar' };
function hpEstado(d) {
  const e = d.en_lista_espera, c = d.cita_actual;
  const partes = [];
  if (e) partes.push(`<span class="hp-estado hp-ambar">En lista de espera: ${esc(HP_TIPO_ESPERA[e.tipo] || e.tipo)}${e.desde ? ` desde ${esc(fFecha(e.desde))}` : ''}</span>`);
  if (c) partes.push(`<span class="hp-estado hp-info">Cita actual: ${hpDia(c.fecha, c.hora)}${c.examinador ? ` · ${esc(c.examinador)}` : ''}</span>`);
  if (!partes.length) partes.push('<span class="hp-estado">Sin cita vigente</span>');
  return partes.join('');
}

function hpTabla(titulo, n, cabeceras, filas) {
  return `<details class="hp-sec" ${n ? 'open' : ''}><summary>${esc(titulo)} (${n})</summary>
    ${n ? `<div class="tabla-scroll"><table class="tabla-hp"><thead><tr>${cabeceras.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${filas.join('')}</tbody></table></div>`
      : '<p class="muted" style="margin:.4rem 0">Sin registros.</p>'}</details>`;
}

function hpFichaHtml(d) {
  const p = d.persona || {}, r = d.resumen || {};
  const tarjeta = (n, t, cls) => `<div class="hp-card ${cls}"><b>${n}</b><span>${esc(t)}</span></div>`;
  const linea = (d.linea_tiempo || []).map((x) => {
    const t = x.tipo === 'examen' ? hpExamenTipo(x.detalle) : HP_TIPO[x.tipo] || { ico: '•', cls: '' };
    return `<li class="hp-ev ${t.cls}"><span class="hp-ev-ico" aria-hidden="true">${t.ico}</span>
      <div><b>${esc(fFecha(x.fecha))}</b><div>${esc(x.detalle || '')}</div></div></li>`;
  }).join('');
  const faltas = (d.faltas || []).map((f) => `<tr><td>${hpDia(f.fecha, f.hora)}</td><td>${esc(f.examinador || '—')}</td><td>${esc(f.actor || '—')}</td><td>${esc(fFechaHora(f.registrada_en))}</td></tr>`);
  const cambios = (d.cambios_hora || []).map((c) => `<tr><td>${hpDia(c.fecha_origen, c.hora_origen)}<div class="muted">${esc(c.examinador_origen || '')}</div></td>
    <td>${hpDia(c.fecha_destino, c.hora_destino)}<div class="muted">${esc(c.examinador_destino || '')}</div></td>
    <td>${esc(c.motivo || '—')}</td><td>${esc(c.actor || '—')}</td></tr>`);
  const exa = (d.examenes || []).map((x) => `<tr><td>${hpDia(x.fecha, x.hora)}</td><td>${esc(x.examinador || '—')}</td><td class="c">${esc(x.clase || '—')}</td><td>${esc(x.resultado || '—')}</td><td class="c">${esc(x.intento ?? '—')}</td></tr>`);
  return `<div class="hp-ficha-cab">
      <div><b>RUT:</b> ${esc(p.rut || 'Sin RUT')} · <b>Clase:</b> ${esc(p.clase || '—')}</div>
      <div><b>Contacto:</b> ${esc(p.contacto || '-')} · <b>Correo:</b> ${esc(p.correo || '-')}</div>
      <div class="hp-estados">${hpEstado(d)}</div>
    </div>
    <div class="hp-cards">
      ${tarjeta(r.faltas || 0, 'Faltas', r.faltas > 0 ? 'hp-rojo' : '')}
      ${tarjeta(r.cambios_hora || 0, 'Cambios de hora', r.cambios_hora > 0 ? 'hp-ambar' : '')}
      ${tarjeta(r.examenes || 0, 'Exámenes rendidos', '')}
      ${tarjeta(`${r.aprobados || 0} / ${r.reprobados || 0}`, 'Aprobados / Reprobados', r.reprobados > 0 ? 'hp-ambar' : (r.aprobados > 0 ? 'hp-verde' : ''))}
    </div>
    <h4 class="hp-h">Línea de tiempo</h4>
    ${linea ? `<ol class="hp-linea">${linea}</ol>` : '<p class="muted">Sin eventos registrados.</p>'}
    ${hpTabla('Faltas', faltas.length, ['Cita', 'Examinador', 'Registró', 'Registrada'], faltas)}
    ${hpTabla('Cambios de hora', cambios.length, ['Desde', 'Hacia', 'Motivo', 'Quién'], cambios)}
    ${hpTabla('Exámenes', exa.length, ['Cita', 'Examinador', 'Clase', 'Resultado', 'Intento'], exa)}`;
}

async function abrirFichaPersona(clave) {
  if (!clave) return;
  const previo = document.activeElement;
  const ov = modal('Ficha de la persona', '<p>Cargando...</p>', '<button class="btn sec" data-cerrar>Cerrar</button>', 'hp-ficha');
  const dlg = ov.querySelector('.modal');
  dlg.setAttribute('aria-labelledby', 'hp-ficha-titulo');
  ov.querySelector('h3').id = 'hp-ficha-titulo';
  const cerrar = () => { cerrarModal(); if (previo && previo.focus && document.contains(previo)) previo.focus(); };
  ov.querySelector('.x').onclick = cerrar;
  ov.querySelector('[data-cerrar]').onclick = cerrar;
  ov.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } };
  ov.querySelector('.x').focus();
  try {
    const d = await api(`/personas-historial/${encodeURIComponent(clave)}`);
    if (!ov.isConnected) return; // se cerro mientras cargaba
    ov.querySelector('h3').textContent = nom(d.persona && d.persona.nombre) || 'Ficha de la persona';
    ov.querySelector('.cuerpo').innerHTML = hpFichaHtml(d);
  } catch (e) {
    if (ov.isConnected) ov.querySelector('.cuerpo').innerHTML = `<p>${esc(e.message || 'No hay historial para esta persona.')}</p>`;
  }
}
window.abrirFichaPersona = abrirFichaPersona;
