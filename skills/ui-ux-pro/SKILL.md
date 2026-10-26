---
name: ui-ux-pro
description: Sistema de diseno institucional White & Blue V18, directrices para tablas densas de datos a 1440x900, accesibilidad WCAG AA estricta, reglas de impresion sin truncado y protocolo de auditoria DOM visual.
---

# Sistema de Diseno y Directrices UI/UX Pro (White & Blue V18)

Este manual y conjunto de reglas accionables rige el diseno, composicion visual, maquetacion CSS y accesibilidad para interfaces institucionales, paneles de gestion y tablas densas de datos. Cero improvisacion, cero placeholders, 100% precision matematica y usabilidad probada.

---

## 1. Sistema de Diseno Institucional «White & Blue V18»

El sistema visual *White & Blue V18* prioriza la claridad cognitiva, la reduccion de fatiga visual en jornadas laborales intensas y la sobriedad institucional.

### 1.1 Paleta de Tokens y Superficies
- **Superficie Base (Papel):** `#ffffff` (`var(--papel)`). Fondos limpios para tarjetas, modales y celdas activas.
- **Superficie Secundaria / Fondo:** `#eef2fb` (`var(--fondo)`). Proporciona profundidad sutil sin recurrir a grises sucios.
- **Superficie Elevada / Contenedores:** `#f5f7fd` (`var(--elev)`) o `#f8fafc`.
- **Acento Primario Institucional:** `#26388c` (`var(--azul)`). Accion principal, encabezados principales (`var(--azul-th)`).
- **Acento Secundario / Interactivo:** `#1a2766` (`var(--azul-900)` o `var(--azul-700)`) para estados `:active` / `:hover`.
- **Linea Delimitadora / Bordes:** `#d9def0` (`var(--linea)`). Grosor exacto de `1px solid var(--linea)` para divisiones internas.
- **Borde de Resalte / Eje:** `#3a55c0` (`var(--azul-linea)`). Usado en separaciones estructurales y divisiones de fecha/dia.
- **Tintas y Tipografia:**
  - Tinta principal (titulos, texto base): `#1b2140` (`var(--tinta)`). Luminancia balanceada para contraste WCAG AAA.
  - Tinta secundaria (metadatos, etiquetas): `#4d5578` (`var(--tinta-2)`). Contraste verificado ≥ 4.5:1.
  - Tinta atenuada (iconos secundarios, placeholders): `#6b7396` (`var(--tinta-3)`).
- **Sombras de Baja Opacidad (Zero-Harshness):**
  - `--sh`: `0 1px 2px rgba(27, 33, 80, 0.06), 0 4px 12px rgba(27, 33, 80, 0.06)`.
  - Sombras laterales divisorias: `4px 0 10px -2px rgba(27, 33, 64, 0.12)`.

---

## 2. Reglas para Tablas Densas de Datos (Viewport 1440×900)

En resolucion de escritorio estandar (1440×900 px), las tablas de gestion densa presentan columnas congeladas (`position: sticky`) que no deben estrangular el espacio de las columnas de datos variables.

### 2.1 Presupuesto de Ancho para Columnas Sticky (Regla del ≤ 38%)
- **Presupuesto Maximo Acumulado:** El conjunto de columnas con `position: sticky; left: ...` **NO debe superar el 38% del viewport (maximo 550px en 1440px)**.
- **Distribucion recomendada para Agenda de Practicos:**
  1. `Columna Fecha`: `width: 118px; left: 0;` (borde derecho `1px solid var(--linea)`).
  2. `Columna Hora`: `width: 92px; left: 118px;` (borde derecho `1px solid var(--linea)`).
  3. `Columna Nombre / Titular`: `width: 220px; left: 210px;`.
  4. `Columna RUT / ID`: `width: 120px; left: 430px;` (ultima columna sticky).
  - **Suma acumulada:** `118 + 92 + 220 + 120 = 550px` (38.1% de 1440px, dejando 890px libres para el resto de columnas).

### 2.2 Prohibicion Estricta de Transparencia en Celdas Sticky
- **Principio Fundamental:** Cualquier elemento con `position: sticky` **debe declarar obligatoriamente un `background-color` solido y opaco**.
- **Error critico prevenido:** Si una celda sticky no tiene fondo o hereda `background: transparent`, el texto y numeros de las columnas que scrollean por debajo se transparentaran, volviendo la interfaz ilegible.
- **Encabezados `th` sticky:**
  ```css
  #view #tabla-agenda-main thead th.th-hora,
  #view #tabla-agenda-main thead th.th-fecha,
  #view #tabla-agenda-main thead th.th-nombre,
  #view #tabla-agenda-main thead th.th-rut {
    background-color: var(--azul-th) !important;
    color: #ffffff !important;
  }
  ```

### 2.3 Sincronizacion Obligatoria de Fondos en Estados de Fila
Cuando la fila (`<tr>`) cambia de estado visual o recibe `:hover`, las celdas sticky (`td.fecha-celda`, `td.td-nombre`, `td.td-rut`) deben sincronizar explicitamente su `background-color`:
- **Fila en `:hover` o Fila Activa (`.row-activa` / `.fila-activa`):**
  ```css
  tr:hover td.td-nombre,
  tr:hover td.td-rut,
  tr.row-activa td.td-nombre,
  tr.row-activa td.td-rut {
    background-color: var(--azul-50) !important;
  }
  ```
- **Fila Libre (`.fila-libre`):**
  ```css
  tr.fila-libre td:not(.fecha-celda) {
    background-color: var(--elev);
  }
  ```
- **Fila Bloqueada (`.fila-bloqueada`):**
  ```css
  tr.fila-bloqueada td:not(.fecha-celda) {
    background-color: var(--alerta-bg);
  }
  ```

### 2.4 Delimitador Separador en la Ultima Columna Sticky
La transicion entre las columnas fijadas a la izquierda y el contenido desplazable horizontalmente debe tener una delimitacion inequivoca:
```css
#view #tabla-agenda-main thead th.th-rut,
#view #tabla-agenda-main tbody td.td-rut {
  border-right: 2px solid var(--azul-linea) !important;
  box-shadow: 4px 0 10px -2px rgba(27, 33, 64, 0.12);
}
```

---

## 3. Accesibilidad WCAG AA Estricta

Toda interfaz debe cumplir el estandar **WCAG 2.1 Nivel AA**.

### 3.1 Criterios de Contraste Luminico
- **Texto Normal (< 18pt o < 14pt bold):** Relacion de contraste minima obligatoria de **4.5:1** contra el fondo inmediato.
- **Texto Grande (≥ 18pt o ≥ 14pt bold) y Componentes UI:** Relacion minima de **3.0:1**.
- **Botones Deshabilitados (`:disabled`) y Avisos Inactivos:**
  - Evitar opacidades inferiores a `0.6` si la tinta de base ya es gris.
  - Usar tokens explicitos como `var(--tinta-2)` o `var(--tinta-3)` para asegurar que el texto sea legible para funcionarios de edad avanzada o pantallas con bajo angulo de vision:
  ```css
  .btn:disabled {
    color: var(--tinta-2) !important;
    background-color: var(--linea-2) !important;
    cursor: not-allowed;
  }
  ```
- **Prohibicion de Texto Blanco sobre Fondos Claros:**
  - Si un encabezado o boton tiene fondo blanco (`#ffffff`), el texto debe ser oscuro (`#1b2140` o `#26388c`).
  - Nunca permitir herencias donde un `th` tome texto blanco pero el fondo sea blanco o transparente.

---

## 4. Reglas de Hoja de Impresion (`@media print` / `.hoja-dia`)

En sistemas de atencion y agendas operativas, las listas impresas en papel son documentos de trabajo diario en terreno.

### 4.1 Prohibicion Absoluta de Truncado en Papel
- **En pantalla:** Es comun usar `white-space: nowrap; text-overflow: ellipsis; overflow: hidden;` para nombres largos.
- **En impresion (`@media print`): ESTA TOTALMENTE PROHIBIDO.** En una hoja impresa los puntos suspensivos ("...") impiden identificar al titular, evaluar practicos o validar RUTs.
- **Regla obligatoria:**
  ```css
  @media print {
    .hd-tabla .hd-nom,
    .hu-tabla .hu-nom,
    table.tabla-impresion td.td-nombre,
    table.tabla-impresion td.td-rut {
      white-space: normal !important;
      overflow: visible !important;
      text-overflow: clip !important;
      word-break: break-word;
      font-size: 10.5px;
      color: #0f172a !important;
    }
  }
  ```

### 4.2 Tinta y Economia de Toner
- Fondos de tarjetas y decoraciones pesadas deben desaparecer: `background: #ffffff !important; box-shadow: none !important;`.
- Tinta de impresion: usar negro o gris ultra-oscuro `#0f172a` sobre fondo blanco puro.
- Bordes de tabla para impresion: `1px solid #cbd5e1 !important`.
- Evitar saltos de pagina huerfanos en medio de una fila:
  ```css
  @media print {
    tr, .fila-agenda, .tarjeta-resumen {
      page-break-inside: avoid;
      break-inside: avoid;
    }
  }
  ```

---

## 5. Protocolo de Verificacion y Auditoria Visual

Cada modificacion en templates HTML, modulos JS o estilos CSS debe pasar obligatoriamente el siguiente ciclo:

1. **Inspeccion de Sintaxis:**
   ```bash
   node --check scripts/ui-audit.js
   ```
2. **Ejecucion de Auditoria Automatizada:**
   ```bash
   node scripts/ui-audit.js http://127.0.0.1:<PORT>/
   ```
   El script evalua automaticamente a 1440×900:
   - Desborde horizontal no deseado (`scrollWidth > innerWidth`).
   - Ancho acumulado de columnas sticky (alerta si > 560px).
   - Fondos solidos en celdas sticky.
   - Relacion de contraste WCAG AA real calculando luminancia relativa.
   - Truncamiento indebido de datos criticos.
3. **Verificacion Visual con `orq-verificador-visual`:**
   Captura de pantalla a 1440×900 desktop y 390px mobile, comprobando legibilidad y renderizado exacto.
