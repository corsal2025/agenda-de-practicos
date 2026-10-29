/* ================= tab: DATOS ================= */
// Acciones de la pestaña: si el servidor falla se avisa con un toast de error (nunca una promesa rechazada).
async function crearBackup() {
  try {
    const r = await api('/backup', { method: 'POST' });
    toast('Backup: ' + r.archivo.split(/[\\/]/).pop());
  } catch (e) { toast(e.message, 'err'); }
}
async function generarBloques(desde, hasta) {
  try {
    const r = await api('/agenda/generar', { method: 'POST', body: { desde, hasta } });
    toast(`${r.creados} bloques nuevos en ${r.dias} dias habiles`);
    META = await api('/meta');
  } catch (e) { toast(e.message, 'err'); }
}
async function agregarFeriado(fecha, nombre) {
  try {
    await api('/feriados', { method: 'POST', body: { fecha, nombre } });
    META = await api('/meta');
  } catch (e) { toast(e.message, 'err'); return; }
  renderDatos();
}
async function borrarFeriado(fecha) {
  try {
    await api(`/feriados?fecha=${fecha}`, { method: 'DELETE' });
    META = await api('/meta');
  } catch (e) { toast(e.message, 'err'); return; }
  renderDatos();
}

async function cargarMetricasAdmin() {
  try {
    const r = await api('/admin/estado');
    if ($('#adm-rol')) $('#adm-rol').textContent = `Rol: ${r.rol || 'Administrador del Sistema'}`;
    if ($('#adm-met-citas')) $('#adm-met-citas').textContent = (r.metricas.total_citas || 0).toLocaleString('es-CL');
    if ($('#adm-met-bloques')) $('#adm-met-bloques').textContent = `de ${(r.metricas.total_bloques || 0).toLocaleString('es-CL')} bloques`;
    if ($('#adm-met-papelera')) $('#adm-met-papelera').textContent = (r.metricas.papelera_count || 0).toString();
    if ($('#adm-met-antigua')) $('#adm-met-antigua').textContent = `${r.metricas.papelera_antigua || 0} antiguos (>30d)`;
    if ($('#adm-met-integridad')) {
      const ok = r.metricas.bd_integridad === 'ok';
      $('#adm-met-integridad').textContent = ok ? 'Correcta (OK)' : esc(r.metricas.bd_integridad);
      $('#adm-met-integridad').style.color = ok ? 'var(--ok, #1f7a3d)' : 'var(--error, #ad2b2f)';
    }
    if ($('#adm-met-tamano')) $('#adm-met-tamano').textContent = `Tamaño BD: ${r.metricas.bd_tamano_formato || '—'}`;
    if ($('#adm-met-backup')) {
      const b = r.metricas.ultimo_backup;
      $('#adm-met-backup').textContent = b ? b.archivo.split(/[\\/]/).pop() : 'Sin respaldos aún';
      if (b) $('#adm-met-backup').title = b.archivo;
    }
    if ($('#adm-met-canal')) $('#adm-met-canal').textContent = `Canal correo: ${(r.metricas.modo_correo || 'auto').toUpperCase()}`;
  } catch (e) {
    console.warn('Error cargando métricas de admin:', e);
  }
}

async function renderDatos() {
  view.innerHTML = `
    <div class="panel panel-admin" style="border: 1px solid var(--azul-linea, #3a55c0); background: linear-gradient(180deg, var(--elev, #f5f7fd) 0%, var(--papel, #ffffff) 100%); box-shadow: 0 4px 14px rgba(38, 56, 140, 0.08); margin-bottom: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; border-bottom: 1px solid var(--linea, #d9def0); padding-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 38px; height: 38px; border-radius: 8px; background: var(--azul, #26388c); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: bold;">
            🛡️
          </div>
          <div>
            <h2 style="margin: 0; font-size: 18px; color: var(--azul-900, #1a2766);">Perfil Administrador & Mantenimiento</h2>
            <span class="muted" style="font-size: 12px;">Operaciones avanzadas, optimización de base de datos y respaldos</span>
          </div>
        </div>
        <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; background: var(--ok-bg, #e7f4ec); border: 1px solid var(--ok-bd, #bfe1c9); border-radius: 999px; color: var(--ok, #1f7a3d); font-weight: 600; font-size: 13px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--ok, #1f7a3d);"></span>
          <span id="adm-rol">Rol: Administrador del Sistema</span>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px;" id="adm-metricas">
        <div style="padding: 12px; background: var(--papel, #ffffff); border: 1px solid var(--linea, #d9def0); border-radius: 8px;">
          <div class="muted" style="font-size: 11px; text-transform: uppercase; font-weight: 600;">Citas Activas</div>
          <div style="font-size: 22px; font-weight: 700; color: var(--azul, #26388c);" id="adm-met-citas">—</div>
          <div class="muted" style="font-size: 11px;" id="adm-met-bloques">de — bloques</div>
        </div>
        <div style="padding: 12px; background: var(--papel, #ffffff); border: 1px solid var(--linea, #d9def0); border-radius: 8px;">
          <div class="muted" style="font-size: 11px; text-transform: uppercase; font-weight: 600;">En Papelera</div>
          <div style="font-size: 22px; font-weight: 700; color: var(--tinta, #1b2140);" id="adm-met-papelera">—</div>
          <div class="muted" style="font-size: 11px;" id="adm-met-antigua">— antiguos (>30d)</div>
        </div>
        <div style="padding: 12px; background: var(--papel, #ffffff); border: 1px solid var(--linea, #d9def0); border-radius: 8px;">
          <div class="muted" style="font-size: 11px; text-transform: uppercase; font-weight: 600;">Integridad BD</div>
          <div style="font-size: 22px; font-weight: 700; color: var(--ok, #1f7a3d);" id="adm-met-integridad">—</div>
          <div class="muted" style="font-size: 11px;" id="adm-met-tamano">—</div>
        </div>
        <div style="padding: 12px; background: var(--papel, #ffffff); border: 1px solid var(--linea, #d9def0); border-radius: 8px;">
          <div class="muted" style="font-size: 11px; text-transform: uppercase; font-weight: 600;">Último Respaldo</div>
          <div style="font-size: 13px; font-weight: 700; color: var(--tinta, #1b2140); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" id="adm-met-backup">—</div>
          <div class="muted" style="font-size: 11px;" id="adm-met-canal">Canal correo: —</div>
        </div>
      </div>

      <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
        <button class="btn" id="adm-btn-optimizar" style="background: var(--azul, #26388c); font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
          🛠️ Optimizar Base de Datos (VACUUM & ANALYZE)
        </button>
        <button class="btn sec" id="adm-btn-backup" style="font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
          💾 Crear Respaldo Inmediato
        </button>
        <button class="btn sec peligro" id="adm-btn-limpiar-papelera" style="font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
          🗑️ Limpiar Papelera Antigua (>30 días)
        </button>
      </div>
    </div>

    <div class="panel"><h2>Importar / Exportar</h2>
      <div class="fila">
        <div class="campo"><label>Archivo Excel de origen (.xlsx, .xls)</label><input type="file" id="im-file" accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
        <label style="align-self:center"><input type="checkbox" id="im-limpiar"> Reemplazar todo (borra lo actual)</label>
        <button class="btn" id="im-btn">Importar</button>
      </div>
      <p class="muted">Sin "reemplazar" se hace un backup antes y se fusionan las citas por (fecha, hora, examinador).</p>
      <div class="fila" style="gap:8px;flex-wrap:wrap">
        <a class="btn" href="/api/export?formato=completo" style="background:#1d4ed8;font-weight:700">📥 Descargar Excel completo (Todos los datos)</a>
        <a class="btn sec" href="/api/export">Exportar (formato dashboard)</a>
        <a class="btn sec" href="/api/export?formato=original">Exportar (formato Excel original)</a>
        <button class="btn sec" id="bk-btn">Crear backup de la base</button>
      </div>
      <div id="im-res"></div>
    </div>

    <div class="panel"><h2>Generar bloques de agenda</h2>
      <div class="fila">
        <div class="campo"><label>Desde</label><input type="date" id="gb-desde"></div>
        <div class="campo"><label>Hasta</label><input type="date" id="gb-hasta"></div>
        <button class="btn" id="gb-btn">Generar</button>
      </div>
      <p class="muted">Crea los bloques faltantes (dias habiles, 11 horarios, por examinador activo). No pisa lo existente.</p>
    </div>

    <div class="panel"><h2>Feriados / dias inhabiles</h2>
      <div class="chips" id="fe-cont" style="margin:.4rem 0"></div>
      <div class="fila"><input type="date" id="fe-fecha"><input id="fe-nombre" placeholder="Nombre (opcional)"><button class="btn chico" id="fe-add">Agregar</button><button class="btn chico sec" id="fe-sync">Actualizar feriados de Chile</button></div>
      <p class="muted">Tras cambiar feriados, volve a generar los bloques del periodo afectado.</p>
    </div>

    <div class="panel"><h2>Listas desplegables</h2><div id="cat-cont"></div></div>

    <div class="grid2">
      <div class="panel"><h2>Examinadores</h2><div id="ex-cont"></div>
        <div class="fila"><input id="ex-nuevo" placeholder="Nombre"><button class="btn chico" id="ex-add">Agregar</button></div></div>
      <div class="panel"><h2>Funcionarios/as</h2>
        <div id="fu-cont"></div>
        <div class="fila"><input id="fu-nuevo" placeholder="Nombre"><button class="btn chico" id="fu-add">Agregar</button></div></div>
    </div>

    <div class="panel">
      <div class="fila fila-cab-tabla" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;flex-wrap:wrap">
        <h2 style="margin:0">Últimos movimientos</h2>
        <div style="display:inline-flex;align-items:center;gap:10px">
          <button class="btn peligro sec" id="mov-borrar-btn">Borrar historial</button>
        </div>
      </div>
      <div class="tabla-scroll"><table>
      <thead><tr><th class="c">Fecha</th><th>Acción</th><th>Por</th><th>Detalle</th></tr></thead><tbody id="mov-body"></tbody></table></div></div>`;

  // El .xlsx se lee ACA en el navegador (via vendor/xlsx.full.min.js) y se manda
  // ya leido al servidor (server/migrate.js, funcion aISO/aHora de server/fechas.js).
  //
  // OJO con las celdas de fecha/hora: sheet_to_json({cellDates:true}) devuelve
  // objetos Date. JSON.stringify() los pasa a UTC (toISOString), y eso puede
  // correr un dia o una hora. Por eso cada Date se convierte a texto
  // 'YYYY-MM-DD HH:MM:SS' con getters LOCALES (hora de Chile) antes de armar el JSON.
  const pad2 = (n) => String(n).padStart(2, '0');
  function celdaASerializable(v) {
    if (!(v instanceof Date) || isNaN(v)) return v;
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())} ${pad2(v.getHours())}:${pad2(v.getMinutes())}:${pad2(v.getSeconds())}`;
  }
  // Hojas que reconoce el importador: AGENDA, CITAS DISPONIBLES, ENE-JUN/JUL-DIC/AGO-DIC con
  // año opcional (mismo criterio que esHojaMaestra en server/migrate.js).
  const RE_HOJA_IMPORTAR = /^(AGENDA|ENE-JUN|JUL-DIC|AGO-DIC)(\s+\d{4})?$/i;
  const esHojaImportar = (nombre) => nombre === 'CITAS DISPONIBLES' || RE_HOJA_IMPORTAR.test(String(nombre || '').trim());
  $('#im-btn').onclick = async () => {
    const f = $('#im-file').files[0];
    if (!f) return toast('Elige un archivo .xlsx o .xls', 'err');
    $('#im-res').innerHTML = '<p class="muted">Leyendo archivo...</p>';
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const hojas = {};
      for (const nombre of (wb.SheetNames || []).filter(esHojaImportar)) {
        const ws = wb.Sheets[nombre];
        if (!ws) continue;
        const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, cellDates: true, defval: null });
        hojas[nombre] = filas.map((fila) => Array.isArray(fila) ? fila.map(celdaASerializable) : fila);
      }
      // Si no tiene hojas con nombres estándar, procesar todas las hojas existentes
      if (Object.keys(hojas).length === 0 && wb.SheetNames && wb.SheetNames.length > 0) {
        for (const nombre of wb.SheetNames) {
          const ws = wb.Sheets[nombre];
          if (!ws) continue;
          const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, cellDates: true, defval: null });
          if (filas && filas.length > 1) {
            hojas[nombre] = filas.map((fila) => Array.isArray(fila) ? fila.map(celdaASerializable) : fila);
          }
        }
      }
      const encontradas = Object.keys(hojas);
      if (encontradas.length === 0) {
        const hojasArchivo = (wb.SheetNames || []).join(', ') || 'ninguna';
        return toast(`El archivo no contiene filas con datos. Hojas: ${hojasArchivo}`, 'err');
      }
      $('#im-res').innerHTML = '<p class="muted">Importando...</p>';
      const r = await api('/import', { method: 'POST', body: { hojas, limpiar: $('#im-limpiar').checked } });
      $('#im-res').innerHTML = `<div class="aviso">Listo. Leidas ${r.resumen.leidas}, citas ${r.resumen.ocupadas},
        bloques nuevos ${r.resumen.bloques_generados}, rango ${r.resumen.rango.map(fFecha).join(' a ')}.
        ${r.resumen.fuera_de_rango ? `<br><b>${r.resumen.fuera_de_rango} fila(s) con fecha anterior a 2020 se descartaron</b> (probable error de digitación en el Excel).` : ''}</div>
        ${(r.resumen.conflictos_examinador || []).length ? `<div class="aviso" style="margin-top:.6rem"><b>${r.resumen.conflictos_examinador.length} conflicto(s) de examinador para revisar a mano</b> (la misma persona figura con dos examinadores; ambas filas se importaron y aparecen en el Reporte de errores como duplicado del día):<ul style="margin:.4rem 0 0 1.1rem">${r.resumen.conflictos_examinador.slice(0, 50).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>${r.resumen.conflictos_examinador.length > 50 ? `<p class="muted">… y ${r.resumen.conflictos_examinador.length - 50} más.</p>` : ''}</div>` : ''}`;
      META = await api('/meta');
      toast('Importacion completada');
    } catch (e) { $('#im-res').innerHTML = `<div class="aviso">${esc(e.message)}</div>`; }
  };
  $('#bk-btn').onclick = crearBackup;
  $('#gb-btn').onclick = () => {
    if (!$('#gb-desde').value || !$('#gb-hasta').value) return toast('Indica el rango', 'err');
    return generarBloques($('#gb-desde').value, $('#gb-hasta').value);
  };

  // feriados
  const fe = $('#fe-cont');
  fe.innerHTML = (META.feriados || []).map((f) => `<span class="chip">${esc(fFecha(f.fecha))}${f.nombre ? ' · ' + esc(f.nombre) : ''}<button data-f="${esc(f.fecha)}">&times;</button></span>`).join('') || '<span class="muted">Sin feriados</span>';
  fe.querySelectorAll('button[data-f]').forEach((b) => {
    b.onclick = () => borrarFeriado(b.dataset.f);
  });
  $('#fe-sync').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    const txt = b.textContent;
    b.textContent = 'Consultando...';
    try {
      const r = await api('/feriados/sincronizar', { method: 'POST', body: {} });
      toast(r.agregados ? `Feriados actualizados: ${r.agregados} nuevos` : 'Los feriados ya estaban al día');
      META = await api('/meta'); renderDatos();
    } catch (err) {
      toast(/conexion/i.test(err.message) ? 'Sin conexión: carga manual disponible' : err.message, 'err');
      b.disabled = false; b.textContent = txt;
    }
  };
  $('#fe-add').onclick = () => {
    if (!$('#fe-fecha').value) return;
    return agregarFeriado($('#fe-fecha').value, $('#fe-nombre').value);
  };

  // catalogos
  const cc = $('#cat-cont');
  cc.innerHTML = Object.keys(META.catalogos).map((tipo) => `
    <div style="margin-bottom:.7rem"><b>${tipo}</b>
      <div class="chips" data-tipo="${tipo}" style="margin:.3rem 0">
        ${META.catalogos[tipo].map((v) => `<span class="chip">${esc(v)}<button data-v="${esc(v)}">&times;</button></span>`).join('')}
      </div>
      <div class="fila"><input placeholder="nuevo valor"><button class="btn chico">Agregar</button></div>
    </div>`).join('');
  cc.querySelectorAll('[data-tipo]').forEach((div) => {
    const tipo = div.dataset.tipo;
    div.querySelectorAll('button[data-v]').forEach((b) => {
      b.onclick = async () => {
        await api(`/catalogos?tipo=${tipo}&valor=${encodeURIComponent(b.dataset.v)}`, { method: 'DELETE' });
        META = await api('/meta'); renderDatos();
      };
    });
  });
  cc.querySelectorAll('.fila').forEach((fila) => {
    const tipo = fila.previousElementSibling.dataset.tipo;
    fila.querySelector('button').onclick = async () => {
      const valor = fila.querySelector('input').value.trim();
      if (!valor) return;
      await api('/catalogos', { method: 'POST', body: { tipo, valor } });
      META = await api('/meta'); renderDatos();
    };
  });

  // examinadores / funcionarios
  const listar = (cont, arr, base) => {
    cont.innerHTML = arr.map((x) => `<div class="fila" style="margin-bottom:.4rem;align-items:center;gap:8px">
      <span style="flex:1">${esc(x.nombre)}</span>
      <label style="display:inline-flex;align-items:center;gap:4px"><input type="checkbox" ${x.activo ? 'checked' : ''} data-id="${x.id}"> activo</label>
      <button type="button" class="btn chico peligro sec btn-eliminar-item" data-del-id="${x.id}" data-del-nom="${esc(x.nombre)}" title="Eliminar ${esc(x.nombre)}" style="padding:2px 8px;font-size:12px">🗑</button>
    </div>`).join('');
    cont.querySelectorAll('input[data-id]').forEach((el) => {
      el.onchange = async () => {
        await api(`/${base}/${el.dataset.id}`, { method: 'PUT', body: { activo: el.checked } });
        META = await api('/meta');
      };
    });
    cont.querySelectorAll('.btn-eliminar-item').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.delId;
        const nombre = btn.dataset.delNom;
        if (!confirm(`¿Eliminar al examinador "${nombre}"?`)) return;
        try {
          const res = await api(`/${base}/${id}`, { method: 'DELETE' });
          toast(res.mensaje || `Examinador ${nombre} eliminado exitosamente`, 'ok');
          const fila = btn.closest('.fila');
          if (fila) fila.remove();
          META = await api('/meta');
          renderDatos();
        } catch (e) {
          toast(e.message, 'err');
        }
      };
    });
  };
  listar($('#ex-cont'), META.examinadores, 'examinadores');
  const listarFuncionarios = (cont, arr) => {
    cont.innerHTML = arr.map((x) => `<div class="fila" style="margin-bottom:.4rem;align-items:center">
      <span style="flex:1">${esc(x.nombre)}</span>
      <label><input type="checkbox" class="fu-activo" ${x.activo ? 'checked' : ''} data-id="${x.id}"> activo</label></div>`).join('');
    cont.querySelectorAll('.fu-activo').forEach((el) => {
      el.onchange = async () => {
        await api(`/funcionarios/${el.dataset.id}`, { method: 'PUT', body: { activo: el.checked } });
        META = await api('/meta');
      };
    });
  };
  listarFuncionarios($('#fu-cont'), META.funcionarios);
  $('#ex-add').onclick = async () => {
    const nombre = $('#ex-nuevo').value.trim(); if (!nombre) return;
    await api('/examinadores', { method: 'POST', body: { nombre } });
    META = await api('/meta'); renderDatos();
  };
  $('#fu-add').onclick = async () => {
    const nombre = $('#fu-nuevo').value.trim(); if (!nombre) return;
    await api('/funcionarios', { method: 'POST', body: { nombre } });
    META = await api('/meta'); renderDatos();
  };

  const mov = await api('/movimientos');
  $('#mov-body').innerHTML = mov.map((m) => `<tr><td class="num c">${esc(fFechaHora(m.ts))}</td><td>${esc(m.accion || '—')}</td><td>${esc(m.actor || '—')}</td><td>${esc(m.detalle || '—')}</td></tr>`).join('');

  // Borrar historial: exige escribir la frase exacta (evita un borrado accidental con un solo clic).
  const FRASE_BORRAR_HISTORIAL = 'BORRAR HISTORIAL';
  $('#mov-borrar-btn').onclick = async () => {
    const escrita = prompt(`Esto borra TODO el historial de movimientos (se respalda antes). Escribe exactamente "${FRASE_BORRAR_HISTORIAL}" para confirmar:`);
    if (escrita === null) return; // cancelado: no se llama a nada
    if (escrita !== FRASE_BORRAR_HISTORIAL) return toast('Texto de confirmación incorrecto: no se borró nada', 'err');
    try {
      const r = await api('/movimientos/borrar', { method: 'POST', body: { confirmacion: escrita } });
      toast(`Historial borrado: ${r.eliminados} registro(s)`);
      renderDatos();
    } catch (e) { toast(e.message, 'err'); }
  };

  // Acciones del perfil de Administrador & Mantenimiento
  if ($('#adm-btn-optimizar')) {
    $('#adm-btn-optimizar').onclick = async () => {
      const btn = $('#adm-btn-optimizar');
      btn.disabled = true;
      const htmlOrig = btn.innerHTML;
      btn.textContent = 'Optimizando base de datos...';
      try {
        const r = await api('/admin/optimizar', { method: 'POST' });
        toast(r.mensaje || 'Base de datos optimizada con éxito');
        await cargarMetricasAdmin();
      } catch (e) {
        toast(e.message, 'err');
      } finally {
        btn.disabled = false;
        btn.innerHTML = htmlOrig;
      }
    };
  }

  if ($('#adm-btn-backup')) {
    $('#adm-btn-backup').onclick = async () => {
      const btn = $('#adm-btn-backup');
      btn.disabled = true;
      const htmlOrig = btn.innerHTML;
      btn.textContent = 'Creando respaldo...';
      try {
        await crearBackup();
        await cargarMetricasAdmin();
      } finally {
        btn.disabled = false;
        btn.innerHTML = htmlOrig;
      }
    };
  }

  if ($('#adm-btn-limpiar-papelera')) {
    $('#adm-btn-limpiar-papelera').onclick = async () => {
      if (!confirm('¿Deseas depurar las citas de la papelera con más de 30 días de antigüedad?')) return;
      const btn = $('#adm-btn-limpiar-papelera');
      btn.disabled = true;
      try {
        const r = await api('/admin/limpiar-papelera', { method: 'POST', body: { dias: 30 } });
        toast(r.eliminadas ? `Papelera depurada: ${r.eliminadas} registros antiguos eliminados` : 'No había registros de más de 30 días en la papelera');
        await cargarMetricasAdmin();
      } catch (e) {
        toast(e.message, 'err');
      } finally {
        btn.disabled = false;
      }
    };
  }

  cargarMetricasAdmin();
}
