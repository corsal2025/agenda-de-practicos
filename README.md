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

```bash
npm start
```

Abre el navegador en **http://localhost:4173**

Para detener el servidor: `Ctrl + C` en la terminal.

---

## Pestañas

| Pestaña | Qué hace |
|---|---|
| **Agenda** | Grilla del día por examinador. Clic en un bloque para agendar, editar, reagendar o liberar. El bloque de las **12:30** admite clases D y A5; el resto no. |
| **Citas disponibles** | Bloques libres en un rango de fechas. Si se filtra por clase D o A5, solo muestra las 12:30. |
| **Reagendar** | Busca una cita por RUT, nombre o teléfono y la mueve a un bloque libre. Marca la nueva como `REAGENDADO` y deja rastro en ambos bloques. |
| **Reporte de errores** | Se recalcula sobre el estado actual. Detecta: cita incompleta (falta RUT o nombre), RUT con dígito verificador inválido, clase pesada en bloque incorrecto, duplicado futuro (mismo RUT con 2+ citas próximas), conflicto de terreno (examinador ausente con citas en oficina), cita reciente sin resultado. |
| **Agenda del día** | Vista imprimible, una columna por examinador. Botón **Imprimir**. |
| **Analítica** | KPIs y gráficos: resultado de exámenes, citas por examinador / clase / funcionario, tipo de cita, tendencia diaria. Filtrable por rango de fechas. |
| **Datos** | Importar / exportar Excel, backup de la base, generar bloques para nuevas fechas, editar listas desplegables, examinadores y funcionarios, ver últimos movimientos. |

## Reglas de negocio

- 11 bloques por día hábil y por examinador: 08:30, 09:00, ... 13:30.
- **Solo el bloque de las 12:30** admite clases **D** y **A5**. Al agendar una clase pesada
  fuera de ese horario la aplicación bloquea la acción (se puede forzar marcando la casilla).
- Tipos de cita: `NORMAL`, `REAGENDADO`, `TRASLADO EN TERRENO`.
- Resultados: `APROBADO`, `REPROBADO`, `REPROBADO INASISTENCIA`, `NO ASISTIO`.
- Un bloque puede marcarse como **bloqueado** (no disponible) con un motivo:
  terreno, día administrativo, feriado, capacitación, etc.

## Feriados

Los días feriados están en `server/fechas.js` (constante `FERIADOS`). Es una lista
best-effort para 2026–2027. Si un feriado cambia o falta, editar ese arreglo y volver a
generar los bloques desde la pestaña Datos.

## Backups

- Cada importación que **no** usa "reemplazar todo" hace un backup automático en
  `data/backups/`.
- Backup manual: botón en la pestaña Datos, o `npm run backup`.
- Para restaurar: detener el servidor y copiar el archivo `.db` deseado sobre `data/agenda.db`.

## Privacidad de datos

`data/` está en `.gitignore` y **no se sube al repositorio** — contiene RUT, nombres,
correos y teléfonos. Los archivos `.xlsx` / `.csv` en la raíz también están ignorados.

## Estructura

```
server/
  index.js       servidor Express y rutas de la API
  db.js          conexión SQLite y semillas
  schema.sql     esquema de la base
  config.js      horarios, clases, semillas
  fechas.js      feriados y conversión de fechas/horas
  normalizar.js  limpieza de datos del Excel
  slots.js       generación de bloques
  migrate.js     importación desde Excel
  errores.js     reglas del reporte de errores
  analitica.js   KPIs y datos de gráficos
  export.js      exportación a Excel
  backup.js      copia de la base
public/          interfaz (HTML + JS sin framework + Chart.js)
data/            base de datos y backups (no versionado)
```

## Notas técnicas

- `node:sqlite` es experimental en Node 24: al iniciar aparece un `ExperimentalWarning`,
  es inofensivo.
- Para cambiar el puerto: `PORT=8080 npm start`.
- Para usar otra ruta de base de datos: `AGENDA_DB=C:\ruta\agenda.db npm start`.
