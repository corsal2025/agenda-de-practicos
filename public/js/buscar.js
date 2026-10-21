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
let filtErr = { tipo: '', q: '' };
async function renderErrores() {
  view.innerHTML = `<div class="panel">
    <div class="fila" style="gap:1rem;flex-wrap:wrap;align-items:center">
      <h2 style="margin:0;flex:1">Reporte de errores</h2>
      <input type="search" id="e-q" placeholder="🔍 Filtrar por RUT, nombre o detalle..." class="input-chico" style="max-width:320px;min-width:240px;padding:.4rem .8rem;border:1px solid var(--linea);border-radius:var(--r-sm);background:var(--papel);color:var(--tinta)">
      <button class="btn sec" id="e-refresh">Recalcular</button>
    </div>
    <div class="chips" id="e-chips" style="margin:.6rem 0"></div>
  </div>
  <div class="panel tabla-scroll">
    <table class="tabla-errores-planilla">
      <thead><tr>
        <th class="c th-err-sev">Sev</th>
        <th class="th-err-tipo">Tipo</th>
        <th class="c th-err-fecha">Fecha</th>
        <th class="c th-err-hora">Hora</th>
        <th class="th-err-examinador">Examinador</th>
        <th class="th-err-rut">RUT</th>
        <th class="th-err-nombre">Nombre</th>
        <th class="th-err-detalle">Detalle</th>
        <th class="c th-err-acciones">Acciones en planilla</th>
      </tr></thead>
      <tbody id="e-body"><tr><td colspan="9">Cargando...</td></tr></tbody>
    </table>
  </div>
  <div id="e-limpieza"></div>`;

  if (window.Limpieza) window.Limpieza.render($('#e-limpieza'));

  let ultimoReporte = null;
  const cargar = () => cargarVista('errores', '/errores', (rep) => {
    ultimoReporte = rep;
    pintarBadgeErrores(rep);
    $('#e-chips').innerHTML = [`<button class="chip ${!filtErr.tipo ? 'activo' : ''}" data-t="">Todos (${rep.total})</button>`]
      .concat(Object.entries(rep.resumen).sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `<button class="chip ${filtErr.tipo === t ? 'activo' : ''}" data-t="${t}">${esc(ETIQUETA[t] || t)} (${n})</button>`)).join('');
    $('#e-chips').querySelectorAll('button').forEach((el) => {
      el.onclick = () => {
        filtErr.tipo = el.dataset.t;
        $('#e-chips').querySelectorAll('button').forEach((b) => b.classList.toggle('activo', b.dataset.t === filtErr.tipo));
        pintar(rep);
      };
    });
    pintar(rep);
  });

  const pintar = (rep) => {
    const busq = (filtErr.q || '').trim().toLowerCase();
    const rows = rep.hallazgos.filter((x) => {
      if (filtErr.tipo && x.tipo !== filtErr.tipo) return false;
      if (busq) {
        const texto = [x.rut, x.nombre, x.examinador, x.mensaje, x.fecha, x.hora, ETIQUETA[x.tipo] || x.tipo].join(' ').toLowerCase();
        if (!texto.includes(busq)) return false;
      }
      return true;
    });

    if (!rows.length) {
      $('#e-body').innerHTML = licoVacioFila(9, 'celebra', 'Todo en orden', 'Nada que mostrar: no hay errores coincidentes en este filtro.');
      return;
    }

    $('#e-body').innerHTML = rows.slice(0, 600).map((x) => {
      let acciones = '';
      if (x.agenda_id) {
        if (x.tipo === 'DUPLICADO_DIA' || x.tipo === 'DUPLICADO_FUTURO') {
          acciones = `
            <div class="acciones-error-wrap">
              <button class="btn chico peligro btn-err-liberar" data-id="${x.agenda_id}" data-desc="${esc(x.nombre || x.rut || 'cita')} (${esc(fFecha(x.fecha))} ${esc(x.hora)})" title="Liberar este cupo duplicado de inmediato">🗑️ Liberar</button>
              <button class="btn chico sec btn-err-editar" data-id="${x.agenda_id}" title="Editar cita en esta misma planilla">✏️ Editar</button>
              <button class="btn chico sec btn-err-espera" data-id="${x.agenda_id}" data-desc="${esc(x.nombre || x.rut || 'cita')}" title="Pasar a lista de espera con prioridad">🔄 Espera</button>
            </div>`;
        } else if (x.tipo === 'SIN_RESULTADO') {
          acciones = `
            <div class="acciones-error-wrap">
              <button class="btn chico btn-err-res" style="background:var(--ok);color:#fff" data-id="${x.agenda_id}" data-res="APROBADO" title="Registrar aprobado">✓ Aprobó</button>
              <button class="btn chico btn-err-res" style="background:var(--error);color:#fff" data-id="${x.agenda_id}" data-res="REPROBADO" title="Registrar reprobado">✗ Reprobó</button>
              <button class="btn chico btn-err-res sec" data-id="${x.agenda_id}" data-res="NO ASISTIO" title="Registrar inasistencia">🚫 No asistió</button>
              <button class="btn chico sec btn-err-editar" data-id="${x.agenda_id}" title="Editar en planilla">✏️</button>
            </div>`;
        } else {
          acciones = `
            <div class="acciones-error-wrap">
              <button class="btn chico btn-err-editar" data-id="${x.agenda_id}" title="Editar en esta misma planilla">✏️ Editar</button>
              <button class="btn chico peligro btn-err-liberar" data-id="${x.agenda_id}" data-desc="${esc(x.nombre || x.rut || 'cita')} (${esc(fFecha(x.fecha))} ${esc(x.hora)})" title="Liberar este cupo">🗑️ Liberar</button>
              <button class="btn chico sec btn-err-espera" data-id="${x.agenda_id}" data-desc="${esc(x.nombre || x.rut || 'cita')}" title="Pasar a lista de espera">🔄 Espera</button>
            </div>`;
        }
      }

      return `<tr data-row-id="${x.agenda_id || ''}">
        <td class="c td-err-sev"><span class="sev ${x.severidad}">${x.severidad}</span></td>
        <td class="td-err-tipo"><strong>${esc(ETIQUETA[x.tipo] || x.tipo)}</strong></td>
        <td class="c td-err-fecha">${esc(fFecha(x.fecha))}</td>
        <td class="c td-err-hora">${esc(x.hora)}</td>
        <td class="td-err-examinador">${esc(x.examinador)}</td>
        <td class="num td-err-rut">${esc(x.rut || '—')}</td>
        <td class="td-err-nombre">${esc(nom(x.nombre) || '—')}</td>
        <td class="td-err-detalle">${esc(x.mensaje)}</td>
        <td class="c td-err-acciones">${acciones}</td>
      </tr>`;
    }).join('');

    // Wire up: Liberar
    $('#e-body').querySelectorAll('.btn-err-liberar').forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.id);
        const desc = btn.dataset.desc || 'esta cita';
        if (!confirm(`¿Liberar este cupo de "${desc}"?\n\nEl cupo quedará libre y disponible para ser citado nuevamente.`)) return;
        try {
          await api(`/agenda/${id}/liberar`, { method: 'POST', body: { motivo: 'Corrección directa en reporte de errores' } });
          toast('Cupo liberado exitosamente · Reporte actualizado', 'ok');
          cacheGet.delete('/errores');
          cargar();
        } catch (e) {
          toast(e.message, 'err');
        }
      };
    });

    // Wire up: Espera
    $('#e-body').querySelectorAll('.btn-err-espera').forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.id);
        const desc = btn.dataset.desc || 'esta persona';
        const mot = prompt(`Enviar a "${desc}" a la Lista de Espera con prioridad:\nIngrese motivo de reagendamiento (opcional):`, 'Corrección de error en planilla');
        if (mot === null) return;
        try {
          await api(`/agenda/${id}/reagendar`, { method: 'POST', body: { motivo: mot.trim() || 'Reagendamiento desde reporte de errores' } });
          toast('Candidato derivado a Lista de Espera con prioridad · Horario liberado', 'ok');
          cacheGet.delete('/errores');
          cargar();
        } catch (e) {
          toast(e.message, 'err');
        }
      };
    });

    // Wire up: Resultados rápidos
    $('#e-body').querySelectorAll('.btn-err-res').forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.id);
        const res = btn.dataset.res;
        try {
          await api(`/agenda/${id}/resultado`, { method: 'POST', body: { resultado: res } });
          toast(`Resultado "${res}" guardado exitosamente`, 'ok');
          cacheGet.delete('/errores');
          cargar();
        } catch (e) {
          toast(e.message, 'err');
        }
      };
    });

    // Wire up: Editar inline en la misma planilla
    $('#e-body').querySelectorAll('.btn-err-editar').forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.id);
        const tr = btn.closest('tr');
        const next = tr.nextElementSibling;
        if (next && next.classList.contains('fila-inline-editor')) {
          next.remove();
          return;
        }

        // Cerrar otros editores abiertos para mantener la vista limpia
        $('#e-body').querySelectorAll('.fila-inline-editor').forEach((el) => el.remove());

        const finding = rep.hallazgos.find((h) => h.agenda_id === id) || {};

        let slotData = null;
        try {
          slotData = await api(`/agenda/${id}`);
        } catch (_) {}

        const rutVal = (slotData && slotData.rut) || finding.rut || '';
        const nomVal = (slotData && slotData.nombre) || finding.nombre || '';
        const telVal = (slotData && slotData.contacto) || '';
        const mailVal = (slotData && slotData.correo) || '';
        const claseVal = (slotData && slotData.clase) || '';
        const obsVal = (slotData && slotData.comentarios) || '';

        const editTr = document.createElement('tr');
        editTr.className = 'fila-inline-editor';
        editTr.innerHTML = `
          <td colspan="9">
            <div class="inline-editor-card">
              <div class="inline-editor-encabezado">
                <div>
                  <strong>✏️ Modificar datos en esta misma planilla</strong>
                  <span class="muted" style="margin-left:.7rem">${esc(fFecha(finding.fecha))} a las ${esc(finding.hora)} · Examinador: ${esc(finding.examinador)}</span>
                </div>
                <span class="badge ${finding.severidad || 'info'}">${esc(ETIQUETA[finding.tipo] || finding.tipo || 'Cita')}</span>
              </div>
              <div class="inline-editor-form">
                <div class="inline-campo" style="max-width:140px">
                  <label>RUT</label>
                  <input type="text" id="ie-rut-${id}" value="${esc(rutVal)}" placeholder="12.345.678-9" />
                </div>
                <div class="inline-campo" style="flex:2">
                  <label>Nombre postulante</label>
                  <input type="text" id="ie-nom-${id}" value="${esc(nomVal)}" placeholder="Nombre y Apellidos" />
                </div>
                <div class="inline-campo" style="max-width:150px">
                  <label>Teléfono</label>
                  <input type="text" id="ie-tel-${id}" value="${esc(telVal)}" placeholder="+56 9 XXXX XXXX" />
                </div>
                <div class="inline-campo" style="flex:1.5">
                  <label>Correo Electrónico</label>
                  <input type="email" id="ie-mail-${id}" value="${esc(mailVal)}" placeholder="correo@ejemplo.com" />
                </div>
                <div class="inline-campo" style="max-width:110px">
                  <label>Clase</label>
                  <input type="text" id="ie-clase-${id}" value="${esc(claseVal)}" placeholder="B, C, A2..." />
                </div>
                <div class="inline-campo" style="flex:2">
                  <label>Observaciones</label>
                  <input type="text" id="ie-obs-${id}" value="${esc(obsVal)}" placeholder="Observaciones o notas" />
                </div>
              </div>
              <div class="inline-editor-footer">
                <button class="btn chico" id="ie-save-${id}">💾 Guardar cambios en planilla</button>
                <button class="btn chico sec" id="ie-cancel-${id}">✖ Cancelar</button>
                <div style="flex:1"></div>
                <button class="btn chico peligro" id="ie-liberar-${id}">🗑️ Liberar este cupo</button>
                <button class="btn chico sec" id="ie-espera-${id}">🔄 Derivar a lista de espera</button>
              </div>
            </div>
          </td>
        `;
        tr.after(editTr);

        const rutInp = $(`#ie-rut-${id}`);
        if (rutInp && window.autoformatoRut) autoformatoRut(rutInp);
        if (rutInp && window.rutEnVivo) rutEnVivo(rutInp);

        // Cancelar
        $(`#ie-cancel-${id}`).onclick = () => editTr.remove();

        // Guardar
        $(`#ie-save-${id}`).onclick = async () => {
          const btnSave = $(`#ie-save-${id}`);
          btnSave.disabled = true;
          btnSave.textContent = 'Guardando...';

          try {
            const bodyPayload = {
              ...(slotData || {}),
              rut: $(`#ie-rut-${id}`).value.trim(),
              nombre: $(`#ie-nom-${id}`).value.trim(),
              contacto: $(`#ie-tel-${id}`).value.trim(),
              correo: $(`#ie-mail-${id}`).value.trim(),
              clase: $(`#ie-clase-${id}`).value.trim(),
              comentarios: $(`#ie-obs-${id}`).value.trim(),
            };

            await api(`/agenda/${id}`, {
              method: 'PUT',
              body: bodyPayload,
            });
            toast('Cita actualizada exitosamente en la planilla', 'ok');
            cacheGet.delete('/errores');
            cargar();
          } catch (e) {
            toast(e.message, 'err');
            btnSave.disabled = false;
            btnSave.textContent = '💾 Guardar cambios en planilla';
          }
        };

        // Liberar desde inline
        $(`#ie-liberar-${id}`).onclick = async () => {
          if (!confirm(`¿Liberar este cupo de "${finding.nombre || finding.rut || 'cita'}" (${fFecha(finding.fecha)} ${finding.hora})?`)) return;
          try {
            await api(`/agenda/${id}/liberar`, { method: 'POST', body: { motivo: 'Corrección directa en reporte de errores' } });
            toast('Cupo liberado exitosamente · Reporte actualizado', 'ok');
            cacheGet.delete('/errores');
            cargar();
          } catch (e) {
            toast(e.message, 'err');
          }
        };

        // Espera desde inline
        $(`#ie-espera-${id}`).onclick = async () => {
          const mot = prompt('Motivo para enviar a lista de espera:', 'Corrección de error en planilla');
          if (mot === null) return;
          try {
            await api(`/agenda/${id}/reagendar`, { method: 'POST', body: { motivo: mot.trim() || 'Reagendamiento desde reporte de errores' } });
            toast('Candidato derivado a Lista de Espera con prioridad · Horario liberado', 'ok');
            cacheGet.delete('/errores');
            cargar();
          } catch (e) {
            toast(e.message, 'err');
          }
        };
      };
    });
  };

  $('#e-refresh').onclick = () => { cacheGet.delete('/errores'); cargar(); };
  $('#e-q').oninput = () => {
    filtErr.q = $('#e-q').value;
    if (ultimoReporte) pintar(ultimoReporte);
  };

  cargar();
}

