/* ================= tab: DATOS ================= */
async function renderDatos() {
  view.innerHTML = `
    <div class="panel"><h2>Importar / Exportar</h2>
      <div class="fila">
        <div class="campo"><label>Archivo Excel de origen (.xlsx, .xls)</label><input type="file" id="im-file" accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
        <label style="align-self:center"><input type="checkbox" id="im-limpiar"> Reemplazar todo (borra lo actual)</label>
        <button class="btn" id="im-btn">Importar</button>
      </div>
      <p class="muted">Sin "reemplazar" se hace un backup antes y se fusionan las citas por (fecha, hora, examinador).</p>
      <div class="fila">
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

    <div class="panel"><h2>Ultimos movimientos</h2><div class="tabla-scroll"><table>
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
  const HOJAS_IMPORTAR = ['AGO-DIC', 'ENE-JUN 2027', 'AGENDA', 'CITAS DISPONIBLES'];
  $('#im-btn').onclick = async () => {
    const f = $('#im-file').files[0];
    if (!f) return toast('Elige un archivo .xlsx o .xls', 'err');
    $('#im-res').innerHTML = '<p class="muted">Leyendo archivo...</p>';
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const hojas = {};
      for (const nombre of HOJAS_IMPORTAR) {
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
        bloques nuevos ${r.resumen.bloques_generados}, rango ${r.resumen.rango.map(fFecha).join(' a ')}.</div>`;
      META = await api('/meta');
      toast('Importacion completada');
    } catch (e) { $('#im-res').innerHTML = `<div class="aviso">${esc(e.message)}</div>`; }
  };
  $('#bk-btn').onclick = async () => {
    const r = await api('/backup', { method: 'POST' });
    toast('Backup: ' + r.archivo.split(/[\\/]/).pop());
  };
  $('#gb-btn').onclick = async () => {
    if (!$('#gb-desde').value || !$('#gb-hasta').value) return toast('Indica el rango', 'err');
    const r = await api('/agenda/generar', { method: 'POST', body: { desde: $('#gb-desde').value, hasta: $('#gb-hasta').value } });
    toast(`${r.creados} bloques nuevos en ${r.dias} dias habiles`);
    META = await api('/meta');
  };

  // feriados
  const fe = $('#fe-cont');
  fe.innerHTML = (META.feriados || []).map((f) => `<span class="chip">${esc(fFecha(f.fecha))}${f.nombre ? ' · ' + esc(f.nombre) : ''}<button data-f="${esc(f.fecha)}">&times;</button></span>`).join('') || '<span class="muted">Sin feriados</span>';
  fe.querySelectorAll('button[data-f]').forEach((b) => {
    b.onclick = async () => { await api(`/feriados?fecha=${b.dataset.f}`, { method: 'DELETE' }); META = await api('/meta'); renderDatos(); };
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
  $('#fe-add').onclick = async () => {
    if (!$('#fe-fecha').value) return;
    await api('/feriados', { method: 'POST', body: { fecha: $('#fe-fecha').value, nombre: $('#fe-nombre').value } });
    META = await api('/meta'); renderDatos();
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
    cont.innerHTML = arr.map((x) => `<div class="fila" style="margin-bottom:.3rem">
      <span style="flex:1">${esc(x.nombre)}</span>
      <label><input type="checkbox" ${x.activo ? 'checked' : ''} data-id="${x.id}"> activo</label></div>`).join('');
    cont.querySelectorAll('input[data-id]').forEach((el) => {
      el.onchange = async () => {
        await api(`/${base}/${el.dataset.id}`, { method: 'PUT', body: { activo: el.checked } });
        META = await api('/meta');
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
  $('#mov-body').innerHTML = mov.map((m) => `<tr><td class="num c">${esc(fFechaHora(m.ts))}</td><td>${esc(m.accion)}</td><td>${esc(m.actor)}</td><td>${esc(m.detalle)}</td></tr>`).join('');

}
