# REGLAS GLOBALES (CLAUDE + ANTIGRAVITY)

## 1. Disciplina y Estilo (Autonomía + Ponytail + Caveman)
- El agente hace el trabajo pesado; el usuario solo revisa o aprueba.
- **Cero acciones no pedidas:** Prohibido tocar archivos, ramas, paquetes o módulos fuera del pedido. Diagnóstico/consulta = 100% SOLO LECTURA.
- Español directo, sin relleno. El cambio más pequeño y limpio que resuelva el 100%.
- Verificar en código real antes de afirmar. Clase CSS o función compartida: buscar todas sus referencias (`grep`) antes de proponer o editar.
- Commits convencionales, sin `Co-Authored-By`.

## 2. Ahorro de Tokens y Enrutamiento Estricto de Modelos (Cuidar cuota de Argon / Opus)
- **CodeGraph + Headroom primero:** Usar `codegraph_explore` antes de leer archivos enteros y `headroom` para comprimir salidas largas.
- **PROHIBIDO gastar la sesión principal (Gemini 4 Argon / Claude Opus) en ejecución o lectura pesada.**
  - **En Antigravity (Gemini):** La cuota semanal de **Gemini 4 Argon** es limitada y se reserva SOLO para pensar, diseñar planes cortos, coordinar y dictar veredicto final. Todo el desarrollo, lectura masiva, edición de archivos, tests y comandos de consola DEBE delegarse con `invoke_subagent` usando `Model: "flash"` (o `"flash_lite"`, equivalentes livianos de alta velocidad / modelo 38 de desarrollo) y reservando `"pro"` solo si un subagente requiere auditoría compleja.
  - **En Claude Code:** La sesión principal usa `opusplan` (piensa en Opus, ejecuta en Sonnet) y delega a subagentes:

| Tarea | Subagente | Modelo en Claude | Modelo en Antigravity (`invoke_subagent`) |
| :--- | :--- | :--- | :--- |
| **Mecánica / Búsqueda / Comandos:** `grep`, conteos, git, copiar DB SQLite, levantar server, ajustes simples | `orq-mecanico` | `haiku` | `flash_lite` / `flash` |
| **Desarrollo / Código / UI / Tests:** escribir lógica, editar CSS/JS/HTML, crear tests TDD, verificar UI | `orq-constructor` / `orq-verificador-visual` | `sonnet` | `flash` (nunca `inherit` si el padre es Argon) |
| **Pensar / Arquitectura / Árbitro:** diseñar plan corto, diagnosticar bug complejo, auditoría final | `orq-disenador` / `orq-arbitro` | `opus` | Coordinador en **Argon** (o subagente `pro`) |

- **Skills y MCP bajo demanda:** Solo leer `SKILL.md` o activar MCPs secundarios cuando la tarea actual lo exija.

## 3. Enrutador Automático (3 Modos)
- **MODO A (Rol específico / Formato cerrado / Diagnóstico):** Ej. *"Eres el agente de DISEÑO VISUAL..."* o entrega A, B, C, D. Leer solo archivos indicados, auditar internamente y **entregar completo en el primer turno sin preguntas**.
- **MODO B (Cambio rápido UI / CSS / Texto):** Delegar búsqueda `grep` y edición a subagente liviano (`flash` / `haiku` / `sonnet`), correr tests y entregar. Máximo 1 pregunta solo si hay ambigüedad destructiva.
- **MODO C (Nueva Feature / Lógica / Backend / DB / `ACTIVAR PROTOCOLO`):** (Se desactiva con `DESACTIVAR PROTOCOLO` o `MODO LIBRE`).
  1. Investigar módulos afectados con `codegraph_explore` + subagente.
  2. Preguntar **1 sola cosa a la vez** si hay ambigüedad crítica.
  3. Diseñar plan corto con criterios numerados y riesgos. Al confirmar: *«Información completa. Iniciando Fase 2 de Ejecución Autónoma.»*
  4. Construir con subagente de desarrollo (`flash` / `sonnet`): TDD, cero `TODO`/placeholders, DB SQLite aislada en scratchpad (`VACUUM INTO`) y puerto libre.
  5. Auditar contra criterios + `gitleaks`.
  6. Cierre: **1. [ENTREGABLE FINAL]** y **2. [REGISTRO DE AUDITORÍA ADVERSARIAL]**.
