/* ================= Lista de espera automática: sugerir a quién dar un cupo libre =================
   Usa helpers globales de app.js en tiempo de ejecución: api, modal, cerrarModal, toast, esc, fFecha, nom, $.
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
    ? `<span class="badge reag">Cola</span><div class="muted" style="font-size:.78rem">Desde ${esc(fFecha(c.origen_fecha))} ${esc(c.origen_hora || '')}</div>`
    : `<span class="badge intento-1">Lista de espera</span><div class="muted" style="font-size:.78rem">Hoy: ${esc(fFecha(c.fecha))} ${esc(c.hora || '')}</div>`);

  async function asignar(cupo, c) {
    if (c.origen === 'cola') {
      return api(`/cola-reagendar/${c.id}/asignar`, { method: 'POST', body: { destino_id: cupo.id } });
    }
    return api(`/agenda/${c.id}/reagendar`, {
      method: 'POST', body: { destino_id: cupo.id, motivo: 'Adelantada desde lista de espera' },
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
      <p class="muted" style="font-size:.82rem">Prioridad: cola de reagendar (más antigua primero), luego lista de espera (cita más lejana primero); desempata el trámite más cerca de vencer. Ya se filtran la regla D/A5 y a quien tiene cita ese día.</p>
      <div class="tabla-scroll"><table><thead><tr><th class="c">#</th><th>Origen</th><th>Postulante</th><th class="c">Clase</th><th class="c">Trámite vence en</th><th></th></tr></thead>
      <tbody>${filas || '<tr><td colspan="6" class="muted">No hay candidatos compatibles para este cupo.</td></tr>'}</tbody></table></div>`;
    const ov = modal('Sugerencias para el cupo', cuerpo, '<button class="btn sec" id="sug-cerrar">Cerrar</button>');
    $('#sug-cerrar').onclick = cerrarModal;
    ov.querySelectorAll('button[data-i]').forEach((btn) => {
      btn.onclick = async () => {
        const c = candidatos[Number(btn.dataset.i)];
        const txt = c.origen === 'cola'
          ? `¿Asignar a ${nom(c.nombre)} en este cupo?`
          : `¿Adelantar a ${nom(c.nombre)}? Su cita del ${fFecha(c.fecha)} ${c.hora} quedará libre.`;
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

  // Botón "Sugerir" en las tarjetas libres de la Agenda.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-sugerir');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    abrir(Number(btn.dataset.id), () => { if ($('#a-grid') && typeof renderAgenda === 'function') renderAgenda(); });
  }, true);

  return { abrir };
})();
window.SugerenciasCupo = SugerenciasCupo;
