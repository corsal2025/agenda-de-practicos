/* ================= tab: BUSCAR (historial) ================= */
// La busqueda vive en el buscador de la cabecera; esta vista solo muestra el
// historial del contribuyente elegido ahi.
let contribuyenteSel = null;
async function renderBuscar() {
  view.innerHTML = '<div id="bx-hist"></div>';
  if (!contribuyenteSel) {
    $('#bx-hist').innerHTML = `<div class="panel"><h2>Buscar contribuyente</h2>
      <p class="muted">Escribe un RUT, nombre o telefono en el buscador de arriba (minimo 3 caracteres).</p></div>`;
    $('#bq').focus();
    return;
  }
  historial(contribuyenteSel.rut, contribuyenteSel.nombre);
}

/* buscador global de la cabecera */
(function buscadorGlobal() {
  const qi = $('#bq');
  const res = $('#bq-res');
  let tmr;
  let pedido = 0; // descarta respuestas viejas si el usuario sigue escribiendo
  let sel = -1;

  const cerrar = () => { res.hidden = true; res.innerHTML = ''; sel = -1; };
  const items = () => [...res.querySelectorAll('.bq-item')];
  const marcar = (i) => {
    const its = items();
    if (!its.length) return;
    sel = (i + its.length) % its.length;
    its.forEach((el, k) => el.classList.toggle('sel', k === sel));
    its[sel].scrollIntoView({ block: 'nearest' });
  };
  const elegir = (el) => {
    contribuyenteSel = { rut: el.dataset.rut, nombre: el.dataset.nom };
    cerrar();
    qi.value = '';
    qi.blur();
    if ((location.hash.slice(1) || 'agenda').split('?')[0] === 'buscar') renderBuscar();
    else irA('buscar');
  };

  autoformatoRut(qi);
  rutEnVivo(qi);
  qi.addEventListener('input', () => {
    clearTimeout(tmr);
    const q = qi.value.trim();
    if (q.length < 3) { cerrar(); return; }
    tmr = setTimeout(async () => {
      const n = ++pedido;
      let rows;
      try { rows = await api(`/buscar?q=${encodeURIComponent(q)}`); } catch (e) { toast(e.message, 'err'); return; }
      if (n !== pedido || qi.value.trim() !== q) return;
      const vistos = new Set();
      const html = [];
      for (const r of rows) {
        const k = r.rut || r.nombre;
        if (vistos.has(k)) continue;
        vistos.add(k);
        html.push(`<button type="button" class="bq-item" data-rut="${esc(r.rut || '')}" data-nom="${esc(r.nombre || '')}">
          <span>${esc(nom(r.nombre) || r.rut)}</span><small>${esc(r.rut || 'sin RUT')}</small></button>`);
      }
      res.innerHTML = html.join('') || '<div class="bq-vacio">Sin resultados</div>';
      res.hidden = false;
      sel = -1;
      items().forEach((el) => { el.onmousedown = (ev) => { ev.preventDefault(); elegir(el); }; });
    }, 250);
  });
  qi.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { cerrar(); qi.blur(); return; }
    if (res.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); marcar(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(sel - 1); }
    else if (e.key === 'Enter') {
      const its = items();
      if (its.length) { e.preventDefault(); elegir(its[sel >= 0 ? sel : 0]); }
    }
  });
  // En reposo el campo es angosto: placeholder corto; al enfocarlo se ensancha y explica que buscar.
  qi.addEventListener('blur', () => { qi.placeholder = 'Buscar'; setTimeout(cerrar, 120); });
  qi.addEventListener('focus', () => {
    qi.placeholder = 'RUT, nombre o teléfono (mín. 3)';
    if (qi.value.trim().length >= 3) qi.dispatchEvent(new Event('input'));
  });
})();
async function historial(rutv, nombre) {
  const rows = rutv ? await api(`/historial?rut=${encodeURIComponent(rutv)}`) : [];
  $('#bx-hist').innerHTML = `<div class="panel"><h3>${esc(nom(nombre) || rutv)}</h3>
    ${rutv ? '' : '<p class="muted">Sin RUT registrado; no se puede armar historial.</p>'}
    <div class="tabla-scroll"><table><thead><tr><th class="c">Fecha</th><th class="c">Hora</th><th>Examinador</th><th class="c">Clase</th><th>Tipo</th><th>Resultado</th><th class="c"></th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td class="c">${esc(fFecha(r.fecha))}</td><td class="c">${esc(r.hora)}</td><td>${esc(r.examinador)}</td>
      <td class="c">${esc(r.clase)}</td><td>${esc(r.tipo_cita)}</td><td>${esc(r.resultado)}</td>
      <td class="c"><button class="btn chico" data-ir="${r.id}" data-fecha="${esc(r.fecha)}">Ir a la agenda</button> <button class="btn chico sec" data-id="${r.id}">Abrir</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin citas.</td></tr>'}
    </tbody></table></div></div>`;
  $('#bx-hist').querySelectorAll('button[data-id]').forEach((el) => {
    el.onclick = () => abrirSlotPorId(Number(el.dataset.id), recargar(() => historial(rutv, nombre)));
  });
  $('#bx-hist').querySelectorAll('button[data-ir]').forEach((el) => {
    el.onclick = () => irACitaEnAgenda(Number(el.dataset.ir), el.dataset.fecha);
  });
}
// Abre la pestana Agenda en el dia de la cita, sin filtro de examinador, y resalta su tarjeta.
async function irACitaEnAgenda(id, fecha) {
  estadoAgenda.fecha = fecha;
  estadoAgenda.examinador_id = '';
  irA('agenda');
  for (let i = 0; i < 30; i++) {
    const card = document.querySelector(`.slot[data-id="${id}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('slot-destacada');
      setTimeout(() => card.classList.remove('slot-destacada'), 4000);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  toast('No se encontró la cita en la agenda de ese día', 'err');
}

/* ================= tab: ERRORES ================= */
const ETIQUETA = {
  INCOMPLETA: 'Cita incompleta', RUT_INVALIDO: 'RUT invalido', CLASE_BLOQUE: 'Clase en bloque incorrecto',
  DUPLICADO_FUTURO: 'Duplicado futuro', DUPLICADO_DIA: 'Duplicado el mismo dia', CONFLICTO_TERRENO: 'Conflicto terreno',
  SIN_RESULTADO: 'Sin resultado', SIN_CONTACTO: 'Sin contacto', TELEFONO_INCOMPLETO: 'Teléfono incompleto', DIA_INHABIL: 'Cita en dia inhabil',
  PENDIENTE_REAGENDAR: 'Pendiente de reagendar', FALTA_TELEFONO: 'Falta teléfono', FALTA_CORREO: 'Falta correo',
  CORREO_INVALIDO: 'Correo inválido', FALTA_CLASE: 'Falta clase', CONFLICTO_PESADA: 'Conflicto D/A5 12:30',
};
let filtErr = { tipo: '' };
async function renderErrores() {
  view.innerHTML = `<div class="panel"><div class="fila">
      <h2 style="margin:0;flex:1">Reporte de errores</h2>
      <button class="btn sec" id="e-refresh">Recalcular</button></div>
    <div class="chips" id="e-chips" style="margin:.6rem 0"></div></div>
    <div class="panel tabla-scroll"><table><thead><tr>
      <th class="c">Sev</th><th>Tipo</th><th class="c">Fecha</th><th class="c">Hora</th><th>Examinador</th><th>RUT</th><th>Nombre</th><th>Detalle</th><th class="c"></th>
    </tr></thead><tbody id="e-body"><tr><td colspan="9">Cargando...</td></tr></tbody></table></div>
    <div id="e-limpieza"></div>`;
  if (window.Limpieza) window.Limpieza.render($('#e-limpieza'));
  const cargar = () => cargarVista('errores', '/errores', (rep) => {
    pintarBadgeErrores(rep); // mismo reporte: no se vuelve a pedir /errores solo para el numerito
    $('#e-chips').innerHTML = [`<button class="chip" data-t="">Todos (${rep.total})</button>`]
      .concat(Object.entries(rep.resumen).sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `<button class="chip" data-t="${t}">${esc(ETIQUETA[t] || t)} (${n})</button>`)).join('');
    $('#e-chips').querySelectorAll('button').forEach((el) => {
      el.onclick = () => { filtErr.tipo = el.dataset.t; pintar(rep); };
    });
    pintar(rep);
  });
  const pintar = (rep) => {
    const rows = rep.hallazgos.filter((x) => (!filtErr.tipo || x.tipo === filtErr.tipo));
    $('#e-body').innerHTML = rows.length ? rows.slice(0, 600).map((x) => `<tr>
      <td class="c"><span class="sev ${x.severidad}">${x.severidad}</span></td>
      <td>${esc(ETIQUETA[x.tipo] || x.tipo)}</td>
      <td class="c">${esc(fFecha(x.fecha))}</td><td class="c">${esc(x.hora)}</td><td>${esc(x.examinador)}</td>
      <td>${esc(x.rut)}</td><td>${esc(nom(x.nombre))}</td><td>${esc(x.mensaje)}</td>
      <td class="c">${x.agenda_id ? `<button class="btn chico" data-id="${x.agenda_id}">Abrir</button>` : ''}</td></tr>`).join('')
      : licoVacioFila(9, 'celebra', 'Todo en orden', 'Nada que mostrar: no hay errores. ¡Eso es lo ideal!');
    $('#e-body').querySelectorAll('button[data-id]').forEach((el) => {
      el.onclick = () => abrirSlotPorId(Number(el.dataset.id), recargar(cargar));
    });
  };
  $('#e-refresh').onclick = () => { cacheGet.delete('/errores'); cargar(); };
  cargar();
}
