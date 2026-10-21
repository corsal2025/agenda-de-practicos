const MOTIVOS_BLOQUEO_DEF = ['PERMISO ADMINISTRATIVO', 'LICENCIA MEDICA', 'FERIADO LEGAL', 'COMPENSATORIO', 'CAPACITACION', 'TERRENO'];
const ETQ_MOTIVO = {
  'LICENCIA MEDICA': 'Licencia médica',
  'FERIADO LEGAL': 'Feriado legal',
  'CAPACITACION': 'Capacitación',
  'COMPENSATORIO': 'Día compensatorio',
  'TERRENO': 'Examen en terreno',
  'TRASLADO': 'Traslado',
  'BLOQUEADO': 'Bloqueo administrativo'
};
function dialogoBloquearDia() {
  const motivos = META.motivos_bloqueo || MOTIVOS_BLOQUEO_DEF;
  const f = estadoAgenda.fecha || hoy();
  const horasDisponibles = (META && META.horas && META.horas.length) ? META.horas : [
    '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30'
  ];
  let modoActual = 'dias'; // 'dias' | 'horas'
  let horasSeleccionadas = new Set(['08:30', '09:00']);

  modal('🔒 Bloquear días u horas', `
    <div class="tabs-modo-bloq ancho">
      <button type="button" class="btn-tab-bloq activo" id="bd-tab-dias">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Día(s) completo(s)
      </button>
      <button type="button" class="btn-tab-bloq" id="bd-tab-horas">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Por horas / bloques específicos
      </button>
    </div>

    <div class="campo ancho"><label>Examinador</label><select id="bd-exam">
      <option value="" ${!estadoAgenda.examinador_id ? 'selected' : ''}>Todos los examinadores</option>
      ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(e.id) === String(estadoAgenda.examinador_id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
    </select></div>

    <!-- PANEL MODO DÍAS COMPLETOS -->
    <div id="bd-panel-dias" class="ancho" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px">
      <div class="campo" style="flex:1"><label>Desde fecha</label><input type="date" id="bd-desde" value="${f}"></div>
      <div class="campo" style="flex:1"><label>Hasta fecha</label><input type="date" id="bd-hasta" value="${f}"></div>
      <div class="ancho" style="margin-top:-4px"><button type="button" class="btn chico sec" id="bd-semana"
        title="Lleva Desde al lunes y Hasta al viernes de sus semanas">Ajustar a semanas completas (lun–vie)</button></div>
    </div>

    <!-- PANEL MODO HORAS / BLOQUES -->
    <div id="bd-panel-horas" class="ancho" style="display:none;flex-direction:column;gap:10px;margin-bottom:6px">
      <div style="display:flex;gap:10px;align-items:flex-end">
        <div class="campo" style="flex:1;margin:0"><label>Fecha</label><input type="date" id="bd-h-fecha" value="${f}"></div>
        <div class="campo" id="bd-h-c-hasta" style="flex:1;margin:0" hidden><label>Hasta fecha</label><input type="date" id="bd-h-hasta" value="${f}"></div>
        <button type="button" class="btn chico sec" id="bd-h-toggle-rango-dias" style="margin-bottom:2px" title="Permite aplicar el bloqueo horario a varios días consecutivos">Aplicar a varios días...</button>
      </div>

      <div style="background:#f8fafc;border:1px solid var(--linea,#e2e8f0);border-radius:8px;padding:12px;margin-top:2px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <label style="font-size:11px;font-weight:700;color:var(--tinta-2);text-transform:uppercase;margin:0">
            Selecciona los bloques a bloquear:
          </label>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn btn-xs sec" id="bd-h-quick-manana" style="font-size:11px;padding:2px 8px">Mañana (08:30-11:00)</button>
            <button type="button" class="btn btn-xs sec" id="bd-h-quick-tarde" style="font-size:11px;padding:2px 8px">Mediodía (11:30-13:30)</button>
            <button type="button" class="btn btn-xs sec" id="bd-h-quick-limpiar" style="font-size:11px;padding:2px 8px">Desmarcar</button>
          </div>
        </div>

        <!-- Selector directo de rango de horas -->
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
          <span style="font-size:11px;color:var(--tinta-3);font-weight:600">Rango rápido:</span>
          <select id="bd-h-sel-desde" style="padding:3px 8px;font-size:12px;border-radius:4px;border:1px solid #cbd5e1">
            ${horasDisponibles.map((h) => `<option value="${h}" ${h === '08:30' ? 'selected' : ''}>${h} hrs</option>`).join('')}
          </select>
          <span style="font-size:11px;color:var(--tinta-3)">a</span>
          <select id="bd-h-sel-hasta" style="padding:3px 8px;font-size:12px;border-radius:4px;border:1px solid #cbd5e1">
            ${horasDisponibles.map((h) => `<option value="${h}" ${h === '10:00' ? 'selected' : ''}>${h} hrs</option>`).join('')}
          </select>
          <button type="button" class="btn chico sec" id="bd-h-btn-marcar-rango" style="padding:3px 10px;font-size:12px">Marcar</button>
        </div>

        <!-- Chips interactivos para cada hora -->
        <div id="bd-horas-chips-cont" style="display:flex;flex-wrap:wrap;gap:6px">
          ${horasDisponibles.map((h) => {
            const esPesada = h === META.hora_d_a5;
            return `<button type="button" class="chip-hora ${horasSeleccionadas.has(h) ? 'activo' : ''}" data-hora="${h}">
              ${h}
              ${esPesada ? '<span style="font-size:9px;background:rgba(0,0,0,0.08);padding:1px 4px;border-radius:3px;margin-left:2px">D/A5</span>' : ''}
            </button>`;
          }).join('')}
        </div>

        <div id="bd-horas-seleccionadas-txt" style="font-size:12px;color:var(--azul,#0284c7);font-weight:700;margin-top:8px">
          2 bloques seleccionados: 08:30, 09:00
        </div>
      </div>
    </div>

    <!-- MOTIVO Y OPCIONES COMUNES -->
    <div class="campo ancho"><label>Motivo del bloqueo</label><select id="bd-motivo">
      ${motivos.map((m) => `<option value="${esc(m)}">${esc(ETQ_MOTIVO[m] || m.charAt(0) + m.slice(1).toLowerCase())}</option>`).join('')}
      <option value="__otro">Otro...</option></select></div>
    <div class="campo ancho" id="bd-otro-c" hidden><label>Otro motivo</label><input id="bd-otro" placeholder="Escribe el motivo"></div>
    <div class="campo ancho" id="bd-ocupados-c"><label><input type="checkbox" id="bd-ocupados" checked> Incluir bloques que ya tienen cita (se enviarán a Reagendar)</label></div>
    <div class="ancho aviso" id="bd-resumen" hidden></div>
  `, `
    <button class="btn sec" id="bd-cancel">Cancelar</button>
    <button class="btn btn-bloq-accion" id="bd-ok">Bloquear días u horas</button>
  `);

  // Switch de modo
  $('#bd-tab-dias').onclick = () => {
    modoActual = 'dias';
    $('#bd-tab-dias').classList.add('activo');
    $('#bd-tab-horas').classList.remove('activo');
    $('#bd-panel-dias').style.display = 'flex';
    $('#bd-panel-horas').style.display = 'none';
    previa();
  };

  $('#bd-tab-horas').onclick = () => {
    modoActual = 'horas';
    $('#bd-tab-dias').classList.remove('activo');
    $('#bd-tab-horas').classList.add('activo');
    $('#bd-panel-dias').style.display = 'none';
    $('#bd-panel-horas').style.display = 'flex';
    actualizarVistaChips();
    previa();
  };

  // Toggle multidia en modo horas
  $('#bd-h-toggle-rango-dias').onclick = () => {
    const cHasta = $('#bd-h-c-hasta');
    cHasta.hidden = !cHasta.hidden;
    $('#bd-h-toggle-rango-dias').textContent = cHasta.hidden ? 'Aplicar a varios días...' : 'Solo este día';
    $('#bd-h-toggle-rango-dias').classList.toggle('activo', !cHasta.hidden);
    if (!cHasta.hidden && !$('#bd-h-hasta').value) $('#bd-h-hasta').value = $('#bd-h-fecha').value;
    previa();
  };

  const actualizarVistaChips = () => {
    const cont = $('#bd-horas-chips-cont');
    if (!cont) return;
    cont.querySelectorAll('.chip-hora').forEach((btn) => {
      btn.classList.toggle('activo', horasSeleccionadas.has(btn.dataset.hora));
    });
    const info = $('#bd-horas-seleccionadas-txt');
    if (info) {
      const arr = Array.from(horasSeleccionadas).sort();
      if (!arr.length) {
        info.textContent = 'Ningún bloque seleccionado (haz clic en los horarios arriba)';
        info.style.color = 'var(--alerta, #dc2626)';
      } else {
        info.textContent = `${arr.length} ${arr.length === 1 ? 'bloque seleccionado' : 'bloques seleccionados'}: ${arr.join(', ')}`;
        info.style.color = 'var(--azul, #0284c7)';
      }
    }
  };

  const contChips = $('#bd-horas-chips-cont');
  if (contChips) {
    contChips.querySelectorAll('.chip-hora').forEach((btn) => {
      btn.onclick = () => {
        const h = btn.dataset.hora;
        if (horasSeleccionadas.has(h)) {
          horasSeleccionadas.delete(h);
        } else {
          horasSeleccionadas.add(h);
        }
        actualizarVistaChips();
        previa();
      };
    });
  }

  $('#bd-h-quick-manana').onclick = () => {
    horasSeleccionadas = new Set(['08:30', '09:00', '09:30', '10:00', '10:30', '11:00']);
    actualizarVistaChips();
    previa();
  };
  $('#bd-h-quick-tarde').onclick = () => {
    horasSeleccionadas = new Set(['11:30', '12:00', '12:30', '13:00', '13:30']);
    actualizarVistaChips();
    previa();
  };
  $('#bd-h-quick-limpiar').onclick = () => {
    horasSeleccionadas.clear();
    actualizarVistaChips();
    previa();
  };
  $('#bd-h-btn-marcar-rango').onclick = () => {
    const hd = $('#bd-h-sel-desde').value;
    const hh = $('#bd-h-sel-hasta').value;
    if (hh < hd) return toast('La hora hasta no puede ser anterior a la hora desde', 'err');
    horasDisponibles.forEach((h) => {
      if (h >= hd && h <= hh) horasSeleccionadas.add(h);
    });
    actualizarVistaChips();
    previa();
  };

  $('#bd-semana').onclick = () => {
    const mover = (iso, alDia) => {
      const d = new Date(`${iso}T12:00:00Z`);
      const dow = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - dow + alDia);
      return d.toISOString().slice(0, 10);
    };
    const desde = $('#bd-desde').value;
    if (!desde) return;
    $('#bd-desde').value = mover(desde, 0);
    $('#bd-hasta').value = mover($('#bd-hasta').value || desde, 4);
    previa();
  };

  const motivo = () => ($('#bd-motivo').value === '__otro' ? $('#bd-otro').value.trim() : $('#bd-motivo').value);
  
  const datos = () => {
    if (modoActual === 'dias') {
      return {
        desde: $('#bd-desde').value,
        hasta: $('#bd-hasta').value || $('#bd-desde').value,
        examinador_id: $('#bd-exam').value || null,
        motivo: motivo(),
        incluir_ocupados: $('#bd-ocupados').checked,
      };
    } else {
      const dDesde = $('#bd-h-fecha').value;
      const dHasta = ($('#bd-h-c-hasta') && !$('#bd-h-c-hasta').hidden && $('#bd-h-hasta').value)
        ? $('#bd-h-hasta').value
        : dDesde;
      return {
        desde: dDesde,
        hasta: dHasta,
        examinador_id: $('#bd-exam').value || null,
        motivo: motivo(),
        incluir_ocupados: $('#bd-ocupados').checked,
        horas: Array.from(horasSeleccionadas).sort(),
      };
    }
  };

  let tmr;
  let pedido = 0;
  const previa = () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const d = datos();
      const res = $('#bd-resumen');
      if (!res) return;
      if (!d.desde || d.hasta < d.desde) {
        res.hidden = false;
        res.textContent = 'Revisa las fechas: "Hasta" no puede ser anterior a "Desde".';
        $('#bd-ok').disabled = true;
        return;
      }
      if (modoActual === 'horas' && (!d.horas || !d.horas.length)) {
        res.hidden = false;
        res.textContent = 'Selecciona al menos un bloque u horario para bloquear.';
        $('#bd-ok').disabled = true;
        return;
      }

      const n = ++pedido;
      const dias = Math.round((Date.parse(d.hasta) - Date.parse(d.desde)) / 864e5) + 1;
      let txtEncabezado = '';
      if (modoActual === 'dias') {
        txtEncabezado = `${fFecha(d.desde)} al ${fFecha(d.hasta)} (${dias} ${dias === 1 ? 'día' : 'días'})`;
      } else {
        const hTxt = d.horas.join(', ');
        txtEncabezado = dias > 1
          ? `${fFecha(d.desde)} al ${fFecha(d.hasta)} (${dias} días) · ${d.horas.length} ${d.horas.length === 1 ? 'bloque' : 'bloques'} (${hTxt})`
          : `${fFecha(d.desde)} · ${d.horas.length} ${d.horas.length === 1 ? 'bloque' : 'bloques'} (${hTxt})`;
      }

      try {
        const r = await api('/bloquear-dia', { method: 'POST', body: { ...d, simular: true } });
        if (n !== pedido || !$('#bd-resumen')) return;
        let txt = `${txtEncabezado} · se bloquearán ${r.bloqueables} ${r.bloqueables === 1 ? 'bloque' : 'bloques'}.`;
        if (r.con_cita) {
          txt += d.incluir_ocupados
            ? ` ${r.con_cita} ${r.con_cita === 1 ? 'cita pasa' : 'citas pasan'} a la lista de Reagendamiento.`
            : ` Hay ${r.con_cita} ${r.con_cita === 1 ? 'cita' : 'citas'} en el rango que NO se tocan: reagéndalas o marca "Incluir bloques que ya tienen cita".`;
        }
        res.hidden = false;
        res.textContent = txt;
        $('#bd-ok').disabled = false;
        $('#bd-ok').textContent = r.bloqueables ? `Bloquear ${r.bloqueables} ${r.bloqueables === 1 ? 'bloque' : 'bloques'}` : 'Bloquear días u horas';
      } catch (e) {
        res.hidden = false;
        res.textContent = e.message;
        $('#bd-ok').disabled = false;
        $('#bd-ok').textContent = 'Bloquear días u horas';
      }
    }, 200);
  };

  $('#bd-motivo').onchange = () => {
    $('#bd-otro-c').hidden = $('#bd-motivo').value !== '__otro';
    previa();
  };
  $('#bd-otro').oninput = previa;
  $('#bd-desde').onchange = () => {
    if (!$('#bd-hasta').value || $('#bd-hasta').value < $('#bd-desde').value) $('#bd-hasta').value = $('#bd-desde').value;
    previa();
  };
  $('#bd-h-fecha').onchange = () => {
    if (!$('#bd-h-hasta').value || $('#bd-h-hasta').value < $('#bd-h-fecha').value) $('#bd-h-hasta').value = $('#bd-h-fecha').value;
    previa();
  };
  ['#bd-hasta', '#bd-h-hasta', '#bd-exam', '#bd-ocupados'].forEach((s) => {
    const el = $(s);
    if (el) el.onchange = previa;
  });
  previa();

  $('#bd-cancel').onclick = cerrarModal;
  $('#bd-ok').onclick = async () => {
    const d = datos();
    if ($('#bd-motivo').value === '__otro' && !d.motivo) return toast('Escribe el motivo del bloqueo', 'err');
    if (modoActual === 'horas' && (!d.horas || !d.horas.length)) {
      return toast('Debes seleccionar al menos un bloque u horario', 'err');
    }

    if (d.incluir_ocupados) {
      try {
        const sim = await api('/bloquear-dia', { method: 'POST', body: { ...d, simular: true } });
        if (sim.con_cita > 0) {
          const txt = sim.con_cita === 1 ? '1 postulante' : `${sim.con_cita} postulantes`;
          if (!confirm(`Se bloqueará el horario seleccionado.\n${txt} con cita agendada pasarán a la sección "Reagendar" para reasignarles un nuevo cupo.\n\n¿Deseas proceder con el bloqueo?`)) return;
        }
      } catch (err) {
        return toast(err.message, 'err');
      }
    }

    $('#bd-ok').disabled = true;
    try {
      const r = await api('/bloquear-dia', { method: 'POST', body: d });
      cerrarModal();
      if (!r.bloqueados) return toast('No había bloques disponibles en ese horario para bloquear', 'err');
      let msg = `${r.bloqueados} ${r.bloqueados === 1 ? 'bloque bloqueado' : 'bloques bloqueados'}`;
      if (r.a_reagendar) msg += ` · ${r.a_reagendar} citas movidas a Lista de Espera`;
      toast(msg, 'ok');
      actualizarBadgeReagendar();
      estadoAgenda.fecha = d.desde;
      await renderAgenda();
      if (r.a_reagendar && confirm(`Se bloquearon los bloques y ${r.a_reagendar} postulante(s) fueron enviados a la Lista de Espera con máxima prioridad por bloqueo.\n\n¿Deseas ir a la Lista de Espera ahora para asignarles cupo?`)) {
        irA('espera');
      }
    } catch (e) {
      $('#bd-ok').disabled = false;
      toast(e.message, 'err');
    }
  };
}

async function dialogoDesbloquearDia() {
  const f = estadoAgenda.fecha || hoy();
  const examinadores = META.examinadores || [];
  const motivos = META.catalogos.bloqueo_motivo || [];
  const horasDisponibles = (META && META.horas && META.horas.length) ? META.horas : [
    '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30'
  ];
  let modoActual = 'dias'; // 'dias' | 'horas'
  let horasSeleccionadas = new Set(['08:30', '09:00']);

  modal('🔓 Desbloquear días u horas', `
    <div class="tabs-modo-bloq ancho">
      <button type="button" class="btn-tab-bloq activo" id="desb-tab-dias">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Día(s) completo(s)
      </button>
      <button type="button" class="btn-tab-bloq" id="desb-tab-horas">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Por horas / bloques específicos
      </button>
    </div>

    <div class="campo ancho"><label>Examinador</label><select id="desb-exam">
      <option value="" ${!estadoAgenda.examinador_id ? 'selected' : ''}>Todos los examinadores</option>
      ${examinadores.filter((e) => e.activo !== false).map((e) => `<option value="${e.id}" ${String(e.id) === String(estadoAgenda.examinador_id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
    </select></div>

    <!-- PANEL MODO DÍAS COMPLETOS -->
    <div id="desb-panel-dias" class="ancho" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px">
      <div class="campo" style="flex:1"><label>Desde fecha</label><input type="date" id="desb-desde" value="${f}"></div>
      <div class="campo" style="flex:1"><label>Hasta fecha</label><input type="date" id="desb-hasta" value="${f}"></div>
      <div class="ancho" style="margin-top:-4px"><button type="button" class="btn chico sec" id="desb-semana"
        title="Lleva Desde al lunes y Hasta al viernes de sus semanas">Ajustar a semanas completas (lun–vie)</button></div>
    </div>

    <!-- PANEL MODO HORAS / BLOQUES -->
    <div id="desb-panel-horas" class="ancho" style="display:none;flex-direction:column;gap:10px;margin-bottom:6px">
      <div style="display:flex;gap:10px;align-items:flex-end">
        <div class="campo" style="flex:1;margin:0"><label>Fecha</label><input type="date" id="desb-h-fecha" value="${f}"></div>
        <div class="campo" id="desb-h-c-hasta" style="flex:1;margin:0" hidden><label>Hasta fecha</label><input type="date" id="desb-h-hasta" value="${f}"></div>
        <button type="button" class="btn chico sec" id="desb-h-toggle-rango-dias" style="margin-bottom:2px" title="Permite aplicar el desbloqueo horario a varios días consecutivos">Aplicar a varios días...</button>
      </div>

      <div style="background:#f8fafc;border:1px solid var(--linea,#e2e8f0);border-radius:8px;padding:12px;margin-top:2px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <label style="font-size:11px;font-weight:700;color:var(--tinta-2);text-transform:uppercase;margin:0">
            Selecciona los bloques a desbloquear:
          </label>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn btn-xs sec" id="desb-h-quick-manana" style="font-size:11px;padding:2px 8px">Mañana (08:30-11:00)</button>
            <button type="button" class="btn btn-xs sec" id="desb-h-quick-tarde" style="font-size:11px;padding:2px 8px">Mediodía (11:30-13:30)</button>
            <button type="button" class="btn btn-xs sec" id="desb-h-quick-todos" style="font-size:11px;padding:2px 8px">Todos</button>
            <button type="button" class="btn btn-xs sec" id="desb-h-quick-limpiar" style="font-size:11px;padding:2px 8px">Desmarcar</button>
          </div>
        </div>

        <!-- Selector directo de rango de horas -->
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
          <span style="font-size:11px;color:var(--tinta-3);font-weight:600">Rango rápido:</span>
          <select id="desb-h-sel-desde" style="padding:3px 8px;font-size:12px;border-radius:4px;border:1px solid #cbd5e1">
            ${horasDisponibles.map((h) => `<option value="${h}" ${h === '08:30' ? 'selected' : ''}>${h} hrs</option>`).join('')}
          </select>
          <span style="font-size:11px;color:var(--tinta-3)">a</span>
          <select id="desb-h-sel-hasta" style="padding:3px 8px;font-size:12px;border-radius:4px;border:1px solid #cbd5e1">
            ${horasDisponibles.map((h) => `<option value="${h}" ${h === '10:00' ? 'selected' : ''}>${h} hrs</option>`).join('')}
          </select>
          <button type="button" class="btn chico sec" id="desb-h-btn-marcar-rango" style="padding:3px 10px;font-size:12px">Marcar</button>
        </div>

        <!-- Chips interactivos para cada hora -->
        <div id="desb-horas-chips-cont" style="display:flex;flex-wrap:wrap;gap:6px">
          ${horasDisponibles.map((h) => {
            const esPesada = h === META.hora_d_a5;
            return `<button type="button" class="chip-hora ${horasSeleccionadas.has(h) ? 'activo' : ''}" data-hora="${h}">
              ${h}
              ${esPesada ? '<span style="font-size:9px;background:rgba(0,0,0,0.08);padding:1px 4px;border-radius:3px;margin-left:2px">D/A5</span>' : ''}
            </button>`;
          }).join('')}
        </div>

        <div id="desb-horas-seleccionadas-txt" style="font-size:12px;color:var(--azul,#0284c7);font-weight:700;margin-top:8px">
          2 bloques seleccionados: 08:30, 09:00
        </div>
      </div>
    </div>

    <!-- MOTIVO ESPECÍFICO (OPCIONAL) -->
    <div class="campo ancho"><label>Motivo específico a desbloquear (opcional)</label><select id="desb-motivo">
      <option value="">Todos los motivos (desbloquear cualquier causa)</option>
      ${motivos.map((m) => `<option value="${esc(m)}">${esc(ETQ_MOTIVO[m] || m.charAt(0) + m.slice(1).toLowerCase())}</option>`).join('')}
    </select></div>
    <div class="ancho aviso" id="desb-resumen" hidden></div>
  `, `
    <button class="btn sec" id="desb-cancel">Cancelar</button>
    <button class="btn btn-desbloq-accion" id="desb-ok">Desbloquear días u horas</button>
  `);

  // Switch de modo
  $('#desb-tab-dias').onclick = () => {
    modoActual = 'dias';
    $('#desb-tab-dias').classList.add('activo');
    $('#desb-tab-horas').classList.remove('activo');
    $('#desb-panel-dias').style.display = 'flex';
    $('#desb-panel-horas').style.display = 'none';
    previa();
  };

  $('#desb-tab-horas').onclick = () => {
    modoActual = 'horas';
    $('#desb-tab-dias').classList.remove('activo');
    $('#desb-tab-horas').classList.add('activo');
    $('#desb-panel-dias').style.display = 'none';
    $('#desb-panel-horas').style.display = 'flex';
    actualizarVistaChips();
    previa();
  };

  // Toggle multidia en modo horas
  $('#desb-h-toggle-rango-dias').onclick = () => {
    const cHasta = $('#desb-h-c-hasta');
    cHasta.hidden = !cHasta.hidden;
    $('#desb-h-toggle-rango-dias').textContent = cHasta.hidden ? 'Aplicar a varios días...' : 'Solo este día';
    $('#desb-h-toggle-rango-dias').classList.toggle('activo', !cHasta.hidden);
    if (!cHasta.hidden && !$('#desb-h-hasta').value) $('#desb-h-hasta').value = $('#desb-h-fecha').value;
    previa();
  };

  const actualizarVistaChips = () => {
    const cont = $('#desb-horas-chips-cont');
    if (!cont) return;
    cont.querySelectorAll('.chip-hora').forEach((btn) => {
      btn.classList.toggle('activo', horasSeleccionadas.has(btn.dataset.hora));
    });
    const info = $('#desb-horas-seleccionadas-txt');
    if (info) {
      const arr = Array.from(horasSeleccionadas).sort();
      if (!arr.length) {
        info.textContent = 'Ningún bloque seleccionado (haz clic en los horarios arriba)';
        info.style.color = 'var(--alerta, #dc2626)';
      } else {
        info.textContent = `${arr.length} ${arr.length === 1 ? 'bloque seleccionado' : 'bloques seleccionados'}: ${arr.join(', ')}`;
        info.style.color = 'var(--azul, #0284c7)';
      }
    }
  };

  const contChips = $('#desb-horas-chips-cont');
  if (contChips) {
    contChips.querySelectorAll('.chip-hora').forEach((btn) => {
      btn.onclick = () => {
        const h = btn.dataset.hora;
        if (horasSeleccionadas.has(h)) {
          horasSeleccionadas.delete(h);
        } else {
          horasSeleccionadas.add(h);
        }
        actualizarVistaChips();
        previa();
      };
    });
  }

  $('#desb-h-quick-manana').onclick = () => {
    horasSeleccionadas = new Set(['08:30', '09:00', '09:30', '10:00', '10:30', '11:00']);
    actualizarVistaChips();
    previa();
  };
  $('#desb-h-quick-tarde').onclick = () => {
    horasSeleccionadas = new Set(['11:30', '12:00', '12:30', '13:00', '13:30']);
    actualizarVistaChips();
    previa();
  };
  $('#desb-h-quick-todos').onclick = () => {
    horasSeleccionadas = new Set(horasDisponibles);
    actualizarVistaChips();
    previa();
  };
  $('#desb-h-quick-limpiar').onclick = () => {
    horasSeleccionadas.clear();
    actualizarVistaChips();
    previa();
  };
  $('#desb-h-btn-marcar-rango').onclick = () => {
    const hd = $('#desb-h-sel-desde').value;
    const hh = $('#desb-h-sel-hasta').value;
    if (hh < hd) return toast('La hora hasta no puede ser anterior a la hora desde', 'err');
    horasDisponibles.forEach((h) => {
      if (h >= hd && h <= hh) horasSeleccionadas.add(h);
    });
    actualizarVistaChips();
    previa();
  };

  $('#desb-semana').onclick = () => {
    const mover = (iso, alDia) => {
      const d = new Date(`${iso}T12:00:00Z`);
      const dow = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - dow + alDia);
      return d.toISOString().slice(0, 10);
    };
    const desde = $('#desb-desde').value;
    if (!desde) return;
    $('#desb-desde').value = mover(desde, 0);
    $('#desb-hasta').value = mover($('#desb-hasta').value || desde, 4);
    previa();
  };

  const datos = () => {
    if (modoActual === 'dias') {
      return {
        desde: $('#desb-desde').value,
        hasta: $('#desb-hasta').value || $('#desb-desde').value,
        examinador_id: $('#desb-exam').value || null,
        motivo: $('#desb-motivo').value || null,
      };
    } else {
      const dDesde = $('#desb-h-fecha').value;
      const dHasta = ($('#desb-h-c-hasta') && !$('#desb-h-c-hasta').hidden && $('#desb-h-hasta').value)
        ? $('#desb-h-hasta').value
        : dDesde;
      return {
        desde: dDesde,
        hasta: dHasta,
        examinador_id: $('#desb-exam').value || null,
        motivo: $('#desb-motivo').value || null,
        horas: Array.from(horasSeleccionadas).sort(),
      };
    }
  };

  let tmr;
  let pedido = 0;
  const previa = () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const d = datos();
      const res = $('#desb-resumen');
      if (!res) return;
      if (!d.desde || d.hasta < d.desde) {
        res.hidden = false;
        res.textContent = 'Revisa las fechas: "Hasta" no puede ser anterior a "Desde".';
        $('#desb-ok').disabled = true;
        return;
      }
      if (modoActual === 'horas' && (!d.horas || !d.horas.length)) {
        res.hidden = false;
        res.textContent = 'Selecciona al menos un bloque u horario para desbloquear.';
        $('#desb-ok').disabled = true;
        return;
      }

      const n = ++pedido;
      const dias = Math.round((Date.parse(d.hasta) - Date.parse(d.desde)) / 864e5) + 1;
      let txtEncabezado = '';
      if (modoActual === 'dias') {
        txtEncabezado = `${fFecha(d.desde)} al ${fFecha(d.hasta)} (${dias} ${dias === 1 ? 'día' : 'días'})`;
      } else {
        const hTxt = d.horas.join(', ');
        txtEncabezado = dias > 1
          ? `${fFecha(d.desde)} al ${fFecha(d.hasta)} (${dias} días) · ${d.horas.length} ${d.horas.length === 1 ? 'bloque' : 'bloques'} (${hTxt})`
          : `${fFecha(d.desde)} · ${d.horas.length} ${d.horas.length === 1 ? 'bloque' : 'bloques'} (${hTxt})`;
      }

      try {
        const r = await api('/desbloquear-dia', { method: 'POST', body: { ...d, simular: true } });
        if (n !== pedido || !$('#desb-resumen')) return;
        const total = r.desbloqueables || 0;
        let txt = `${txtEncabezado} · se reactivarán ${total} ${total === 1 ? 'bloque bloqueado' : 'bloques bloqueados'}.`;
        if (total === 0) {
          txt += ' No hay bloques bloqueados que coincidan con estos criterios.';
        }
        res.hidden = false;
        res.textContent = txt;
        $('#desb-ok').disabled = false;
        $('#desb-ok').textContent = total ? `Desbloquear ${total} ${total === 1 ? 'bloque' : 'bloques'}` : 'Desbloquear días u horas';
      } catch (e) {
        res.hidden = false;
        res.textContent = e.message;
        $('#desb-ok').disabled = false;
        $('#desb-ok').textContent = 'Desbloquear días u horas';
      }
    }, 200);
  };

  $('#desb-motivo').onchange = previa;
  $('#desb-desde').onchange = () => {
    if (!$('#desb-hasta').value || $('#desb-hasta').value < $('#desb-desde').value) $('#desb-hasta').value = $('#desb-desde').value;
    previa();
  };
  $('#desb-h-fecha').onchange = () => {
    if (!$('#desb-h-hasta').value || $('#desb-h-hasta').value < $('#desb-h-fecha').value) $('#desb-h-hasta').value = $('#desb-h-fecha').value;
    previa();
  };
  ['#desb-hasta', '#desb-h-hasta', '#desb-exam'].forEach((s) => {
    const el = $(s);
    if (el) el.onchange = previa;
  });
  previa();

  $('#desb-cancel').onclick = cerrarModal;
  $('#desb-ok').onclick = async () => {
    const d = datos();
    if (modoActual === 'horas' && (!d.horas || !d.horas.length)) {
      return toast('Debes seleccionar al menos un bloque u horario para desbloquear', 'err');
    }

    $('#desb-ok').disabled = true;
    try {
      const r = await api('/desbloquear-dia', { method: 'POST', body: d });
      cerrarModal();
      if (!r.desbloqueados) return toast('No había bloques bloqueados que coincidieran con la selección', 'alerta');
      toast(`${r.desbloqueados} ${r.desbloqueados === 1 ? 'bloque desbloqueado y reactivado' : 'bloques desbloqueados y reactivados'} exitosamente`, 'ok');
      estadoAgenda.fecha = d.desde;
      await renderAgenda();
    } catch (e) {
      $('#desb-ok').disabled = false;
      toast(e.message, 'err');
    }
  };
}

// Motivo corto si a la cita le falta algun dato clave, o null si esta bien.
// Mismo criterio que el Reporte de errores, pero visible directo en la tarjeta.
