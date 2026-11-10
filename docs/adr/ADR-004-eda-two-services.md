---
type: architecture-decision-record
status: proposed
date: 2026-11-10
---

# ADR-004 — Event-Driven Architecture con dos microservicios

**Estado: PROPOSED.** El usuario desea explorar EDA/microservicios; falta acuerdo del equipo, pruebas de memoria y validación AWS. Este ADR **no reemplaza todavía** el ADR-001 (alternativa de monolito modular).

## Contexto

El MVP IT Help Desk requiere crear tickets, tomar uno de forma atómica, conversar por ticket, almacenar mensajes y auditar. El PDF base organiza una SPA y un server Node/Express. El diseño documentado previamente prefería un monolito modular. Se propone EDA para demostrar desacoplamiento por eventos, con presupuesto Free AWS y una t3.medium de 4 GiB como límite inicial de recursos.

## Alternativas

1. **Monolito modular** (ADR-001): coste y despliegue mínimos, consistente y fácil de probar; no demuestra entrega eventual entre servicios reales.
2. **Dos microservicios con broker durable** (candidato): Core (identidad/tickets/claim) y Chat (mensajes/Socket.io), con NATS JetStream, PostgreSQL y MongoDB bajo ownership separado.
3. **Cinco o más microservicios** (auth, tickets, chat, notifications, analytics, etc.): aumenta operaciones, latencias, contratos y consumo de RAM sin valor adicional demostrado en este MVP.

## Decisión que se propone aceptar

- Dos servicios desplegables independientes, **core-api** y **chat-service**, detrás de reverse proxy.
- **core-api** es el único que escribe tickets, asignaciones, roles, sesiones y auditoría en PostgreSQL; usa outbox dentro de transacción PG.
- **chat-service** es el único que escribe mensajes en Mongo; valida autorización de ticket con Core para *join* y *send*, sin acceso directo a PostgreSQL.
- **NATS JetStream** interno almacena eventos `ticket.created.v1`, `ticket.claimed.v1`, `ticket.status-changed.v1`, `ticket.reassigned.v1` (nombres ilustrativos, contrato pendiente).
- Broker proporciona **at-least-once**, no exactly-once; consumidores idempotentes por `eventId`. Reconciliar estado después de fallos.
- Todo en **una EC2 t3.medium como candidato de hosting**, sin llamar a eso alta disponibilidad o independencia de fallos físicos.
- S3 versiona *releases*, no mensajes, ni eventos, ni reemplaza Git.

## Consecuencias aceptables solo con gates

**A favor:** demuestra EDA/microservicios de verdad, ownership de datos, outbox, idempotencia, pruebas de contrato y trazabilidad; mantiene React/Express/SQL/NoSQL/Socket.io.

**En contra:** más contenedores/operación, dependencia interna Core→Chat para permisos, caídas parciales, necesidad de monitoreo; 4 GiB puede no ser suficiente. El trabajo de Web II y Cloud debe priorizarse por encima de mecanismos distribuidos decorativos.

**Mitigaciones:** spike local con limitación 4 GiB; pruebas de eventos duplicados/reintentados; test de asignación concurrente; test de socket tras reasignación; límites de recursos Docker; revisión de costos/CPU burst y restauración.

## Gate de aprobación o rechazo

- G0: rúbricas y alcance claros.
- G1: ownership, contrato eventos JSON v1 y estrategia de autenticación entre servicios aprobados.
- G2: backend + Mongo + PG + NATS + reverse proxy caben en un perfil similar a t3.medium con margen para OS.
- G3: claim transaccional + outbox + consumidor idempotente verificables con pruebas.
- Si G2/G3 no pasan a tiempo, reducir a un **monolito modular con bus interno/outbox o un solo servicio** y registrar el compromiso, sin añadir AWS ni servicios caros sin aprobación.

**Reemplaza:** ninguno mientras esté Proposed. Cuando se acepte, actualizar 003, 004, 005, 006 y marcar ADR-001 como opción descartada o superada, conservando su historia.

Fuente: [007.EDA-Evaluation](../007.EDA-Evaluation.md), [008.Repository-Structure](../008.Repository-Structure.md), [PDF original](../references/FixIt_Project_Specification.pdf), https://docs.nats.io/concepts/jetstream, https://aws.amazon.com/ec2/instance-types/t3/ .
