# FixIt — IT Help Desk

**MVP académico single-tenant para Keiser University LAC.** Tres roles (Reporter, Support Agent, Admin), tickets IT, toma atómica, chat y notificaciones dentro del ticket. No es un servicio oficial de la universidad ni usa identidades institucionales reales.

**Estado (16 nov):** el primer servicio **Auth** tiene backend Express/Prisma y pruebas de integración con PostgreSQL 17; **Tickets, Chat, React y AWS siguen pendientes**. El proyecto completo no está desplegado. Contratos de los tres servicios bajo revisión del equipo.

## Leer solamente lo necesario

- [Índice y fuentes](docs/000.INDEX.md) — qué documento es la referencia vigente
- [Producto y requisitos](docs/001.Product.md) · [FR/NFR](docs/002.Requirements.md)
- [Arquitectura actual](docs/003.Architecture.md) · [Contratos y permisos](docs/010.G1-Contracts.md)
- [API OpenAPI (draft)](docs/openapi.json) · [DB 3NF/FK/migración](docs/database/README.md)
- [Cloud y S3](docs/004.Cloud.md) · [Entrega](docs/005.Delivery.md) · [Estado de gates](docs/011.Gates.md)
- [Decisiones](docs/006.Decisions.md) · [Resumen para docentes](docs/014.Resumen-Ejecutivo.md)

## Reglas de colaboración

[CONTEXT.md](CONTEXT.md) es la guía canónica; [CLAUDE.md](CLAUDE.md) es el puente mínimo exigido por COP3851. El profesor Félix exige **OpenAPI y esquema 3NF/FK/migraciones validados y commiteados antes de generar controladores con IA**. El commit inicial de borradores no equivale a validación formal.

No hacer commits, push, merge ni crear recursos AWS sin autorización expresa. Preparar el MVP y probarlo localmente antes de desplegar.

## Auth Service — ejecución local (primera fase, sin Cloud)

Prerequisitos: Node.js 26, PostgreSQL 17, npm y un proxy HTTPS para uso desde navegador. Auth existe en `services/auth/`; **Tickets, Chat y React aún no están implementados**.

```sh
npm ci
npm run db:generate
# Configurar DATABASE_URL exclusivamente para el rol operador de migraciones
npm run db:migrate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ops/postgres/runtime-roles.sql
# Crear por separado un LOGIN por servicio y conceder solo su rol NOLOGIN correspondiente.
cp .env.example .env
# Sustituir los placeholders de .env por URLs y secretos aleatorios distintos; .env está ignorado en Git.
npm run auth:bootstrap -- admin@example.invalid # Ejecutar SOLO en TTY privada; imprime la temporal una vez
npm run auth:start
```

El servicio requiere `AUTH_DATABASE_URL` con acceso limitado a `auth.*`, `AUTH_CSRF_KEY`, `AUTH_TICKETS_SERVICE_TOKEN`, `AUTH_CHAT_SERVICE_TOKEN` (todos secretos diferentes), `AUTH_PUBLIC_ORIGIN` y `AUTH_PORT`/`AUTH_BIND_HOST`. `DATABASE_URL` es solo para Prisma Migrate; **no ejecutar Auth como superuser**. La recuperación del Admin inicial es `npm run auth:reset-admin` únicamente en TTY privada; invalida todas las sesiones anteriores.

Las mutaciones por cookie comprueban `Origin` exactamente igual a `AUTH_PUBLIC_ORIGIN` y `X-CSRF-Token` obtenido de `GET /api/v1/auth/csrf`; login exige Origin pero no token previo. Cookies `__Host-fixit_session` llevan `HttpOnly; Secure; SameSite=Strict`. Para browser local se necesita **HTTPS**, no asumir que cookies Secure funcionarán en cualquier HTTP. El endpoint `/internal/v1/sessions/introspect` debe permanecer **fuera del proxy público**; usa credenciales distintas de Tickets/Chat.

Pruebas desde una **base PostgreSQL efímera y aislada**, nunca desde una DB real con usuarios: migrar con `DATABASE_URL`, aprovisionar el rol runtime, después ejecutar `FIXIT_TEST_DB_URL=postgresql://<runtime-test>@<host>:<port>/<db> npm run test:auth`. Se verificó en PostgreSQL 17 con Podman, rol SQL sin lectura de Tickets, `npm run typecheck` y `npm audit --audit-level=high` (cero hallazgos al 16 nov). El CLI de Admin se probó sin capturar el secreto. Falta defensa Red Team completa, Swagger UI, Compose y los otros servicios.

## Equipo y fuentes originales

- caml07: Web II y Cloud
- Valeria (avaleria13): Web II y Cloud; autora de la [propuesta original](docs/references/FixIt_Project_Specification.pdf), aunque su portada identifica la cuenta de Yaderling
- Rina (Rinahrrg): Web II y trabajo de Software Engineering II; también puede colaborar con desarrollo y datos

Los roles operativos todavía deben acordarse en equipo. La [adaptación para tres cursos](docs/references/FixIt_Adapting_Cloud_and_Software_Engineering_II_2026-11-10.pdf) es un estudio de alcance, no una rúbrica docente aprobada. La [hoja Contract-First de Félix](docs/references/COP3851_Capstone_2026-11-11.md) sí debe verificarse en la implementación. Las alternativas anteriores se pueden consultar en el historial Git; no son arquitectura vigente.
