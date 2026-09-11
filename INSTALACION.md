# Instalación y trabajo desde varios PC

## Cómo funciona (importante)

La aplicación es **un servidor + una base de datos en un solo archivo**
(`data\agenda.db`). Ese archivo vive en **un único PC**: el "servidor".

- **Se instala en un solo PC** (el servidor).
- Los demás PC **no instalan nada**: entran con el navegador a la dirección
  del servidor. Todos ven y editan los mismos datos en tiempo real.
- La información **siempre está en el PC servidor**, en `data\agenda.db`.
  Los backups también.

```
                 ┌─────────────────────────────┐
   PC 1 (navegador) ─┐                          │
   PC 2 (navegador) ─┼──►  PC SERVIDOR  ──►  data\agenda.db
   PC 3 (navegador) ─┘   (corre npm start)      │
                 └─────────────────────────────┘
```

> No pongas `data\agenda.db` en una carpeta de red compartida. SQLite sobre
> red se corrompe. La base va SIEMPRE en un disco local del servidor.

### ¿Qué PC elegir como servidor?

El que esté **más tiempo encendido** y en la **misma red** que los demás.
Puede ser un PC de escritorio fijo o un mini-PC dedicado. Si ese PC se apaga,
nadie puede trabajar hasta que vuelva a encenderse.

---

## Parte A — Instalar en el PC servidor (una sola vez)

### 1. Node.js

Descargar de <https://nodejs.org> (versión **22.5 o superior**).
Verificar en una terminal: `node --version`

### 2. Copiar la carpeta

Copiar `agenda de practicos` al PC, por ejemplo a `C:\agenda-practicos`.

### 3. Primera ejecución

Doble clic en **`iniciar.bat`**. La primera vez instala dependencias
(1–2 min) y luego abre el navegador.

O por terminal:

```bat
npm install
npm run migrar
npm start
```

### 4. Cargar los datos

Copiar `AGENDA PRÁCTICOS.xlsx` a `data\origen.xlsx` y correr `npm run migrar`
(o importar desde la pestaña **Datos**). Esto solo se hace una vez.

### 5. Logo del organismo (opcional)

Copiar el archivo del logo a `public\` con el nombre **`logo`**:
`public\logo.svg` (preferido) o `public\logo.png` / `.jpg` / `.webp`.
Aparece automáticamente en la cabecera, el ingreso y el membrete del informe.
Si no hay archivo, se muestra un escudo genérico.

El nombre del organismo y la unidad se ajustan en `iniciar.bat`:

```bat
set AGENDA_ORGANISMO=Municipalidad de Valparaíso
set AGENDA_UNIDAD=Departamento de Licencias de Conducir
```

### 6. PIN de acceso

Por defecto el PIN es `1234`. Para cambiarlo, editar `iniciar.bat` y agregar
antes de `node server\index.js`:

```bat
set AGENDA_PIN=elpin-que-quieras
```

Cada acción queda registrada con el nombre que la persona escribe al entrar
(pestaña **Datos → Últimos movimientos**).

### 7. Que arranque solo con Windows (recomendado para el servidor)

**Opción simple** — carpeta de Inicio:
1. `Win + R` → `shell:startup` → Enter
2. Crear ahí un acceso directo a `iniciar.bat`

**Opción robusta** — servicio con NSSM (<https://nssm.cc>), en terminal como administrador:

```bat
nssm install AgendaPracticos "C:\Program Files\nodejs\node.exe" "C:\agenda-practicos\server\index.js"
nssm set AgendaPracticos AppDirectory "C:\agenda-practicos"
nssm set AgendaPracticos AppEnvironmentExtra AGENDA_PIN=elpin
nssm start AgendaPracticos
```

Con NSSM el servidor corre aunque nadie inicie sesión en el PC.

---

## Parte B — Habilitar el acceso desde los otros PC

### 1. Averiguar la dirección del servidor

Al arrancar, la terminal muestra algo como:

```
  Este PC:        http://localhost:4900
  Otros PC (LAN): http://192.168.1.45:4900
```

Esa segunda dirección (`http://192.168.1.45:4900`) es la que usan los demás PC.
Si no aparece, correr `ipconfig` y usar la "Dirección IPv4".

> Conviene que el servidor tenga **IP fija** (reserva de DHCP en el router, o
> IP estática). Si la IP cambia, hay que avisar la nueva a los demás PC.

### 2. Abrir el puerto en el Firewall de Windows (en el PC servidor)

1. "Firewall de Windows Defender con seguridad avanzada"
2. Reglas de entrada → Nueva regla → Puerto → TCP → puerto específico **4900**
3. Permitir la conexión → aplicar a Dominio y Privada → nombre "Agenda de Prácticos"

O en terminal como administrador:

```bat
netsh advfirewall firewall add rule name="Agenda de Practicos" dir=in action=allow protocol=TCP localport=4900
```

### 3. En cada PC cliente

Solo abrir el navegador en `http://IP-DEL-SERVIDOR:4900` y crear un acceso
directo / marcador. **Nada que instalar.** Dejar el **login con PIN activo**.

---

## Backups (siempre en el PC servidor)

- **Automático**: uno al arrancar (si el último tiene +20 h) y luego cada 24 h,
  en `data\backups\`. Se conservan los últimos 30.
- **Manual**: pestaña Datos → "Crear backup", o `npm run backup`.
- **Restaurar**: detener el servidor, copiar el `.db` deseado sobre
  `data\agenda.db`, volver a arrancar.
- **Recomendado — automático, sin acordarse**: definir `AGENDA_BACKUP_OFFSITE` (en
  `iniciar.bat`, por ejemplo `set AGENDA_BACKUP_OFFSITE=D:\respaldos\agenda` o una carpeta
  sincronizada con OneDrive/Google Drive). Cada backup (al arrancar, diario o manual) se
  copia también ahí solo, sin depender de una Tarea Programada aparte. Si el disco/carpeta
  no está disponible en ese momento, el backup local igual se hace y solo se avisa en la
  consola del servidor.

---

## Si más adelante se necesita acceso desde fuera de la oficina

Este modelo funciona solo dentro de la red local. Para acceso remoto (otra
sede, teletrabajo) las opciones son: VPN de la institución, o publicar la
aplicación en un servidor propio. Es un paso aparte; avisar cuando haga falta.

---

## Notas técnicas

- `node:sqlite` es experimental en Node: al arrancar aparece un
  `ExperimentalWarning`, es inofensivo.
- Puerto: `set PORT=8080` en `iniciar.bat` para cambiarlo.
- Ruta de la base: `set AGENDA_DB=D:\ruta\agenda.db` para moverla.
- Concurrencia: la app avisa si dos personas editan el mismo bloque a la vez
  (una recibe "otra persona modificó este bloque"). Aguanta bien 3–5 usuarios
  simultáneos.
- Tests: `npm test`
