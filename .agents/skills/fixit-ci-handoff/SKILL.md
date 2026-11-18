---
name: fixit-ci-handoff
description: Skill local de FixIt. Revisión de PR, CI reproducible sin AWS/Atlas, comprobación documental/SQL, tests de módulos cuando existan, matriz de casos negativos y handoff entre agentes.
---

# FixIt CI y Handoff

Activar desde `cam-route` para validar un diff o entregar trabajo a otra persona/IA. Siempre empezar leyendo `AGENTS.md`, `docs/016.CI-Team-Workflow.md` y `git status`.

## Prueba real, no casilla ficticia

1. Identificar rama, autor, módulo y `merge-base`; el contrato compartido no puede alterarse en PRs paralelos sin coordinación.
2. Ejecutar `node scripts/ci/check-docs.mjs`, `node scripts/ci/check-contract.mjs` y `npx --yes @redocly/cli@2.79.0 lint docs/openapi.json` (si el registry está accesible). Ejecutar `sh scripts/ci/check-migration.sh` cuando haya contenedor (PostgreSQL 17 **efímero sin red**). Reportar sin ocultar fallos.
3. Si existe `package.json` del módulo, ejecutar **sus scripts reales** con `npm ci`, lint/typecheck, tests de comportamiento y build. Si no existe, marcar **no disponible**, no PASS.
4. Seguridad: pruebas BOLA/IDOR y roles, sesión expirada/revocada, Chat Socket.IO con reassignment, claim atómico, outbox/JetStream repetido, validación adjuntos, no ACK positivo con Mongo caído. Tienen que fallar los accesos indebidos; no alcanza compilar.
5. Revisar `git diff --check`, secretos (usar no-commit-secrets antes de commit autorizado), `npm audit`/Dependency RFC al añadir dependencias, logins y credenciales fuera de artefactos de CI.
6. Solicitar **revisión cruzada** y señalar estado de G0-G5. La CI verde inicial NO significa que el MVP está completo.

## Mensaje de entrega entre IAs

Dejar un resumen pequeño en el PR: **objetivo/FR**, archivos tocados, cambios de API/SQL, qué tests se ejecutaron y su salida, pruebas negativas, límites conocidos, next owner y **qué no se hizo**. No crear handoffs redundantes en `dev`.

## Límites

**Nunca** conectar CI a RDS/Atlas reales, migrar datos compartidos, ejecutar deploy, crear AWS, borrar recursos, hacer commit, push o merge sin aprobación explícita. React+Chat es responsabilidad del usuario; Valeria/Tickets y Rina/Auth son **propuestas pendientes**. `main` protegido, `dev` es contratos; los servicios viven en ramas de producto.
