/* ================= Corrección rápida de datos (dentro de Reporte de errores) =================
   Usa helpers globales de app.js en tiempo de ejecución: api, toast, esc, fFecha, nom, abrirSlotPorId.
   Guarda con PATCH /agenda/:id/contacto (solo correo, teléfono y nombre, con validación en el servidor). */
'use strict';

const Limpieza = (() => {
  const ETQ = {
    CORREO_INVALIDO: 'Correo inválido', TELEFONO_INCOMPLETO: 'Teléfono incompleto',
    NOMBRE: 'Nombre mal escrito', RUT_INVALIDO: 'RUT inválido',
  };
  const MAX_VISIBLES = 300;
  let filtro = '';

  const fila = (f) => `<tr data-id="${f.id}" data-visto="${esc(f.actualizado_en || '')}">
      <td class="c">${esc(fFecha(f.fecha))}<div class="muted" style="font-size:.78rem">${esc(f.hora)}</div></td>
      <td>${f.problemas.map((p) => `<span class="sev warning">${esc(ETQ[p] || p)}</span>`).join(' ')}</td>
      <td>${esc(f.rut || '')}</td>
      <td><input class="lz-in" data-campo="nombre" value="${esc(f.nombre || '')}"></td>
      <td><input class="lz-in" data-campo="contacto" value="${esc(f.contacto || '')}" inputmode="tel"></td>
      <td><input class="lz-in" data-campo="correo" value="${esc(f.correo || '')}" inputmode="email"></td>
      <td class="c lz-acc"><button class="btn chico" data-guardar>Guardar</button>
        <button class="btn chico sec" data-abrir>Abrir</button></td></tr>`;

  async function guardar(tr, recargar) {
    const body = { visto_en: tr.dataset.visto || undefined };
    tr.querySelectorAll('.lz-in').forEach((inp) => {
      if (inp.value !== inp.defaultValue) body[inp.dataset.campo] = inp.value;
    });
    if (Object.keys(body).length === 1) { toast('No hay cambios en esta fila', 'err'); return; }
    try {
      await api(`/agenda/${tr.dataset.id}/contacto`, { method: 'PATCH', body });
      toast('Datos corregidos');
      recargar();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function vaciarCorreos(n, recargar) {
    if (!confirm(`Se borrará el correo de ${n} cita(s) con formato inválido (se hace un respaldo antes). ¿Continuar?`)) return;
    try {
      const r = await api('/limpieza/vaciar-correos-invalidos', { method: 'POST', body: { confirmar: true } });
      toast(`${r.vaciados} correo(s) inválido(s) vaciado(s). Respaldo creado.`);
      recargar();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function render(cont) {
    if (!cont) return;
    cont.innerHTML = '<div class="panel"><h3 style="margin-top:0">Corrección rápida</h3><p class="muted">Cargando...</p></div>';
    const recargar = () => render(cont);
    let datos;
    try { datos = await api('/limpieza'); } catch (e) { cont.innerHTML = `<div class="panel"><p class="muted">${esc(e.message)}</p></div>`; return; }
    const conteo = {};
    datos.filas.forEach((f) => f.problemas.forEach((p) => { conteo[p] = (conteo[p] || 0) + 1; }));
    const visibles = datos.filas.filter((f) => !filtro || f.problemas.includes(filtro));
    const nCorreos = conteo.CORREO_INVALIDO || 0;
    cont.innerHTML = `<div class="panel">
      <div class="fila"><h3 style="margin:0;flex:1">Corrección rápida</h3>
        <button class="btn sec" id="lz-vaciar" ${nCorreos ? '' : 'disabled'}>Vaciar correos inválidos (${nCorreos})</button></div>
      <p class="muted" style="font-size:.82rem">Corrige correo, teléfono y nombre directo en la fila y pulsa <b>Guardar</b>. Para el RUT usa <b>Abrir</b>.</p>
      <div class="chips" id="lz-chips" style="margin:.4rem 0">
        <button class="chip" data-t="">Todos (${datos.total})</button>
        ${Object.entries(conteo).map(([t, n]) => `<button class="chip" data-t="${t}">${esc(ETQ[t] || t)} (${n})</button>`).join('')}
      </div>
      <div class="tabla-scroll"><table class="tabla-limpieza"><thead><tr>
        <th class="c">Fecha</th><th>Problema</th><th>RUT</th><th>Nombre</th><th>Teléfono</th><th>Correo</th><th></th>
      </tr></thead><tbody>${visibles.length ? visibles.slice(0, MAX_VISIBLES).map(fila).join('')
        : '<tr><td colspan="7" class="muted">Sin datos por corregir.</td></tr>'}</tbody></table></div></div>`;
    cont.querySelectorAll('#lz-chips button').forEach((b) => { b.onclick = () => { filtro = b.dataset.t; recargar(); }; });
    cont.querySelector('#lz-vaciar').onclick = () => vaciarCorreos(nCorreos, recargar);
    cont.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
      tr.querySelector('[data-guardar]').onclick = () => guardar(tr, recargar);
      tr.querySelector('[data-abrir]').onclick = () => abrirSlotPorId(Number(tr.dataset.id), recargar);
      tr.querySelectorAll('.lz-in').forEach((inp) => {
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') guardar(tr, recargar); });
      });
    });
  }

  return { render };
})();
window.Limpieza = Limpieza;
