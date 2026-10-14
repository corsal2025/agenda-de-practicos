'use strict';
// Transporte alternativo: envia por Outlook clasico instalado (COM via PowerShell).
// Los datos viajan en un JSON temporal; nunca se interpolan en la linea de comandos.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SCRIPT = path.join(__dirname, 'outlook-enviar.ps1');
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
const TIMEOUT_CHEQUEO_MS = 15000;
const TIMEOUT_ENVIO_MS = 60000;
// Solo se instancia Outlook si el usuario ya tiene un perfil de correo configurado. Sin perfil,
// Outlook muestra el asistente "Agregar un servicio" en pantalla al ser invocado por COM.
const CMD_CHEQUEO = "try { $p = @('14.0','15.0','16.0') | ForEach-Object { Get-ChildItem " +
  "(\"HKCU:\Software\Microsoft\Office\$_\Outlook\Profiles\") -ErrorAction SilentlyContinue }; " +
  "if (-not $p) { 'NO'; return }; $o = New-Object -ComObject Outlook.Application; if ($o) { 'SI' } } catch { 'NO' }";

function soportado() {
  // node --test marca a sus procesos con NODE_TEST_CONTEXT: tampoco se invoca PowerShell ahi.
  return process.platform === 'win32' && process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT;
}

let cacheDisponible = null; // Promise<boolean>
let estadoDisponible = false;
function disponible() {
  if (!soportado()) return Promise.resolve(false);
  if (!cacheDisponible) {
    cacheDisponible = new Promise((resolve) => {
      execFile('powershell.exe', [...PS_ARGS, '-Command', CMD_CHEQUEO], { timeout: TIMEOUT_CHEQUEO_MS, windowsHide: true },
        (err, stdout) => resolve(!err && String(stdout).trim() === 'SI'));
    }).then((v) => { estadoDisponible = v; return v; });
  }
  return cacheDisponible;
}
function disponibleSync() { return estadoDisponible; }

// Escribe el payload en un archivo temporal con nombre aleatorio. Devuelve la ruta.
function escribirPayload({ to, subject, html, cuenta }, dir = os.tmpdir()) {
  const ruta = path.join(dir, `agenda-outlook-${crypto.randomBytes(12).toString('hex')}.json`);
  const datos = { to: String(to || ''), subject: String(subject || ''), html: String(html || ''), cuenta: cuenta || null };
  fs.writeFileSync(ruta, JSON.stringify(datos), { encoding: 'utf8', mode: 0o600 });
  return ruta;
}

// Argumentos de PowerShell: fijos + ruta del script + ruta del JSON (nunca datos del correo).
function argsEnvio(rutaPayload) {
  return [...PS_ARGS, '-File', SCRIPT, '-Payload', rutaPayload];
}

let cola = Promise.resolve();
let ultimoError = null;

function enviarUno(msg, cuenta) {
  return new Promise((resolve) => {
    let ruta;
    try { ruta = escribirPayload({ ...msg, cuenta }); } catch (e) { ultimoError = e; return resolve(false); }
    execFile('powershell.exe', argsEnvio(ruta), { timeout: TIMEOUT_ENVIO_MS, windowsHide: true }, (err, _out, stderr) => {
      fs.rm(ruta, { force: true }, () => {});
      if (err) {
        const e = new Error(String(stderr || err.message).trim() || 'Error enviando por Outlook');
        e.code = err.killed ? 'ETIMEDOUT' : 'EOUTLOOK';
        ultimoError = e;
        return resolve(false);
      }
      ultimoError = null;
      resolve(true);
    });
  });
}

// Serializa los envios para evitar contencion COM.
function enviar({ to, subject, html, text }) {
  if (!soportado()) return Promise.resolve(false);
  // Nunca enviar desde una cuenta cualquiera del perfil: por defecto la misma del correo municipal (SMTP_USER).
  const cuenta = process.env.OUTLOOK_CUENTA || process.env.SMTP_USER || null;
  return enCola(() => enviarUno({ to, subject, html: html || text }, cuenta));
}

// Cola compartida (envio y lectura de respuestas) para evitar contencion COM.
function enCola(fn) {
  const p = cola.then(fn);
  cola = p.catch(() => {});
  return p;
}

module.exports = {
  disponible, disponibleSync, CMD_CHEQUEO, enviar, enCola, escribirPayload, argsEnvio, SCRIPT,
  get ultimoError() { return ultimoError; },
};
