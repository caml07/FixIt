# Auth Service (prototipo)

Express, TypeScript, Prisma y PostgreSQL. Las rutas y respuestas siguen el
[OpenAPI](../../docs/openapi.json); el servicio no contiene Tickets ni Chat.

## Verificacion local sin AWS

Requisitos: Node 22.12+ compatible con Prisma 7, npm, Podman o Docker,
OpenSSL y acceso al registro de paquetes e imagen PostgreSQL 17.

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` crea y elimina un contenedor PostgreSQL 17 propio, con puerto
aleatorio en 127.0.0.1, datos temporales y secretos sinteticos. Ejecuta la
migracion y la suite Auth con un rol de runtime restringido; no usa URLs de
BD externas. `CONTAINER_ENGINE=docker` permite seleccionar Docker.
`npm run test:auth:security` ejecuta solo las pruebas unitarias sin BD.
`node scripts/ci/check-apps.mjs` reproduce la CI de aplicaciones (incluye
audit de dependencias de produccion).

`npm run auth:check-db` verifica que `AUTH_DATABASE_URL` pueda conectar y
consultar las tablas de usuarios y sesiones de Auth. Devuelve codigo 0 cuando
la comprobacion pasa y 1 ante error, sin mostrar la URL ni credenciales. Usa
limites de conexion y consulta de 3 segundos. Comprueba una conexion nueva;
no demuestra que el proceso Auth este atendiendo peticiones ni sustituye una
comprobacion integral de readiness del servicio.
El comando usa `tsx` y se ha verificado con dependencias de desarrollo
instaladas; no se ha preparado como probe de imagen de produccion.

## Arranque manual para integracion local

1. Preparar PostgreSQL local con una BD de desarrollo dedicada. Desde la
   raiz, configurar `DATABASE_URL` del owner de migraciones y ejecutar
   `npm run db:migrate`; aplicar `ops/postgres/runtime-roles.sql` como owner.
   Crear fuera de Git un LOGIN de Auth con el rol `fixit_auth_runtime`, sin
   privilegios de owner, superusuario ni acceso a `tickets`.
2. Configurar estas variables en `.env` privado o en el entorno del proceso.
   No copiar secretos de produccion ni guardar contrasenas en Git.

| Variable | Uso |
| --- | --- |
| `AUTH_DATABASE_URL` | URL del LOGIN restringido de Auth (no del owner) |
| `AUTH_PUBLIC_ORIGIN` | Origen HTTPS exacto del proxy/UI, sin slash final |
| `AUTH_CSRF_KEY` | Secreto aleatorio independiente de al menos 32 caracteres |
| `AUTH_TICKETS_SERVICE_TOKEN` | Credencial interna distinta para Tickets |
| `AUTH_CHAT_SERVICE_TOKEN` | Credencial interna distinta para Chat |
| `AUTH_PORT` | Puerto; por defecto 3001 |
| `AUTH_BIND_HOST` | Por defecto 127.0.0.1; no exponer directamente a Internet |
| `AUTH_FULL_SESSION_SECONDS` | Duracion absoluta, por defecto 28800 (8 h) |
| `AUTH_IDLE_SESSION_SECONDS` | Inactividad, por defecto 1800 (30 min) |
| `AUTH_TEMPORARY_SESSION_SECONDS` | Sesion provisional, por defecto 900 (15 min) |
| `AUTH_PASSWORD_BLOCKLIST_FILE` | Archivo local UTF-8, una entrada por linea; obligatorio con `NODE_ENV=production` |

3. Ejecutar `npm run db:generate` y `npm run auth:start`. El primer Admin se
   crea una sola vez desde una terminal privada con `npm run auth:bootstrap -- admin@invalid.example`.
   Para recuperarlo usar `npm run auth:reset-admin` en esa terminal. Nunca
   ejecutar la CLI en CI, con salida redirigida ni en logs de contenedor.
4. El proxy HTTPS dirige `/api/v1/auth/*` y `/api/v1/admin/*` a Auth; **no**
   debe publicar `/internal/v1/sessions/introspect`. Usar mismo origen para
   el navegador y `X-CSRF-Token` en mutaciones. Tickets y Chat usan sus
   credenciales internas por red privada, no desde React.

## Seguridad y limites

- Sesiones opacas con revocacion y timeout absoluto e inactividad persistida
  en `auth.sessions.last_seen_at`; introspeccion acepta solo sesiones FULL.
- La activacion limita a 20 intentos por cuenta en 15 minutos, despues de
  autenticar la sesion provisional y validar CSRF. Los limitadores son en
  memoria; aun requieren revision para multiples replicas y proxy de confianza.
  En el modo actual de un proceso, el limite de login usa la IP de la conexion
  directa. Un proxy puede hacer que varias personas compartan la misma cuota;
  los valores `X-Forwarded-For` del cliente no se usan como identidad confiable.
  Con varias replicas los contadores no se comparten y se reinician con cada
  proceso. Antes de habilitar replicas o exponer el servicio, definir la
  topologia de proxies de confianza y un contador compartido, y comprobar el
  comportamiento con solicitudes reales; no habilitar confianza universal en
  cabeceras reenviadas. La suite local comprueba el rechazo del spoofing, no
  valida una topologia de despliegue ni limitacion distribuida.
- La blocklist incorporada es solo un minimo de desarrollo. Para produccion,
  provisionar un corpus local revisado de contrasenas comunes/comprometidas,
  con licencia y procedencia documentadas; no enviar contrasenas del usuario
  a servicios externos. La carga falla si falta el archivo en produccion o
  esta vacio. Esto por si solo no certifica cumplimiento de NIST.
- Los valores de timeout y Argon2id son defaults de desarrollo pendientes de
  calibracion. Falta verificar seguridad concurrente, browser/proxy HTTPS,
  readiness real, integracion Tickets/Chat y despliegue. No declarar G4 PASS.

## Decision de dependencias: override de Effect

El audit detecta GHSA-7589-6fvf-x4pw en `effect <= 3.22.0`, transitiva de
`@prisma/config` 7.10.1. Se propone fijar `effect` 3.22.5 exclusivamente
bajo `@prisma/config`, sin degradar Prisma a 6 ni adoptar Prisma 8 RC.
Validar con lockfile reproducible, generacion/migracion Prisma, tests,
build y audit. Retirar el override cuando Prisma incorpore una version
corregida y compatible. Fuente: https://github.com/advisories/GHSA-7589-6fvf-x4pw.

## Evidencia local del 23 de noviembre de 2026

Base de Rina: `2f51830`. Correcciones: `6c3d55d` (contrato) y `b5a7c1d`
(seguridad y CI). Se ejecuto `node scripts/ci/check-apps.mjs`: PASS, con
`npm ci`, lint, typecheck, 4/4 tests (incluye PostgreSQL 17 real con rol
restringido), build y `npm audit --omit=dev --audit-level=high` (0 alertas).
Prisma 7.10.1 genero cliente y aplico la migracion existente sin cambios.
Los casos agregados cubren contrasenas bloqueadas, inactividad en `/me` e
introspeccion y limite de activacion por cuenta. Los checks de docs y
estructura OpenAPI pasaron; Redocly 2.79.0 valido con 5 warnings existentes.
No quedaron contenedores temporales. No se uso AWS ni una BD real del equipo.
No se ha comprobado GitHub Actions remoto ni se certifica G4.
