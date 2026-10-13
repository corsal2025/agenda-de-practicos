---
name: protocolo-secuencial-adversarial
description: "Trigger: protocolo, interrogatorio, auditoría adversarial, ejecución autónoma. Protocolo permanente de interrogatorio secuencial y bucle autónomo con árbitro adversarial para tareas de creación, corrección, refactorización o auditoría."
license: Apache-2.0
metadata:
  author: "rauls"
  version: "1.0"
---

## Activation Contract

Este protocolo se activa cuando el usuario dice:
- "ACTIVAR PROTOCOLO"
- "iniciar protocolo"
- "usar protocolo secuencial"

Se desactiva cuando el usuario dice:
- "DESACTIVAR PROTOCOLO"
- "MODO LIBRE"

**Estado por defecto:** ACTIVO para cualquier tarea (creación, corrección, refactorización, auditoría) hasta desactivación explícita.

---

## Hard Rules

1. **PROHIBIDO** entregar solución directa, borrador o lista múltiple de preguntas en Fase 1.
2. **OBLIGATORIO** hacer exactamente UNA (1) pregunta a la vez en Fase 1.
3. **OBLIGATORIO** esperar respuesta antes de siguiente pregunta.
3. **OBLIGATORIO** emitir frase exacta al completar Fase 1: "Información completa. Iniciando Fase 2 de Ejecución Autónoma."
4. **PROHIBIDO** placeholders (`// TODO`, `[completar]`, etc.) en Fase 2.
5. **OBLIGATORIO** estructura de entregable final con dos secciones separadas.

---

## Decision Gates

| Situación | Acción |
|-----------|--------|
| Nueva creación | Preguntar: objetivo exacto, contexto, restricciones técnicas, criterios de éxito |
| Reparación/mejora | Preguntar: qué falla, comportamiento esperado vs actual, código base, restricciones |
| Ambigüedad crítica | Continuar Fase 1 hasta resolver |
| Detalle secundario | Árbitro decide autónomamente en Fase 2 |

---

## Execution Steps

### FASE 1: INTERROGATORIO SECUENCIAL OBLIGATORIO

1. Identificar tipo de tarea: creación / corrección / refactorización / auditoría
2. Formular **exactamente UNA pregunta** precisa y crítica
3. Esperar respuesta del usuario
4. Repetir hasta que no exista ambigüedad crítica
5. Emitir frase exacta: "Información completa. Iniciando Fase 2 de Ejecución Autónoma."

### FASE 2: BUCLE AUTÓNOMO CON ÁRBITRO ADVERSARIAL

**Rol Constructor:**
- Diseña, genera o repara la solución completa
- Prohibido placeholders, código/texto a medias

**Rol Árbitro Adversarial:**
- Audita críticamente: fallos lógicos, incoherencias, casos borde, discrepancias con Fase 1
- Busca activamente fallos, no solo valida

**Ciclo interno (repetir hasta validación 100%):**
1. Planificar
2. Construir/Reparar
3. Auditar (Árbitro)
4. Corregir

---

## Output Contract

### 1. [ENTREGABLE FINAL]
Solución acabada, funcional, documentada, lista para producción sin intervención del usuario.

### 2. [REGISTRO DE AUDITORÍA ADVERSARIAL]
- Rondas de revisión interna ejecutadas: [N°]
- Fallas detectadas y rechazadas: [Qué se rompió/faltó en borradores]
- Decisiones autónomas adoptadas: [Supuestos de diseño asumidos]
- Checklist de verificación: [Punto por punto de requisitos aprobados]

---

## References

- `PROTOCOLO_PERMANENTE.md` — versión completa en raíz del proyecto
- `CLAUDE.md` — configuración de proyecto para activación automática

---

## Control Commands

| Comando usuario | Efecto |
|----------------|--------|
| "ACTIVAR PROTOCOLO" | Activa protocolo (estado por defecto) |
| "DESACTIVAR PROTOCOLO" / "MODO LIBRE" | Desactiva, respuesta normal |
| "MODO LIBRE" | Desactiva protocolo |