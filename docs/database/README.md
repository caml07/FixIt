# Esquema 3NF y primera migracion (borrador)

**Estado:** Contract-First documental, 15 nov 2026. OpenAPI, Prisma y SQL tienen **commit inicial de borradores**. Comprobaciones locales posteriores: `npx prisma@7.3.0 validate --schema docs/database/schema.prisma` **PASS**; Redocly validó OpenAPI con 5 advertencias no bloqueantes; la migración SQL **PASS en PostgreSQL 17 efímero, sin red, tmpfs** (8 tablas, 12 FK, 5 categorías). **No prueba equivalencia Prisma/SQL, roles de DB, carreras ni revisión del equipo**; todavía no generar controllers.

## Archivos y autoridad

- [schema.prisma](schema.prisma): modelo propuesto de Prisma ORM v7 para una **sola** PostgreSQL con esquemas `auth` y `tickets`. Validado con Prisma CLI 7.3.0 **vía `npx` temporal**, no instalado como dependencia del repositorio ni fijado en lockfile.
- [migrations/0001_initial.sql](migrations/0001_initial.sql): **migracion SQL inicial redactada manualmente**, con 3NF, FK, CHECK, indices, unicidad, catalogo inicial de cinco categorias y `BEGIN/COMMIT`. La aplicacion en PostgreSQL 17 temporal paso, **pero NO fue generada ni validada con Prisma Migrate**. Antes del primer commit de implementacion, elegir version estable de Prisma, generar/comparar el SQL y corregir drift. Una sola cadena de migraciones es la fuente operativa, no dos migradores por microservicio.
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
- **Revocacion:** `revoked_at` y `expires_at` deben comprobarse en cada introspeccion de Auth. Una fila antigua no autoriza al usuario.
- **Categorias:** la migracion siembra cinco codigos IT (`NETWORK`, `HARDWARE`, `SOFTWARE`, `ACCOUNTS`, `PERIPHERALS`) sin datos de personas; `GET /api/v1/categories` consulta este catalogo. Su administracion dinamica queda fuera del primer MVP.
- **Fotos:** solo metadata y referencia de storage privado en PostgreSQL; validar contenido real, acceso y tamano (maximo propuesto 5 MiB). No guardar bytes en la tabla.
- **Privilegios:** usar un rol DB de migracion distinto de los roles runtime. Auth hace DML solo en `auth.*`, Tickets solo en `tickets.*`; las FK cruzadas **no** justifican acceso a hashes. Los `GRANT` y credenciales de cada entorno se prepararan en operacion, no dentro de esta migracion.

## Verificacion y secuencia

**Evidencia observada el 15 nov 2026 (local):** se utilizo `postgres:17-alpine` mediante `podman run --rm --network none`, con almacenamiento `tmpfs`. Se aplico `0001_initial.sql` usando `psql -v ON_ERROR_STOP=1`: **PASS**, 8 tablas, 12 FK y 5 categorias semilla (repetido tras los commits). Dentro de una transaccion desechable se comprobo insert de usuario/ticket/timeline/outbox, rechazo de email duplicado ignorando mayusculas, rechazo de FK a reporter inexistente, primera actualizacion de claim con 1 fila y reintento posterior con 0 filas. El test termino en `ROLLBACK` y el contenedor se elimino al finalizar. **No fue una prueba de claim simultaneo ni de seguridad de roles DB, ni se ejecuto Prisma CLI o un validador OAS formal.**

1. Revisar modelo con Valeria y Rina, especialmente FK cruzadas, estados, excepciones y minimizacion de datos.
2. Fijar version de Prisma/cliente PostgreSQL. **Prisma CLI 7.3.0 ya valida la sintaxis**, pero falta generar/comparar su migracion con el SQL artesanal y conservar `CHECK` e indices SQL.
3. Completar la validacion de PostgreSQL: dos claims realmente **concurrentes**, restricciones de estado, migracion inversa/rollback de version y roles runtime sin permisos de lectura cruzados. El smoke test inicial anterior no cubre estos casos.
4. Validar [OpenAPI](../openapi.json) (referencias, esquema, tipos de respuesta, seguridad y roles). Si se modifica una ruta, corregir contrato **antes** de implementar el endpoint.
5. Tras validaciones formales y revision de equipo, documentar los resultados y realizar **un nuevo commit correctivo del contrato/esquema** (con autorizacion del usuario), **anterior a generar controllers**. El commit de draft por si solo no acredita esos pasos.

**Fuentes:** [rubrica COP3851](../references/COP3851_Capstone_2026-11-11.md), [G1](../010.G1-Contracts.md), [Prisma v7 multi-schema](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/multi-schema), [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
