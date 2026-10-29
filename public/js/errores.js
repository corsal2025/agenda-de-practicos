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
    const hoyStr = typeof hoy === 'function' ? hoy() : new Date().toISOString().slice(0, 10);
    const hallazgosVigentes = (rep.hallazgos || []).filter((x) => {
      if (x.fecha && x.fecha < hoyStr) return false;
      if (typeof pareceMarcador === 'function' && (pareceMarcador(x.rut) || pareceMarcador(x.nombre))) return false;
      return true;
    });
    const resumen = hallazgosVigentes.reduce((acc, h) => {
      acc[h.tipo] = (acc[h.tipo] || 0) + 1;
      return acc;
    }, {});
    const repVigente = { ...rep, total: hallazgosVigentes.length, resumen, hallazgos: hallazgosVigentes };
    ultimoReporte = repVigente;
    pintarBadgeErrores(repVigente);
    $('#e-chips').innerHTML = [`<button class="chip ${!filtErr.tipo ? 'activo' : ''}" data-t="">Todos (${repVigente.total})</button>`]
      .concat(Object.entries(repVigente.resumen).sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `<button class="chip ${filtErr.tipo === t ? 'activo' : ''}" data-t="${t}">${esc(ETIQUETA[t] || t)} (${n})</button>`)).join('');
    $('#e-chips').querySelectorAll('button').forEach((el) => {
      el.onclick = () => {
        filtErr.tipo = el.dataset.t;
        $('#e-chips').querySelectorAll('button').forEach((b) => b.classList.toggle('activo', b.dataset.t === filtErr.tipo));
        pintar(repVigente);
      };
    });
    pintar(repVigente);
  });

  const pintar = (rep) => {
    const hoyStr = typeof hoy === 'function' ? hoy() : new Date().toISOString().slice(0, 10);
    const busq = (filtErr.q || '').trim().toLowerCase();
    const filtrados = (rep.hallazgos || []).filter((x) => {
      if (x.fecha && x.fecha < hoyStr) return false;
      if (typeof pareceMarcador === 'function' && (pareceMarcador(x.rut) || pareceMarcador(x.nombre))) return false;
      if (filtErr.tipo && x.tipo !== filtErr.tipo) return false;
      if (busq) {
        const texto = [x.rut, x.nombre, x.examinador, x.mensaje, x.fecha, x.hora, ETIQUETA[x.tipo] || x.tipo].join(' ').toLowerCase();
        if (!texto.includes(busq)) return false;
      }
      return true;
    });

    // Agrupa por persona (RUT, o nombre si no hay): sus errores quedan juntos, cada uno en su fila.
    // Los grupos conservan el orden del primer error de cada persona (severidad, fecha, hora).
    const grupos = new Map();
    for (const x of filtrados) {
      const clave = String(x.rut || '').replace(/[^0-9kK]/g, '').toUpperCase()
        || String(x.nombre || '').trim().toLowerCase()
        || `id-${x.agenda_id}`;
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(x);
    }
    const rows = [...grupos.values()].flat();

    if (!rows.length) {
      $('#e-body').innerHTML = licoVacioFila(9, 'celebra', 'Todo en orden', 'Nada que mostrar: no hay errores coincidentes en este filtro.');
      return;
    }

    $('#e-body').innerHTML = rows.slice(0, 600).map((x) => {
      let acciones = '';
      if (x.agenda_id) {
        const btnNoVino = x.fecha <= hoy() ? `
              <button class="btn chico peligro btn-err-novino" data-id="${x.agenda_id}" data-desc="${esc(x.nombre || x.rut || 'la persona')}" data-cita="${esc(fFecha(x.fecha))} ${esc(x.hora)}" title="No vino: registrar falta y pasar a lista de espera">🚫 No vino</button>` : '';
        if (x.tipo === 'DUPLICADO_DIA' || x.tipo === 'DUPLICADO_FUTURO') {
          acciones = `
            <div class="acciones-error-wrap">
              <button class="btn chico peligro btn-err-liberar" data-id="${x.agenda_id}" data-desc="${esc(x.nombre || x.rut || 'cita')} (${esc(fFecha(x.fecha))} ${esc(x.hora)})" title="Liberar este cupo duplicado de inmediato">🗑️ Liberar</button>
              <button class="btn chico sec btn-err-editar" data-id="${x.agenda_id}" title="Editar cita en esta misma planilla">✏️ Editar</button>
              <button class="btn chico sec btn-err-espera" data-id="${x.agenda_id}" data-desc="${esc(x.nombre || x.rut || 'cita')}" title="Pasar a lista de espera con prioridad">🔄 Espera</button>${btnNoVino}
            </div>`;
        } else if (x.tipo === 'SIN_RESULTADO') {
          acciones = `
            <div class="acciones-error-wrap">
              <button class="btn chico btn-err-res" style="background:var(--ok);color:#fff" data-id="${x.agenda_id}" data-res="APROBADO" title="Registrar aprobado">✓ Aprobó</button>
              <button class="btn chico btn-err-res" style="background:var(--error);color:#fff" data-id="${x.agenda_id}" data-res="REPROBADO" title="Registrar reprobado">✗ Reprobó</button>
              <button class="btn chico btn-err-res sec" data-id="${x.agenda_id}" data-res="NO ASISTIO" title="Registrar inasistencia">🚫 No asistió</button>
              <button class="btn chico sec btn-err-editar" data-id="${x.agenda_id}" title="Editar en planilla">✏️</button>${btnNoVino}
            </div>`;
        } else {
          acciones = `
            <div class="acciones-error-wrap">
              <button class="btn chico btn-err-editar" data-id="${x.agenda_id}" title="Editar en esta misma planilla">✏️ Editar</button>
              <button class="btn chico peligro btn-err-liberar" data-id="${x.agenda_id}" data-desc="${esc(x.nombre || x.rut || 'cita')} (${esc(fFecha(x.fecha))} ${esc(x.hora)})" title="Liberar este cupo">🗑️ Liberar</button>
              <button class="btn chico sec btn-err-espera" data-id="${x.agenda_id}" data-desc="${esc(x.nombre || x.rut || 'cita')}" title="Pasar a lista de espera">🔄 Espera</button>${btnNoVino}
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
          toast('Marcado como pendiente de reagendar', 'ok');
          cacheGet.delete('/errores');
          cargar();
        } catch (e) {
          toast(e.message, 'err');
        }
      };
    });

    // Wire up: No vino
    $('#e-body').querySelectorAll('.btn-err-novino').forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.id);
        if (!confirm(`¿Registrar que ${btn.dataset.desc} no vino el ${btn.dataset.cita}?

Se anota la falta, el cupo queda libre y pasa a la lista de espera con menor prioridad según sus faltas.`)) return;
        try {
          const r = await api(`/agenda/${id}/no-vino`, { method: 'POST' });
          toast(`Falta registrada · ${r.faltas} falta(s) en total · cupo liberado`, 'ok');
          cacheGet.delete('/errores');
          cacheGet.delete('/lista-espera');
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
            toast('Marcado como pendiente de reagendar', 'ok');
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

