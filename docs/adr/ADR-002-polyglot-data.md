---
type: architecture-decision-record
status: proposed
date: 2026-11-10
---

# ADR-002 — PostgreSQL para dominio y MongoDB para conversación

**Estado:** Proposed; exige acuerdo del grupo y validación de RAM/costo antes de implementar.

## Contexto

Web II incluye Prisma/PostgreSQL y MongoDB/Mongoose; la especificación original usa ambos. Mantener dos bases tiene valor académico, pero aumenta memoria, migraciones, backups, credenciales y manejo de errores. Para un help desk pequeño, **PostgreSQL podría guardar también el chat**, y sería más simple.

## Alternativas

| Opción | Beneficio | Costo/riesgo |
| --- | --- | --- |
| Solo PostgreSQL, mensajes incluidos | Transacciones, menor memoria/operación, un backup | No muestra MongoDB operativo en el proyecto |
| **PostgreSQL + MongoDB (preferida condicionada)** | Relacional para tickets/auditoría y documentos consultables para chat; demuestra ambos motores | Sin FK entre motores, 2 DB, fallos parciales, mayor RAM y copias |
| Mongo para todo | Pocos motores | Relación de tickets, RBAC, claim y auditoría requieren otro diseño; menos cobertura Prisma |

## Decisión propuesta

- PostgreSQL es **única fuente de verdad** para identidades, estados, asignaciones y eventos críticos.
- MongoDB contiene mensajes individuales por ticket, con IDs referenciales de PG y clave idempotente por envío; no almacenar eventos críticos allí como única copia.
- La API orquesta ambos, **sin transacciones distribuidas**. Envíos de mensajes: autorizar vía PG → guardar en Mongo → ACK → emit; falla Mongo no implica éxito.
- Restricciones de índices, paginación y recuperación están en [003.Architecture](../003.Architecture.md).

## Consecuencias

- Se debe probar cierre/reasignación y permisos sobre conversaciones existentes.
- Un ticket puede existir mientras Mongo está caído; la UI muestra chat temporalmente indisponible.
- Cuando se borra un ticket se necesitaría política de datos coordinada; por eso no hay hard-delete en MVP.
- Necesidad de probar memoria local real con ambos motores y backup/restore separado.

## Gate antes de aceptar

1. Profesor Félix confirma que usar MongoDB resulta útil o requerido para la evaluación.
2. Docker Compose local ejecuta PG+Mongo+API con RAM viable para la EC2 costeada.
3. El equipo acepta el riesgo y acuerda quién opera backups de ambos motores.

Si falla cualquiera, preferir **PostgreSQL único** y documentar a MongoDB como opción descartada sin convertir el requisito del curso en excusa de complejidad.
