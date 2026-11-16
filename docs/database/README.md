# Esquema 3NF y migracion inicial — Contract-First

**Estado (16 nov 2026):** OpenAPI 3.1.1 validada con Redocly (5 warnings no bloqueantes). Versiones `prisma`, `@prisma/client` y `@prisma/adapter-pg` fijadas en **7.10.1**. El esquema pasa `prisma validate` y la migracion manual **pasa Prisma Migrate deploy** contra PostgreSQL 17 efimero. `prisma migrate diff --from-config-datasource --to-schema docs/database/schema.prisma --script --exit-code` produce una migracion vacia. Prisma no inspecciona todos los `CHECK`/indices especiales; preservarlos por SQL. **Solo se conservan los contratos en `dev`; las pruebas del prototipo Auth con rol restringido están en `prototype/auth-g4`. Tickets/Chat/React no están implementados.** Falta ratificacion tecnica del equipo. G1 NO PASS.

## Archivos y autoridad

- [schema.prisma](schema.prisma): modelo de Prisma ORM **7.10.1** con una PostgreSQL y esquemas `auth`/`tickets`, y nombre/ON UPDATE de las 12 FK alineados con SQL. Versiones de prueba fijadas en el lockfile de `prototype/auth-g4` (sin lockfile en `dev`); el cliente generado no forma parte de esta rama documental.
- [migrations/20261115000100_initial/migration.sql](migrations/20261115000100_initial/migration.sql): **una unica migracion inicial manual, adoptada por Prisma Migrate**, con 3NF/FK, `CHECK`, indice `lower(email)`, indices parciales y categorias semilla. `npm run db:migrate` pasa en PostgreSQL 17 de prueba con `DATABASE_URL`; queda registrada en `_prisma_migrations`. No duplicar migradores ni generar segunda migracion inicial con `db push`.
- [../openapi.json](../openapi.json): contrato REST publico e interno propuesto. Las rutas `/internal/v1` estan marcadas con `x-internal` y **no** deben aparecer en el reverse proxy publico. El contrato de Socket.IO sigue en [../010.G1-Contracts.md](../010.G1-Contracts.md).

## Tercera forma normal

| Esquema | Tabla | Dependencia funcional | FK y separacion |
| --- | --- | --- | --- |
| `auth` | `users` | `id -> email, display_name, role, account_status, password_hash, ...` | `created_by -> users.id` opcional; el email tiene indice unico case-insensitive |
| `auth` | `sessions` | `id -> user_id, token_hash, scope, expiracion, revocacion` | `user_id -> users.id` |
| `auth` | `account_audit` | `id -> subject, actor, action, timestamp, reason` | Usuario sujeto y actor refieren a `users.id` |
| `tickets` | `categories` | `code -> label, is_active` | Catalogo unico, el nombre no se copia al ticket |
| `tickets` | `support_tickets` | `id -> reporter, assignee, category, title, status, version, ...` | FK reales a `auth.users` y `tickets.categories` |
| `tickets` | `ticket_timeline` | `id -> ticket_id, ticket_version, actor, cambio` | Una fila por version del ticket; FK a ticket y actor |
| `tickets` | `outbox` | `id -> event_type, payload, aggregate_version, publication status` | FK compuesta `(ticket_id, aggregate_version)` a timeline |
| `tickets` | `ticket_attachments` | `id -> ticket_id, uploaded_by, storage_key, metadata` | FK al ticket y autor; `UNIQUE(ticket_id)` limita a una foto |

No repetimos atributos de otras tablas (por ejemplo, email del reporter o label de categoria en cada ticket). El `payload` JSONB de outbox es un **sobre de integracion**, no una segunda tabla de datos del dominio ni fuente de autorizacion. El `ticket_id` de Chat en MongoDB es una referencia logica: Mongo **no** tiene FK a PostgreSQL. Chat consulta permisos vigentes por REST, no por join SQL.

Las restricciones `CHECK`, el indice `lower(email)` y el indice parcial de cola existen en el SQL aunque Prisma no los modele declarativamente. La migracion futura debe conservarlos. La tabla timeline no permite varias filas para la misma version del ticket; cada operacion auditada incrementa version, incluida edicion o cambio de foto. Se genera una fila de outbox para **eventos publicados**, no obligatoriamente para todas las entradas de timeline.

## Cambios atomicos e invariantes

- **Claim:** `UPDATE tickets.support_tickets SET assignee_id = $agent_id, status = 'ASSIGNED', version = version + 1 WHERE id = $id AND status = 'OPEN' AND assignee_id IS NULL RETURNING ...`. Una sola fila ganadora; los demas reciben 409. La operacion completa guarda el timeline y el outbox en la **misma transaccion**, con parametros ligados, nunca interpolacion SQL.
- **Reasignacion/estado/edicion:** comparar version esperada en la transaccion; no emitir outbox de exito para un 409.
- **Passwords:** `auth.users.password_hash` contiene un hash completo **Argon2id PHC**, con sal/parametros gestionados por libreria. La contraseña temporal vence a las 72 h; las sesiones guardan **hash del token opaco de alta entropia**, no Argon2id por solicitud (el token no es contraseña humana).
- **Revocacion:** `revoked_at` y `expires_at` deben comprobarse en cada introspeccion de Auth. Una fila antigua no autoriza al usuario. **Admin (16 nov):** desactivar cambia `account_status=DISABLED`, revoca todas las sesiones y registra `DISABLED` en auditoria dentro de una transaccion. Reactivar conserva ID, cambia a `PENDING_PASSWORD_CHANGE` con temporal Argon2id nueva de 72 h, revoca sesiones y registra `REACTIVATED`; no reutilizar passwords antiguas. No permitir desactivar Admin de bootstrap via HTTP. Se anadio `REACTIVATED` al `CHECK` de auditoria y se reaplico la migracion en PostgreSQL 17 efimero: **PASS** en SQL (16 nov). La API y la prueba de carrera real con Auth/Socket.IO siguen pendientes.
- **Categorias:** la migracion siembra cinco codigos IT (`NETWORK`, `HARDWARE`, `SOFTWARE`, `ACCOUNTS`, `PERIPHERALS`) sin datos de personas; `GET /api/v1/categories` consulta este catalogo. Su administracion dinamica queda fuera del primer MVP.
- **Fotos:** solo metadata y referencia de storage privado en PostgreSQL; validar contenido real, acceso y tamano (maximo propuesto 5 MiB). No guardar bytes en la tabla.
- **Privilegios:** usar un rol DB de migracion distinto de los roles runtime. Auth hace DML solo en `auth.*`, Tickets solo en `tickets.*`; las FK cruzadas **no** justifican acceso a hashes. Los `GRANT` y credenciales de cada entorno se prepararan en operacion, no dentro de esta migracion.

## Verificacion y secuencia

**Evidencia adicional 16 nov (sin código del producto ni recursos AWS):** se reejecutó PostgreSQL 17 efímero, sin red, usando `podman run --rm --network none` y `tmpfs`. Dos transacciones concurrentes ejecutaron la cadena `UPDATE` condicionado de ticket + `ticket_timeline` + `outbox` en un solo statement SQL; la ganadora produjo `1|1|1` y la perdedora `0|0|0`. Persistieron un ticket versión 2, una entrada timeline y una outbox. Un segundo caso con evento outbox inválido activó un `CHECK` y produjo **rollback integral**: ticket `OPEN` versión 1, sin timeline ni outbox.

**Prueba de privilegios:** se crearon roles y `GRANT` **solo en ese contenedor desechable**. Auth pudo consultar `auth.*` pero no `tickets.*`; Tickets consultó `tickets.*` pero no `auth.users.password_hash`. Los roles definitivos y sus GRANT no forman parte de la migración actual.

**Comparación estática adicional:** se cotejaron los nombres de columnas mapeados de los 8 modelos Prisma con las 8 tablas SQL: ninguna columna faltante o sobrante. El DDL añade 20 expresiones `CHECK` y 7 índices independientes; este cotejo **no comprueba igualdad de tipos, defaults, unicidad case-insensitive, índices ni drift de Prisma Migrate**.

**Precauciones al implementar Auth:** PostgreSQL exige `temporary_expires_at` para `PENDING_PASSWORD_CHANGE`, aunque Prisma declare el campo nullable y ponga ese estado por defecto: el seeder y el alta de cuentas deben fijar explícitamente la fecha de expiración (72 h). El email es único mediante índice SQL `lower(email)`, no `@unique` en Prisma; usar búsqueda case-insensitive o consulta parametrizada, **no asumir `findUnique({email})`**.



**Evidencia inicial 15 nov (local):** `postgres:17-alpine` con `podman run --rm --network none` y `tmpfs`; `0001_initial.sql` **PASS**, 8 tablas, 12 FK y 5 categorias semilla. Se probaron unicidad de email case-insensitive, FK de reporter y claim secuencial. Redocly valido OAS 3.1.1 (5 advertencias no bloqueantes) y Prisma CLI 7.3.0 valido la sintaxis del schema.

1. Revisar modelo con Valeria y Rina, especialmente FK cruzadas, estados, excepciones y minimizacion de datos.
2. **Validado en prototipo (16 nov):** Prisma 7.10.1 con dependencias en `prototype/auth-g4`; `migrate deploy` aplica la migración versionada y `migrate diff` detecta **cero drift representable en Prisma**. Mantener los `CHECK` y los indices SQL expresionales/parciales en revisiones de migraciones futuras.
3. Repetir desde **Tickets real** la transaccion de claim/timeline/outbox ya ensayada con SQL (16 nov). Aun faltan: provision y GRANTs reproducibles de roles runtime, estados/transiciones completos, comparacion de tipos/defaults/indices Prisma vs SQL, pruebas de migracion de version/rollback y API 409. Las pruebas SQL locales no hacen G1 PASS.
4. Validar [OpenAPI](../openapi.json) (referencias, esquema, tipos de respuesta, seguridad y roles). Si se modifica una ruta, corregir contrato **antes** de implementar el endpoint.
5. Tras validaciones formales y revision de equipo, documentar los resultados y realizar **un nuevo commit correctivo del contrato/esquema** (con autorizacion del usuario), **anterior a generar controllers**. El commit de draft por si solo no acredita esos pasos.

**Fuentes:** [rubrica COP3851](../references/COP3851_Capstone_2026-11-11.md), [G1](../010.G1-Contracts.md), [Prisma v7 multi-schema](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/multi-schema), [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
