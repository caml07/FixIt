# FixIt — CONTEXT

> Ultima revision: 11 de noviembre de 2026 (America/Managua).
> Documento de continuidad para el equipo y asistentes que retomen el repositorio.
> El estado verificable y los cambios aprobados por el equipo están en los
> documentos enlazados. Este archivo **no aprueba gates ni ADR por sí mismo**.

## Qué es FixIt

Proyecto universitario de **IT Help Desk** para gestionar incidentes de TI
de profesores, personal y usuarios autorizados en un piloto; no se incluye a
estudiantes como usuarios generales del MVP. El producto reúne tickets,
asignación de agentes y chat privado asociado a cada ticket.

Se busca reutilizar una sola solución para Web Development II y Cloud &
Internet Computing, con posible alineación adicional a Software Engineering II.
No ampliar de momento el alcance a mantenimiento de instalaciones, IA, SLA,
adjuntos o funcionalidades accesorias. Ver [Product](docs/001.Product.md),
[Requirements](docs/002.Requirements.md) y
[course-alignment](docs/course-alignment.md).

## Qué decisiones sí quedaron confirmadas

**De producto, por el usuario:**

- El alcance es **IT Help Desk**, con cuentas personales y acceso por rol.
- **No existe autoregistro**: un Admin aprovisiona las cuentas y entrega una
  contraseña temporal; el primer inicio obliga a cambiarla. Este es el
  comportamiento esperado, consistente con el proceso de creación de cuentas
  que el usuario conoce de su universidad. **No se ha acreditado que sea una
  política institucional formal ni se han cerrado entrega/caducidad/bootstrap.**
- Chat pertenece a cada ticket; solo sus participantes autorizados deben
  acceder. **B2 alternativa A elegida por el usuario (11 nov):** las
  operaciones nuevas del agente anterior se rechazan tras la reasignacion,
  pero las que ya estaban autorizadas y en vuelo pueden finalizar; el agente
  anterior deja de recibir nuevos broadcasts. Falta ratificacion del equipo
  y pruebas de concurrencia sobre el producto: **no implica atomicidad
  transaccional entre PostgreSQL y MongoDB**.

**Preferencias técnicas en estudio, no ratificadas por el equipo:**

- Candidato principal: **Auth, Tickets y Chat**, con REST interno, Socket.IO
  para chat, **una PostgreSQL con esquemas `auth`/`tickets` y roles SQL
  separados** (propuesta aceptada expresamente por usuario, 11 nov),
  MongoDB para mensajes en Chat y NATS JetStream para eventos. Sesiones
  **opacas**, hashes bcrypt, autorización interna por servicio.
  **Tres runtimes se mantienen independientes**; las FK entre esquemas
  aportan integridad, no dan acceso libre a tablas ajenas. Falta ratificacion
  por Valeria/Rina y especificar migraciones/privilegios; ADR-005 **sigue
  propuesto**. Ver [G1-Contracts](docs/010.G1-Contracts.md).
- Alternativa conservada: **Core (Auth+Tickets) + Chat**. El monolito modular
  es una opción histórica de respaldo. La comparación de rendimiento NO
  acepta ni rechaza por sí sola [ADR-005](docs/adr/ADR-005-three-services-opaque-sessions.md).
- No ejecutar despliegues de AWS ni modificar el plan de cuenta, costos o
  permisos sin autorización explícita.

## Actualización académica obligatoria — Mr. Felix, COP3851 (11 nov)

El usuario compartió la especificación de una página **Final Capstone:
Contract-First REST APIs & DevSecOps Pipeline**. Su transcripción y fuente
están en [docs/references/COP3851_Capstone_2026-11-11.md](docs/references/COP3851_Capstone_2026-11-11.md).

- **Antes de que agentes de IA creen nuevos controladores:** generar
  `docs/openapi.json`, modelo relacional **3NF con FK explícitas** y
  migraciones; **commitearlos previamente** (no solo escribirlos en Markdown).
  Aún **NO existen** esos archivos definitivos ni ese commit. El spike de G2
  es histórico y no cuenta como cumplimiento contractual del capstone.
- **`CONTEXT.md` es nuestra unica constitucion canonica** para agentes,
  arquitectura y continuidad del equipo; no crear otra con contenido
  duplicado. **Advertencia de rubrica:** el PDF exige literalmente un archivo
  raiz `CLAUDE.md` o `GEMINI.md`; `CONTEXT.md` por si solo **no satisface
  ese nombre de archivo**. Dejar este conflicto explicito para comprobarlo
  con Felix y, si hace falta, introducir al final un archivo puente minimo
  que apunte a este CONTEXT, sin mantener dos textos diferentes.
- Rubrica: **25%** OpenAPI/3NF/migraciones, **20%** arquitectura/middleware,
  **25%** seguridad y AI Red Team, **20%** solución funcional, **10%** defensa
  en vivo/extension de middleware.
- La hoja permite **Session/JWT**, **Argon2/BCrypt**, **PostgreSQL/SQLite**;
  no requiere JWT ni MongoDB para sesiones, ni abandona la opción de tres
  servicios. Sí necesita evaluar cómo demostrar FK cuando los IDs de Auth
  y Tickets cruzan fronteras de servicio.
- **Nota oral no verificada:** Felix pudo mencionar guardar registros de
  sesiones/tokens en **MongoDB/Mongoose** con estado `deprecated` en lugar
  de borrarlos. No está en el PDF. Distinguir **retención de registro** de
  **autorización**: un token cerrado/caducado no puede continuar siendo válido.
  No mover el store Auth desde PostgreSQL sin confirmar semántica y revisar G1.
- Añadir **[DEPENDENCY RFC] + npm audit** para paquetes nuevos de backend;
  pruebas adversariales de BOLA, SQL/NoSQL, CORS y rate limit con evidencia.
  No se han ejecutado todavía contra la API de producto.

### Reglas para agentes y contribuyentes (fuente única)

1. **Contract-First:** no generar ni modificar controladores de backend del
   producto hasta que `docs/openapi.json`, esquema relacional 3NF con FK
   explicitas y migraciones estén **validados y commiteados previamente**.
   Implementar exactamente rutas, auth, request/response y códigos de estado
   de OpenAPI. Primero actualizar el contrato si debe cambiar.
2. **BOLA/IDOR:** Auth autentica, Tickets decide acceso al recurso; filtrar
   lectura, listado, actualización y broadcast por owner/asignado/Admin
   desde backend y consultas de datos. `WHERE tenant_id = current_user` es
   el **ejemplo del PDF**, no una columna que debamos inventar; confirmar si
   se exige multi-tenancy o si la política de propiedad por ticket basta.
3. **Persistencia:** prohibido construir SQL con entradas concatenadas;
   usar parametros/ORM, FK y migraciones. En Mongo validar tipos/operadores
   (prevenir NoSQL injection). Ticket/timeline/outbox en transacción.
4. **Sesiones y cookies:** HTTPS/WSS, `HttpOnly; Secure; SameSite=Strict`,
   CORS con allowlist de orígenes, CSRF y Origin en WebSockets; logout/expiry
   invalidan la sesión **del lado servidor**. Un documento conservado en Mongo
   como histórico nunca autoriza si está revocado o vencido.
5. **Dependencias:** toda nueva librería de backend del producto requiere
   una nota corta **[DEPENDENCY RFC]** con versión, razón frente a implementar
   middleware manual, resultado **real** de `npm audit`, mitigación de CVEs
   y alternativa. El spike histórico no aprueba sus dependencias para G4.
6. **Validación y entrega:** preparar Red Team de BOLA/IDOR, SQL/NoSQL,
   CORS con credenciales, rate-limit bypass, y pruebas de sesiones/cookies;
   preservar pruebas negativas, correcciones y retests en el código real.
   Demostrar ampliación de una regla de middleware en defensa en vivo.
   Ningún gate ni ADR se aprueba por una prueba de laboratorio aislada.
7. **Operación:** no exponer secretos, tokens o cuerpos de mensajes en logs;
   no subir credenciales, hacer auto-commits, auto-push ni gastar AWS sin
   autorización expresa.

## Por qué conservamos un único Markdown de benchmarks

El historial de los benchmarks quedó concentrado en
[docs/013.Spike-Results.md](docs/013.Spike-Results.md), incluyendo resultados,
metodología, limitaciones y hallazgos G3.
Por decisión del usuario se retiró del checkout actual `spikes/g2/`:
servidor experimental, scripts, dependencias y los **81 archivos de
resultados** (JSON, TSV, logs y resúmenes). El histórico completo aún puede
recuperarse por Git desde el commit `5df9b8c`, pero **el benchmark ya no se
puede volver a ejecutar desde HEAD**. Cuando exista el código verdadero de
FixIt se crearán tests/benchmarks nuevos basados en sus contratos.

| Ubicación | Qué contiene | Por qué se conserva |
| --- | --- | --- |
| `docs/000`–`013`, `docs/adr/` | Scope, gates, decisiones, seguridad y evidencia consolidada | Mantener una fuente de verdad por tema |
| `docs/013.Spike-Results.md` | Tablas G2, fallos controlados y regresión G3 | Memoria técnica sin 81 artefactos de prueba |
| `docs/references/` | Documentos de origen, incluyendo nota de Felix | Verificar requisitos académicos, sin inventar acuerdos |
| `CONTEXT.md` | Único contexto y reglas operativas del equipo | Retomar trabajo y gobernar agentes sin archivos duplicados |

## Qué se verificó realmente hasta ahora

- **G2, arranque:** seis contenedores sintéticos en Podman rootless bajo
  límites explícitos, comprobando conexión y salud básica.
- **G2, integración:** seis corridas iniciales (3 con tres servicios y 3 con
  Core+Chat), **13/13 checks por corrida** sobre infraestructura real pero
  servicios de negocio **experimentales**.
- **G2, ajuste:** diversas corridas de CPU y bcrypt nativo con **14/14 checks**.
  Se separó login individual de ráfagas concurrentes. Repartir cuotas
  fraccionarias demasiado bajas distorsionaba el diagnóstico; usar núcleos
  compartidos mejoró el rendimiento. La calibración final de bcrypt y el
  hardware EC2 aún están pendientes.
- **G2, 10 sockets y fallos:** dos corridas corregidas de 20 s con
  **200/200 mensajes confirmados**, cero errores de carga y comparación de
  latencia sin mezclar la inyección deliberada de fallos. Se reiniciaron
  Auth (solo arquitectura de 3), Tickets/Core, Mongo, PostgreSQL y NATS;
  se verificó falta de ACK positivo cuando no corresponde y recuperación
  de outbox/historial. **No equivale a HA ni restauración desde backups.**
- **G3, seguridad:** se descubrió una **fuga de mensajes a sockets cuya
  sesión estaba revocada**; la prueba roja lo reprodujo. Tras comprobar
  sesión y autorización del destinatario en cada broadcast, ambas
  topologías pasaron **7/7 checks**. **La corrección vive solo en el spike.**
  Ver [012.G3-Security-Consistency](docs/012.G3-Security-Consistency.md).

Todos los números y limitaciones históricos están en
[013.Spike-Results](docs/013.Spike-Results.md), con estado en
[011.Gates](docs/011.Gates.md). Las pruebas no son autorización de
producción: no incluyen todavía TLS/CSRF de extremo a extremo, calibración
en el host final, seguridad exhaustiva, pruebas prolongadas ni AWS real.

## Estado de gates al cerrar la sesión

| Gate | Estado honesto | ¿Qué impide PASS? |
| --- | --- | --- |
| G0 · Alcance/academia | **PARCIAL; nueva rubrica COP3851 recibida** | Confirmar `tenant_id`/ownership literal, comunidad IT Help Desk, entregas docentes |
| G1 · Diseño | **3 servicios + PG compartido elegidos por usuario; NO PASS** | Ratificacion equipo, **commit previo** OpenAPI + 3NF/FK/migraciones, roles SQL, contratos y ADR-005 |
| G2 · Capacidad/Cloud | **EVIDENCIA PARCIAL; APLAZADO** | Carga prolongada, EC2/T3, costos, backup/restore y producto real |
| G3 · Seguridad/consistencia | **B2 A SELECCIONADA POR USUARIO; RED TEAM PENDIENTE** | CSRF/Origin/Strict, eventos, carreras, BOLA/SQL/NoSQL/CORS/rate-limit y tests del producto |
| G4 · Implementación | **GOBERNANZA CREADA; CODIGO REAL NO INICIADO** | OpenAPI/schema commiteados primero, tests, RFC dependencias, defensa en vivo y MVP real |
| G5 · Cloud/entrega | **NO DESPLEGADO** | Presupuesto y autorización, AWS, observabilidad, rollback/restore |

**Ningún gate G0–G5 está completamente aprobado.** Lo que se ha
**validado** es el comportamiento de escenarios concretos sobre el spike;
no confundir `PASS_SPIKE` con `PASS` del proyecto.

## Por dónde retomar al continuar

1. Leer [011.Gates](docs/011.Gates.md) y
   [012.G3-Security-Consistency](docs/012.G3-Security-Consistency.md).
2. **Seguir primero nuestros gates:** continuar la revisión **G3** de
   CSRF/Origin, permisos, carrera envío/reasignación y reentrega de eventos.
   Las pruebas deben rediseñarse sobre el producto cuando exista.
3. Para iniciar el código de **G4**, cerrar **G1 Contract-First**: validar
   `docs/openapi.json` y esquema **3NF/FK/migraciones** y commitearlos
   **antes** de que agentes generen controllers. Siguiente review conjunto:
   [estrategia de una DB PostgreSQL con schemas separados frente a bases
   independientes](docs/011.Gates.md), sin cambiar ADR-005 unilateralmente.
   No es un nuevo gate.
4. Preparar **G4** con código real y nuevos tests, reutilizando las lecciones
   del [historial consolidado](docs/013.Spike-Results.md) **sin copiar
   mecanismos experimentales inseguros**.
5. Mantener **G2 final aplazado**, pero exigir su revisión y confirmación de
   costos antes de AWS/G5.
6. **Conservar lo de Felix como referencia académica y completar su
   documentación de entrega al final de la revisión de gates**, sin perder
   requisitos obligatorios de orden (Contract-First). Cuando el equipo
   ratifique arquitectura, actualizar ADR-005, contratos y este CONTEXT.

## Convenciones de trabajo

- `dev`: integración; `main`: estable; preferir PR desde `feat/*` con
  tests y revisión. El commit y push se realizan solo cuando el usuario lo
  autoriza explícitamente.
- Mantener secretos fuera de Git, no subir `node_modules`, `.env`, tokens
  ni datos reales. Los benchmarks históricos usaron fixtures ficticios.
- Cuando volvamos a probar en contenedores, aislar y limpiar solo sus
  recursos. No desplegar, incurrir costos ni marcar gates PASS por inferencia.
- Para decisiones: separar **acuerdo explícito del usuario/equipo**,
  **propuesta documentada** y **prueba técnica reproducible**.
