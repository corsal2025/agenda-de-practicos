/* ================= Lista de espera automática: sugerir a quién dar un cupo libre =================
   Usa helpers globales de public/js/core.js en tiempo de ejecución: api, modal, cerrarModal, toast, esc, fFecha, nom, $.
   No escribe por su cuenta: asigna con las rutas existentes
   (POST /cola-reagendar/:id/asignar y POST /agenda/:id/reagendar). */
'use strict';

const SugerenciasCupo = (() => {
  const vigenciaTxt = (v) => {
    if (!v) return '<span class="muted">—</span>';
    if (v.dias <= 0) return '<span class="sev error">Vencido</span>';
    return `${v.dias} día(s)`;
  };
  const origenTxt = (c) => (c.origen === 'cola'
    ? `<span class="badge reag">${c.tipo === 'reprobo' ? 'Reprobó' : c.tipo === 'no_vino' ? 'No vino' : 'Cola'}</span><div class="muted" style="font-size:.78rem">Desde ${esc(fFecha(c.origen_fecha))} ${esc(c.origen_hora || '')}</div>`
    : `<span class="badge ${c.origen === 'cambio' ? 'reag' : 'intento-1'}">${c.origen === 'cambio' ? 'Solicita cambio' : 'Lista de espera'}</span><div class="muted" style="font-size:.78rem">Hoy: ${esc(fFecha(c.fecha))} ${esc(c.hora || '')}</div>`);

  async function asignar(cupo, c) {
    if (c.origen === 'cola') {
      return api(`/cola-reagendar/${c.id}/asignar`, { method: 'POST', body: { destino_id: cupo.id } });
    }
    return api(`/agenda/${c.id}/reagendar`, {
      method: 'POST', body: { destino_id: cupo.id, motivo: c.origen === 'cambio' ? 'POSTULANTE SOLICITA CAMBIO' : 'Adelantada desde lista de espera' },
    });
  }

  async function abrir(cupoId, alAsignar) {
    let datos;
    try { datos = await api(`/sugerencias-cupo/${cupoId}`); } catch (e) { toast(e.message, 'err'); return; }
    const { cupo, candidatos, avisos } = datos;
    const filas = candidatos.map((c, i) => `<tr>
        <td class="c">${i + 1}</td><td>${origenTxt(c)}</td>
        <td><b>${esc(nom(c.nombre))}</b><div class="muted" style="font-size:.78rem">${esc(c.rut || '')}</div></td>
        <td class="c">${esc(c.clase || '')}</td><td class="c">${vigenciaTxt(c.vigencia)}</td>
        <td class="c"><button class="btn chico" data-i="${i}">Asignar aquí</button></td></tr>`).join('');
    const cuerpo = `
      <p style="margin-top:0">Cupo libre: <b>${esc(fFecha(cupo.fecha))} ${esc(cupo.hora)}</b>${cupo.examinador ? ` · ${esc(cupo.examinador)}` : ''}</p>
      ${(avisos || []).map((a) => `<p class="aviso-sug">${esc(a)}</p>`).join('')}
      <p class="muted" style="font-size:.82rem">Prioridad: 1° trámite por vencer (15 días o menos), 2° origen (cola urgente por bloqueo, luego solicitudes de cambio junto a quienes no vinieron o reprobaron, luego lista de espera), 3° menos faltas primero y 4° desempates (cola más antigua, cita más cercana o más lejana según el origen). Ya se filtran la regla D/A5 y a quien tiene cita ese día.</p>
      <div class="tabla-scroll"><table><thead><tr><th class="c">#</th><th>Origen</th><th>Postulante</th><th class="c">Clase</th><th class="c">Trámite vence en</th><th></th></tr></thead>
      <tbody>${filas || '<tr><td colspan="6" class="muted">No hay candidatos compatibles para este cupo.</td></tr>'}</tbody></table></div>`;
    const ov = modal('Sugerencias para el cupo', cuerpo, '<button class="btn sec" id="sug-cerrar">Cerrar</button>');
    $('#sug-cerrar').onclick = cerrarModal;
    ov.querySelectorAll('button[data-i]').forEach((btn) => {
      btn.onclick = async () => {
        const c = candidatos[Number(btn.dataset.i)];
        const txt = c.origen === 'cola'
          ? `¿Asignar a ${nom(c.nombre)} en este cupo?`
          : `¿${c.origen === 'cambio' ? 'Cambiar' : 'Adelantar'} a ${nom(c.nombre)}? Su cita del ${fFecha(c.fecha)} ${c.hora} quedará libre.`;
        if (!confirm(txt)) return;
        btn.disabled = true;
        try {
          const r = await asignar(cupo, c);
          cerrarModal();
          toast(`Cupo asignado a ${nom(c.nombre)}`);
          (r && r.avisos || []).forEach((a) => toast(a, 'err'));
          if (alAsignar) alAsignar();
        } catch (e) { btn.disabled = false; toast(e.message, 'err'); }
      };
    });
  }

  return { abrir };
})();
window.SugerenciasCupo = SugerenciasCupo;

/* ================= Pestaña "Lista de espera": todos los que esperan un cupo =================
   Lee GET /lista-espera y GET /lista-espera/:origen/:id/cupos; asigna con las mismas rutas
   que el modal "Sugerir" (cola-reagendar/:id/asignar y agenda/:id/reagendar). */
const ListaEspera = (() => {
  let personas = [];
  const filtros = { origen: 'todos', clase: '', q: '' };

  async function badge() {
    try {
      const d = await api('/lista-espera');
      pintarBadge('badge-espera', d.personas.length);
      return d.personas;
    } catch (_) { pintarBadge('badge-espera', 0); return null; }
  }

  const nFaltas = (n) => `${n} falta${n === 1 ? '' : 's'}`;
  // Abre la ficha de historial de la persona (clave: RUT, o nombre si no tiene RUT).
  const fichaLink = (p, html) => {
    const clave = p.rut || nom(p.nombre);
    return clave ? `<a href="#" class="hp-link" data-ficha-persona="${esc(clave)}" title="Ver historial de la persona">${html}</a>` : html;
  };
  const TIP_NO_VINO ='No asistió a su cita: tiene menos prioridad que quienes tienen menos faltas';

  const prioridadBadge = (p, prio) => {
    if (p.tipo === 'no_vino') {
      return `<span class="badge-prio badge-prio-alta" style="background:#fef3c7;color:#92400e;border-color:#fcd34d" title="${TIP_NO_VINO}">#${prio} · 🚫 NO VINO</span>`;
    }
    if (p.tipo === 'reprobo') {
      return `<span class="badge-prio badge-prio-alta" title="Reprobó su examen: compite con las solicitudes de cambio">#${prio} · 📝 REPROBÓ</span>`;
    }
    if (p.origen === 'reagendar') {
      return `<span class="badge-prio badge-prio-urgente" title="Máxima prioridad: Sin cupo por bloqueo municipal">#${prio} · 🚨 URGENTE</span>`;
    }
    if (p.origen === 'cambio') {
      return `<span class="badge-prio badge-prio-alta" title="Alta prioridad: Postulante solicitó cambio/reagendamiento">#${prio} · 🔄 ALTA</span>`;
    }
    return `<span class="badge-prio badge-prio-normal" title="Prioridad normal: Postulante con cita que desea adelantar fecha">#${prio} · ⏳ NORMAL</span>`;
  };

  const origenBadge = (p) => {
    if (p.tipo === 'no_vino') {
      return `<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;font-weight:700" title="${TIP_NO_VINO}">🚫 No vino · ${nFaltas(p.faltas || 1)}</span><div class="muted" style="font-size:.74rem;margin-top:2px">Menor prioridad por faltas</div>`;
    }
    if (p.tipo === 'reprobo') {
      return `<span class="badge" style="background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;font-weight:700">📝 Reprobó · vuelve a rendir</span><div class="muted" style="font-size:.74rem;margin-top:2px">${p.faltas > 0 ? `Reprobó · ${nFaltas(p.faltas)}` : 'Reprobó'}</div>`;
    }
    if (p.origen === 'reagendar') {
      return `<span class="badge" style="background:#fee2e2;color:#b91c1c;border:1px solid #f87171;font-weight:700">🚨 Por Reagendar</span><div class="muted" style="font-size:.74rem;margin-top:2px">Bloqueo municipal</div>`;
    }
    if (p.origen === 'cambio') {
      return `<span class="badge" style="background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc;font-weight:700">🔄 Solicita Cambio</span><div class="muted" style="font-size:.74rem;margin-top:2px">Reagendamiento</div>`;
    }
    return `<span class="badge intento-1">⏳ Adelanto</span><div class="muted" style="font-size:.74rem;margin-top:2px">Tiene cita</div>`;
  };

  const tramiteHtml = (p) => {
    if (p.dias_restantes_tramite == null) return SIN_INICIO_HTML;
    const base = cuentaRegresivaHtml(p.dias_restantes_tramite, p.tramite_vence);
    if (p.dias_restantes_tramite <= 15) {
      return `${base}<div style="margin-top:2px"><span class="badge" style="background:#dc2626;color:#fff;font-size:.7rem;font-weight:700;padding:1px 5px">⚠️ Vence pronto</span></div>`;
    }
    return base;
  };

  const citaActual = (p) => (p.origen !== 'reagendar'
    ? `<b>${esc(fFecha(p.fecha))}</b> <span style="font-family:monospace;font-weight:700">${esc(p.hora || '')}</span>${p.examinador ? `<div class="muted" style="font-size:.78rem">${esc(p.examinador)}</div>` : ''}`
    : `<span class="badge" style="background:#fee2e2;color:#991b1b;font-weight:700">Sin cita</span>${p.motivo ? `<div class="muted" style="font-size:.76rem;margin-top:2px">${esc(p.motivo)}</div>` : ''}`);

  const clasesDe = (p) => String(p.clase || '').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);

  function filtrar() {
    const q = filtros.q.trim().toUpperCase();
    return personas.map((p, i) => ({ p, prio: i + 1 })).filter(({ p }) => {
      if (filtros.origen === 'reagendar' && p.origen !== 'reagendar' && p.origen !== 'cambio') return false;
      if (filtros.origen === 'bloqueo' && p.origen !== 'reagendar') return false;
      if (filtros.origen === 'cambio' && p.origen !== 'cambio') return false;
      if (filtros.origen === 'adelantar' && p.origen !== 'lista_espera') return false;
      if (filtros.origen === 'vencer' && (p.dias_restantes_tramite == null || p.dias_restantes_tramite > 30)) return false;
      if (filtros.clase && !clasesDe(p).includes(filtros.clase)) return false;
      if (q && !`${p.nombre || ''} ${p.rut || ''} ${p.correo || ''}`.toUpperCase().includes(q)) return false;
      return true;
    });
  }

  function pintar() {
    const filas = filtrar();
    $('#le-total').textContent = `${filas.length} de ${personas.length} en espera`;
    $('#le-body').innerHTML = filas.length ? filas.map(({ p, prio }) => `
      <tr data-id="${esc(p.id)}" data-origen="${esc(p.origen)}">
        <td class="c">${prioridadBadge(p, prio)}</td>
        <td>${fichaLink(p, `<b>${esc(nom(p.nombre) || '—')}</b>`)}${p.faltas > 0 ? ` ${fichaLink(p, `<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;font-size:.7rem;font-weight:700" title="${TIP_NO_VINO}">⚠ ${nFaltas(p.faltas)}</span>`)}` : ''}</td>
        <td class="num">${esc(p.rut || '—')}</td>
        <td class="c"><b>${esc(p.clase || '—')}</b></td>
        <td class="c">${origenBadge(p)}</td>
        <td class="c">${tramiteHtml(p)}</td>
        <td class="c">${citaActual(p)}</td>
        <td class="c"><button class="btn chico" style="font-weight:700" data-le="${esc(p.origen)}:${esc(p.id)}" ${p.cupos_compatibles ? '' : 'disabled'}>${p.cupos_compatibles ? '🔍 Asignar cupo' : 'Sin cupos'}</button></td>
      </tr>`).join('') : '<tr><td colspan="8" class="muted c" style="padding:1.5rem">No hay personas en espera con los filtros seleccionados.</td></tr>';

    const destacado = AlmacenSeguro.sesion.leer('le_destacado');
    if (destacado) {
      AlmacenSeguro.sesion.quitar('le_destacado');
      const fila = $('#le-body').querySelector(`[data-id="${destacado}"]`);
      if (fila) {
        fila.classList.add('fila-destacada-reagendar');
        fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  // correo: solo se envia cuando la persona no tenia (el servidor lo exige para dar la hora)
  function asignar(p, cupo, correo) {
    if (p.origen === 'reagendar') return api(`/cola-reagendar/${p.id}/asignar`, { method: 'POST', body: { destino_id: cupo.id, correo } });
    const motivo = p.origen === 'cambio' ? 'POSTULANTE SOLICITA CAMBIO' : 'Adelantada desde lista de espera';
    return api(`/agenda/${p.id}/reagendar`, { method: 'POST', body: { destino_id: cupo.id, motivo, correo } });
  }

  async function buscarCupo(p, recargar) {
    let cupos;
    try {
      ({ cupos } = await api(`/lista-espera/${encodeURIComponent(p.origen)}/${encodeURIComponent(p.id)}/cupos`));
    } catch (e) { toast(e.message, 'err'); return; }
    const filas = cupos.map((c, i) => `<tr><td class="num c">${esc(fFecha(c.fecha))}</td><td class="num c">${esc(c.hora)}</td>
      <td>${esc(c.examinador || '—')}</td><td class="c"><button class="btn chico" data-i="${i}">Asignar</button></td></tr>`).join('');
    const cuerpo = `<p style="margin:0 0 .3rem;font-size:14px"><b>${esc(nom(p.nombre))}</b> · ${esc(p.rut || '')} · Clase ${esc(p.clase || '—')}</p>
      <p class="muted" style="font-size:.82rem;margin:0 0 .5rem">Cupos libres de los próximos 30 días compatibles (regla D/A5 y sin repetir día)${p.origen === 'lista_espera' ? ', anteriores a su cita actual' : ''}.</p>
      ${p.correo ? '' : `<div class="campo" style="margin-bottom:.5rem"><label for="le-correo" style="font-size:12px;font-weight:700">Correo del postulante (obligatorio para dar la hora)</label>
        <input id="le-correo" type="email" placeholder="nombre@correo.cl" autocomplete="off" style="padding:.4rem .6rem"></div>`}
      <div class="tabla-scroll modal-cupos-scroll"><table class="tabla-modal-cupos"><thead><tr><th class="c col-fecha">Fecha</th><th class="c col-hora">Hora</th><th class="col-exam">Examinador</th><th class="c col-accion">Acción</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="4" class="muted c" style="padding:1rem">No hay cupos compatibles.</td></tr>'}</tbody></table></div>`;
    const ov = modal('Buscar cupo', cuerpo, '<button class="btn sec" id="le-cerrar">Cerrar</button>', 'modal-asignar-cupo');
    $('#le-cerrar').onclick = cerrarModal;
    ov.querySelectorAll('button[data-i]').forEach((btn) => {
      btn.onclick = async () => {
        const c = cupos[Number(btn.dataset.i)];
        const campoCorreo = ov.querySelector('#le-correo');
        const correo = campoCorreo ? campoCorreo.value.trim() : null;
        if (campoCorreo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
          toast('Ingresa un correo válido para dar la hora', 'err');
          campoCorreo.focus();
          return;
        }
        const txt = p.origen === 'reagendar'
          ? `¿Asignar a ${nom(p.nombre)} el ${fFecha(c.fecha)} ${c.hora}?`
          : `¿${p.origen === 'cambio' ? 'Cambiar' : 'Adelantar'} a ${nom(p.nombre)} al ${fFecha(c.fecha)} ${c.hora}? Su cita del ${fFecha(p.fecha)} ${p.hora} quedará libre.`;
        if (!confirm(txt)) return;
        btn.disabled = true;
        try {
          const r = await asignar(p, c, correo);
          cerrarModal();
          toast(`Cupo asignado a ${nom(p.nombre)}`);
          ((r && r.avisos) || []).forEach((a) => toast(a, 'err'));
          if (typeof actualizarBadgeEspera === 'function') actualizarBadgeEspera();
          recargar();
        } catch (e) { btn.disabled = false; toast(e.message, 'err'); }
      };
    });
  }

  async function render() {
    view.innerHTML = `
      <div class="panel">
        <div class="fila" style="align-items:center;flex-wrap:wrap;gap:8px">
          <div style="flex:1">
            <h2 style="margin:0">Lista de espera unificada</h2>
            <p class="muted" style="margin:4px 0 0;font-size:13px">Ordenada por prioridad: <b>1° Trámite por vencer</b> (15 días o menos), <b>2° Origen</b> (urgentes por bloqueo municipal; solicitudes de cambio junto a quienes no vinieron o reprobaron; adelanto de fecha), <b>3° Menos faltas primero</b> y <b>4° Desempates</b> por fecha más cercana.</p>
          </div>
          <span class="pastilla" id="le-total" style="font-weight:700">Cargando...</span>
        </div>
        <div class="fila" id="le-filtros" style="flex-wrap:wrap;gap:8px;margin-top:.85rem">
          <select id="le-origen" style="font-weight:600">
            <option value="todos">Todas las prioridades</option>
            <option value="reagendar">🔄 Todo Reagendamiento (Urgentes + Solicitudes)</option>
            <option value="bloqueo">🚨 Solo Bloqueo Municipal (Urgente sin cupo)</option>
            <option value="cambio">🔄 Solo Solicitudes de Cambio (Alta)</option>
            <option value="adelantar">⏳ Solo Adelanto de Cita (Normal)</option>
            <option value="vencer">⚠️ Trámites por vencer (≤30 días)</option>
          </select>
          <select id="le-clase"><option value="">Todas las clases</option></select>
          <input id="le-q" type="search" placeholder="Buscar nombre, RUT o correo" style="flex:1;min-width:180px">
        </div>
        <div class="tabla-scroll" id="le-tabla" style="margin-top:.75rem">
          <table class="thead-fijo">
            <thead>
              <tr>
                <th class="c" style="width:145px">Prioridad</th>
                <th>Nombre Postulante</th>
                <th class="c" style="width:125px">RUT</th>
                <th class="c" style="width:65px">Clase</th>
                <th class="c" style="width:145px">Estado / Origen</th>
                <th class="c" style="width:130px">Trámite</th>
                <th class="c" style="width:150px">Cita actual</th>
                <th class="c" style="width:130px">Acción</th>
              </tr>
            </thead>
            <tbody id="le-body"><tr><td colspan="8" class="c muted" style="padding:1.5rem">Cargando lista de espera...</td></tr></tbody>
          </table>
        </div>
      </div>`;

    $('#le-origen').value = filtros.origen;
    $('#le-q').value = filtros.q;
    $('#le-origen').onchange = (e) => { filtros.origen = e.target.value; pintar(); };
    $('#le-clase').onchange = (e) => { filtros.clase = e.target.value; pintar(); };
    $('#le-q').oninput = (e) => { filtros.q = e.target.value; pintar(); };

    async function cargar() {
      const lista = await badge();
      if (!$('#le-body')) return;
      if (!lista) {
        $('#le-body').innerHTML = '<tr><td colspan="8" class="muted">No se pudo cargar la lista de espera.</td></tr>';
        $('#le-total').textContent = 'Error';
        return;
      }
      personas = lista;
      const clases = [...new Set(personas.flatMap(clasesDe))].sort();
      if (filtros.clase && !clases.includes(filtros.clase)) filtros.clase = '';
      $('#le-clase').innerHTML = '<option value="">Todas las clases</option>'
        + clases.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      $('#le-clase').value = filtros.clase;
      pintar();
    }

    $('#le-body').onclick = (e) => {
      const ficha = e.target.closest('a[data-ficha-persona]');
      if (ficha) { e.preventDefault(); abrirFichaPersona(ficha.dataset.fichaPersona); return; }
      const btn = e.target.closest('button[data-le]');
      if (!btn) return;
      const [origen, id] = btn.dataset.le.split(':');
      const p = personas.find((x) => x.origen === origen && String(x.id) === id);
      if (p) buscarCupo(p, cargar);
    };

    await cargar();
  }

  return { render, badge };
})();
window.ListaEspera = ListaEspera;
function renderListaEspera() { return ListaEspera.render(); }
