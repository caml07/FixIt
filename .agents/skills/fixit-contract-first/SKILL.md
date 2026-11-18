---
name: fixit-contract-first
description: Uso local en FixIt. Cada cambio de payload, endpoint, permisos, Prisma, SQL, eventos o adjuntos exige contrato anterior a controllers, revisión de Rina/Valeria/usuario, fixtures falsos y validación real.
---

# FixIt Contract First

**Activar vía `cam-route`** cuando se diseñe o cambie una API, migración, evento NATS, autorización, adjunto o modelo de tickets. No usar para explicaciones genéricas.

1. Leer `AGENTS.md`, `docs/002.Requirements.md`, `docs/010.G1-Contracts.md`, `docs/011.Gates.md` y estado Git. Confirmar dueño del módulo y qué campos están acordados o pendientes.
2. Definir FR/NFR y matriz de actores. **No extrapolar el ejemplo "luz" a mantenimiento eléctrico**: el MVP sigue siendo IT Help Desk. Para prioridad, separar `reporterUrgency` de `effectivePriority` como **nombres candidatos**, no nombres finales aprobados.
3. Registrar en docs discrepancias con `docs/openapi.json`, `docs/database/schema.prisma` y migraciones. No introducir valores enumerados, límites de video o permisos no ratificados como "decisión".
4. Si el equipo ratifica payload/DDL, actualizar OpenAPI 3.1, Prisma y **nueva** migración SQL coordinada. Conservar FK, CHECK, índices especiales, auditoría, roles SQL separados y outbox. No editar migraciones previamente aplicadas en bases compartidas.
5. Ejecutar checks documentales, validación OpenAPI formal con herramienta declarada, `prisma validate`, migrate deploy/diff en **PG desechable**, pruebas de permisos y carreras según cambios; no dar G1 PASS por sintaxis.
6. Exigir historial Git demostrable: **commit de contrato validado antes del commit con controllers**. Pedir autorización humana antes de cualquier commit/push; no introducir backend funcional en `dev` sin nuevo acuerdo.
7. Regresar matriz `FR → endpoint/schema → test → pendiente` y límites: Chat consulta Auth y Tickets por REST en tiempo real; JetStream es asíncrono, no autoridad RBAC.

**Tests cruciales:** Reporter no puede fijar prioridad oficial con payload manipulado; agente no asignado no puede modificarla; Admin sí, con auditoría. Un ticket de otro usuario nunca revela chat/archivos. Videos y fotografías privados, verificación de MIME/contenido y cuota antes de subir.

**Ruta siguiente:** `fixit-ci-handoff` cuando se prepare PR. No afirmar que los test existen si no están implementados.
