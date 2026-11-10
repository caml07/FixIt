# Cobertura academica y pendientes

**Estado:** plan de alineacion; no demuestra funcionalidades implementadas.
**Fuentes verificadas en vault local:** `COP3851_Web_Development_II/RESOURCES/SYLLABUS/Syllabus_Notes.md` y `CEN4086_Cloud_Internet_Computing/RESOURCES/SYLLABUS/Syllabus_Notes.md`, basadas en los PDF oficiales Fall 2026. Los originales tienen precedencia si existe discrepancia.

## Web Development II (COP3851)

| Tema del syllabus | Demostracion prevista en FixIt |
| --- | --- |
| Node, async/await, ES modules, npm, buffers y streams (semanas 1–2) | API Node/Express, operaciones async; streaming solo si se adopta exportacion/adjuntos |
| HTTP, routing, middleware, CORS y errores (3–4) | REST, middlewares de autenticacion, validacion y errores |
| REST, Zod/Joi, filtros/paginacion (5–6) | Tickets filtrables, contratos validados y errores estandarizados |
| Prisma/PostgreSQL y relaciones; MongoDB/Mongoose (6–8) | Usuarios/tickets y mensajes por ticket |
| bcrypt, cookies/JWT vs sesiones, RBAC y hardening (8–10) | Registro/login, roles, ownership, rate limiting y proteccion de endpoints |
| Tests y Supertest (10–11) | Concurrencia en autoasignacion, rutas protegidas y tests de Socket.io |
| WebSockets/Socket.io (12) | Chat y notificaciones por ticket |
| Logging, Docker, OpenAPI (13–14) | Health checks, contenedores y documentacion HTTP |

**Advertencia:** no todos los topicos estan demostrados solo por elegir una herramienta. Por ejemplo, sin un caso de uso real de streams o MongoDB aggregation, esas habilidades no quedan cubiertas automaticamente.

## Cloud & Internet Computing (CEN4086)

| Tema del syllabus | Evidencia propuesta |
| --- | --- |
| Virtualizacion y contenedores (semana 3) | EC2 + imagenes/Compose |
| Cloud networking, VPC y subnets (semanas 5–6) | Diagrama de red y reglas efectivas |
| Connectivity/security (7–9) | Acceso privado por SSM, roles, SG, control de trafico y MFA |
| IAM, KMS/Secrets Manager (10) | Acceso humano minimo y gestion de secretos si se implementa |
| Storage/databases (11) | Volumenes, persistencia y backup verificable |
| Observabilidad (12) | Logs, estado/alarma de salud y evidencia |
| Automation / IaC (13–14) | Configuracion reproducible solo si hay tiempo y rubrica lo requiere |

## Distribucion propuesta, no asignada

- **caml07:** Web II (backend/autorizacion/integracion) y Cloud (red/seguridad).
- **avaleria13:** Web II (datos/tickets/pruebas) y Cloud (contenedores, persistencia y monitoreo).
- **Rinahrrg:** Web II (frontend/integracion/operacion de datos); su nota/participacion en Cloud se debe confirmar. Acceso AWS limitado no significa que tenga una entrega academica de Cloud.

Esta tabla no impone responsabilidades; el equipo debe repartir el trabajo de acuerdo con tiempo y experiencia.

## Calendario de referencia

- **Web II:** semanas 11–14 = tests de integracion, WebSockets, logs, Docker y OpenAPI; syllabus contempla presentaciones en semana 15 (a partir del 7 dic).
- **Cloud:** semana 11 = primer reporte de avance del grupo; semana 14 = reporte/presentacion final. **La fecha exacta no figura en el syllabus de Cloud**.
- El PDF original FixIt indica presentacion el **7 de diciembre de 2026** (p. 1); confirmar exigencias reales con docentes.

## Gaps antes de convertir esto en plan de implementacion

1. Revisar rubricas oficiales: proyecto Web II, proyecto Cloud, si ambos pueden usar el mismo producto y como presentar contribuciones individuales.
2. Elegir el camino minimo del demo de extremo a extremo antes que perseguir todo el syllabus.
3. Definir seguridad de auth/cookies y accesos SSM, respaldos y estrategia de costos con evidencia.
4. Cerrar modelo de conversacion, quien puede cerrar/reabrir y como operar offline o con DB desconectada.
5. Diseñar prueba de integracion y un plan de recuperacion ante fallos de AWS; no dejar el deployment para el ultimo dia.

**Nota de integridad academica:** los syllabus de ambas materias exigen conocimiento/aprobacion del instructor para trabajos asistidos por IA que se entreguen. Documentar el uso y conservar las fuentes originales.
