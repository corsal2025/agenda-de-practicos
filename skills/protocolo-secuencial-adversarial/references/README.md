# Referencias del Protocolo Secuencial Adversarial

## Archivos relacionados

- `PROTOCOLO_PERMANENTE.md` — Versión completa en raíz del proyecto
- `CLAUDE.md` — Configuración de proyecto para activación automática con Claude Code
- `skills/protocolo-secuencial-adversarial/SKILL.md` — Este skill

## Uso con diferentes agentes

### Claude Code
El protocolo se activa automáticamente si existe `CLAUDE.md` en la raíz del proyecto con el protocolo definido.

### opencode
Cargar el skill explícitamente:
```bash
opencode skill load skills/protocolo-secuencial-adversarial/SKILL.md
```

### Otros agentes
Leer `PROTOCOLO_PERMANENTE.md` y seguir las instrucciones manualmente.

## Comandos de control

| Comando | Efecto |
|---------|--------|
| `ACTIVAR PROTOCOLO` | Activa (estado por defecto) |
| `DESACTIVAR PROTOCOLO` / `MODO LIBRE` | Desactiva |

## Estructura del proyecto

```
agenda-de-practicos/
├── PROTOCOLO_PERMANENTE.md      # Protocolo completo
├── CLAUDE.md                    # Config auto-activación (Claude Code)
├── skills/
│   └── protocolo-secuencial-adversarial/
│       ├── SKILL.md             # Este skill
│       ├── assets/              # Plantillas, esquemas (futuro)
│       └── references/
│           └── README.md        # Este archivo
```