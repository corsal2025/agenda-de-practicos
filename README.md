# Agenda de Prácticos

Dashboard operativo local para la agenda de exámenes prácticos de licencia de conducir.
Reemplaza el Excel `AGENDA PRÁCTICOS.xlsx`: agenda por examinador, citas disponibles con
reglas de clase, reagendamiento, reporte de errores automático, agenda diaria imprimible
y analítica.

Corre 100% en el PC: servidor Node local + base de datos SQLite en un archivo
(`data/agenda.db`). No usa internet ni servicios externos.

---

## Requisitos

- **Node.js 22.5 o superior** (usa el módulo integrado `node:sqlite`). Verificar con `node --version`.
- Un navegador (Chrome, Edge, Firefox).

## Instalación (una sola vez)

```bash
npm install
```

## Carga inicial de datos

Copiar el Excel original a `data/origen.xlsx` y correr:

```bash
npm run migrar
```

Esto:
- lee las hojas `AGO-DIC` y `ENE-JUN 2027`,
- normaliza los datos sucios (funcionarios mal escritos, resultados de texto libre,
  RUT con formato irregular, clases tipo `D EMPRESA`),
- detecta los bloqueos administrativos (`DÍA ADMINISTRATIVO`, `EXAMEN EN TERRENO`,
  `FIESTAS PATRIAS`, etc.) y los separa de las citas reales,
- genera la grilla completa de bloques (días hábiles, 11 horarios, 3 examinadores).

Para reemplazar todo lo cargado: `npm run migrar -- --limpiar`

También se puede importar desde la pestaña **Datos** de la aplicación.

## Uso diario

Doble clic en **`iniciar.bat`** (Windows), o:

```bash
npm start
```

Abre el navegador en **http://localhost:4900**. Para detener: cerrar la ventana / `Ctrl + C`.

Instalación en el PC de la agenda, login, arranque automático y acceso por red:
ver **[INSTALACION.md](INSTALACION.md)**.

## Login

Por defecto pide un PIN compartido (`1234`, cambiable con `AGENDA_PIN`). Cada acción
queda registrada con el nombre de quien la hizo. Para desactivarlo: `AGENDA_SIN_LOGIN=1`.

---

## Pestañas

| Pestaña | Qué hace |
|---|---|
| **Agenda** | Grilla del día por examinador. Clic en un bloque para agendar, editar, reagendar o liberar. El bloque de las **12:30** admite clases D y A5; el resto no. |
| **Citas disponibles** | Bloques libres en un rango de fechas. Si se filtra por clase D o A5, solo muestra las 12:30. |
| **Reagendar** | Lista las citas marcadas "pendiente de reagendar". Busca una cita por RUT, nombre o teléfono y la mueve a un bloque libre. Marca la nueva como `REAGENDADO` y deja rastro en ambos bloques. |
| **Buscar** | Historial completo de un contribuyente por RUT: todas sus citas, resultados y reagendamientos. |
| **Reporte de errores** | Se recalcula sobre el estado actual. Detecta: cita incompleta, RUT con dígito verificador inválido, clase pesada en bloque incorrecto, duplicado futuro, duplicado el mismo día, conflicto de terreno, cita reciente sin resultado, cita futura sin contacto, cita en día inhábil, pendientes de reagendar. |
| **Agenda del día** | Vista imprimible: una hoja por examinador. Botón **Imprimir**. |
| **Analítica** | KPIs y gráficos: resultado de exámenes, citas por examinador / clase / funcionario, tipo de cita, citas por día y agendados por día. Filtrable por rango de fechas. |
| **Datos** | Importar / exportar Excel (formato dashboard o formato Excel original), backup de la base, generar bloques, editar feriados, listas desplegables, examinadores y funcionarios, **papelera** (recuperar citas liberadas o pisadas), últimos movimientos. |

Además, en **Agenda** → "Bloquear día..." se bloquea un día completo (o el de un examinador)
de un clic, y las citas que ya estaban van a la papelera.

## Reglas de negocio

- 11 bloques por día hábil y por examinador: 08:30, 09:00, ... 13:30.
- **Solo el bloque de las 12:30** admite clases **D** y **A5**. Al agendar una clase pesada
  fuera de ese horario la aplicación bloquea la acción (se puede forzar marcando la casilla).
- Tipos de cita: `NORMAL`, `REAGENDADO`, `TRASLADO EN TERRENO`.
- Resultados: `APROBADO`, `REPROBADO`, `REPROBADO INASISTENCIA`, `NO ASISTIO`.
- Un bloque puede marcarse como **bloqueado** (no disponible) con un motivo:
  terreno, día administrativo, feriado, capacitación, etc.

## Feriados

Los días feriados viven en la base de datos y se editan desde la pestaña **Datos**
(la lista inicial es best-effort para 2026–2027, sembrada desde `server/fechas.js`).
Tras cambiar feriados, volver a generar los bloques del período afectado.

## Backups

- Automático: uno al arrancar el servidor (si el último tiene +20 h) y luego cada 24 h,
  en `data/backups/`. Se conservan los últimos 30 (`AGENDA_BACKUPS` para cambiarlo).
- Cada importación que **no** usa "reemplazar todo" hace un backup antes.
- Backup manual: botón en la pestaña Datos, o `npm run backup`.
- Para restaurar: detener el servidor y copiar el archivo `.db` deseado sobre `data/agenda.db`.

## Tests

```bash
npm test
```

Cubre validación de RUT (módulo 11), normalización de datos del Excel, conversión de
fechas/horas y la importación completa con detección de bloqueos.

## Privacidad de datos

`data/` está en `.gitignore` y **no se sube al repositorio** — contiene RUT, nombres,
correos y teléfonos. Los archivos `.xlsx` / `.csv` en la raíz también están ignorados.

## Estructura

```
server/
  index.js       servidor Express y rutas de la API
  auth.js        login por PIN (cookie de sesión)
  db.js          conexión SQLite, semillas y migración de columnas
  schema.sql     esquema de la base
  config.js      horarios, clases, semillas
  fechas.js      conversión de fechas/horas, feriados semilla
  feriados.js    feriados en base de datos
  normalizar.js  limpieza de datos del Excel
  slots.js       generación de bloques
  migrate.js     importación desde Excel
  errores.js     reglas del reporte de errores
  analitica.js   KPIs y datos de gráficos
  export.js      exportación a Excel (formato dashboard u original)
  papelera.js    respaldo/recuperación de citas borradas
  backup.js      copia de la base + backup automático diario
public/          interfaz (HTML + JS sin framework + Chart.js)
test/            tests (node:test)
data/            base de datos y backups (no versionado)
iniciar.bat      arranque en Windows
```

## Notas técnicas

- `node:sqlite` es experimental en Node 24: al iniciar aparece un `ExperimentalWarning`,
  es inofensivo.
- Para cambiar el puerto: `PORT=8080 npm start`.
- Para usar otra ruta de base de datos: `AGENDA_DB=C:\ruta\agenda.db npm start`.
