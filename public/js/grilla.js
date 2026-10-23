function problemaDatos(b) {
  if (b.rut && !rutEsValido(b.rut)) return 'RUT con dígito verificador inválido';
  if (!b.contacto && !b.correo) return 'Sin teléfono ni correo: no se puede avisar ni confirmar';
  if (b.contacto && b.contacto.replace(/\D/g, '').length !== 9) return 'Teléfono incompleto';
  return null;
}
// Historial del solicitante dentro del panel lateral de la ficha. Cada cita se puede abrir.
async function cargarHistorialCita(b, alGuardar) {
  const cont = $('#zona-hist-cita .hist-lista');
  if (!cont) return;
  const params = new URLSearchParams();
  if (b.rut) params.set('rut', b.rut);
  if (b.nombre) params.set('nombre', b.nombre);
  try {
    const rows = await api(`/buscar-historial?${params.toString()}`);
    if (!document.body.contains(cont)) return;
    if (!Array.isArray(rows) || !rows.length) { cont.textContent = 'Sin citas registradas'; return; }
    pintarAvisoIntento(b, rows);
    cont.innerHTML = rows.map((r) => {
      const actual = r.id === b.id;
      return `<div class="hist-item ${actual ? 'actual' : ''}" ${actual ? '' : `role="button" tabindex="0" data-id="${r.id}"`}>
        <div class="hist-fila"><b>${esc(fFecha(r.fecha))}</b> · ${esc(r.hora)} hrs${actual ? '<span class="badge reag">Cita actual</span>' : ''}<span class="hist-clase">${esc(r.clase || '-')}</span></div>
        <div class="hist-sub">Examinador: ${esc(r.examinador || '-')}</div>
        <div class="hist-sub">Resultado: <b>${esc(r.resultado || 'Sin resultado')}</b></div>
        <div class="hist-sub">Inicio trámite: <b>${r.fecha_inicio_tramite ? esc(fFecha(r.fecha_inicio_tramite)) : 'Sin registrar'}</b>${r.fecha_vencimiento_tramite ? ` · Vence: <b>${esc(fFecha(r.fecha_vencimiento_tramite))}</b>` : ''}</div>
        ${r.dias_restantes_tramite != null ? `<div class="hist-sub">${cuentaRegresivaHtml(r.dias_restantes_tramite, r.fecha_vencimiento_tramite)}</div>` : ''}
        ${r.escuela_conductores ? `<div class="hist-sub">Escuela: ${esc(r.escuela_conductores)}</div>` : ''}
        ${r.tipo_reagendamiento ? `<div class="hist-sub">Reagendamiento: ${esc(r.tipo_reagendamiento)}</div>` : ''}
        ${(r.alerts || []).length ? `<div class="hist-sub">${alertasHtml(r)}</div>` : ''}
      </div>`;
    }).join('');
    cont.querySelectorAll('.hist-item[data-id]').forEach((el) => {
      const abrir = () => abrirSlotPorId(Number(el.dataset.id), alGuardar).catch((e) => toast(e.message, 'err'));
      el.onclick = abrir;
      el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); } };
    });
  } catch (e) {
    if (document.body.contains(cont)) cont.textContent = 'No se pudo cargar el historial';
  }
}

// Reprobaciones previas (mismo RUT, alguna clase en comun) antes de esta cita.
// Casillas "Avisado por": medios por los que se aviso al postulante (telefono, whatsapp, correo).
const MEDIOS_AVISO = [['telefono', 'Teléfono'], ['whatsapp', 'WhatsApp'], ['correo', 'Correo']];
function avisosHtml(b) {
  const on = new Set(String(b.avisado_por || '').split(',').filter(Boolean));
  const hay = { telefono: !!b.contacto, whatsapp: !!b.contacto, correo: !!b.correo };
  const disp = MEDIOS_AVISO.filter(([m]) => hay[m]);
  const todos = disp.length > 0 && disp.every(([m]) => on.has(m));
  const casilla = ([m, etq]) => `<label class="aviso-chk${hay[m] ? '' : ' sin'}" title="${hay[m] ? 'Marcar si se avisó por ' + etq : 'Sin ' + (m === 'correo' ? 'correo' : 'teléfono') + ' registrado'}">
      <input type="checkbox" data-aviso="${m}" ${on.has(m) ? 'checked' : ''} ${hay[m] ? '' : 'disabled'}>${etq}</label>`;
  return `<div class="slot-avisos" data-id="${b.id}" onclick="event.stopPropagation()"><span class="aviso-tit">Avisado:</span>
    ${MEDIOS_AVISO.map(casilla).join('')}
    <label class="aviso-chk aviso-todos" title="Marcar o desmarcar todos los medios disponibles"><input type="checkbox" data-aviso="todos" ${todos ? 'checked' : ''} ${disp.length ? '' : 'disabled'}>Todos</label></div>`;
}

const RESULTADOS_REPROBADO = ['REPROBADO', 'REPROBADO INASISTENCIA'];
function reprobacionesPrevias(b, rows) {
  if (!b.rut) return 0;
  const clases = clasesDe(b.clase);
  return rows.filter((r) => r.id !== b.id && r.fecha <= b.fecha
    && RESULTADOS_REPROBADO.includes(r.resultado)
    && clasesDe(r.clase).some((c) => clases.includes(c))).length;
}
const ordinalIntento = (n) => (n === 3 ? '3er' : `${n}°`);
// Aviso (no bloquea): con 2+ reprobaciones previas en la misma clase, este es el 3er intento o mas.
function pintarAvisoIntento(b, rows) {
  const zona = $('#f-intento-aviso');
  const previas = reprobacionesPrevias(b, rows);
  if (!zona || previas < 2) return;
  zona.innerHTML = `<span class="badge reprob" title="${previas} reprobaciones previas en la misma clase">⚠ ${ordinalIntento(previas + 1)} intento</span>`;
  zona.hidden = false;
}

// Ficha imprimible: documento municipal con datos del postulante + historial, en una ventana aparte.
const siNo = (v) => (v === 1 ? 'SÍ' : v === 0 ? 'NO' : '');
function estadoTramiteTxt(b) {
  const d = b.dias_restantes_tramite;
  if (d == null) return b.fecha_inicio_tramite ? '' : 'Sin fecha de inicio registrada';
  return d <= 0 ? `VENCIDO (hace ${diasTxt(-d)})` : `Vigente · quedan ${diasTxt(d)}`;
}
const FICHA_SECCIONES = [
  ['Datos personales', [
    ['Nombre', (b) => nom(b.nombre)], ['RUT', (b) => b.rut],
    ['Teléfono', (b) => fTel(b.contacto)], ['Correo', (b) => b.correo],
  ]],
  ['Trámite', [
    ['Clase(s)', (b) => b.clase], ['Escuela de conductores', (b) => b.escuela_conductores],
    ['Fecha de inicio', (b) => (b.fecha_inicio_tramite ? fFecha(b.fecha_inicio_tramite) : '')],
    ['Fecha de vencimiento', (b) => (b.fecha_vencimiento_tramite ? fFecha(b.fecha_vencimiento_tramite) : '')],
    ['Estado / días restantes', estadoTramiteTxt], ['Intento', (b) => b.intento],
    ['Tipo de cita', (b) => b.tipo_cita], ['Tipo de reagendamiento', (b) => b.tipo_reagendamiento],
  ]],
  ['Resultado', [
    ['Confirmó asistencia', (b) => siNo(b.confirmo_asistencia)], ['Resultado', (b) => b.resultado],
    ['Comentarios', (b) => b.comentarios, true],
  ]],
];
const FICHA_CSS = `@page{size:A4;margin:16mm 15mm 18mm}
*{box-sizing:border-box}body{font:10.5pt/1.4 "Segoe UI",Arial,Helvetica,sans-serif;color:#000;background:#fff;margin:0}
.doc-hd{display:flex;align-items:center;gap:14px;border-bottom:2px solid #000;padding-bottom:10px}
.doc-hd img{height:64px;width:auto}.doc-hd .org{flex:1}.doc-hd .org b{display:block;font-size:11pt;letter-spacing:.02em}
.doc-hd .org span{font-size:9pt;color:#333}.doc-hd .emi{font-size:8.5pt;text-align:right;color:#333;white-space:nowrap}
h1{font:700 15pt/1.25 Georgia,"Times New Roman",serif;text-align:center;margin:16px 0 2px}
.sub{text-align:center;font-size:9pt;color:#333;margin:0 0 14px}
.cita{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #000;margin-bottom:12px}
.cita div{padding:6px 8px;border-right:1px solid #999}.cita div:last-child{border-right:0}
.lbl{display:block;font-size:7.5pt;text-transform:uppercase;letter-spacing:.05em;color:#444}
.val{font-weight:600}h2{font:700 11pt Georgia,"Times New Roman",serif;border-bottom:1px solid #000;margin:14px 0 6px;padding-bottom:2px}
.grid{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #bbb;border-left:1px solid #bbb}
.grid div{padding:5px 8px;border-right:1px solid #bbb;border-bottom:1px solid #bbb;break-inside:avoid}.grid .ancho{grid-column:1/-1}
table{border-collapse:collapse;width:100%;font-size:9pt}th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#e9e9e9;font-size:8pt;text-transform:uppercase;letter-spacing:.03em}tbody tr:nth-child(even) td{background:#f5f5f5}
tr{break-inside:avoid;page-break-inside:avoid}thead{display:table-header-group}
.firmas{display:flex;gap:60px;margin-top:60px;break-inside:avoid}.firmas div{flex:1;border-top:1px solid #000;text-align:center;padding-top:4px;font-size:9pt}
.pie{margin-top:24px;border-top:1px solid #999;padding-top:4px;font-size:8pt;color:#444;display:flex;justify-content:space-between}
@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
function fichaImprimibleHtml(b, rows, logoUrl) {
  const ahora = new Date();
  const emitido = `${fFecha(hoy())} ${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')} hrs`;
  const celda = (t, v, ancho) => `<div${ancho ? ' class="ancho"' : ''}><span class="lbl">${esc(t)}</span><span class="val">${esc(v || '—')}</span></div>`;
  const cita = [['Fecha', fFecha(b.fecha)], ['Hora', b.hora ? `${b.hora} hrs` : ''], ['Examinador/a', b.examinador], ['Funcionario/a', b.funcionario]]
    .map(([t, v]) => celda(t, v)).join('');
  const secciones = FICHA_SECCIONES.map(([titulo, campos]) => `<h2>${esc(titulo)}</h2>
    <div class="grid">${campos.map(([t, f, ancho]) => celda(t, f(b), ancho)).join('')}</div>`).join('');
  const hist = rows.length ? rows.map((r) => `<tr>
    <td>${esc(fFecha(r.fecha))} ${esc(r.hora || '')}</td><td>${esc(r.clase || '—')}</td><td>${r.fecha_inicio_tramite ? esc(fFecha(r.fecha_inicio_tramite)) : '—'}</td><td>${r.fecha_vencimiento_tramite ? esc(fFecha(r.fecha_vencimiento_tramite)) : '—'}</td><td>${esc(r.examinador || '—')}</td>
    <td>${esc(r.resultado || 'Sin resultado')}</td><td>${esc(r.escuela_conductores || '—')}</td><td>${esc(r.comentarios || '')}</td></tr>`).join('')
    : '<tr><td colspan="8">Sin citas registradas</td></tr>';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ficha ${esc(nom(b.nombre))}</title>
    <style>${FICHA_CSS}</style></head><body>
    <header class="doc-hd"><img id="ficha-logo" src="${esc(logoUrl)}" alt="${esc(MARCA.organismo)}">
      <div class="org"><b>Ilustre ${esc(MARCA.organismo)}</b><span>Dirección de Tránsito y Transporte Público · ${esc(MARCA.unidad)}</span></div>
      <div class="emi">Emitido el<br>${esc(emitido)}</div></header>
    <h1>Ficha del Postulante — Examen Práctico de Conducir</h1>
    <p class="sub">Dirección de Tránsito y Transporte Público — Ilustre ${esc(MARCA.organismo)}</p>
    <div class="cita">${cita}</div>
    ${secciones}
    <h2>Historial de citas</h2>
    <table><thead><tr><th>Fecha</th><th>Clase</th><th>Inicio trámite</th><th>Término trámite</th><th>Examinador/a</th><th>Resultado</th><th>Escuela</th><th>Comentarios</th></tr></thead>
    <tbody>${hist}</tbody></table>
    <div class="firmas"><div>Firma funcionario/a</div><div>Firma postulante</div></div>
    <footer class="pie"><span>Documento generado por Agenda de Prácticos</span></footer>
    </body></html>`;
}
async function imprimirFicha(b) {
  const params = new URLSearchParams();
  if (b.rut) params.set('rut', b.rut);
  if (b.nombre) params.set('nombre', b.nombre);
  const rows = await api(`/buscar-historial?${params.toString()}`);
  const w = window.open('', '_blank');
  if (!w) { toast('El navegador bloqueó la ventana de impresión', 'err'); return; }
  w.document.write(fichaImprimibleHtml(b, Array.isArray(rows) ? rows : [], `${location.origin}/logo.png`));
  w.document.close();
  w.focus();
  // Espera a que cargue el logo (o falle) antes de imprimir, con tope de 3 s.
  const img = w.document.getElementById('ficha-logo');
  let impreso = false;
  const imprimir = () => { if (!impreso) { impreso = true; w.print(); } };
  if (!img || img.complete) { imprimir(); return; }
  img.addEventListener('load', imprimir);
  img.addEventListener('error', () => { img.remove(); imprimir(); });
  setTimeout(imprimir, 3000);
}

// Esc cierra el panel lateral de la ficha.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.querySelector('#modal-root .modal.lateral')) cerrarModal();
});

function claseFamilia(c) {
  const x = String(c || '').toUpperCase();
  if (x === 'D' || x === 'A5') return 'pesada';
  if (x === 'E') return 'prof';
  if (x.startsWith('A')) return 'moto';
  return 'liviana';
}
// Una cita puede tener varias clases marcadas ("B,A2"): una etiqueta por cada una.
function clasesTagsHtml(clase) {
  const lista = clasesDe(clase);
  if (!lista.length) return '—';
  return lista.map((cl) => `<span class="clase-tag ${claseFamilia(cl)}">${esc(cl)}</span>`).join(' ');
}

function pintarGrilla(cont, filas, fecha) {
  let exs = estadoAgenda.examinador_id
    ? META.examinadores.filter((e) => String(e.id) === String(estadoAgenda.examinador_id))
    : META.examinadores.filter((e) => e.activo);
  // En celular se muestra un examinador a la vez (el selector "Examinador" elige cuál).
  if (!estadoAgenda.examinador_id && exs.length > 1 && window.matchMedia && window.matchMedia('(max-width: 600px)').matches) {
    exs = exs.slice(0, 1);
    const sel = document.getElementById('a-exam');
    if (sel) sel.value = String(exs[0].id);
  }


  if (!filas.length) {
    cont.className = '';
    cont.style.gridTemplateColumns = '';
    const textoPeriodo = (filtAgenda && filtAgenda.esRango && filtAgenda.desde && filtAgenda.hasta && filtAgenda.desde !== filtAgenda.hasta)
      ? `el rango ${fFecha(filtAgenda.desde)} al ${fFecha(filtAgenda.hasta)}`
      : fFecha(fecha);
    cont.innerHTML = licoVacio('explica', 'Sin bloques en este período', `No hay bloques para ${textoPeriodo}. Puede ser fin de semana o feriado, o falta generar la grilla (pestaña Datos).`);
    return;
  }
  pintarTablaAgenda(cont, filas, fecha, exs);
}
// Marca (o borra, con resultado=null) el resultado de una cita preservando
// el resto de sus datos. Compartido entre la grilla y el check-in del dia.
async function marcarResultado(id, resultado) {
  await api(`/agenda/${id}/resultado`, { method: 'POST', body: { resultado } });
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// "2026-11-23" -> "lunes 23 de nov" (fecha local, sin desfase por zona horaria)
function fFechaAgenda(iso) {
  const [anio, mes, dia] = String(iso).split('-').map(Number);
  const fecha = new Date(anio, mes - 1, dia);
  return `${DIAS_SEMANA[fecha.getDay()]} ${dia} de ${MESES_CORTOS[mes - 1]}`;
}

// Licencias del catalogo; conserva la clase actual aunque no este en el catalogo
function clasesDisponibles(claseActual) {
  const clases = [...(META.catalogos.clase || [])];
  if (claseActual && !clases.includes(claseActual)) clases.unshift(claseActual);
  return clases;
}

// Nube de licencias: se abre al tocar CLASE; elegir una la guarda
let nubeClases = null;

function cerrarNubeClases() {
  if (!nubeClases) return;
  nubeClases.el.remove();
  document.removeEventListener('pointerdown', alPresionarFueraNube, true);
  document.removeEventListener('keydown', alPresionarTeclaNube, true);
  nubeClases = null;
}

function alPresionarFueraNube(e) {
  if (nubeClases && !nubeClases.el.contains(e.target) && !nubeClases.ancla.contains(e.target)) cerrarNubeClases();
}

function alPresionarTeclaNube(e) {
  if (e.key === 'Escape') cerrarNubeClases();
}

async function guardarClaseEnNube(b, valor) {
  if (valor === (b.clase || '')) return;
  try {
    if (!(await guardarCampoCita(b, 'clase', valor))) return;
    toast('Dato actualizado en la planilla', 'ok');
    if (window.renderAgenda) renderAgenda();
  } catch (e) {
    // Sin correo no se guarda la clase; la nube no muestra aviso y la celda conserva su valor
    if (!e.message.startsWith('Falta el correo')) toast(e.message, 'err');
  }
}

// Nube de licencias: se pueden marcar varias; OK guarda y cierra; clic fuera o Escape cancela
function abrirNubeClases(ancla, b) {
  cerrarNubeClases();
  const marcadas = new Set((b.clase || '').split(',').map((c) => c.trim()).filter(Boolean));
  const el = document.createElement('div');
  el.className = 'nube-clases';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Tipos de licencia');
  el.innerHTML = `${clasesDisponibles(b.clase)
    .map((c) => `<button type="button" class="nube-clase" aria-pressed="${marcadas.has(c)}" data-clase="${esc(c)}">${esc(c)}</button>`)
    .join('')}<button type="button" class="nube-ok">OK</button>`;
  document.body.appendChild(el);

  const r = ancla.getBoundingClientRect();
  const ancho = el.offsetWidth;
  el.style.top = `${r.bottom + 10}px`;
  el.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - ancho / 2), window.innerWidth - ancho - 8)}px`;

  el.addEventListener('click', (e) => {
    const licencia = e.target.closest('.nube-clase');
    if (licencia) {
      licencia.setAttribute('aria-pressed', String(licencia.getAttribute('aria-pressed') !== 'true'));
      return;
    }
    if (!e.target.closest('.nube-ok')) return;
    const elegidas = [...el.querySelectorAll('.nube-clase[aria-pressed="true"]')].map((btn) => btn.dataset.clase);
    if (!elegidas.length) {
      toast('Elige al menos una licencia', 'err');
      return;
    }
    cerrarNubeClases();
    guardarClaseEnNube(b, elegidas.join(','));
  });
  el.addEventListener('keydown', (e) => {
    const controles = [...el.querySelectorAll('.nube-clase, .nube-ok')];
    const i = controles.indexOf(document.activeElement);
    const salto = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!salto || i < 0) return;
    e.preventDefault();
    controles[(i + salto + controles.length) % controles.length].focus();
  });
  el.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !el.contains(e.relatedTarget)) cerrarNubeClases();
  });

  nubeClases = { el, ancla };
  document.addEventListener('pointerdown', alPresionarFueraNube, true);
  document.addEventListener('keydown', alPresionarTeclaNube, true);
  el.querySelector('.nube-clase').focus();
}

const CAMPOS_EDITABLES = {
  nombre: { label: 'Nombre completo', placeholder: 'NOMBRES Y APELLIDOS', requerido: true },
  rut: { label: 'RUT', placeholder: '12.345.678-9', requerido: true },
  contacto: { label: 'Teléfono celular', placeholder: '+56 9 XXXX XXXX' },
  correo: { label: 'Correo electrónico', placeholder: 'nombre@correo.cl' },
  clase: { label: 'Clase', placeholder: 'B, C, A2...' },
};

function valorCampoCita(b, campo) {
  if (campo === 'nombre') return nom(b.nombre) || '';
  return b[campo] || '';
}

function normalizarCampoCita(campo, valor) {
  const limpio = valor.trim();
  if (campo === 'nombre') return limpio.toUpperCase();
  if (campo === 'clase') return limpio.toUpperCase() || 'B';
  return limpio;
}

async function guardarCampoCita(b, campo, valor) {
  let slot = b;
  try { slot = await api(`/agenda/${b.id}`); } catch (_) {}
  const payload = { ...(slot || {}), [campo]: valor };
  const enviar = (body) => api(`/agenda/${b.id}`, { method: 'PUT', body });

  let r;
  try {
    r = await enviar(payload);
  } catch (err) {
    if (!(err.status === 409 && err.data && err.data.codigo === 'TERCER_INTENTO')) throw err;
    const motivo = await pedirAutorizacionTercerIntento(err.data);
    if (!motivo) return false;
    r = await enviar({ ...payload, autorizar_tercer_intento: { motivo } });
  }
  (r.avisos || []).forEach((a) => toast(a, 'err'));
  return true;
}

async function liberarCupoCita(b) {
  const desc = `${nom(b.nombre) || b.rut || 'cita'} (${fFecha(b.fecha)} ${b.hora})`;
  if (!confirm(`¿Estás seguro de liberar este cupo de "${desc}"?\n\nEl cupo quedará libre y disponible para ser citado nuevamente.`)) return;
  try {
    await api(`/agenda/${b.id}/liberar`, { method: 'POST', body: { motivo: 'Liberado desde edición rápida en planilla' } });
    toast('Cupo liberado exitosamente', 'ok');
    if (window.renderAgenda) renderAgenda();
  } catch (e) {
    toast(e.message, 'err');
  }
}

// Una sola barra de scroll lateral: la del pie del marco; sincronizada con la tabla
// Crea un cupo extra en la misma hora (p. ej. una hora que alcanza para dos personas) y abre su formulario.
async function agregarOtraPersona(id) {
  try {
    const { bloque } = await api(`/agenda/${id}/persona`, { method: 'POST' });
    if ($('#a-grid')) renderAgenda();
    await abrirSlotPorId(bloque.id, () => { if ($('#a-grid')) renderAgenda(); });
  } catch (e) {
    toast(e.message, 'err');
  }
}

function crearBarraLateralTabla(scrollEl) {
  const barra = document.createElement('div');
  barra.className = 'tabla-agenda-barra-lateral';
  barra.innerHTML = '<div></div>';
  scrollEl.after(barra);

  const ajustar = () => {
    barra.firstElementChild.style.width = `${scrollEl.scrollWidth}px`;
    barra.hidden = scrollEl.scrollWidth <= scrollEl.clientWidth;
  };
  barra.onscroll = () => { scrollEl.scrollLeft = barra.scrollLeft; };
  scrollEl.onscroll = () => { barra.scrollLeft = scrollEl.scrollLeft; };

  const observer = new ResizeObserver(ajustar);
  observer.observe(scrollEl);
  ajustar();
  return { observer };
}

function pintarTablaAgenda(cont, filas, fecha, exs) {
  cont.className = 'tabla-agenda-wrap';
  cont.style.gridTemplateColumns = '';

  // Ordenar filas por fecha (si hay rango), hora ascendente y luego examinador
  const ordenadas = [...filas].sort((a, b) => {
    if (a.fecha !== b.fecha) return (a.fecha || '').localeCompare(b.fecha || '');
    if (a.hora !== b.hora) return (a.hora || '').localeCompare(b.hora || '');
    return (Number(a.examinador_id || 0) - Number(b.examinador_id || 0)) || (Number(a.cupo || 1) - Number(b.cupo || 1));
  });

  let html = `
    <div class="tabla-agenda-card">
      <div class="tabla-agenda-scroll">
        <table class="tabla-agenda-elegante" id="tabla-agenda-main">
          <thead>
            <tr>
              <th class="th-hora es-rango">FECHA / HORA</th>
              <th class="th-nombre">NOMBRE DE CONTRIBUYENTE</th>
              <th class="th-rut">RUT</th>
              <th class="th-examinador">EXAMINADOR</th>
              <th class="th-clase">CLASE *</th>
              <th class="th-contacto">CONTACTO</th>
              <th class="th-correo">CORREO</th>
              <th class="th-avisos">AVISADO</th>
              <th class="th-confirmar">CONFIRMAR</th>
              <th class="th-resultado">RESULTADO</th>
              <th class="th-accion">ACCIÓN</th>
            </tr>
          </thead>
          <tbody>
  `;

  for (const b of ordenadas) {

    const ocupada = Boolean(b.rut || b.nombre);
    const bloqueada = Boolean(b.bloqueado);
    const examObj = META.examinadores.find((e) => e.id === b.examinador_id);
    const examNombre = b.examinador || (examObj ? examObj.nombre : 'AV. ARGENTINA');
    const pesada = b.hora === META.hora_d_a5;
    const esConfirmado = b.confirmo_asistencia === 1;
    const telWa = telWaDe(b.contacto);
    const mensajeWa = mensajeWaCita(b, examNombre);
    const mensajeSms = mensajeSmsCita(b, examNombre);
    const problema = problemaDatos(b);
    const noAsiste = b.resultado === 'NO ASISTIO' || b.resultado === 'REPROBADO INASISTENCIA';
    const avisadoSet = new Set(String(b.avisado_por || '').split(',').filter(Boolean));

    if (bloqueada) {
      html += `
        <tr class="fila-agenda-tabla fila-bloqueada" data-id="${b.id}" data-tipo="bloqueada" data-examinador="${b.examinador_id}">
          <td class="td-hora es-rango">
            <div class="fecha-slot-tabla">${esc(fFechaAgenda(b.fecha))}</div>
            <span class="hora-badge ${pesada ? 'hora-pesada' : ''}">
              ${esc(b.hora)}
              ${pesada ? '<span class="et-d">D·A5</span>' : ''}
            </span>
          </td>
          <td class="td-nombre">
            <span class="bloqueado-label">🔒 ${esc(b.bloqueo_motivo || 'BLOQUEADO')}</span>
          </td>
          <td class="td-rut text-muted">—</td>
          <td class="td-sede"><span class="sede-pill-badge">${esc(examNombre)}</span></td>
          <td class="td-clase text-muted">—</td>
          <td class="td-contacto text-muted">—</td>
          <td class="td-correo text-muted">—</td>
          <td class="td-avisos text-muted">—</td>
          <td class="td-confirmar text-muted">—</td>
          <td class="td-resultado"><span class="badge-bloq-tag">No disponible</span></td>
          <td class="td-accion text-muted">—</td>
        </tr>
      `;
    } else if (!ocupada) {
      html += `
        <tr class="fila-agenda-tabla fila-libre" data-id="${b.id}" data-tipo="libre" data-examinador="${b.examinador_id}">
          <td class="td-hora es-rango">
            <div class="fecha-slot-tabla">${esc(fFechaAgenda(b.fecha))}</div>
            <span class="hora-badge ${pesada ? 'hora-pesada' : ''}">
              ${esc(b.hora)}
              ${pesada ? '<span class="et-d">D·A5</span>' : ''}
            </span>
          </td>
          <td class="td-nombre">
            <span class="libre-label"><span class="punto-verde"></span> Disponible para agendar</span>
          </td>
          <td class="td-rut text-muted">—</td>
          <td class="td-sede"><span class="sede-pill-badge">${esc(examNombre)}</span></td>
          <td class="td-clase">${pesada ? '<span class="badge dpesada">D y A5</span>' : '<span class="text-muted">—</span>'}</td>
          <td class="td-contacto text-muted">—</td>
          <td class="td-correo text-muted">—</td>
          <td class="td-avisos text-muted">—</td>
          <td class="td-confirmar text-muted">—</td>
          <td class="td-resultado">
            <button type="button" class="btn-agendar-tabla" data-id="${b.id}" title="Agendar cita en este bloque">+ Agendar cita</button>
          </td>
          <td class="td-accion"></td>
        </tr>
      `;
    } else {
      // Cita ocupada
      const resCls = b.resultado === 'APROBADO' ? 'res-aprob' : (b.resultado === 'REPROBADO' || noAsiste) ? 'res-reprob' : '';

      // Cuenta regresiva / plazo trámite
      const plazoHtml = b.dias_restantes_tramite != null
        ? cuentaRegresivaHtml(b.dias_restantes_tramite, b.fecha_vencimiento_tramite)
        : '';

      // Avisos compactos
      const chkTel = `<label class="chk-aviso-mini ${b.contacto ? '' : 'sin'}" title="${b.contacto ? 'Avisado por Teléfono' : 'Sin teléfono'}"><input type="checkbox" data-aviso="telefono" ${avisadoSet.has('telefono') ? 'checked' : ''} ${b.contacto ? '' : 'disabled'}>Tel</label>`;
      const chkWa = `<label class="chk-aviso-mini ${b.contacto ? '' : 'sin'}" title="${b.contacto ? 'Avisado por mensaje de texto (SMS)' : 'Sin teléfono'}"><input type="checkbox" data-aviso="whatsapp" ${avisadoSet.has('whatsapp') ? 'checked' : ''} ${b.contacto ? '' : 'disabled'}>SMS</label>`;
      const chkMail = `<label class="chk-aviso-mini ${b.correo ? '' : 'sin'}" title="${b.correo ? 'Avisado por Correo' : 'Sin correo'}"><input type="checkbox" data-aviso="correo" ${avisadoSet.has('correo') ? 'checked' : ''} ${b.correo ? '' : 'disabled'}>Mail</label>`;

      // Formatear RUT y Teléfono sin posibilidad de salto de línea
      const rutFmt = b.rut ? esc(b.rut).replace(/-/g, '&#8209;') : 'sin RUT';
      const telFmt = b.contacto ? esc(fTel(b.contacto)).replace(/ /g, '&nbsp;') : '';
      // RUT o telefono con formato incorrecto: se marcan en rojo hasta corregirlos
      const errRut = errorDato('rut', b.rut);
      const errTel = errorDato('contacto', b.contacto);

      html += `
        <tr class="fila-agenda-tabla fila-ocupada ${resCls}" data-id="${b.id}" data-tipo="ocupada" data-examinador="${b.examinador_id}">
          <td class="td-hora es-rango">
            <div class="fecha-slot-tabla">${esc(fFechaAgenda(b.fecha))}</div>
            <span class="hora-badge ${pesada ? 'hora-pesada' : ''}">
              ${esc(b.hora)}
              ${pesada ? '<span class="et-d">D·A5</span>' : ''}
            </span>
          </td>
          <td class="td-nombre">
            <div class="nombre-cell-box">
              <div class="nombre-cell-top">
                ${problema ? `<span class="alerta-dato" title="${esc(problema)}">⚠</span>` : ''}
                <span class="nombre-contribuyente" data-valor="nombre">${esc(nom(b.nombre) || '(SIN NOMBRE)')}</span>
              </div>
              <div class="nombre-cell-sub">
                ${plazoHtml ? `<span class="plazo-badge-wrap">${plazoHtml}</span>` : ''}
                ${(b.alerts || []).length ? `<span class="slot-alertas-mini">${alertasHtml(b)}</span>` : ''}
              </div>
            </div>
          </td>
          <td class="td-rut">
            <div class="rut-cell-box">
              <span class="rut-txt num ${errRut ? 'dato-invalido' : ''}" data-valor="rut" title="${esc(errRut || '')}">${rutFmt}</span>
            </div>
          </td>
          <td class="td-sede">
            <span class="sede-pill-badge">${esc(examNombre)}</span>
          </td>
          <td class="td-clase">
            <span class="clase-badge-tabla" data-valor="clase">${esc(b.clase || '—')}</span>
          </td>
          <td class="td-contacto">
            <div class="contacto-col-wrap">
              ${telFmt ? `<span class="tel-txt num ${errTel ? 'dato-invalido' : ''}" data-valor="contacto" title="${esc(errTel || '')}">${telFmt}</span>` : '<span class="sin-tel text-muted" data-valor="contacto">—</span>'}
              ${telWa ? `<a href="sms:+${telWa}?body=${encodeURIComponent(mensajeSms)}" class="btn-sms-tabla" onclick="event.stopPropagation()" title="Enviar mensaje de texto (SMS) a este postulante"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:middle;margin-right:3px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Mensaje de texto</a>` : ''}
            </div>
          </td>
          <td class="td-correo">
            ${b.correo
              ? `<span class="correo-txt" data-valor="correo" title="Clic para editar el correo">${esc(b.correo)}</span>`
              : '<span class="sin-correo" data-valor="correo" title="Clic para ingresar el correo">+ Agregar correo</span>'}
          </td>
          <td class="td-avisos">
            <div class="slot-avisos-tabla" data-id="${b.id}" onclick="event.stopPropagation()">
              ${chkTel}
              ${chkWa}
              ${chkMail}
            </div>
          </td>
          <td class="td-confirmar">
            ${b.confirmo_asistencia === 1 ? `
              <button type="button" class="btn-confirmar-tabla es-confirmado" data-act="modificar-confirmacion" data-id="${b.id}" title="Hora confirmada. Clic para volver a seleccionar">
                <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>
                <span>Confirma hora</span>
              </button>
            ` : b.confirmo_asistencia === 0 ? `
              <button type="button" class="btn-confirmar-tabla es-sin-confirmacion" data-act="enviar-sin-confirmacion" data-id="${b.id}" title="Sin confirmación. Clic para enviar aviso o cambiar estado">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <span>Sin confirmación enviar</span>
              </button>
            ` : `
              <div class="confirmar-pills-pair" data-id="${b.id}">
                <button type="button" class="btn-conf-tab tab-confirmado" data-act="elegir-confirmado" data-id="${b.id}" title="Marcar como Confirmado">Confirmado</button>
                <button type="button" class="btn-conf-tab tab-sin-confirmar" data-act="elegir-sin-confirmar" data-id="${b.id}" title="Marcar Sin confirmación">Sin confirmación</button>
              </div>
            `}
          </td>
          <td class="td-resultado">
            <div class="resultado-celda-wrap">
              <div class="slot-res tabla-slot-res" data-id="${b.id}">
                <span class="sr sr-a ${b.resultado === 'APROBADO' ? 'on' : ''}" role="button" tabindex="0" data-r="APROBADO" title="Marcar Aprobado">Aprobó</span>
                <span class="sr sr-r ${b.resultado === 'REPROBADO' ? 'on' : ''}" role="button" tabindex="0" data-r="REPROBADO" title="Marcar Reprobado">Reprobó</span>
                <span class="sr sr-n ${noAsiste ? 'on' : ''}" role="button" tabindex="0" data-r="NO ASISTIO" title="Marcar No asistió">No asistió</span>
              </div>
            </div>
          </td>
          <td class="td-accion">
            <div class="accion-celda-wrap">
              <button type="button" class="btn-tabla-liberar" data-id="${b.id}" title="Liberar este cupo" aria-label="Liberar este cupo">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
              </button>
              <button type="button" class="btn-tabla-reagendar" data-id="${b.id}" title="Derivar directamente a Reagendar" aria-label="Derivar directamente a Reagendar">
                <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>
              </button>
              <button type="button" class="btn-tabla-persona" data-id="${b.id}" title="Agregar otra persona a esta hora" aria-label="Agregar otra persona a esta hora">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M19 8v6M16 11h6"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }
  }

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  cont.innerHTML = html;

  const scrollEl = cont.querySelector('.tabla-agenda-scroll');
  if (scrollEl) scrollEl.scrollLeft = 0;
  cont._barraLateral?.observer.disconnect();
  cont._barraLateral = scrollEl ? crearBarraLateralTabla(scrollEl) : null;

  const mapaSlots = new Map(ordenadas.map((item) => [item.id, item]));

  function iniciarEdicionCelda(tr, campo) {
    const b = mapaSlots.get(Number(tr.dataset.id));
    const cfg = CAMPOS_EDITABLES[campo];
    const valorEl = tr.querySelector(`[data-valor="${campo}"]`);
    if (!b || !cfg || !valorEl || tr.querySelector('.celda-edicion')) return;
    if (campo === 'clase') {
      abrirNubeClases(valorEl, b);
      return;
    }

    const original = valorEl.cloneNode(true);
    const editor = document.createElement('span');
    editor.className = 'celda-edicion';
    editor.dataset.campo = campo;
    editor.innerHTML = `<input type="text" class="celda-edicion-input" value="${esc(valorCampoCita(b, campo))}" placeholder="${esc(cfg.placeholder)}" aria-label="${esc(cfg.label)}" autocomplete="off">`;
    valorEl.replaceWith(editor);

    const inp = editor.querySelector('.celda-edicion-input');
    // El campo se ajusta al largo del texto (ej. un telefono), sin ancho fijo
    const ajustarAncho = () => { inp.style.width = `${Math.max(8, inp.value.length + 2)}ch`; };
    ajustarAncho();
    inp.addEventListener('input', ajustarAncho);
    let guardando = false;
    let cancelado = false;
    const cancelar = () => {
      if (guardando) return;
      cancelado = true;
      editor.replaceWith(original);
    };

    if (campo === 'rut' && window.autoformatoRut) autoformatoRut(inp);
    if (campo === 'rut' && window.rutEnVivo) rutEnVivo(inp);

    // origen: 'enter' | 'tab' | 'fuera' (raton, touch o cambio de foco)
    const guardar = async (origen) => {
      if (guardando || cancelado) return;
      const valor = normalizarCampoCita(campo, inp.value);
      if (cfg.requerido && !valor) {
        if (origen === 'fuera') {
          cancelar();
          return;
        }
        toast(`${cfg.label} es obligatorio`, 'err');
        inp.focus();
        return;
      }
      // Con formato incorrecto no se guarda ni se sale: se queda editando hasta corregirlo (Esc cancela)
      const errorFormato = errorDato(campo, valor);
      if (errorFormato) {
        toast(errorFormato, 'err');
        inp.focus();
        return;
      }
      if (valor === valorCampoCita(b, campo)) {
        cancelar();
        return;
      }
      guardando = true;
      inp.disabled = true;
      try {
        const guardado = await guardarCampoCita(b, campo, valor);
        if (!guardado) {
          guardando = false;
          inp.disabled = false;
          inp.focus();
          return;
        }
        toast('Dato actualizado en la planilla', 'ok');
        if (window.renderAgenda) renderAgenda();
      } catch (e) {
        guardando = false;
        inp.disabled = false;
        // Sin correo no se guarda: el campo vuelve a su valor anterior, sin aviso en la agenda
        if (e.message.startsWith('Falta el correo')) {
          cancelar();
          return;
        }
        inp.focus();
        toast(e.message, 'err');
      }
    };

    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); guardar('enter'); }
      if (ev.key === 'Escape') { ev.preventDefault(); cancelar(); }
      if (ev.key === 'Tab') guardar('tab');
    });
    inp.addEventListener('blur', () => guardar('fuera'));
    inp.focus();
    inp.select();
  }

  // 1. Filtro rápido de búsqueda en tiempo real
  const inpBusc = document.querySelector('#tabla-busc-input');
  if (inpBusc) {
    const filtrarBuscador = () => {
      const q = inpBusc.value.toLowerCase().trim();
      cont.querySelectorAll('.fila-agenda-tabla').forEach((tr) => {
        if (!q) {
          tr.style.display = '';
          return;
        }
        const str = (tr.textContent || '').toLowerCase();
        tr.style.display = str.includes(q) ? '' : 'none';
      });
      cont.querySelectorAll('.fila-separador-fecha').forEach((sep) => {
        if (!q) {
          sep.style.display = '';
          return;
        }
        let next = sep.nextElementSibling;
        let hasVisible = false;
        while (next && !next.classList.contains('fila-separador-fecha')) {
          if (next.classList.contains('fila-agenda-tabla') && next.style.display !== 'none') {
            hasVisible = true;
            break;
          }
          next = next.nextElementSibling;
        }
        sep.style.display = hasVisible ? '' : 'none';
      });
    };
    inpBusc.oninput = filtrarBuscador;
    if (inpBusc.value) filtrarBuscador();
  }

  // Filas: se seleccionan y cada dato se edita con su propio lápiz
  cont.querySelectorAll('.fila-agenda-tabla').forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.sr') || e.target.closest('input') || e.target.closest('label')) return;
      if (tr.classList.contains('fila-bloqueada')) {
        dialogoDesbloquearDia();
        return;
      }
      cont.querySelectorAll('.fila-agenda-tabla').forEach((r) => r.classList.remove('row-activa'));
      tr.classList.add('row-activa');
    };
  });

  cont.onclick = (e) => {
    const liberar = e.target.closest('.btn-tabla-liberar');
    if (liberar) {
      e.stopPropagation();
      liberarCupoCita(mapaSlots.get(Number(liberar.dataset.id)));
      return;
    }
    const persona = e.target.closest('.btn-tabla-persona');
    if (persona) {
      e.stopPropagation();
      agregarOtraPersona(Number(persona.dataset.id));
      return;
    }
    const dato = e.target.closest('.fila-ocupada [data-valor]');
    if (!dato) return;
    e.stopPropagation();
    iniciarEdicionCelda(dato.closest('.fila-ocupada'), dato.dataset.valor);
  };

  cont.querySelectorAll('.btn-agendar-tabla').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      abrirSlotPorId(id, () => { if ($('#a-grid')) renderAgenda(); }).catch((err) => toast(err.message, 'err'));
    };
  });

  // 4. Marcado de resultados interactivo
  cont.querySelectorAll('.tabla-slot-res .sr').forEach((el) => {
    el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.click(); } };
    el.onclick = async (ev) => {
      ev.stopPropagation();
      const box = el.closest('.tabla-slot-res');
      const tr = el.closest('tr');
      const id = Number(box.dataset.id);
      const quitar = el.classList.contains('on');
      const antes = { on: [...box.querySelectorAll('.sr.on')], cls: tr.className };
      box.querySelectorAll('.sr').forEach((s) => s.classList.remove('on'));
      tr.classList.remove('res-aprob', 'res-reprob');
      if (!quitar) {
        el.classList.add('on');
        tr.classList.add(el.dataset.r === 'APROBADO' ? 'res-aprob' : 'res-reprob');
      }
      try {
        await marcarResultado(id, quitar ? null : el.dataset.r);
        if (!quitar && el.dataset.r === 'APROBADO') licoConfeti(el);
        toast(quitar ? 'Resultado borrado' : `Marcado: ${el.dataset.r === 'NO ASISTIO' ? 'No asistió' : el.dataset.r === 'APROBADO' ? 'Aprobó' : 'Reprobó'}`);
      } catch (e) {
        box.querySelectorAll('.sr').forEach((s) => s.classList.remove('on'));
        antes.on.forEach((s) => s.classList.add('on'));
        tr.className = antes.cls;
        toast(e.message, 'err');
      }
    };
  });

  // 5. Botones y pestañas de confirmar asistencia
  cont.querySelectorAll('.btn-conf-tab[data-act="elegir-confirmado"]').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const id = Number(btn.dataset.id);
      try {
        await api(`/agenda/${id}/confirmar`, { method: 'POST', body: { valor: 1 } });
        toast('Hora confirmada exitosamente', 'ok');
        actualizarBadgePorConfirmar();
        renderAgenda();
      } catch (e) { toast(e.message, 'err'); }
    };
  });

  cont.querySelectorAll('.btn-conf-tab[data-act="elegir-sin-confirmar"]').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const id = Number(btn.dataset.id);
      try {
        await api(`/agenda/${id}/confirmar`, { method: 'POST', body: { valor: 0 } });
        toast('Cita marcada: Sin confirmación', 'alerta');
        actualizarBadgePorConfirmar();
        renderAgenda();
      } catch (e) { toast(e.message, 'err'); }
    };
  });

  cont.querySelectorAll('.btn-confirmar-tabla[data-act="modificar-confirmacion"]').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const id = Number(btn.dataset.id);
      if (!confirm('Esta cita figura como "Confirma hora".\n\n¿Deseas volver a mostrar las opciones para cambiar su estado?')) return;
      try {
        await api(`/agenda/${id}/confirmar`, { method: 'POST', body: { valor: null } });
        toast('Opciones de confirmación restauradas', 'ok');
        actualizarBadgePorConfirmar();
        renderAgenda();
      } catch (e) { toast(e.message, 'err'); }
    };
  });

  cont.querySelectorAll('.btn-confirmar-tabla[data-act="enviar-sin-confirmacion"]').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const id = Number(btn.dataset.id);
      const b = mapaSlots.get(id);
      const nombre = b ? (nom(b.nombre) || b.rut || 'el postulante') : 'el postulante';

      if (b && b.correo) {
        const accion = confirm(`Cita sin confirmación de ${nombre}.\n\n¿Deseas enviar un correo de solicitud de confirmación a ${b.correo}?\n\n(Pulsa Cancelar para volver a mostrar las opciones de confirmación)`);
        if (accion) {
          try {
            await api('/correo/confirmacion-masiva', { method: 'POST', body: { ids: [id] } });
            toast(`Correo de confirmación enviado a ${b.correo}`, 'ok');
          } catch (e) {
            toast(e.message, 'err');
          }
          return;
        }
      } else if (b && b.contacto) {
        const accion = confirm(`Cita sin confirmación de ${nombre} (Teléfono: ${fTel(b.contacto)}).\n\n¿Deseas abrir SMS / mensaje de confirmación para este postulante?\n\n(Pulsa Cancelar para volver a mostrar las opciones de confirmación)`);
        if (accion) {
          const telWa = telWaDe(b.contacto);
          const examObj = META.examinadores.find((e) => e.id === b.examinador_id);
          const examNombre = b.examinador || (examObj ? examObj.nombre : '');
          const msg = mensajeSmsCita(b, examNombre);
          if (telWa) window.open(`sms:+${telWa}?body=${encodeURIComponent(msg)}`, '_blank');
          return;
        }
      }

      if (confirm(`¿Deseas volver a mostrar las opciones Confirmado / Sin confirmación para ${nombre}?`)) {
        try {
          await api(`/agenda/${id}/confirmar`, { method: 'POST', body: { valor: null } });
          toast('Opciones de confirmación restauradas', 'ok');
          actualizarBadgePorConfirmar();
          renderAgenda();
        } catch (e) { toast(e.message, 'err'); }
      }
    };
  });

  // 6. Checkboxes de avisos compactos
  cont.querySelectorAll('.slot-avisos-tabla input[data-aviso]').forEach((chk) => {
    chk.onchange = async (ev) => {
      ev.stopPropagation();
      const box = chk.closest('.slot-avisos-tabla');
      const id = Number(box.dataset.id);
      const medio = chk.dataset.aviso;
      const marcar = chk.checked;
      try {
        const res = await api(`/agenda/${id}/aviso`, { method: 'POST', body: { medio, avisado: marcar } });
        const lista = res.avisado_por || [];
        box.querySelectorAll('input[data-aviso]').forEach((i) => {
          i.checked = lista.includes(i.dataset.aviso);
        });
        toast(`Aviso por ${medio === 'telefono' ? 'teléfono' : medio} ${marcar ? 'marcado' : 'desmarcado'}`);
      } catch (e) {
        chk.checked = !marcar;
        toast(e.message, 'err');
      }
    };
  });

  // 7. Botón de reagendar directo desde la fila
  cont.querySelectorAll('.btn-tabla-reagendar').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const id = Number(btn.dataset.id);
      if (!confirm('¿Deseas derivar a este postulante a la Lista de Espera para reagendarle un nuevo cupo?')) return;
      try {
        await api(`/agenda/${id}/reagendar`, { method: 'POST', body: { motivo: 'POSTULANTE SOLICITA CAMBIO' } });
        toast('Postulante enviado a Lista de Espera con alta prioridad', 'ok');
        sessionStorage.setItem('le_destacado', String(id));
        actualizarBadgeReagendar();
        irA('espera');
      } catch (e) { toast(e.message, 'err'); }
    };
  });
}
