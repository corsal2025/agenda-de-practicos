/* ================= editor de bloque ================= */
// "B,A2" -> ['B','A2']. Acepta tanto el valor guardado (con comas) como uno solo.
const clasesDe = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function editorSlot(b, alGuardar) {
  // 1. Si la celda está bloqueada: Diálogo para desbloquear
  if (b.bloqueado) {
    modal(
      `Bloque inhabilitado · ${fFecha(b.fecha)} · ${b.hora} · ${b.examinador}`,
      `
      <div style="text-align:center;padding:1.4rem .5rem">
        <div style="font-size:2.4rem;margin-bottom:.5rem">&#128274;</div>
        <h3 style="margin:0 0 .5rem;color:var(--alerta);font-size:1.2rem;text-transform:uppercase">${esc(b.bloqueo_motivo || 'BLOQUEADO')}</h3>
        <p class="muted" style="max-width:380px;margin:0 auto;line-height:1.4">Este horario de examen práctico se encuentra actualmente no disponible.</p>
      </div>
      `,
      `
      <button class="btn btn-desbloq-accion" id="btn-desbloq-slot">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
        Desbloquear esta hora
      </button>
      <button class="btn sec" id="btn-cancel-bloq">Cerrar</button>
      `
    );
    $('#btn-cancel-bloq').onclick = cerrarModal;
    $('#btn-desbloq-slot').onclick = async () => {
      try {
        await api(`/agenda/${b.id}/liberar`, { method: 'POST', body: { motivo: 'Desbloqueo manual' } });
        cerrarModal();
        alGuardar && alGuardar();
        toast('Bloque desbloqueado exitosamente · Ahora está disponible para citar', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    };
    return;
  }

  // 2. Si la celda está libre o tiene cita: Abrir DIRECTAMENTE el formulario de agendamiento completo
  formularioCita(b, alGuardar);
}

function funcionarioActual() {
  if (!META) return null;
  if (META.funcionario_id) {
    const f = (META.funcionarios || []).find((x) => x.id === META.funcionario_id);
    if (f) return f;
  }
  return (META.funcionarios || []).find((f) => f.activo) || null;
}

function formularioCita(b, alGuardar) {
  const c = META.catalogos;
  const funcs = META.funcionarios.filter((f) => f.activo);
  const actual = funcionarioActual();
  const fAsignado = (b.funcionario_id && (META.funcionarios || []).find((f) => f.id === b.funcionario_id))
    || actual
    || (b.funcionario ? { id: b.funcionario_id || null, nombre: b.funcionario } : null)
    || { id: null, nombre: 'Sin asignar' };
  const clasesIniciales = clasesDe(b.clase);
  const esPesada = clasesIniciales.some((cl) => META.clases_pesadas.includes(cl));
  const tieneCita = Boolean(b && (b.rut || b.nombre));
  if (tieneCita) {
    // Ficha de cita modal eliminada por solicitud del usuario para trabajar otro método
    return;
  }

  modal(
    `Agendar nueva cita · ${fFecha(b.fecha)} · ${b.hora} hrs · Examinador/a: ${esc(b.examinador)}`,
    `
    <div class="campo"><label>Nombre completo <b class="req" style="color:var(--alerta)">*</b></label>
      <input id="f-nombre" value="${esc(nom(b.nombre))}" required placeholder="NOMBRES Y APELLIDOS" style="text-transform:uppercase;font-weight:600">
    </div>
    
    <div class="campo"><label>RUT (con puntos y guión) <b class="req" style="color:var(--alerta)">*</b></label>
      <input id="f-rut" value="${esc(b.rut)}" required placeholder="12.345.678-9" style="font-weight:600">
    </div>

    <div class="campo"><label>Celular (contacto) <b class="req" style="color:var(--alerta)">*</b></label>
      <input id="f-contacto" value="${esc(fTel(b.contacto))}" required placeholder="+56 9 1234 5678" inputmode="tel">
    </div>

    <div class="campo ancho"><label>Clase de Licencia que está sacando <b class="req" style="color:var(--alerta)">*</b> (puedes marcar más de una)</label>
      <div class="chk-clases" id="f-clase">${c.clase.map((cl) => `
        <label class="chk-clase"><input type="checkbox" value="${esc(cl)}" ${clasesIniciales.includes(cl) ? 'checked' : ''}> ${esc(cl)}</label>
      `).join('')}</div>
    </div>

    <div class="campo"><label>Correo electrónico <b class="req" style="color:var(--alerta)">*</b></label>
      <input id="f-correo" type="email" required placeholder="nombre@correo.com" value="${esc(b.correo)}">
    </div>

    <div class="campo" id="wrap-f-func">
      <label>Funcionario/a que agenda</label>
      <div id="disp-f-func" style="display:flex;align-items:center;gap:.6rem;padding:.45rem .75rem;background:var(--elev);border:1px solid var(--linea);border-radius:6px;min-height:38px;box-sizing:border-box">
        <span style="font-size:14px">👤</span>
        <span id="txt-f-func" style="font-weight:700;color:var(--tinta);font-size:13px">${esc(fAsignado.nombre)}</span>
        <span class="badge" style="margin-left:auto;font-size:10px;background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;padding:2px 7px;font-weight:600">
          ${b.funcionario_id ? 'Asignado' : 'Por defecto'}
        </span>
        <button type="button" class="btn chico sec" id="btn-cambiar-func" style="padding:1px 6px;font-size:11px;margin-left:6px" title="Cambiar funcionario">Cambiar</button>
      </div>
      <div id="sel-f-func-cont" hidden style="margin-top:4px">
        <select id="f-func-sel" style="width:100%">
          ${funcs.map((f) => `<option value="${f.id}" ${f.id === (fAsignado.id || b.funcionario_id) ? 'selected' : ''}>${esc(f.nombre)}</option>`).join('')}
          <option value="__nuevo">+ Nuevo...</option>
        </select>
      </div>
      <input type="hidden" id="f-func" value="${fAsignado.id || ''}">
    </div>

    <div class="campo ancho" id="zona-forzar" ${esPesada ? '' : 'hidden'}>
      <label><input type="checkbox" id="f-forzar"> <span id="f-forzar-txt">${esc(textoForzar(b))}</span></label>
    </div>
    ${(b.alerts || []).length ? `<div class="campo ancho">${alertasHtml(b)}</div>` : ''}
    <div class="campo ancho" id="f-intento-aviso" hidden></div>
    <div class="campo">
      <label>Fecha de Inicio de Trámite *</label>
      <input type="date" id="f-fecha-inicio" required value="${esc(b.fecha_inicio_tramite || '')}" max="${hoy()}" style="width:100%;padding:.45rem .6rem;border:1px solid var(--linea);border-radius:6px">
      <div id="f-cuenta-tramite" class="cuenta-tramite-zona" aria-live="polite"></div>
    </div>
    <div class="campo" id="zona-escuela" ${esClaseTramite(b.clase) ? '' : 'hidden'}>
      <label>Escuela de Conductores</label>
      <select id="f-escuela" style="width:100%;padding:.45rem .6rem;border:1px solid var(--linea);border-radius:6px">
        <option value="">-- Sin escuela --</option>
        ${c.escuela_conductores ? c.escuela_conductores.map((e) => `<option value="${esc(e)}" ${b.escuela_conductores === e ? 'selected' : ''}>${esc(e)}</option>`).join('') : ''}
      </select>
    </div>
    <div class="campo">
      <label>Tipo de Reagendamiento</label>
      <select id="f-tipo-reagendamiento" style="width:100%;padding:.45rem .6rem;border:1px solid var(--linea);border-radius:6px">
        <option value="">-- Sin tipo --</option>
        ${c.tipo_reagendamiento ? c.tipo_reagendamiento.map((tipo) => `<option value="${esc(tipo)}" ${b.tipo_reagendamiento === tipo ? 'selected' : ''}>${esc(tipo)}</option>`).join('') : ''}
      </select>
    </div>
    ${tieneCita ? `<div class="campo">
      <label>Confirmó asistencia</label>
      <select id="f-conf">
        <option value="" ${b.confirmo_asistencia == null ? 'selected' : ''}>-- Sin respuesta --</option>
        <option value="1" ${b.confirmo_asistencia === 1 ? 'selected' : ''}>SÍ</option>
        <option value="0" ${b.confirmo_asistencia === 0 ? 'selected' : ''}>NO</option>
      </select>
    </div>
    <div class="campo">
      <label>Resultado</label>
      <select id="f-res">
        <option value="">-- Sin resultado --</option>
        ${(c.resultado || []).map((r) => `<option value="${esc(r)}" ${b.resultado === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
      </select>
    </div>
    <div class="campo ancho">
      <label>Comentarios</label>
      <textarea id="f-coment" rows="3">${esc(b.comentarios || '')}</textarea>
    </div>` : ''}
    ${tieneCita ? '<div class="campo ancho hist-cita" id="zona-hist-cita"><h4>Historial del solicitante</h4><div class="hist-lista">Cargando...</div></div>' : ''}
    `,
    `
    ${(b.rut || b.nombre) ? '<button class="btn peligro sec" id="btn-liberar" title="Quita la cita del bloque">Liberar bloque</button>' : ''}
    ${(b.rut || b.nombre) ? '<button type="button" class="btn sec" id="btn-reagendar-slot" style="color:var(--azul);font-weight:600"' + (bloqueoReagendarConfirmada(b) ? ` disabled title="${esc(bloqueoReagendarConfirmada(b))}"` : '') + '>Reagendar postulante</button>' : ''}
    ${tieneCita ? '<button type="button" class="btn sec" id="btn-imprimir-ficha">Imprimir ficha</button>' : ''}
    <button class="btn sec" id="btn-cancel">Cancelar</button>
    <button class="btn" id="btn-guardar" style="background:#1d4ed8;font-weight:700">${tieneCita ? "Guardar cambios" : "Confirmar y agendar cita"}</button>
    `,
    'lateral'
  );
  if (tieneCita) cargarHistorialCita(b, alGuardar);

  // Autoformato de RUT en tiempo real
  $('#f-rut').addEventListener('input', () => {
    let v = $('#f-rut').value.replace(/[^0-9kK]/g, '').toUpperCase();
    if (v.length > 9) v = v.slice(0, 9);
    if (v.length > 1) {
      const cuerpo = v.slice(0, -1);
      const dv = v.slice(-1);
      let cuerpoFmt = '';
      for (let i = cuerpo.length - 1, j = 1; i >= 0; i--, j++) {
        cuerpoFmt = cuerpo[i] + cuerpoFmt;
        if (j % 3 === 0 && i > 0) cuerpoFmt = '.' + cuerpoFmt;
      }
      $('#f-rut').value = cuerpoFmt + '-' + dv;
    } else {
      $('#f-rut').value = v;
    }
  });

  // Autoformato de Celular
  $('#f-contacto').addEventListener('blur', () => {
    let v = $('#f-contacto').value.trim().replace(/\s+/g, '');
    if (v.startsWith('+56')) v = v.slice(3);
    if (v.startsWith('56')) v = v.slice(2);
    if (v.length === 9 && v.startsWith('9')) {
      $('#f-contacto').value = `+56 9 ${v.slice(1, 5)} ${v.slice(5)}`;
    } else if (v.length === 8) {
      $('#f-contacto').value = `+56 9 ${v.slice(0, 4)} ${v.slice(4)}`;
    }
  });

  // Autocompletar datos si el RUT tiene citas anteriores
  if (!b.rut && !b.nombre) {
    $('#f-rut').addEventListener('blur', async () => {
      const val = $('#f-rut').value.trim();
      if (!val) return;
      try {
        const hist = await api(`/historial?rut=${encodeURIComponent(val)}`);
        if (!hist.length) return;
        const ultimo = hist[hist.length - 1];
        let completo = false;
        if (!$('#f-nombre').value && ultimo.nombre) { $('#f-nombre').value = nom(ultimo.nombre); completo = true; }
        if (!$('#f-contacto').value && ultimo.contacto) { $('#f-contacto').value = fTel(ultimo.contacto); completo = true; }
        if (!$('#f-correo').value && ultimo.correo) { $('#f-correo').value = ultimo.correo; completo = true; }
        if (completo) toast('Datos autocompletados de una cita anterior', 'ok');
      } catch (_) {}
    });
  }

  if ($('#btn-cambiar-func')) {
    $('#btn-cambiar-func').onclick = () => {
      $('#sel-f-func-cont').hidden = false;
      $('#btn-cambiar-func').style.display = 'none';
      $('#f-func-sel').focus();
    };
  }
  if ($('#f-func-sel')) {
    $('#f-func-sel').onchange = async (e) => {
      if (e.target.value === '__nuevo') {
        const nombre = prompt('Nombre del nuevo funcionario/a:');
        if (!nombre || !nombre.trim()) { e.target.value = $('#f-func').value; return; }
        try {
          const r = await api('/funcionarios', { method: 'POST', body: { nombre } });
          META = await api('/meta');
          const optEl = document.createElement('option');
          optEl.value = r.id; optEl.textContent = r.nombre; optEl.selected = true;
          $('#f-func-sel').insertBefore(optEl, $('#f-func-sel').lastElementChild);
          $('#f-func').value = r.id;
          $('#txt-f-func').textContent = r.nombre;
        } catch (err) {
          toast(err.message, 'err');
        }
        return;
      }
      $('#f-func').value = e.target.value;
      const fn = funcs.find((f) => String(f.id) === String(e.target.value));
      $('#txt-f-func').textContent = fn ? fn.nombre : '';
    };
  }

  const clasesMarcadas = () => Array.from(document.querySelectorAll('#f-clase input:checked')).map((i) => i.value);

  const chequearPesada = () => {
    const clases = clasesMarcadas();
    const tienePesada = clases.some((cl) => META.clases_pesadas.includes(cl));
    $('#zona-forzar').hidden = !tienePesada;
    if (tienePesada) $('#f-forzar-txt').textContent = textoForzar(b);
    $('#zona-escuela').hidden = !esClaseTramite(clases.join(','));
    actualizarCuentaTramite();
  };
  const actualizarCuentaTramite = () => {
    const v = vigenciaTramiteCli($('#f-fecha-inicio').value);
    $('#f-cuenta-tramite').innerHTML = v ? cuentaRegresivaHtml(v.dias, v.vence) : '';
  };
  document.querySelectorAll('#f-clase input').forEach((chk) => {
    chk.addEventListener('change', chequearPesada);
    chk.addEventListener('change', () => avisoTercerIntentoEnVivo(b, $('#f-rut').value.trim(), clasesMarcadas()));
  });
  $('#f-rut').addEventListener('blur', () => avisoTercerIntentoEnVivo(b, $('#f-rut').value.trim(), clasesMarcadas()));
  $('#f-fecha-inicio').addEventListener('input', actualizarCuentaTramite);
  $('#f-fecha-inicio').addEventListener('change', actualizarCuentaTramite);
  actualizarCuentaTramite();

  $('#btn-cancel').onclick = cerrarModal;
  if ($('#btn-imprimir-ficha')) $('#btn-imprimir-ficha').onclick = () => imprimirFicha(b).catch((e) => toast(e.message, 'err'));

  if ($('#btn-liberar')) {
    $('#btn-liberar').onclick = async () => {
      if (!confirm('¿Seguro que deseas liberar este bloque? La cita se moverá a la Papelera.')) return;
      try {
        await api(`/agenda/${b.id}/liberar`, { method: 'POST', body: { motivo: 'Liberado desde formulario' } });
        cerrarModal(); alGuardar && alGuardar();
        toast('Bloque liberado');
        if (window.SugerenciasCupo) window.SugerenciasCupo.abrir(b.id, alGuardar);
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  if ($('#btn-reagendar-slot')) {
    $('#btn-reagendar-slot').onclick = async () => {
      try {
        await api(`/agenda/${b.id}/reagendar`, { method: 'POST', body: { motivo: 'POSTULANTE SOLICITA CAMBIO' } });
        cerrarModal(); alGuardar && alGuardar();
        sessionStorage.setItem('le_destacado', String(b.id));
        actualizarBadgeReagendar();
        toast('Postulante enviado a Lista de Espera con alta prioridad', 'ok');
        irA('espera');
      } catch (e) { toast(e.message, 'err'); }
    };
  }


  $('#btn-guardar').onclick = async () => {
    const nombre = $('#f-nombre').value.trim();
    const rutVal = $('#f-rut').value.trim();
    const clases = clasesMarcadas();
    const contacto = $('#f-contacto').value.trim();
    const correoVal = $('#f-correo').value.trim();

    // Validaciones estrictas de campos obligatorios
    if (!nombre) { toast('El nombre del postulante es obligatorio', 'err'); $('#f-nombre').focus(); return; }
    if (!rutVal) { toast('El RUT es obligatorio', 'err'); $('#f-rut').focus(); return; }
    if (!formatearSiEsRut(rutVal)) { toast('El RUT ingresado no es válido (revisa el dígito verificador)', 'err'); $('#f-rut').focus(); return; }
    if (!clases.length) { toast('Debes marcar al menos una clase de licencia', 'err'); return; }
    if (!contacto) { toast('El número de celular es obligatorio', 'err'); $('#f-contacto').focus(); return; }
    if (!correoVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoVal)) { toast('Ingresa un correo electrónico válido', 'err'); $('#f-correo').focus(); return; }
    if ($('#f-fecha-inicio') && !$('#f-fecha-inicio').value) { toast('La fecha de inicio de trámite es obligatoria', 'err'); $('#f-fecha-inicio').focus(); return; }

    $('#btn-guardar').disabled = true;
    $('#btn-guardar').textContent = 'Guardando...';

    const comun = { visto_en: b.actualizado_en, comentarios: $('#f-coment') ? ($('#f-coment').value.trim() || null) : (b.comentarios || null) };
    try {
      const body = {
        ...comun,
        rut: rutVal,
        nombre: nombre,
        nacionalidad: b.nacionalidad || 'CHILENA',
        clase: clases.join(','),
        contacto: contacto,
        correo: correoVal,
        tipo_cita: b.tipo_cita || 'NORMAL',
        motivo_reagendamiento: b.motivo_reagendamiento || null,
        lista_espera: 'NO',
        intento: b.intento || '1° VEZ',
        funcionario_id: $('#f-func').value && $('#f-func').value !== '__nuevo' ? Number($('#f-func').value) : null,
        fecha_inicio_tramite: $('#f-fecha-inicio') ? ($('#f-fecha-inicio').value || null) : (b.fecha_inicio_tramite || null),
        escuela_conductores: esClaseTramite(clasesMarcadas().join(',')) ? ($('#f-escuela').value || null) : null,
        tipo_reagendamiento: $('#f-tipo-reagendamiento') ? $('#f-tipo-reagendamiento').value || null : (b.tipo_reagendamiento || null),
        confirmo_asistencia: $('#f-conf') ? ($('#f-conf').value === '' ? null : Number($('#f-conf').value)) : (b.confirmo_asistencia ?? null),
        resultado: $('#f-res') ? ($('#f-res').value || null) : (b.resultado || null),
        pendiente_reagendar: Boolean(b.pendiente_reagendar),
        pendiente_nota: b.pendiente_nota || null,
        forzar: $('#f-forzar') && $('#f-forzar').checked,
      };

      let r;
      try {
        r = await api(`/agenda/${b.id}`, { method: 'PUT', body });
      } catch (err) {
        if (!(err.status === 409 && err.data && err.data.codigo === 'TERCER_INTENTO')) throw err;
        const motivo = await pedirAutorizacionTercerIntento(err.data);
        if (!motivo) {
          $('#btn-guardar').disabled = false;
          $('#btn-guardar').textContent = tieneCita ? 'Guardar cambios' : 'Confirmar y agendar cita';
          return;
        }
        r = await api(`/agenda/${b.id}`, { method: 'PUT', body: { ...body, autorizar_tercer_intento: { motivo } } });
      }
      (r.avisos || []).forEach((a) => toast(a, 'err'));
      toast('Cita agendada exitosamente · Comprobante e instrucciones enviadas por correo', 'ok');
      cerrarModal();
      alGuardar && alGuardar();
    } catch (e) {
      $('#btn-guardar').disabled = false;
      $('#btn-guardar').textContent = tieneCita ? 'Guardar cambios' : 'Confirmar y agendar cita';
      toast(e.message, 'err');
      if (e.status === 409 && e.data && e.data.bloque) { editorSlot(e.data.bloque, alGuardar); }
    }
  };
}
async function abrirSlotPorId(id, alGuardar) {
  editorSlot(await api(`/agenda/${id}`), alGuardar);
}

async function fechaInicialAgenda() {
  const h = hoy();
  const dow = new Date(`${h}T12:00:00`).getDay();
  if (dow === 0 || dow === 6) {
    return await proximoDiaConAgenda(h, 1);
  }
  try {
    const rows = await apiReciente(`/agenda?fecha=${h}`, 30e3);
    if (!Array.isArray(rows) || !rows.length) return await proximoDiaConAgenda(h, 1);
  } catch (_) {}
  return h;
}


// ---------- Regla de 3er intento (el servidor bloquea; aqui se avisa y se pide autorizacion) ----------
const MOTIVO_TERCER_INTENTO_MIN = 10;
const RESULTADOS_TERCER_INTENTO = ['REPROBADO', 'REPROBADO INASISTENCIA'];

// Aviso en rojo, antes de guardar, si el RUT ya reprobo 2 veces alguna de las clases marcadas.
async function avisoTercerIntentoEnVivo(b, rutVal, clases) {
  const zona = $('#f-intento-aviso');
  if (!zona || !rutVal || !clases.length) return;
  try {
    const rows = await api(`/buscar-historial?rut=${encodeURIComponent(rutVal)}`);
    if (!document.body.contains(zona) || !Array.isArray(rows)) return;
    const cuenta = {};
    rows.filter((r) => r.id !== b.id && RESULTADOS_TERCER_INTENTO.includes(r.resultado))
      .forEach((r) => clasesDe(r.clase).forEach((c) => { cuenta[c] = (cuenta[c] || 0) + 1; }));
    const bloqueada = clases.find((c) => (cuenta[c] || 0) >= 2);
    if (!bloqueada) { zona.innerHTML = ''; zona.hidden = true; return; }
    zona.innerHTML = `<div class="badge reprob" role="alert" style="display:block;padding:8px 10px;font-weight:700;white-space:normal">
      ⚠ 3er intento: esta persona reprobó ${cuenta[bloqueada]} veces la clase ${esc(bloqueada)}. Para agendar se requiere autorización con motivo.</div>`;
    zona.hidden = false;
  } catch (_) { /* el aviso es informativo; el servidor aplica la regla */ }
}

// Modal sobre el editor: devuelve el motivo (>= 10 caracteres) o null si se cancela.
function pedirAutorizacionTercerIntento(datos) {
  return new Promise((resolver) => {
    const ov = h(`<div class="overlay" style="z-index:1000">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="ti-titulo" style="max-width:480px">
        <header><h3 id="ti-titulo">Tercer intento bloqueado</h3></header>
        <div class="cuerpo">
          <p>${esc(datos.error || '')}</p>
          <p>Solo se puede agendar con una autorización justificada. Quedará registrada en el historial de movimientos y en los comentarios de la cita.</p>
          <label for="ti-motivo"><b>Motivo de la autorización</b></label>
          <textarea id="ti-motivo" rows="3" style="width:100%" placeholder="Mínimo ${MOTIVO_TERCER_INTENTO_MIN} caracteres"></textarea>
          <div id="ti-cuenta" class="hist-sub"></div>
        </div>
        <footer>
          <button type="button" class="btn sec" id="ti-cancelar">Cancelar</button>
          <button type="button" class="btn" id="ti-autorizar" disabled>Autorizar y guardar</button>
        </footer>
      </div></div>`);
    const txt = ov.querySelector('#ti-motivo');
    const btn = ov.querySelector('#ti-autorizar');
    const cuenta = ov.querySelector('#ti-cuenta');
    const terminar = (v) => { ov.remove(); resolver(v); };
    txt.addEventListener('input', () => {
      const n = txt.value.trim().length;
      btn.disabled = n < MOTIVO_TERCER_INTENTO_MIN;
      cuenta.textContent = n < MOTIVO_TERCER_INTENTO_MIN ? `Faltan ${MOTIVO_TERCER_INTENTO_MIN - n} caracteres` : '';
    });
    ov.querySelector('#ti-cancelar').onclick = () => terminar(null);
    btn.onclick = () => terminar(txt.value.trim());
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); terminar(null); } });
    document.body.appendChild(ov);
    txt.focus();
  });
}
