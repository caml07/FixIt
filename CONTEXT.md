# FixIt — CONTEXT

> Ultima revision: 23 de noviembre de 2026 (America/Managua).
> Documento de continuidad para el equipo y asistentes que retomen el repositorio.
> El estado verificable y los cambios aprobados por el equipo están en los
> documentos enlazados. Este archivo **no aprueba gates ni ADR por sí mismo**.

**Actualización Cloud prioritaria 23 nov 2026:** el usuario seleccionó ECS Fargate **sin EC2**, NAT temporal, CloudFormation nativo y provisionamiento por etapas; CloudWatch permanece. [017.Cloud-Evaluation](docs/017.Cloud-Evaluation.md) contiene el borrador A–D y las equivalencias de rúbrica pendientes de Marvin. El avance oficial vence el 27 nov a las 11:59 PM CST. [Templates](infra/cloudformation/README.md) foundation y sesión smoke validados localmente con cfn-lint 1.61.0; no aplicados. El smoke no es FixIt integrado. JetStream permanece local hasta resolver persistencia Cloud sin EC2; no cambiar contratos ni sustituir broker sin acuerdo. RDS/Atlas siguen candidatos, sin acceso remoto aprobado ni recursos creados. Mantener techo de US$120 sujeto a créditos comprobados; no ejecutar AWS sin autorización. Esta dirección prevalece sobre propuestas Cloud históricas de este archivo y no implica aprobación de Marvin ni de todo el equipo.

**Actualización prioritaria 18 nov 2026:** este estado **prevalece sobre las notas históricas del 11–15 nov que aparecen más abajo**. Rina y el usuario acordaron formulario de ticket con hora automática, **tag como categoría IT existente**, descripción breve, fotos/video, **urgencia sugerida por Reporter** y **prioridad oficial fijada manualmente por Support Agent asignado/Admin**; IA futura. «Luz» fue solo ejemplo, no amplía a instalaciones. La especificación anterior de una foto de 5 MB ya no representa el objetivo. Usuario reservó **Chat + React para sí**; Valeria/Tickets y Rina/Auth son propuestas por confirmar. Se eligió **etapa híbrida de desarrollo**: servicios/NATS locales en contenedores y PostgreSQL RDS/Mongo Atlas cuando el acceso privado, créditos/costo y autorización existan, con fallback de DB totalmente local. **No se crearon recursos Cloud** y hosting final Fargate/EC2 no está decidido. Ver [015](docs/015.Hybrid-Development.md), [016](docs/016.CI-Team-Workflow.md) y [G1](docs/010.G1-Contracts.md). El contexto legado siguiente documenta la evolución, no revierte estas decisiones.

## Qué es FixIt

Proyecto universitario de **IT Help Desk** para gestionar incidentes de TI
de profesores, personal y usuarios autorizados en un piloto; no se incluye a
estudiantes como usuarios generales del MVP. El producto reúne tickets,
asignación de agentes y chat privado asociado a cada ticket.

Se busca reutilizar una sola solución para Web Development II y Cloud &
Internet Computing, con posible alineación adicional a Software Engineering II.
No ampliar el alcance a mantenimiento de instalaciones, IA, SLA ni funciones
accesorias. **Fotos y/o video opcionales** estan previstos como evidencia
del ticket; cantidades y límites aún no están ratificados. Ver [Product](docs/001.Product.md),
[Requirements](docs/002.Requirements.md) y
[Delivery](docs/005.Delivery.md).

## Qué decisiones sí quedaron confirmadas

**De producto, por el usuario:**

- El alcance es **IT Help Desk**, con cuentas personales y acceso por rol.
- **No existe autoregistro**: un Admin aprovisiona las cuentas y entrega una
  contraseña temporal; el primer inicio obliga a cambiarla. Este es el
  comportamiento esperado, consistente con el proceso de creación de cuentas
  que el usuario conoce de su universidad. **B1 elegida por usuario el
  11 nov:** el primer Admin proviene de un **seeder de BD inicial e idempotente**
  sin credencial fija versionada, y tanto su password temporal como las de
  usuarios nuevos caducan a las **72 h**. Hasta completar cambio obligatorio
  tienen sesion `PASSWORD_CHANGE_ONLY` sin acceso a Tickets ni Chat;
  al activar se invalida la sesion provisional y se exige login nuevo.
  Las passwords personales siguen **NIST SP 800-63B-4**: 15 caracteres
  minimos sin MFA, aceptar 64+, Unicode, sin composicion obligatoria,
  blocklist, limitacion de intentos y sin rotacion periodica arbitraria.
  **No es politica universitaria verificada; 72 h es decision de FixIt.**
  **Decision del usuario, 15 nov:** el primer seeder muestra la credencial
  aleatoria una sola vez en un TTY privado al operador autorizado, no en
  logs, CI ni stdout de contenedores; si no existe TTY seguro, no crea cuenta.
  Recuperacion seleccionada: un CLI local y manual resetea **la misma cuenta
  Admin**, invalida sesiones y audita; no reejecuta seed ni agrega servicios.
  Argon2id elegido; faltan calibracion y pruebas.
- Chat pertenece a cada ticket; solo sus participantes autorizados deben
  acceder. **B2 alternativa A elegida por el usuario (11 nov):** las
  operaciones nuevas del agente anterior se rechazan tras la reasignacion,
  pero las que ya estaban autorizadas y en vuelo pueden finalizar; el agente
  anterior deja de recibir nuevos broadcasts. Falta ratificacion del equipo
  y pruebas de concurrencia sobre el producto: **no implica atomicidad
  transaccional entre PostgreSQL y MongoDB**.

**Preferencias técnicas en estudio, no ratificadas por el equipo:**

El usuario informo el 15 nov que Valeria y Rina respaldan el concepto general
y la division en Auth/Tickets/Chat. Valeria considera bien encaminada la
direccion Cloud, pero advierte del riesgo de gastos. La ratificacion de
contratos, datos y eventos queda pendiente. Consultar
[006.Decisions](docs/006.Decisions.md) antes de cambiar el estado de ADR-005.

- Candidato principal: **Auth, Tickets y Chat**, con REST interno, Socket.IO
  para chat, **una PostgreSQL con esquemas `auth`/`tickets` y roles SQL
  separados** (propuesta aceptada expresamente por usuario, 11 nov),
  MongoDB para mensajes en Chat y NATS JetStream para eventos. Sesiones
  **opacas**, Argon2id seleccionado el 15 nov para contrasenas,
  autorización interna por servicio.
  **G1-C alternativa B elegida por usuario el 11 nov:** REST sincrono
  exclusivamente para decisiones de identidad/permisos y NATS JetStream
  asincrono para publicar cambios de Tickets mediante outbox; Chat usa
  Socket.IO para tiempo real y MongoDB para mensajes persistentes.
  Nunca confiar en NATS para conceder permisos.
  **Opcion A de recuperacion seleccionada por usuario (11 nov):**
  [G1](docs/010.G1-Contracts.md) define **confirmar cambios de Tickets
  cuando PostgreSQL guarda ticket+timeline+outbox**, sin esperar a NATS:
  reintentos tras caidas, deduplicacion y reparacion de proyecciones.
  Se acepta **consistencia eventual de notificaciones** para minimizar
  latencia y acoplamiento del broker; **NO** de permisos, que se verifican
  sincronamente. Decision de diseño seleccionada, **pendiente de ratificacion
  del equipo y pruebas**, sin crear un gate nuevo.
  **Tres runtimes se mantienen independientes**; las FK entre esquemas
  aportan integridad, no dan acceso libre a tablas ajenas. Falta ratificacion
  por Valeria/Rina y especificar migraciones/privilegios; ADR-005 **sigue
  propuesto**. Ver [G1-Contracts](docs/010.G1-Contracts.md).
- Alternativa conservada: **Core (Auth+Tickets) + Chat**. El monolito modular
  es una opción histórica de respaldo. La comparación de rendimiento NO
  acepta ni rechaza por sí sola [ADR-005](docs/adr/ADR-005-three-services-opaque-sessions.md).
- **Grilling cerrado por usuario (11 nov):** construir **MVP IT Help Desk
  funcional y bien terminado**, no todas las funciones del PDF inicial;
  conservar **Auth + Tickets + Chat** y minimizar complejidad innecesaria.
  El usuario revisara arquitectura con **Valeria y Rina**. **Las dos
  validaran por su cuenta Software Engineering II** con su profesor; no
  bloquear Web II/Cloud por ese curso ni asumir que sus cambios de rubrica
  se aplican al producto general sin acuerdo de los tres.
- **Ajuste MVP del PDF original (11 nov):** el usuario quiere
  **fotografia de evidencia en ticket**, operaciones principales de
  ticket, **estados auditados** y **notificaciones dentro de la app**.
  Se propone una foto **opcional** JPG/PNG/WebP max. 5 MB por ticket,
  almacenada privadamente con permisos por ticket; el detalle se
  revisara con el equipo. Reporter puede editar ticket propio en
  OPEN; avisos de creacion, asignacion, estado y mensajes a destinatarios
  autorizados via JetStream/Socket.IO. **No afecta el token opaco de Auth,
  no reintroduce IA ni exige S3 para fotos**, sin push ni email en MVP.
- No ejecutar despliegues de AWS ni modificar el plan de cuenta, costos o
  permisos sin autorización explícita.

**Cloud, confirmacion oral comunicada por usuario el 11 nov:** Marvin
**acepta una VPC y una EC2** y espera evidencia de **S3**. El **12 nov**
el usuario planea presentarle la documentacion. Falta saber si la
evidencia de S3 requerida es **website estatico publico**, **bucket
privado de artefactos versionados** o ambas; que reemplaza la prueba
de dos VPC/VM del PDF adicional, y fechas/horas/formatos definitivos.
No confundir esta confirmacion con autorizacion AWS de gasto o deploy.
Ver [004.Cloud](docs/004.Cloud.md) y la
[auditoria conjunta de gates](docs/011.Gates.md).

**Actualizacion Cloud (12 nov):** usuario informa que **Marvin dio luz
verde para continuar con la arquitectura Cloud de FixIt**. Direccion
academica de **una VPC + una EC2** fue una referencia de diseño,
**reabierta el 17 nov** ante Fargate/RDS/Atlas y el 18 nov con la etapa
híbrida de servicios locales + bases remotas. La aprobación histórica **no**
autoriza por si solo crear EC2, buckets, IAM ni asumir cargos.
El [paquete intermedio de AWS, seccion 8](docs/004.Cloud.md) resume
defaults propuestos para review del equipo: Compose en una EC2, proxy
HTTPS unico, SSM y rol IAM, PostgreSQL/Mongo/JetStream sobre EBS duradero,
S3 privado para releases salvo rubrica distinta, despliegue manual por SHA,
backup/restore, pruebas y observabilidad. **Pendientes que si importan:**
**S3 Versioning de releases confirmado posteriormente por usuario como indicacion de Marvin el 15 nov**; titularidad/dominio, costo y capacidad siguen por comprobar.
No crear nuevos gates ni cambiar el scope de los tres servicios.

**Publicacion elegida por usuario el 15 nov (solo diseno):** DigitalPlat
FreeDomain delega DNS a Cloudflare y un **Cloudflare Tunnel nombrado** publica
un hostname HTTPS/WSS de FixIt hacia el proxy local. No hay dominio, tunnel,
credenciales Cloudflare ni EC2 creados. El requisito de salida de EC2 y sus
precios siguen abiertos; un tunnel no garantiza IPv4/NAT sin costo. Valeria
pidio controlar gastos. **El usuario es titular principal de DigitalPlat/Cloudflare
y Valeria colaboradora delegada cuando sea compatible**, con cuentas/MFA
individuales. **Techo: US$120 de costo AWS acumulado para todo FixIt**,
cubierto solo con creditos reales, no dinero personal. Hasta US$200 es el
maximo promocional, no saldo garantizado. Sin provisionar ni activar Paid.
**EC2 Spot elegida: `persistent` EBS-backed con interrupcion `stop`, start/stop manual y no 24/7**. Si Spot no esta disponible para una presentacion, **nueva On-Demand temporal** restaurada desde backups (sin conversion in-place ni infraestructura adicional fija), solo si cabe en creditos. **Backups PG/Mongo cifrados y privados en S3, conservados sin borrado automatico; exportar copia verificada fuera de AWS al finalizar antes de cualquier cleanup**. Faltan pruebas de plan, costo, capacidad, restarts y restore. Ver [004.Cloud, secciones 4, 6 y 10](docs/004.Cloud.md).

**Presentacion unificada (11 nov):** [014.Resumen-Ejecutivo](docs/014.Resumen-Ejecutivo.md)
resume el MVP, el diagrama y las decisiones, mas la agenda para Marvin y
Felix el **12 nov**, y para Valeria/Rina cuando se reunan. Distingue
lo confirmado, las propuestas y los hitos no verificados. Es la referencia
corta para docentes, sin reemplazar los requisitos y gates canonicos.

**ORM recomendados para review (sin implementacion):**
Prisma ORM para la unica PostgreSQL con esquemas `auth` y `tickets`,
**un unico owner/historial de migraciones** por FK entre esquemas,
clientes y cuentas SQL de runtime separados; **Mongoose** para
MongoDB de Chat (`messages`, dedupe/inbox). El ER conceptual
de [G1](docs/010.G1-Contracts.md) ahora incluye
`tickets.ticket_attachments` para metadata de foto privada. Son
**candidatos**; existen [schema Prisma y SQL inicial en borrador](docs/database/README.md),
sin aplicar ni validar en PostgreSQL. Ver decision [A-16](docs/006.Decisions.md).

**Hashing elegido el 15 nov:** Argon2id para contrasenas del producto,
con valores OWASP de partida `m=19456 KiB, t=2, p=1` para benchmark.
Las mediciones bcrypt siguen siendo historia del spike, no validan Auth final.
Probar Unicode largo, normalizacion consistente, blocklist y rendimiento
antes de afirmar cumplimiento NIST. Ver
[G1](docs/010.G1-Contracts.md) y
[NIST 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html).

## Actualización académica obligatoria — Mr. Felix, COP3851 (11 nov)

El usuario compartió la especificación de una página **Final Capstone:
Contract-First REST APIs & DevSecOps Pipeline**. Su transcripción y fuente
están en [docs/references/COP3851_Capstone_2026-11-11.md](docs/references/COP3851_Capstone_2026-11-11.md).

- **Antes de que agentes de IA creen nuevos controladores:** generar
  `docs/openapi.json`, modelo relacional **3NF con FK explícitas** y
  migraciones; **commitearlos previamente** (no solo escribirlos en Markdown).
  **Desde el 15 nov existen borradores commiteados** [OpenAPI](docs/openapi.json),
  [Prisma y migracion SQL](docs/database/README.md), autorizados por el usuario
  solo como documentacion. **En `dev` solo quedan contratos y documentación: OpenAPI se validó con Redocly (5 warnings); Prisma 7.10.1 aplicó la migración y dio diff representable vacío en PostgreSQL 17 temporal. El prototipo Auth Express y las pruebas con SQL restringido se conservan en `prototype/auth-g4`, no en `dev`. Tickets/Chat/UI no están implementados. Falta ratificación del equipo y Red Team completo.** El spike de G2 es historico y no
  cuenta como cumplimiento Contract-First.
- **`CONTEXT.md` es nuestra unica constitucion canonica** para agentes,
  arquitectura y continuidad del equipo; no crear otra con contenido
  duplicado. **Puente `CLAUDE.md` versionado desde el 15 nov:** archivo minimo en raiz enlazado a este CONTEXT canonico, con reglas Contract-First y seguridad exigidas por COP3851. Falta confirmacion docente de suficiencia; no duplicar toda la constitucion.
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
   desde backend y consultas de datos. **Decision 15 nov: FixIt es single-tenant para Keiser University LAC (piloto academico)**. No agregar `tenant_id` a PG/Mongo/OpenAPI; el ejemplo `WHERE tenant_id = current_user` de la rubrica es ilustrativo. Usar `reporter_id`, `assignee_id` actual y `ADMIN` en permisos por recurso. Consultar solo si Felix impone multi-tenancy literal.
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
  compartidos mejoró el rendimiento. Fue un spike historico con bcrypt;
  la calibracion de Argon2id y hardware EC2 aun estan pendientes.
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
| G0 · Alcance/academia | **PARCIAL; nueva rubrica COP3851 recibida** | Single-tenant Keiser sin `tenant_id` confirmado por usuario; Felix aun debe confirmar encaje IT Help Desk y si exige columna literal, mas fechas/entregables |
| G1 · Diseño | **DIVISION DE SERVICIOS RESPALDADA; NO PASS** | Ratificar contratos/datos, validar borradores OpenAPI/Prisma/SQL y **commitear antes de controladores** tras permiso |
| G2 · Capacidad/Cloud | **EVIDENCIA PARCIAL; APLAZADO** | Carga prolongada, EC2/T3, costos, backup/restore y producto real |
| G3 · Seguridad/consistencia | **B2 A SELECCIONADA POR USUARIO; RED TEAM PENDIENTE** | CSRF/Origin/Strict, eventos, carreras, BOLA/SQL/NoSQL/CORS/rate-limit y tests del producto |
| G4 · Implementación | **SIN CODIGO DE APLICACION EN `dev`** | Prototipo Auth separado; implementar Tickets/Chat/UI, Red Team, Compose/Cloud y defensa en vivo. G4 no PASS |
| G5 · Cloud/entrega | **NO DESPLEGADO** | Presupuesto y autorización, AWS, observabilidad, rollback/restore |

**Ningún gate G0–G5 está completamente aprobado.** Lo que se ha
**validado** es el comportamiento de escenarios concretos sobre el spike;
no confundir `PASS_SPIKE` con `PASS` del proyecto.

## Por dónde retomar al continuar

1. Leer el **[paquete unico de revision G0–G5](docs/011.Gates.md)** y
   [G1-Contracts](docs/010.G1-Contracts.md). Valeria y Rina respaldan
   el concepto y la division; faltan los contratos detallados.
2. **Sin codigo del producto:** resolver dudas academicas de G0 y
   revisar G1 **en bloque**; no abrir mas microgates de diseno.
   Las pruebas G2/G3 se haran sobre el producto cuando exista.
3. Revisar/validar los borradores de
   `docs/openapi.json` y esquema **3NF/FK/migraciones** y commitearlos
   **solo con autorizacion expresa**,
   **antes** de que agentes generen controllers. Conservar la DB PostgreSQL
   compartida con schemas `auth`/`tickets` como direccion elegida, sin
   declarar aceptado el ADR por parte de todo el equipo.
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
