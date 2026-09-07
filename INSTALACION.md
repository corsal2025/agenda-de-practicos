# Instalación en el PC de la agenda

## 1. Requisitos

- **Node.js 22.5 o superior** — descargar de <https://nodejs.org> (opción LTS sirve si es 22.5+; si no, la "Current").
  Verificar en una terminal: `node --version`

## 2. Copiar la carpeta

Copiar toda la carpeta `agenda de practicos` al PC (por ejemplo a `C:\agenda-practicos`).

## 3. Primera vez

Doble clic en **`iniciar.bat`**. La primera vez instala dependencias solo
(tarda 1–2 minutos) y luego abre el navegador en <http://localhost:4173>.

Si preferís la terminal:

```bat
npm install
npm run migrar        REM carga los datos del Excel (data\origen.xlsx)
npm start
```

## 4. Cargar los datos del Excel

Copiar `AGENDA PRÁCTICOS.xlsx` a `data\origen.xlsx` y correr `npm run migrar`
(o importar desde la pestaña **Datos** de la aplicación).

## 5. Uso diario

Doble clic en `iniciar.bat`. Para cerrar: cerrar la ventana negra (terminal).

## 6. Login

Por defecto la aplicación pide un **PIN** compartido: `1234`.

Para cambiarlo, crear un archivo `.env` **no** — Node no lo lee solo. En su lugar,
editar `iniciar.bat` y agregar la línea antes de `node server\index.js`:

```bat
set AGENDA_PIN=elpin-que-quieras
```

Para **desactivar el login** (PC de un solo uso, sin datos sensibles a la vista):

```bat
set AGENDA_SIN_LOGIN=1
```

Cada acción queda registrada con el nombre que la persona escribe al entrar
(pestaña Datos → "Últimos movimientos").

## 7. Arranque automático con Windows (opcional)

### Opción simple: carpeta de Inicio

1. `Win + R` → `shell:startup` → Enter.
2. Crear un acceso directo a `iniciar.bat` dentro de esa carpeta.

Así el servidor arranca al iniciar sesión en Windows.

### Opción robusta: servicio con NSSM

1. Descargar NSSM de <https://nssm.cc>.
2. En una terminal como administrador:

```bat
nssm install AgendaPracticos "C:\Program Files\nodejs\node.exe" "C:\agenda-practicos\server\index.js"
nssm set AgendaPracticos AppDirectory "C:\agenda-practicos"
nssm set AgendaPracticos AppEnvironmentExtra AGENDA_PIN=elpin
nssm start AgendaPracticos
```

El servicio queda corriendo aunque nadie inicie sesión. El navegador se abre a
mano en <http://localhost:4173>.

## 8. Acceso desde otros PC de la misma red (opcional)

El servidor ya escucha en todas las interfaces de red. Para que otros PC entren:

1. Abrir el puerto **4173** en el Firewall de Windows (entrada, TCP).
2. Los demás entran a `http://IP-DEL-PC:4173` (ver la IP con `ipconfig`).

**Dejar el login activo (con PIN) en este caso.**

## 9. Backups

- Automático: uno al arrancar (si el último tiene +20 h) y luego cada 24 h,
  en `data\backups\`. Se conservan los últimos 30.
- Manual: pestaña Datos → "Crear backup", o `npm run backup`.
- Restaurar: cerrar el servidor, copiar el `.db` deseado sobre `data\agenda.db`.

## 10. Tests

```bat
npm test
```
