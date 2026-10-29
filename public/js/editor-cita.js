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

// El sistema opera sin requisito de login/funcionario propio: el control de acceso lo gestiona el sistema padre.
function funcionarioActual() {
  if (!META) return null;
  const fSesion = window.FuncionarioSesion ? window.FuncionarioSesion.actual() : null;
  return fSesion || { id: null, nombre: 'Sin asignar' };
}

function formularioCita(b, alGuardar) {
  // Abrir DIRECTAMENTE el formulario de agendamiento sin exigir usuario ni funcionario
  abrirFormularioCita(b, alGuardar);
}

// Aviso tras guardar una cita nueva, segun lo que el servidor informa del correo de confirmacion:
// { estado: 'enviado' | 'fallido' (con motivo) | 'deshabilitado' | 'sin_correo' } o null si no hubo intento.
function avisoCorreoCita(correoRes) {
  const ok = 'Cita agendada exitosamente';
  if (!correoRes) return { texto: ok, tipo: 'ok' };
  switch (correoRes.estado) {
    case 'enviado':
    case 'enviando':
      return { texto: `${ok} · Comprobante e instrucciones enviados por correo`, tipo: 'ok' };
    case 'fallido':
      return { texto: `Cita agendada, pero el correo NO se pudo enviar (${correoRes.motivo || 'causa desconocida'}). Avisa a la persona por otro medio.`, tipo: 'alerta' };
    case 'deshabilitado':
      return { texto: 'Cita agendada. El correo no está configurado en este equipo: no se envió el comprobante.', tipo: 'alerta' };
    case 'sin_correo':
      return { texto: 'Cita agendada sin correo: no se envió el comprobante.', tipo: 'alerta' };
    default:
      return { texto: ok, tipo: 'ok' };
  }
}

function abrirFormularioCita(b, alGuardar) {
  b = b || {};
  const metaObj = (typeof META !== 'undefined' && META) ? META : {};
  const c = metaObj.catalogos || {};
  const catalogoClases = (Array.isArray(c.clase) && c.clase.length)
    ? c.clase
    : ['B', 'C', 'D', 'A1', 'A2', 'A3', 'A4', 'A5', 'E'];
  const clasesPesadas = (Array.isArray(metaObj.clases_pesadas) && metaObj.clases_pesadas.length)
    ? metaObj.clases_pesadas
    : ['D', 'A5'];
  const catalogoEscuelas = Array.isArray(c.escuela_conductores) ? c.escuela_conductores : [];
  const horaD = metaObj.hora_d_a5 || '12:30';

  const clasesIniciales = clasesDe(b.clase);
  const esPesada = clasesIniciales.some((cl) => clasesPesadas.includes(cl));

  const forzarTexto = typeof textoForzar === 'function'
    ? textoForzar(b)
    : (b.hora === horaD ? 'Forzar cita (bloque reservado para clase pesada)' : `Forzar: clase pesada fuera del bloque ${horaD}`);

  const alertasTexto = typeof alertasHtml === 'function'
    ? alertasHtml(b)
    : (b.alerts || []).map((t) => `<span class="badge reprob">${esc(t)}</span>`).join(' ');

  const esTramite = typeof esClaseTramite === 'function'
    ? esClaseTramite(b.clase)
    : clasesIniciales.some((cl) => clasesPesadas.includes(cl));

  modal(
    `Agendar nueva cita · ${fFecha(b.fecha)} · ${esc(b.hora || '')} hrs · Examinador/a: ${esc(b.examinador || 'Sin asignar')}`,
    `
    <div class="cita-resumen-c" aria-label="Resumen de la cita">
      <div><span>Fecha</span><b>${esc(fFecha(b.fecha))}</b></div>
      <div><span>Hora</span><b>${esc(b.hora || '')} hrs</b></div>
      <div><span>Examinador/a</span><b>${esc(b.examinador || 'Sin asignar')}</b></div>
    </div>
    <div class="campo"><label>Nombre completo</label>
      <input id="f-nombre" value="${esc(nom(b.nombre))}" required placeholder="NOMBRES Y APELLIDOS" style="text-transform:uppercase;font-weight:600">
    </div>
    
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
      <div class="campo"><label>RUT</label>
        <input id="f-rut" value="${esc(b.rut || '')}" required placeholder="12.345.678-9" style="font-weight:600">
      </div>

      <div class="campo"><label>Celular</label>
        <input id="f-contacto" value="${esc(fTel(b.contacto))}" required placeholder="+56 9 1234 5678" inputmode="tel">
      </div>
    </div>

    <div class="campo ancho"><label>Licencias (puedes marcar varias)</label>
      <div class="chk-clases" id="f-clase">${catalogoClases.map((cl) => {
        const esPesada = clasesPesadas.includes(cl);
        const bloqPesada = esPesada && b.hora && b.hora < '12:30';
        return `
        <label class="chk-clase" style="${bloqPesada ? 'opacity:0.55;cursor:not-allowed;' : ''}">
          <input type="checkbox" value="${esc(cl)}" ${clasesIniciales.includes(cl) ? 'checked' : ''} ${bloqPesada ? 'disabled title="Solo disponible en bloques de las 12:30 en adelante"' : ''}>
          ${esc(cl)}${bloqPesada ? ' <small style="font-size:10px;color:#dc2626;font-weight:700">(Solo desde 12:30)</small>' : ''}
        </label>`;
      }).join('')}</div>
    </div>

    <div class="campo"><label>Correo</label>
      <input id="f-correo" type="email" required placeholder="nombre@correo.com" value="${esc(b.correo || '')}">
    </div>

    <div class="campo ancho" id="f-pesada-bloqueada-aviso" style="background:#fee2e2;color:#b91c1c;padding:.6rem .8rem;border-radius:6px;font-weight:700;font-size:12.5px;border:1px solid #f87171" hidden>⚠️ Las licencias Clase D y A5 solo pueden agendarse en bloques de las 12:30 en adelante.</div>
    <div class="campo ancho" id="zona-forzar" ${esPesada ? '' : 'hidden'}>
      <label><input type="checkbox" id="f-forzar"> <span id="f-forzar-txt">${esc(forzarTexto)}</span></label>
    </div>
    ${(b.alerts || []).length ? `<div class="campo ancho">${alertasTexto}</div>` : ''}
    <div class="campo ancho" id="f-intento-aviso" hidden></div>
    <div class="campo">
      <label for="f-fecha-inicio">Fecha de Inicio de Trámite *</label>
      <input type="date" id="f-fecha-inicio" required value="${esc(b.fecha_inicio_tramite || '')}" max="${hoy()}" style="width:100%;padding:.45rem .6rem;border:1px solid var(--linea);border-radius:6px">
      <div id="f-cuenta-tramite" class="cuenta-tramite-zona" aria-live="polite"></div>
    </div>
    <div class="campo" id="zona-escuela" ${esTramite ? '' : 'hidden'}>
      <label for="f-escuela">Escuela de Conductores</label>
      <select id="f-escuela" style="width:100%;padding:.45rem .6rem;border:1px solid var(--linea);border-radius:6px">
        <option value="">-- Sin escuela --</option>
        ${catalogoEscuelas.map((e) => `<option value="${esc(e)}" ${b.escuela_conductores === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}
      </select>
    </div>
    `,
    `
    <button class="btn sec" id="btn-cancel">Cancelar</button>
    <button class="btn" id="btn-guardar" style="background:#1d4ed8;font-weight:700">Confirmar y agendar cita</button>
    `,
    'lateral cita-c'
  );

  // Autoformato de RUT en tiempo real
  const fRutInput = $('#f-rut');
  if (fRutInput) {
    fRutInput.addEventListener('input', () => {
      let v = fRutInput.value.replace(/[^0-9kK]/g, '').toUpperCase();
      if (v.length > 9) v = v.slice(0, 9);
      if (v.length > 1) {
        const cuerpo = v.slice(0, -1);
        const dv = v.slice(-1);
        let cuerpoFmt = '';
        for (let i = cuerpo.length - 1, j = 1; i >= 0; i--, j++) {
          cuerpoFmt = cuerpo[i] + cuerpoFmt;
          if (j % 3 === 0 && i > 0) cuerpoFmt = '.' + cuerpoFmt;
        }
        fRutInput.value = cuerpoFmt + '-' + dv;
      } else {
        fRutInput.value = v;
      }
    });

    // Autocompletar datos si el RUT tiene citas anteriores
    fRutInput.addEventListener('blur', async () => {
      const val = fRutInput.value.trim();
      if (!val) return;
      try {
        const hist = await api(`/historial?rut=${encodeURIComponent(val)}`);
        if (!hist || !hist.length) return;
        const ultimo = hist[hist.length - 1];
        let completo = false;
        if ($('#f-nombre') && !$('#f-nombre').value && ultimo.nombre) { $('#f-nombre').value = nom(ultimo.nombre); completo = true; }
        if ($('#f-contacto') && !$('#f-contacto').value && ultimo.contacto) { $('#f-contacto').value = fTel(ultimo.contacto); completo = true; }
        if ($('#f-correo') && !$('#f-correo').value && ultimo.correo) { $('#f-correo').value = ultimo.correo; completo = true; }
        if (completo) toast('Datos autocompletados de una cita anterior', 'ok');
      } catch (_) {}
    });
  }

  // Autoformato de Celular
  const fContactoInput = $('#f-contacto');
  if (fContactoInput) {
    fContactoInput.addEventListener('blur', () => {
      let v = fContactoInput.value.trim().replace(/\s+/g, '');
      if (v.startsWith('+56')) v = v.slice(3);
      if (v.startsWith('56')) v = v.slice(2);
      if (v.length === 9 && v.startsWith('9')) {
        fContactoInput.value = `+56 9 ${v.slice(1, 5)} ${v.slice(5)}`;
      } else if (v.length === 8) {
        fContactoInput.value = `+56 9 ${v.slice(0, 4)} ${v.slice(4)}`;
      }
    });
  }

  const clasesMarcadas = () => Array.from(document.querySelectorAll('#f-clase input:checked')).map((i) => i.value);

  const chequearPesada = () => {
    const clases = clasesMarcadas();
    const tienePesada = clases.some((cl) => clasesPesadas.includes(cl));
    const esHoraInvalidaPesada = tienePesada && b.hora && b.hora < '12:30';
    const zPesadaAviso = $('#f-pesada-bloqueada-aviso');
    if (zPesadaAviso) zPesadaAviso.hidden = !esHoraInvalidaPesada;
    const zForzar = $('#zona-forzar');
    if (zForzar) zForzar.hidden = !tienePesada || esHoraInvalidaPesada;
    const zForzarTxt = $('#f-forzar-txt');
    if (zForzarTxt && tienePesada) {
      zForzarTxt.textContent = typeof textoForzar === 'function' ? textoForzar(b) : forzarTexto;
    }
    const zEscuela = $('#zona-escuela');
    if (zEscuela) {
      zEscuela.hidden = typeof esClaseTramite === 'function'
        ? !esClaseTramite(clases.join(','))
        : !clases.some((c) => clasesPesadas.includes(c));
    }
    actualizarCuentaTramite();
  };
  const actualizarCuentaTramite = () => {
    const fIni = $('#f-fecha-inicio');
    const zCuenta = $('#f-cuenta-tramite');
    if (!fIni || !zCuenta) return;
    const v = typeof vigenciaTramiteCli === 'function' ? vigenciaTramiteCli(fIni.value) : null;
    zCuenta.innerHTML = (v && typeof cuentaRegresivaHtml === 'function') ? cuentaRegresivaHtml(v.dias, v.vence) : '';
  };
  document.querySelectorAll('#f-clase input').forEach((chk) => {
    chk.addEventListener('change', chequearPesada);
    chk.addEventListener('change', () => {
      const rInput = $('#f-rut');
      avisoTercerIntentoEnVivo(b, rInput ? rInput.value.trim() : '', clasesMarcadas());
    });
  });
  if (fRutInput) {
    fRutInput.addEventListener('blur', () => avisoTercerIntentoEnVivo(b, fRutInput.value.trim(), clasesMarcadas()));
  }
  const fIniInput = $('#f-fecha-inicio');
  if (fIniInput) {
    fIniInput.addEventListener('input', actualizarCuentaTramite);
    fIniInput.addEventListener('change', actualizarCuentaTramite);
  }
  actualizarCuentaTramite();

  const esCupoExtraVacio = Number(b.cupo) > 1 && !b.rut && !b.nombre;
  let guardadoExitoso = false;
  let yaLimpiado = false;
  const limpiarSiCancela = async () => {
    if (esCupoExtraVacio && !guardadoExitoso && !yaLimpiado) {
      yaLimpiado = true;
      try {
        await api(`/agenda/${b.id}/liberar`, { method: 'POST', body: { motivo: 'Cancelación al agregar persona' } });
        alGuardar && alGuardar();
        if (window.renderAgenda) renderAgenda();
      } catch (_) {}
    }
  };

  const cerrarYCancela = () => {
    window.removeEventListener('keydown', onEscapeModal);
    limpiarSiCancela();
    cerrarModal();
  };

  const onEscapeModal = (e) => {
    if (e.key === 'Escape') {
      cerrarYCancela();
    }
  };
  window.addEventListener('keydown', onEscapeModal);

  const btnCancel = $('#btn-cancel');
  if (btnCancel) btnCancel.onclick = cerrarYCancela;

  const ovModal = $('#modal-root .overlay');
  if (ovModal && typeof ovModal.querySelector === 'function') {
    const xBtn = ovModal.querySelector('.x');
    if (xBtn) {
      xBtn.onclick = cerrarYCancela;
    }
    if (typeof ovModal.addEventListener === 'function') {
      ovModal.addEventListener('click', (e) => {
        if (e.target === ovModal) {
          cerrarYCancela();
        }
      });
    }
  }

  const btnGuardar = $('#btn-guardar');
  if (btnGuardar) btnGuardar.onclick = async () => {
    const btnG = $('#btn-guardar');
    if (btnG && btnG.disabled) return;
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
    const tienePesada = clases.some((cl) => clasesPesadas.includes(cl));
    if (tienePesada && b.hora && b.hora < '12:30') {
      toast('Las licencias Clase D y A5 solo pueden agendarse en bloques de las 12:30 en adelante.', 'err');
      return;
    }
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
        funcionario_id: b.funcionario_id || null,
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
          $('#btn-guardar').textContent = 'Confirmar y agendar cita';
          return;
        }
        r = await api(`/agenda/${b.id}`, { method: 'PUT', body: { ...body, autorizar_tercer_intento: { motivo } } });
      }
      (r.avisos || []).forEach((a) => toast(a, 'err'));
      guardadoExitoso = true;
      window.removeEventListener('keydown', onEscapeModal);
      const aviso = avisoCorreoCita(r.correo);
      toast(aviso.texto, aviso.tipo);
      cerrarModal();
      alGuardar && alGuardar();
    } catch (e) {
      $('#btn-guardar').disabled = false;
      $('#btn-guardar').textContent = 'Confirmar y agendar cita';
      toast(e.message, 'err');
      if (e.status === 409 && e.data && e.data.bloque) { editorSlot(e.data.bloque, alGuardar); }
    }
  };
}
async function abrirSlotPorId(id, alGuardar) {
  try {
    const idNum = Number(id);
    if (!idNum) return;
    if (typeof META === 'undefined' || !META || !META.catalogos) {
      try {
        META = await api('/meta');
      } catch (_) {}
    }
    const bloque = await api(`/agenda/${idNum}`);
    if (!bloque) {
      if (typeof toast === 'function') toast('No se encontró el bloque seleccionado', 'err');
      return;
    }
    editorSlot(bloque, alGuardar);
  } catch (err) {
    console.error('Error al abrir bloque:', err);
    if (typeof toast === 'function') toast(err.message || 'Error al abrir bloque', 'err');
  }
}

window.abrirSlotPorId = abrirSlotPorId;
window.abrirFormularioCita = abrirFormularioCita;
window.editorSlot = editorSlot;

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

// Delegación global infalible para cualquier botón de agendar en cualquier tabla o vista
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-agendar-tabla, [data-accion="agendar"]');
    if (!btn) return;
    const id = Number(btn.dataset.id || btn.getAttribute('data-id'));
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    abrirSlotPorId(id, () => {
      if (typeof renderAgenda === 'function' && document.getElementById('a-grid')) {
        renderAgenda();
      } else if (typeof renderDisponibles === 'function' && document.getElementById('tabla-disponibles-main')) {
        const btnB = document.getElementById('d-buscar');
        if (btnB) btnB.click();
      }
    });
  });

  // Atajo de teclado para agendar: tecla 'A' o 'Enter' sobre una fila seleccionada o libre
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (document.querySelector('#modal-root .overlay')) return;

    const esTeclaAgendar = e.key === 'a' || e.key === 'A' || e.key === 'Insert';
    const esEnterEnFila = e.key === 'Enter' && !e.target.closest('button, a');

    if (esTeclaAgendar || esEnterEnFila) {
      const activa = document.querySelector('.fila-agenda-tabla.row-activa');
      if (activa) {
        const btn = activa.querySelector('.btn-agendar-tabla, [data-accion="agendar"]');
        if (btn) {
          e.preventDefault();
          btn.click();
          return;
        }
      }

      if (esTeclaAgendar) {
        const primerBtn = document.querySelector('#d-body .btn-agendar-tabla, #a-grid .btn-agendar-tabla');
        if (primerBtn) {
          e.preventDefault();
          primerBtn.click();
        }
      }
    }
  });
}
