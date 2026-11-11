---
type: architecture-decision-record
status: proposed
reviewed_on: 2026-11-11
decision_id: ADR-005
---

# ADR-005 — Tres servicios, sesiones opacas y eventos durables (propuesto)

## Estado

**PROPOSED / selected for design by the user, NOT accepted by the FixIt team.** El usuario confirmo el 11 nov que desea **Auth + Tickets + Chat como runtimes independientes** con una **base PostgreSQL compartida en esquemas `auth` y `tickets`**. Esto confirma una direccion de diseño, **no** la aceptación de todo ADR-005 ni el PASS de G1. No existe producto implementado ni despliegue; se dispone solo de evidencia historica del spike G2, no de un benchmark de la aplicacion final.

## Contexto

El producto IT Help Desk acordado necesita identidad, tickets con claim atomico y chat persistente. El [ADR-004](ADR-004-eda-two-services.md) documenta la opcion anterior de **Core API + Chat + NATS**. En el handoff 009 el usuario eligio **explorar Auth + Tickets + Chat**, NATS JetStream, bcrypt y sesiones opacas en vez de JWT.

Queremos una separacion comprobable para Web Development II, eventos reales y un modelo de dominio explicable en Software Engineering II, sin agregar IA, hazards, WorkOrder, SLA ni microservicios de relleno.

## Opciones

| Opcion | Beneficio | Costo / riesgo |
| --- | --- | --- |
| A. Monolito modular (ADR-001/003) | Operacion y transacciones mas simples | Menos fronteras de despliegue y ejercicio EDA |
| B. Dos servicios Core + Chat (ADR-004) | Un evento durable y menos infraestructura | Auth y Tickets comparten runtime/ownership |
| C. **Tres servicios Auth + Tickets + Chat (esta propuesta)** | Autoridad de identidad aislada; contratos entre contextos; Chat autonomo | Dos llamadas internas frecuentes, mas secrets, procesos, memoria y pruebas de fallo |
| D. Mas servicios (intake, assignment, notification, etc.) | Limites mas granulares en teoria | Alcance y complejidad injustificados para MVP |

## Direccion seleccionada para el diseno

1. Tres runtimes Express: Auth (Account/Session/Role), Tickets (SupportTicket/Assignment/Timeline/outbox), Chat (Message/Mongo/Socket.io); mismo reverse proxy HTTPS/WSS. **Una base PostgreSQL** para Auth y Tickets con esquemas `auth` y `tickets`, cuentas de BD y privilegios separados. Cada servicio accede solo a sus tablas de negocio mediante su propio rol; las FK referencian `auth.users` desde `tickets` sin convertirlas en una API interna ni permitir consultas arbitrarias cruzadas. Chat mantiene MongoDB.
2. Auth emite sesion opaca de alta entropia en cookie segura y guarda solo hash del token en PG; bcrypt con salt automatico y work factor calibrado. No JWT de browser.
3. Tickets y Chat validan identidad con Auth por introspeccion interna autenticada. Tickets es el **Policy Decision Point** para acceso al ticket; Chat siempre consulta a Tickets para joins, mensajes, historial y destinatarios. NATS no concede permisos.
4. Tickets guarda mutacion de dominio, timeline y outbox en la misma transaccion PG. Publica eventos versionados en JetStream; Chat consume at-least-once de forma idempotente y reconcilia con Tickets cuando la secuencia no concuerda.
5. BCs candidatos: Identity & Access (generic), IT Support Ticketing (core) y Ticket Conversation (supporting). No son equivalentes a dos core contexts academicos. Si la rubrica exige dos contextos **de negocio**, reconsiderar dentro de Tickets el corte Issue Intake / Support Resolution sin desplegar otro servicio por reflejo.
6. Fail-closed al no poder validar sesion o autorizacion; Mongo caido bloquea ACK positivo; JetStream caido no bloquea el commit ya garantizado en PG.

Todos los endpoints, payloads, codigos, politicas de roles y ejemplos de eventos estan **solo propuestos** en [010.G1-Contracts](../010.G1-Contracts.md).

### Decision complementaria de persistencia (seleccionada por usuario, 11 nov)

Se descartan **como direccion inicial** dos bases PostgreSQL totalmente
independientes para Auth y Tickets. En una misma database es posible definir
`tickets.reporter_id` y `tickets.assignee_id` con FK a `auth.users(id)`,
ademas de las FK propias de tickets/timeline. Los esquemas separan namespaces,
**no** bases de datos ni mecanismos de aislamiento completos: se requieren
roles SQL de minimo privilegio, `GRANT REFERENCES` acotado cuando aplique,
`search_path` controlado y migraciones coordinadas. No usar `ON DELETE
CASCADE` para borrar historiales al eliminar usuarios; preferir
desactivacion y retencion definida.

**Trade-off aceptado para el diseño:** se gana integridad referencial SQL y
un modelo 3NF explicable; se sacrifica la independencia de migraciones y
del despliegue de datos entre Auth/Tickets. El ownership de operaciones
sigue gobernado por los contratos REST internos, no por el permiso de FK.
Esto no altera la separacion Chat/Mongo ni NATS JetStream.

**Pendiente para ratificar ADR:** Valeria y Rina revisan límites, privilegios,
DDL, migraciones y disponibilidad; G1 Contract-First exige
`docs/openapi.json` y el modelo 3NF/FK/migraciones validados y
commiteados **antes** de controladores de producto. Ninguno de esos
artefactos está implementado aún.

## Consecuencias y restricciones

- **Beneficio:** frontera de identidad clara, control de asignacion en un solo dueño, eventual consistency intencional en Chat, practicable en pruebas contractuales.
- **Costo:** latencia de introspeccion/authz REST, 3 Node + PG + Mongo + NATS en la misma EC2 candidata y operacion de credenciales internas.
- **Seguridad:** rate limit, limite bcrypt de 72 bytes, CSRF, Origin del upgrade WebSocket, scopes por servicio, logs redactados y revocacion/reasignacion son condiciones de entrada, no extras.
- **Consistencia:** no existe transaccion SQL-Mongo-NATS; no prometer exactly-once ni ausencia absoluta de carreras permiso-vs-reasignacion sin protocolo demostrado.
- **Historico:** ADR-004 y ADR-001 siguen siendo **opciones historicas propuestas**, no marcar superseded antes de aceptar ADR-005.
- **Cloud:** una unica EC2/t3.medium permanece hipotesis; la propuesta de dos VPC/dos VM del PDF compartido por Valeria se evalua contra la rubrica, no se adopta automaticamente.
- **Equipo:** aun no hay aceptacion de los tres integrantes ni confirmacion docente para usar el proyecto en Software Engineering II.

## Evidencia requerida para ACCEPTED / gate G1

- Revisión del equipo a contratos y mapa de contexto; G0 no introduce un requisito academico contradictorio.
- Aprobación explicita de ownership, REST interno, RBAC, eventos v1, amenazas y degradacion.
- Plan verificable para test de claim concurrente, idempotencia, reasignacion y expiracion.
- Si G2 demuestra que no cabe en el presupuesto de RAM o costo, volver a opcion B o A; no aumentar AWS silenciosamente.

## Fuentes

[009.HANDOFF](../009.HANDOFF.md), [002.Requirements](../002.Requirements.md), [006.Decisions](../006.Decisions.md), [010.G1-Contracts](../010.G1-Contracts.md), [PDF adicional de Cloud/SE II](../references/FixIt_Adapting_Cloud_and_Software_Engineering_II_2026-11-10.pdf), [NATS](https://docs.nats.io/concepts/jetstream), [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
