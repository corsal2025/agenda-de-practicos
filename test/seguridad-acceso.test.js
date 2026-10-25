'use strict';
// Control de acceso: Host (DNS rebinding), Origin / Sec-Fetch-Site (CSRF), cabeceras y limites de cuerpo.
// Usa node:http para poder falsificar Host, Origin y Sec-Fetch-Site (fetch no deja). Base temporal: NUNCA toca data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// Variables de entorno ANTES de requerir los modulos del servidor. Dominios ficticios.
const PADRE = 'https://padre.ejemplo.test';
const PUBLICA = 'https://agenda.ejemplo.test';
const AJENO = 'https://atacante.ejemplo.test';
const tmpDb = path.join(os.tmpdir(), `agenda-acceso-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-acceso-bk-'));
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = tmpBackups;
process.env.AGENDA_ORIGENES_PERMITIDOS = PADRE;
process.env.AGENDA_URL_PUBLICA = PUBLICA;

const { db } = require('../server/db');
const { hoyISO } = require('../server/fechas');
const { crear } = require('../server/seguridad-acceso');
const app = require('../server/index');

let servidor;
let puerto;
test.before(async () => {
  await new Promise((ok) => { servidor = app.listen(0, '127.0.0.1', ok); });
  puerto = servidor.address().port;
});
test.after(() => {
  servidor.close();
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
  fs.rmSync(tmpBackups, { recursive: true, force: true });
});

// ---------- helpers ----------
// Peticion cruda. `headers` pisa los valores por defecto (Host se fija a 127.0.0.1:<puerto>).
function pedir(metodo, ruta, { headers = {}, cuerpo } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host: `127.0.0.1:${puerto}`, ...headers };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    if (cuerpo !== undefined) h['content-length'] = Buffer.byteLength(cuerpo);
    const req = http.request({ host: '127.0.0.1', port: puerto, method: metodo, path: ruta, headers: h }, (res) => {
      const trozos = [];
      res.on('data', (t) => trozos.push(t));
      res.on('end', () => {
        const texto = Buffer.concat(trozos).toString('utf8');
        let datos = null;
        try { datos = JSON.parse(texto); } catch (_) { /* html o texto */ }
        resolve({ status: res.statusCode, headers: res.headers, texto, datos });
      });
    });
    // Con cuerpos enormes el servidor puede responder 413 y cortar antes de leer todo.
    req.on('error', (e) => { if (!req.res) reject(e); });
    req.end(cuerpo);
  });
}
const json = (metodo, ruta, objeto, headers = {}) => pedir(metodo, ruta, {
  headers: { 'content-type': 'application/json', ...headers }, cuerpo: JSON.stringify(objeto),
});
const conOrigin = (origin) => ({ origin });

// Foto de TODAS las tablas: un rechazo no debe dejar ningun rastro (ni siquiera en movimientos).
function fotoBase() {
  const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return JSON.stringify(tablas.map((t) => [t.name, db.prepare(`SELECT * FROM "${t.name}"`).all()]));
}
const hoyMas = (n) => {
  const d = new Date(`${hoyISO()}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
let diaN = 200;
function citaConToken(token) {
  const fecha = hoyMas(diaN++);
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, 1)').run(fecha, '09:00');
  const fila = db.prepare('SELECT id FROM agenda WHERE fecha = ? AND hora = ? AND examinador_id = 1').get(fecha, '09:00');
  db.prepare("UPDATE agenda SET rut='11.111.111-1', nombre='JUAN PEREZ', clase='B', correo='juan@x.cl', token_confirmacion=? WHERE id=?").run(token, fila.id);
  return fila.id;
}
const tokenDe = (id) => db.prepare('SELECT token_confirmacion t FROM agenda WHERE id = ?').get(id).t;

// ---------- 9. configuracion (unitarias) ----------
test('config: normaliza una lista con espacios, mayusculas y barra final', () => {
  const s = crear({ origenes: ' https://A.ejemplo.test/ , http://b.ejemplo.test:8080 ' });
  assert.equal(s.frameAncestors, "'self' https://a.ejemplo.test http://b.ejemplo.test:8080");
});
test('config: sin la variable solo queda self', () => {
  assert.equal(crear({}).frameAncestors, "'self'");
  assert.equal(crear({ origenes: '' }).frameAncestors, "'self'");
});
test('config: entradas invalidas hacen fallar el arranque nombrando la variable', () => {
  for (const mala of ['*', 'null', 'ftp://x.ejemplo.test', 'https://x.ejemplo.test/ruta', 'basura', 'https://ok.ejemplo.test,*']) {
    assert.throws(() => crear({ origenes: mala }), /AGENDA_ORIGENES_PERMITIDOS/, mala);
  }
});
test('config: caracteres que no forman parte de un origen hacen fallar el arranque', () => {
  for (const mala of ['https://a.com;script-src', 'https://a.com script-src', "https://a.com'", 'https://a.com\nX: y']) {
    assert.throws(() => crear({ origenes: mala }), /AGENDA_ORIGENES_PERMITIDOS/, JSON.stringify(mala));
  }
});
test('config: origenes validos siguen pasando', () => {
  const s = crear({ origenes: 'https://padre.ejemplo.test, https://padre.ejemplo.test/ ,HTTP://127.0.0.1:4932' });
  assert.equal(s.frameAncestors, "'self' https://padre.ejemplo.test http://127.0.0.1:4932");
});
test('config: AGENDA_URL_PUBLICA ilegible hace fallar el arranque nombrando la variable', () => {
  assert.throws(() => crear({ urlPublica: 'no es una url' }), /AGENDA_URL_PUBLICA/);
  assert.throws(() => crear({ urlPublica: 'ftp://x.ejemplo.test' }), /AGENDA_URL_PUBLICA/);
});
test('config: server/config.js exporta la lista cruda ORIGENES_PERMITIDOS', () => {
  assert.equal(require('../server/config').ORIGENES_PERMITIDOS, PADRE);
});

// ---------- 2/4/5/6. decision (unitarias) ----------
test('decidir: Host permitido incluye loopback, URL publica y AGENDA_HOST concreto', () => {
  const s = crear({ host: '192.168.1.50', urlPublica: PUBLICA });
  for (const h of ['localhost:4900', '127.0.0.1:4900', '[::1]:4900', 'localhost', 'agenda.ejemplo.test', '192.168.1.50:4900']) {
    assert.equal(s.decidir({ metodo: 'GET', host: h }), null, h);
  }
  for (const h of ['atacante.ejemplo.test', '10.0.0.9:4900', undefined, '']) {
    assert.equal(s.decidir({ metodo: 'GET', host: h }).status, 421, String(h));
  }
});
test('decidir: AGENDA_HOST 0.0.0.0 o :: no abre ningun host extra', () => {
  for (const host of ['0.0.0.0', '::']) {
    assert.equal(crear({ host }).decidir({ metodo: 'GET', host: '0.0.0.0:4900' }).status, 421);
  }
});
test('decidir: Origin en metodos que cambian estado', () => {
  const s = crear({ origenes: PADRE, urlPublica: PUBLICA });
  const base = { metodo: 'POST', host: '127.0.0.1:4900' };
  assert.equal(s.decidir({ ...base, origin: 'http://127.0.0.1:4900' }), null);
  assert.equal(s.decidir({ ...base, origin: PADRE }), null);
  assert.equal(s.decidir({ ...base, origin: PUBLICA }), null);
  for (const o of ['null', 'http://localhost:3000', AJENO, 'basura']) {
    assert.equal(s.decidir({ ...base, origin: o }).status, 403, o);
  }
});
test('decidir: sin Origin manda Sec-Fetch-Site; sin ninguna cabecera pasa', () => {
  const s = crear({});
  const base = { metodo: 'DELETE', host: 'localhost:4900' };
  assert.equal(s.decidir({ ...base, secFetchSite: 'cross-site' }).status, 403);
  assert.equal(s.decidir({ ...base, secFetchSite: 'same-site' }).status, 403);
  assert.equal(s.decidir({ ...base, secFetchSite: 'same-origin' }), null);
  assert.equal(s.decidir({ ...base, secFetchSite: 'none' }), null);
  assert.equal(s.decidir(base), null);
});
test('decidir: GET, HEAD y OPTIONS no exigen Origin', () => {
  const s = crear({});
  for (const m of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(s.decidir({ metodo: m, host: 'localhost', origin: AJENO, secFetchSite: 'cross-site' }), null, m);
  }
});

// ---------- 2. Host (integracion) ----------
test('Host ajeno da 421 en pagina, API, ruta publica y POST', async () => {
  const h = { host: 'atacante.ejemplo.test' };
  for (const [m, ruta] of [['GET', '/'], ['GET', '/api/meta'], ['GET', '/confirmar/1/x'], ['POST', '/api/papelera/vaciar'], ['POST', '/confirmar/1/x']]) {
    assert.equal((await pedir(m, ruta, { headers: h })).status, 421, `${m} ${ruta}`);
  }
});
test('Host de loopback y de la URL publica pasan', async () => {
  for (const host of [`localhost:${puerto}`, `127.0.0.1:${puerto}`, `[::1]:${puerto}`, 'agenda.ejemplo.test']) {
    assert.equal((await pedir('GET', '/api/meta', { headers: { host } })).status, 200, host);
  }
});

// ---------- 3. Origin ajeno sin efectos ----------
test('Origin ajeno da 403 y no deja efectos en la base en ninguna ruta que cambia estado', async () => {
  const id = citaConToken('tokenintacto');
  const mala = conOrigin(AJENO);
  const casos = [
    ['POST', '/api/papelera/vaciar', {}],
    ['POST', `/api/agenda/${id}/liberar`, { motivo: 'x' }],
    ['PUT', `/api/agenda/${id}`, { nombre: 'OTRO' }],
    ['PATCH', `/api/agenda/${id}/contacto`, { correo: 'otro@x.cl' }],
    ['DELETE', '/api/catalogos?tipo=clase&valor=B', undefined],
    ['POST', '/api/movimientos/borrar', { confirmacion: 'BORRAR HISTORIAL' }],
    ['POST', `/confirmar/${id}/tokenintacto`, undefined],
  ];
  const antes = fotoBase();
  for (const [m, ruta, cuerpo] of casos) {
    const r = cuerpo === undefined ? await pedir(m, ruta, { headers: mala }) : await json(m, ruta, cuerpo, mala);
    assert.equal(r.status, 403, `${m} ${ruta}`);
  }
  assert.equal(fotoBase(), antes, 'la base no debe cambiar');
  assert.equal(tokenDe(id), 'tokenintacto', 'el token del enlace sigue sirviendo');
  const ok = await pedir('POST', `/confirmar/${id}/tokenintacto`);
  assert.equal(ok.status, 200, 'sin Origin ni Sec-Fetch-Site el mismo POST si funciona');
});
test('POST /api/import multipart con limpiar=true y Origin ajeno: 403, base intacta y sin respaldo nuevo', async () => {
  const frontera = '----pruebaacceso';
  const cuerpo = `--${frontera}\r\nContent-Disposition: form-data; name="limpiar"\r\n\r\ntrue\r\n`
    + `--${frontera}\r\nContent-Disposition: form-data; name="archivo"; filename="a.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\nbasura\r\n--${frontera}--\r\n`;
  const antes = fotoBase();
  const respaldosAntes = fs.readdirSync(tmpBackups).length;
  const r = await pedir('POST', '/api/import', {
    headers: { 'content-type': `multipart/form-data; boundary=${frontera}`, ...conOrigin(AJENO) }, cuerpo,
  });
  assert.equal(r.status, 403);
  assert.equal(fotoBase(), antes);
  assert.equal(fs.readdirSync(tmpBackups).length, respaldosAntes, 'no se crea respaldo');
});
test('el rechazo se registra con el primer segmento de la ruta y sin el token', async () => {
  const original = console.warn;
  const lineas = [];
  console.warn = (...a) => lineas.push(a.join(' '));
  try { await pedir('POST', '/confirmar/7/SECRETOTOKEN123', { headers: conOrigin(AJENO) }); } finally { console.warn = original; }
  assert.equal(lineas.length, 1);
  assert.match(lineas[0], /POST \/confirmar /);
  assert.match(lineas[0], /atacante\.ejemplo\.test/);
  assert.ok(!lineas[0].includes('SECRETOTOKEN123') && !lineas[0].includes('/7'), lineas[0]);
});

// ---------- 4/5/6. Origin y Sec-Fetch-Site (integracion) ----------
test('Origin null y Origin de otro puerto local dan 403', async () => {
  for (const o of ['null', 'http://localhost:3000']) {
    assert.equal((await json('POST', '/api/catalogos', { tipo: 'clase', valor: 'ZZ' }, conOrigin(o))).status, 403, o);
  }
});
test('pasan: mismo origen, app padre y origen de la URL publica con Host localhost', async () => {
  const cuerpo = { tipo: 'clase', valor: 'ZZ' };
  assert.equal((await json('POST', '/api/catalogos', cuerpo, conOrigin(`http://127.0.0.1:${puerto}`))).status, 200);
  assert.equal((await json('POST', '/api/catalogos', cuerpo, conOrigin(PADRE))).status, 200);
  assert.equal((await json('POST', '/api/catalogos', cuerpo, { ...conOrigin(PUBLICA), host: `localhost:${puerto}` })).status, 200);
});
test('sin Origin: cross-site y same-site dan 403; same-origin, none y sin cabeceras pasan', async () => {
  const cuerpo = { tipo: 'clase', valor: 'ZZ' };
  for (const [sitio, esperado] of [['cross-site', 403], ['same-site', 403], ['same-origin', 200], ['none', 200], [undefined, 200]]) {
    const r = await json('POST', '/api/catalogos', cuerpo, { 'sec-fetch-site': sitio });
    assert.equal(r.status, esperado, String(sitio));
  }
});
test('la ruta publica sigue las mismas reglas: POST de formulario del mismo origen funciona', async () => {
  const id = citaConToken('tokenformulario');
  const r = await pedir('POST', `/confirmar/${id}/tokenformulario`, { headers: { ...conOrigin(`http://127.0.0.1:${puerto}`), 'sec-fetch-site': 'same-origin' } });
  assert.equal(r.status, 200);
});

// ---------- 7. GET/HEAD y CORS ----------
test('GET y HEAD con Origin ajeno siguen en 200 y ninguna respuesta trae Access-Control-Allow-Origin', async () => {
  for (const m of ['GET', 'HEAD']) {
    const r = await pedir(m, '/api/meta', { headers: conOrigin(AJENO) });
    assert.equal(r.status, 200, m);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  }
  const rechazo = await json('POST', '/api/catalogos', {}, conOrigin(AJENO));
  assert.equal(rechazo.headers['access-control-allow-origin'], undefined);
});

// ---------- 8. cabeceras ----------
const FRAME = `frame-ancestors 'self' ${PADRE}`;
function cabecerasGenerales(r, etiqueta) {
  assert.equal(r.headers['x-content-type-options'], 'nosniff', etiqueta);
  assert.equal(r.headers['referrer-policy'], 'same-origin', etiqueta);
  assert.equal(r.headers['content-security-policy'], FRAME, etiqueta);
  assert.equal(r.headers['x-frame-options'], undefined, etiqueta);
}
test('cabeceras minimas en paginas, API, 404, 421 y 403, sin X-Frame-Options', async () => {
  for (const ruta of ['/', '/index.html', '/sala.html', '/api/meta', '/no-existe.js']) {
    cabecerasGenerales(await pedir('GET', ruta), ruta);
  }
  cabecerasGenerales(await pedir('GET', '/', { headers: { host: 'atacante.ejemplo.test' } }), '421');
  cabecerasGenerales(await json('POST', '/api/catalogos', {}, conOrigin(AJENO)), '403');
});
test('rutas publicas: frame-ancestors none y X-Frame-Options DENY en GET, POST y Link no valido', async () => {
  const id = citaConToken('tokenpublico');
  const resp = [
    ['GET valido', await pedir('GET', `/confirmar/${id}/tokenpublico`)],
    ['Link no valido', await pedir('GET', '/confirmar/1/x')],
    ['GET rechazar', await pedir('GET', `/rechazar/${id}/tokenpublico`)],
    ['GET reagendar', await pedir('GET', `/reagendar/${id}/tokenpublico`)],
    ['403', await pedir('POST', `/confirmar/${id}/tokenpublico`, { headers: conOrigin(AJENO) })],
    ['POST', await pedir('POST', `/confirmar/${id}/tokenpublico`)],
  ];
  for (const [etiqueta, r] of resp) {
    assert.equal(r.headers['content-security-policy'], "frame-ancestors 'none'", etiqueta);
    assert.equal(r.headers['x-frame-options'], 'DENY', etiqueta);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', etiqueta);
    assert.equal(r.headers['referrer-policy'], 'same-origin', etiqueta);
  }
  assert.equal(resp[0][1].status, 200);
  assert.equal(resp[5][1].status, 200);
});

test('rutas publicas con otras mayusculas tambien llevan frame-ancestors none y DENY', async () => {
  for (const ruta of ['/CONFIRMAR/1/tokenfalso', '/Rechazar/1/tokenfalso', '/REAGENDAR/1/tokenfalso']) {
    const r = await pedir('GET', ruta);
    assert.equal(r.headers['content-security-policy'], "frame-ancestors 'none'", ruta);
    assert.equal(r.headers['x-frame-options'], 'DENY', ruta);
  }
});

// ---------- 10. limites ----------
test('2 MB de JSON a una ruta normal da 413 en espanol y no toca la base', async () => {
  const antes = fotoBase();
  const r = await json('POST', '/api/agenda/generar', { desde: 'x'.repeat(2 * 1024 * 1024), hasta: 'y' });
  assert.equal(r.status, 413);
  assert.match(r.datos.error, /demasiado grande/);
  assert.equal(fotoBase(), antes);
});
test('/api/import acepta 2 MB de JSON y rechaza 26 MB con 413', async () => {
  const dos = await json('POST', '/api/import', { relleno: 'x'.repeat(2 * 1024 * 1024) });
  assert.notEqual(dos.status, 413);
  const grande = await json('POST', '/api/import', { relleno: 'x'.repeat(26 * 1024 * 1024) });
  assert.equal(grande.status, 413);
});
