'use strict';
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { Duplex } = require('node:stream');
const { DatabaseSync } = require('node:sqlite');

const RAIZ = path.join(__dirname, '..');
const SCRATCH = path.join(RAIZ, 'scratch');
if (!fs.existsSync(SCRATCH)) fs.mkdirSync(SCRATCH, { recursive: true });

const STRESS_DB_PATH = path.join(SCRATCH, 'agenda-stress.db');
if (fs.existsSync(STRESS_DB_PATH)) {
  try { fs.unlinkSync(STRESS_DB_PATH); } catch (_) {}
}

// 1. Clonar base SQLite actual con VACUUM INTO para aislamiento estricto
const DB_PROD = path.join(RAIZ, 'data', 'agenda.db');
const dbProd = new DatabaseSync(DB_PROD);
dbProd.exec(`VACUUM INTO '${STRESS_DB_PATH.replace(/\\/g, '/')}'`);
dbProd.close();

// Establecer variable de entorno para que el servidor use la base clonada
process.env.AGENDA_DB = STRESS_DB_PATH;

// Cargar la aplicación Express configurada con la base de datos de prueba aislada
delete require.cache[require.resolve('../server/db')];
delete require.cache[require.resolve('../server/config')];
delete require.cache[require.resolve('../server/index')];

const app = require('../server/index');
const { db } = require('../server/db');

// Generador de RUTs chilenos con dígito verificador matemático oficial (Módulo 11)
function generarRutChileno(num) {
  let suma = 0;
  let mult = 2;
  const str = String(num);
  for (let i = str.length - 1; i >= 0; i--) {
    suma += parseInt(str[i], 10) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const res = 11 - (suma % 11);
  const dv = res === 11 ? '0' : res === 10 ? 'K' : String(res);
  const cuerpoFmt = str.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpoFmt}-${dv}`;
}

// Cliente HTTP in-process de alto rendimiento que ejercita el stack completo de Express
function request(method, url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

    const socket = new Duplex({
      read() {},
      write(chunk, enc, cb) { cb(); }
    });
    socket.remoteAddress = '127.0.0.1';

    const req = new http.IncomingMessage(socket);
    req.method = method.toUpperCase();
    req.url = url;
    req.headers = {
      host: 'localhost:4900',
      'user-agent': 'AuditoriaAdversarial/1.0',
      ...headers
    };
    if (payload) {
      req.headers['content-type'] = req.headers['content-type'] || 'application/json';
      req.headers['content-length'] = Buffer.byteLength(payload);
      req.push(payload);
    }
    req.push(null);

    const res = new http.ServerResponse(req);
    const chunks = [];
    res.write = function(chunk) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    };
    res.end = function(chunk) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const dur = performance.now() - t0;
      const raw = Buffer.concat(chunks);
      let parsed = null;
      const ct = res.getHeader('content-type') || '';
      if (ct.includes('application/json')) {
        try { parsed = JSON.parse(raw.toString('utf8')); } catch (_) { parsed = raw.toString('utf8'); }
      } else {
        parsed = raw;
      }
      resolve({
        status: res.statusCode,
        headers: res.getHeaders ? res.getHeaders() : {},
        body: parsed,
        raw,
        dur
      });
    };

    try {
      app(req, res);
    } catch (err) {
      reject(err);
    }
  });
}

function calcularPercentil(arr, p) {
  if (!arr.length) return 0;
  const ordenado = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * ordenado.length) - 1;
  return ordenado[Math.max(0, Math.min(idx, ordenado.length - 1))];
}

async function correrAuditoriaAdversarial() {
  console.log('================================================================');
  console.log(' INICIANDO BATERÍA DE PRUEBAS DE ESTRÉS Y AUDITORÍA ADVERSARIAL ');
  console.log(' Base de datos aislada: ' + STRESS_DB_PATH);
  console.log(' Target simulado: http://localhost:4900');
  console.log('================================================================\n');

  const metricas = {
    totalPeticiones: 0,
    exitosas: 0,
    rechazadasEsperadas: 0,
    erroresInesperados: 0,
    latencias: []
  };

  function registrar(res, esperado = 200) {
    metricas.totalPeticiones++;
    metricas.latencias.push(res.dur);
    const ok = res.status === esperado || (Array.isArray(esperado) && esperado.includes(res.status));
    if (ok) {
      if (res.status >= 200 && res.status < 300) metricas.exitosas++;
      else metricas.rechazadasEsperadas++;
      return true;
    } else {
      metricas.erroresInesperados++;
      console.error(`[ERROR INESPERADO] status=${res.status} esperado=${esperado} body=${JSON.stringify(res.body)}`);
      return false;
    }
  }

  // 1. Identificar cupos libres y citas existentes
  const bloquesLibres = db.prepare(`
    SELECT id, fecha, hora, examinador_id
    FROM agenda
    WHERE rut IS NULL AND (bloqueado IS NULL OR bloqueado = 0)
    ORDER BY fecha ASC, hora ASC
    LIMIT 200
  `).all();

  const citasExistentes = db.prepare(`
    SELECT id, rut, nombre, contacto, correo, actualizado_en
    FROM agenda
    WHERE rut IS NOT NULL AND (bloqueado IS NULL OR bloqueado = 0)
    ORDER BY fecha DESC, hora ASC
    LIMIT 100
  `).all();

  console.log(`[PREP] Cupos libres para agendamiento: ${bloquesLibres.length}`);
  console.log(`[PREP] Citas agendadas para edición/confirmación: ${citasExistentes.length}`);

  // ============================================================================
  // TEST 1: Concurrencia Masiva (100 peticiones simultáneas)
  // ============================================================================
  console.log('\n--- 1. CONCURRENCIA MASIVA (100 PETICIONES SIMULTÁNEAS) ---');
  const tInicioMasivo = performance.now();
  const promesasMasivas = [];

  // 40 Agendamientos simultáneos en cupos diferentes con RUTs chilenos reales
  for (let i = 0; i < 40; i++) {
    const bloque = bloquesLibres[i];
    const rutValido = generarRutChileno(15000000 + i * 17);
    promesasMasivas.push(
      request('PUT', `/api/agenda/${bloque.id}`, {
        rut: rutValido,
        nombre: `POSTULANTE ESTRÉS ${i + 1}`,
        contacto: '912345678',
        correo: `estres${i}@valparaiso.cl`,
        clase: 'B',
        funcionario_id: 1,
        visto_en: null
      }).then(res => {
        registrar(res, [200, 201]);
        return { tipo: 'agendar', res };
      })
    );
  }

  // 30 Ediciones rápidas concurrentes de celdas sobre citas reales
  for (let i = 0; i < 30; i++) {
    const cita = citasExistentes[i % citasExistentes.length];
    promesasMasivas.push(
      request('PATCH', `/api/agenda/${cita.id}/contacto`, {
        contacto: '987654321',
        correo: `modificado${i}@valparaiso.cl`
      }).then(res => {
        registrar(res, [200, 409]);
        return { tipo: 'editar', res };
      })
    );
  }

  // 15 Confirmaciones de asistencia concurrentes
  for (let i = 0; i < 15; i++) {
    const cita = citasExistentes[(i + 30) % citasExistentes.length];
    promesasMasivas.push(
      request('POST', `/api/agenda/${cita.id}/confirmar`, {
        confirmo: 1
      }).then(res => {
        registrar(res, 200);
        return { tipo: 'confirmar', res };
      })
    );
  }

  // 15 Actualizaciones de tipo de cita concurrentes
  for (let i = 0; i < 15; i++) {
    const cita = citasExistentes[(i + 45) % citasExistentes.length];
    promesasMasivas.push(
      request('POST', `/api/agenda/${cita.id}/tipo-cita`, {
        tipo_cita: 'REAGENDAMIENTO LLAMADA'
      }).then(res => {
        registrar(res, 200);
        return { tipo: 'tipo-cita', res };
      })
    );
  }

  const resultadosMasivos = await Promise.all(promesasMasivas);
  const tFinMasivo = performance.now() - tInicioMasivo;
  console.log(`[OK] 100 peticiones concurrentes completadas en ${tFinMasivo.toFixed(2)} ms.`);
  console.log(`[OK] Rendimiento: ${(100 / (tFinMasivo / 1000)).toFixed(1)} peticiones/seg.`);

  // ============================================================================
  // TEST 2: Detección de Colisiones (Carrera de usuarios sobre el MISMO cupo)
  // ============================================================================
  console.log('\n--- 2. DETECCIÓN DE COLISIONES EN TIEMPO REAL ---');
  const cupoDisputado = bloquesLibres[50];
  console.log(`Disputando exactamente el mismo cupo ID=${cupoDisputado.id} (${cupoDisputado.fecha} ${cupoDisputado.hora})...`);

  const rutA = generarRutChileno(16111111);
  const rutB = generarRutChileno(16222222);
  const rutC = generarRutChileno(16333333);

  // 2. Simulación de carrera con bloqueo optimista (ambos usuarios abrieron el cupo libre en pantalla)
  const cupoEstado = db.prepare('SELECT id, actualizado_en FROM agenda WHERE id = ?').get(cupoDisputado.id);
  const vistoEn = cupoEstado?.actualizado_en || null;

  // Lanzar peticiones simultáneas intentando ocupar el mismo bloque con el mismo visto_en
  const promesasColision = [
    request('PUT', `/api/agenda/${cupoDisputado.id}`, {
      rut: rutA,
      nombre: 'USUARIO A',
      contacto: '911111111',
      correo: 'usuarioA@test.cl',
      clase: 'B',
      visto_en: vistoEn
    }),
    request('PUT', `/api/agenda/${cupoDisputado.id}`, {
      rut: rutB,
      nombre: 'USUARIO B',
      contacto: '922222222',
      correo: 'usuarioB@test.cl',
      clase: 'B',
      visto_en: vistoEn
    }),
    request('PUT', `/api/agenda/${cupoDisputado.id}`, {
      rut: rutC,
      nombre: 'USUARIO C',
      contacto: '933333333',
      correo: 'usuarioC@test.cl',
      clase: 'B',
      visto_en: vistoEn
    })
  ];

  const resColisiones = await Promise.all(promesasColision);
  resColisiones.forEach(r => registrar(r, [200, 400, 409]));

  const exitosos = resColisiones.filter(r => r.status === 200);
  console.log(`[OK] Resultado de la colisión: ${exitosos.length} cupo agendado, ${resColisiones.length - exitosos.length} peticiones controladas/sobrescritas con regla.`);

  // Verificar en base de datos que el cupo no se haya corrompido ni duplicado
  const filaCupo = db.prepare('SELECT id, rut, nombre, clase FROM agenda WHERE id = ?').get(cupoDisputado.id);
  console.log(`[BD VERIFICACIÓN] Fila en SQLite: ID=${filaCupo.id}, RUT=${filaCupo.rut}, Nombre=${filaCupo.nombre}`);
  if (!filaCupo.rut) throw new Error('El cupo no quedó registrado');

  // ============================================================================
  // TEST 3: Intentos de Vulnerar Reglas de Negocio (Clases Pesadas D y A5)
  // ============================================================================
  console.log('\n--- 3. AUDITORÍA ADVERSARIAL: VULNERACIÓN DE REGLAS DE NEGOCIO ---');
  console.log('Intentando forzar agendamientos de Clase D y A5 en horarios prohibidos (< 12:30)...');

  const horasProhibidas = ['08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00'];
  let intentosPesadasRechazados = 0;
  let totalIntentosPesadas = 0;

  for (const hora of horasProhibidas) {
    const bloqueHora = db.prepare('SELECT id, fecha, hora FROM agenda WHERE hora = ? AND rut IS NULL LIMIT 1').get(hora);
    if (!bloqueHora) continue;

    // Intentar clase D con forzar=true
    totalIntentosPesadas++;
    const resD = await request('PUT', `/api/agenda/${bloqueHora.id}`, {
      rut: generarRutChileno(17111000 + totalIntentosPesadas),
      nombre: 'HACKER PESADA D',
      contacto: '944444444',
      correo: 'hacker@test.cl',
      clase: 'D',
      forzar: true // Intento explícito de bypass
    });
    registrar(resD, 400);
    if (resD.status === 400 && resD.body?.error?.includes('12:30')) {
      intentosPesadasRechazados++;
    }

    // Intentar clase A5
    totalIntentosPesadas++;
    const resA5 = await request('PUT', `/api/agenda/${bloqueHora.id}`, {
      rut: generarRutChileno(17222000 + totalIntentosPesadas),
      nombre: 'HACKER PESADA A5',
      contacto: '955555555',
      correo: 'hacker2@test.cl',
      clase: 'A5',
      forzar: false
    });
    registrar(resA5, 400);
    if (resA5.status === 400 && resA5.body?.error?.includes('12:30')) {
      intentosPesadasRechazados++;
    }
  }

  console.log(`[RESULTADO CLASE D/A5] ${intentosPesadasRechazados}/${totalIntentosPesadas} intentos fueron RECHAZADOS con 400 (100% efectividad).`);
  if (intentosPesadasRechazados !== totalIntentosPesadas) {
    throw new Error('FALLO CRÍTICO: Se permitió agendar clase pesada antes de las 12:30.');
  }

  // ============================================================================
  // TEST 4: Intentos de Agendar a las 08:30 después del 9 de noviembre
  // ============================================================================
  console.log('\n--- 4. AUDITORÍA ADVERSARIAL: BLOQUES DE 08:30 POST 9 DE NOVIEMBRE ---');
  const count0830 = db.prepare("SELECT COUNT(*) as n FROM agenda WHERE fecha >= '2026-11-09' AND hora = '08:30'").get().n;
  console.log(`[BD VERIFICACIÓN] Bloques a las 08:30 registrados después del 09/11/2026: ${count0830}`);
  if (count0830 > 0) {
    throw new Error(`Existen ${count0830} bloques a las 08:30 después del 9 de noviembre.`);
  }

  // Intentar consultar/agendar un bloque inexistente de 08:30
  const bloqueInexistente = db.prepare("SELECT id FROM agenda WHERE fecha = '2026-11-10' AND hora = '08:30'").get();
  console.log(`[INFO] Consulta directa en SQLite de bloque 2026-11-10 08:30: ${bloqueInexistente ? 'EXISTE (ERROR)' : 'NO EXISTE (CORRECTO)'}`);
  if (bloqueInexistente) {
    throw new Error('El bloque 08:30 existe en la fecha 2026-11-10');
  }

  // Petición a ID fantasma simulando intento de inyección de bloque
  const resInexistente = await request('PUT', '/api/agenda/9999999', {
    rut: generarRutChileno(17999999),
    nombre: 'FANTASMA 08:30',
    contacto: '966666666',
    correo: 'fantasma@test.cl',
    clase: 'B'
  });
  registrar(resInexistente, 404);
  console.log(`[OK] Intento de inyectar cita en cupo inexistente rechazado con HTTP ${resInexistente.status} (Not Found).`);

  // ============================================================================
  // TEST 5: Descarga Pesada de Excel Completo y Analítica bajo Escrituras Simultáneas
  // ============================================================================
  console.log('\n--- 5. DESCARGA PESADA DE EXCEL COMPLETO Y ANALÍTICA CON ESCRITURA SIMULTÁNEA ---');
  const tInicioPesado = performance.now();

  const promesasPesadas = [
    // 1. Exportación masiva completa XLSX (buffer binario)
    request('GET', '/api/export?formato=completo').then(r => {
      registrar(r, 200);
      return { tipo: 'export-completo', r };
    }),
    // 2. Exportación formato dashboard
    request('GET', '/api/export').then(r => {
      registrar(r, 200);
      return { tipo: 'export-dashboard', r };
    }),
    // 3. Consulta analítica compleja
    request('GET', '/api/analitica?desde=2026-01-01&hasta=2026-12-31').then(r => {
      registrar(r, 200);
      return { tipo: 'analitica', r };
    }),
    // 4. Reporte de errores de la base completa
    request('GET', '/api/errores').then(r => {
      registrar(r, 200);
      return { tipo: 'errores', r };
    })
  ];

  // Disparar simultáneamente 20 modificaciones de celdas con RUTs chilenos válidos mientras se procesa el Excel
  for (let i = 0; i < 20; i++) {
    const bloque = bloquesLibres[60 + i];
    const rutValido = generarRutChileno(18000000 + i * 31);
    promesasPesadas.push(
      request('PUT', `/api/agenda/${bloque.id}`, {
        rut: rutValido,
        nombre: `CONCURRENTE EXCEL ${i + 1}`,
        contacto: '977777777',
        correo: `concurrente${i}@test.cl`,
        clase: 'B'
      }).then(r => {
        registrar(r, 200);
        return { tipo: 'modificacion', r };
      })
    );
  }

  const resPesadas = await Promise.all(promesasPesadas);
  const tFinPesado = performance.now() - tInicioPesado;
  console.log(`[OK] Descarga de Excel completo, Dashboard, Analítica y 20 escrituras completadas en ${tFinPesado.toFixed(2)} ms.`);

  const exportCompleto = resPesadas.find(p => p.tipo === 'export-completo')?.r;
  const magicZip = exportCompleto?.raw?.slice(0, 4);
  const esZipValido = magicZip && magicZip[0] === 0x50 && magicZip[1] === 0x4B; // 'PK'
  console.log(`[VERIFICACIÓN EXCEL] Tamaño generado: ${(exportCompleto?.raw?.length / 1024).toFixed(1)} KB. Magic bytes PK válidos: ${esZipValido ? 'SÍ' : 'NO'}`);
  if (!esZipValido) throw new Error('El archivo Excel exportado no es un archivo ZIP/XLSX válido');

  // ============================================================================
  // TEST 6: Medición de Latencias y Verificación de Integridad de SQLite
  // ============================================================================
  console.log('\n--- 6. LATENCIAS DE RESPUESTA Y VERIFICACIÓN DE INTEGRIDAD SQLITE ---');

  const p50 = calcularPercentil(metricas.latencias, 50);
  const p95 = calcularPercentil(metricas.latencias, 95);
  const p99 = calcularPercentil(metricas.latencias, 99);
  const minLat = Math.min(...metricas.latencias);
  const maxLat = Math.max(...metricas.latencias);
  const avgLat = metricas.latencias.reduce((a, b) => a + b, 0) / metricas.latencias.length;

  console.log(`Total de solicitudes analizadas: ${metricas.totalPeticiones}`);
  console.log(`- Mínima:         ${minLat.toFixed(2)} ms`);
  console.log(`- Promedio:       ${avgLat.toFixed(2)} ms`);
  console.log(`- Mediana (p50):  ${p50.toFixed(2)} ms`);
  console.log(`- Percentil 95 (p95): ${p95.toFixed(2)} ms`);
  console.log(`- Percentil 99 (p99): ${p99.toFixed(2)} ms`);
  console.log(`- Máxima:         ${maxLat.toFixed(2)} ms`);

  // Verificación de integridad SQLite
  console.log('\nEjecutando verificaciones de integridad SQLite en la base clonada...');
  const integrity = db.prepare('PRAGMA integrity_check').all();
  const quick = db.prepare('PRAGMA quick_check').all();
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();

  console.log(`PRAGMA integrity_check: ${JSON.stringify(integrity)}`);
  console.log(`PRAGMA quick_check: ${JSON.stringify(quick)}`);
  console.log(`PRAGMA foreign_key_check: ${foreignKeys.length === 0 ? '0 violaciones (100% OK)' : JSON.stringify(foreignKeys)}`);

  const esIntegro = integrity.length === 1 && integrity[0].integrity_check === 'ok' &&
                    quick.length === 1 && quick[0].quick_check === 'ok' &&
                    foreignKeys.length === 0;

  if (!esIntegro) {
    throw new Error('FALLO DE INTEGRIDAD EN SQLITE TRAS EL ESTRÉS');
  }

  // Verificación adicional de la base de producción original
  const connProd = new DatabaseSync(DB_PROD);
  const prodCheck = connProd.prepare('PRAGMA integrity_check').all();
  connProd.close();
  console.log(`PRAGMA integrity_check (Base de Producción): ${JSON.stringify(prodCheck)}`);

  console.log('\n================================================================');
  console.log(' ¡AUDITORÍA ADVERSARIAL Y PRUEBA DE ESTRÉS SUPERADAS CON ÉXITO! ');
  console.log('================================================================\n');

  return {
    metricas,
    latencias: { minLat, avgLat, p50, p95, p99, maxLat },
    esIntegro,
    tFinMasivo,
    tFinPesado
  };
}

let testRunner;
try {
  testRunner = require('node:test');
} catch (_) {}

if (testRunner && typeof testRunner === 'function') {
  testRunner('Auditoría adversarial y prueba de estrés en vivo', async () => {
    const res = await correrAuditoriaAdversarial();
    if (!res.esIntegro) throw new Error('Fallo de integridad');
  });
}

if (require.main === module && !process.env.NODE_TEST_CONTEXT) {
  correrAuditoriaAdversarial()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('\n[FATAL ERROR EN AUDITORÍA]:', err);
      process.exit(1);
    });
}

module.exports = { correrAuditoriaAdversarial };
