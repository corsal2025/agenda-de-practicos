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

// El funcionario/a "actual" viene del selector temporal de la sesion del navegador
// (funcionario-sesion.js): sin login propio, nunca se asume "el primero activo".
function funcionarioActual() {
  if (!META) return null;
  return window.FuncionarioSesion ? window.FuncionarioSesion.actual() : null;
}

function formularioCita(b, alGuardar) {
  const tieneCita = Boolean(b && (b.rut || b.nombre));
  if (tieneCita) {
    // Ficha de cita modal eliminada por solicitud del usuario para trabajar otro método
    return;
  }

  // Primera vez que se abre "Agendar nueva cita" en esta sesion del navegador sin un
  // funcionario/a elegido: se pide antes de mostrar el formulario (ver funcionario-sesion.js).
  const actual = funcionarioActual();
  if (!actual) {
    if (!window.FuncionarioSesion) return;
    window.FuncionarioSesion.elegirModal().then((elegido) => { if (elegido) formularioCita(b, alGuardar); });
    return;
  }

  abrirFormularioCita(b, alGuardar, actual);
}

function abrirFormularioCita(b, alGuardar, funcionarioSesion) {
  const c = META.catalogos;
  const fAsignado = (b.funcionario_id && (META.funcionarios || []).find((f) => f.id === b.funcionario_id))
    || funcionarioSesion
    || (b.funcionario ? { id: b.funcionario_id || null, nombre: b.funcionario } : null)
    || { id: null, nombre: 'Sin asignar' };
  const clasesIniciales = clasesDe(b.clase);
  const esPesada = clasesIniciales.some((cl) => META.clases_pesadas.includes(cl));

  modal(
    `Agendar nueva cita · ${fFecha(b.fecha)} · ${b.hora} hrs · Examinador/a: ${esc(b.examinador)}`,
    `
    <div class="cita-resumen-c" aria-label="Resumen de la cita">
      <div><span>Fecha</span><b>${esc(fFecha(b.fecha))}</b></div>
      <div><span>Hora</span><b>${esc(b.hora)} hrs</b></div>
      <div><span>Examinador/a</span><b>${esc(b.examinador)}</b></div>
      <div><span>Funcionario/a</span><b>${esc(funcionarioSesion.nombre)} · <a href="#" id="fs-cambiar">cambiar</a></b></div>
    </div>
    <div class="campo"><label>Nombre completo</label>
      <input id="f-nombre" value="${esc(nom(b.nombre))}" required placeholder="NOMBRES Y APELLIDOS" style="text-transform:uppercase;font-weight:600">
    </div>
    
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
      <div class="campo"><label>RUT</label>
        <input id="f-rut" value="${esc(b.rut)}" required placeholder="12.345.678-9" style="font-weight:600">
      </div>

      <div class="campo"><label>Celular</label>
        <input id="f-contacto" value="${esc(fTel(b.contacto))}" required placeholder="+56 9 1234 5678" inputmode="tel">
      </div>
    </div>

    <div class="campo ancho"><label>Licencias (puedes marcar varias)</label>
      <div class="chk-clases" id="f-clase">${c.clase.map((cl) => `
        <label class="chk-clase"><input type="checkbox" value="${esc(cl)}" ${clasesIniciales.includes(cl) ? 'checked' : ''}> ${esc(cl)}</label>
      `).join('')}</div>
    </div>

    <div class="campo"><label>Correo</label>
      <input id="f-correo" type="email" required placeholder="nombre@correo.com" value="${esc(b.correo)}">
    </div>

    <div class="campo ancho" id="zona-forzar" ${esPesada ? '' : 'hidden'}>
      <label><input type="checkbox" id="f-forzar"> <span id="f-forzar-txt">${esc(textoForzar(b))}</span></label>
    </div>
    ${(b.alerts || []).length ? `<div class="campo ancho">${alertasHtml(b)}</div>` : ''}
    <div class="campo ancho" id="f-intento-aviso" hidden></div>
    <div class="campo">
      <label for="f-fecha-inicio">Fecha de Inicio de Trámite *</label>
      <input type="date" id="f-fecha-inicio" required value="${esc(b.fecha_inicio_tramite || '')}" max="${hoy()}" style="width:100%;padding:.45rem .6rem;border:1px solid var(--linea);border-radius:6px">
      <div id="f-cuenta-tramite" class="cuenta-tramite-zona" aria-live="polite"></div>
    </div>
    <div class="campo" id="zona-escuela" ${esClaseTramite(b.clase) ? '' : 'hidden'}>
      <label for="f-escuela">Escuela de Conductores</label>
      <select id="f-escuela" style="width:100%;padding:.45rem .6rem;border:1px solid var(--linea);border-radius:6px">
        <option value="">-- Sin escuela --</option>
        ${c.escuela_conductores ? c.escuela_conductores.map((e) => `<option value="${esc(e)}" ${b.escuela_conductores === e ? 'selected' : ''}>${esc(e)}</option>`).join('') : ''}
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
  if ($('#fs-cambiar')) {
    $('#fs-cambiar').onclick = (e) => {
      e.preventDefault();
      cerrarModal();
      window.FuncionarioSesion.elegirModal().then((elegido) => { if (elegido) formularioCita(b, alGuardar); });
    };
  }
  $('#btn-guardar').onclick = async () => {
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
        funcionario_id: fAsignado.id || null,
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
      toast('Cita agendada exitosamente · Comprobante e instrucciones enviadas por correo', 'ok');
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
