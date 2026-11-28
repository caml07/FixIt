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

Para ensayar la recuperacion de la base, ejecutar `check-auth.sh` con
`FIXIT_AUTH_RECOVERY_TEST=1`. La prueba pausa y reanuda exclusivamente su
contenedor PostgreSQL temporal y verifica el proceso HTTP de Auth con una
sesion de prueba. En Windows puede ejecutarse con Git Bash y Docker.
En el ensayo local, una solicitud autenticada supero el plazo de 3 segundos
del cliente mientras PostgreSQL estaba pausado; despues de reanudarlo, Auth
volvio a responder. `/health` siguio en 200 porque solo indica que el proceso
esta vivo. El endpoint interno `GET /internal/v1/auth/ready` acepta el bearer
de Tickets o Chat y comprueba con una conexion separada y de solo lectura, en
un plazo de tres segundos, que Auth puede consultar usuarios y sesiones.
Devuelve 200 o 503, no se publica por el proxy y no comprueba el pool principal
ni garantiza solicitudes posteriores. Las solicitudes ordinarias tienen un
plazo de respuesta de cinco segundos: si vence, Auth intenta responder 503 con
resultado incierto. Los plazos dependen del event loop y la red, y no cancelan
una consulta o transaccion en curso. Un proxy debe permitir tiempo suficiente
para recibir esa respuesta. Si se pierde una respuesta de escritura, seguir el
procedimiento de reconciliacion de [G1](../../docs/010.G1-Contracts.md), sin
reintentos automaticos ni suponer rollback.
Un experimento separado con el `query_timeout` del controlador `pg` confirmo
que una escritura enviada durante la pausa puede completarse tras informarse
el timeout. Por eso no se configura ese limite global como si cancelara la
operacion. Es necesario disenar y probar el manejo de resultados inciertos,
incluida la reconciliacion antes de reintentar operaciones de cuentas.

La prueba opcional `browser-https.integration.test.mjs` usa Chrome y OpenSSL
locales, un proxy HTTPS y un perfil de navegador temporales. Una pagina de prueba
verifica activacion, rechazo sin CSRF, cierre de sesion provisional, nuevo login
y logout; no prueba las pantallas React ni el proxy definitivo. Para incluirla en
`npm test`, configurar `FIXIT_BROWSER_PATH` y `FIXIT_OPENSSL_PATH` con las rutas
de sus ejecutables. Sin ambas variables se omite; no se considera aprobada por
una suite que la haya omitido. El certificado local autofirmado solo se acepta
en ese navegador de prueba y no configura la confianza del sistema.

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
| `AUTH_PUBLIC_ORIGIN` | Origen HTTPS exacto del proxy/UI, sin slash final ni ruta; Auth rechaza HTTP y URLs que no sean un origen canonico |
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
   ejecutar la CLI en CI, con salida redirigida ni en logs de contenedor. La
   CLI rechaza antes de modificar la base cuando no hay terminal interactiva;
   los errores inesperados no muestran detalles de conexion ni de la base.
   La prueba interactiva aislada verifica bootstrap unico, contrasenas
   temporales, recuperacion de la misma cuenta, revocacion y auditoria. En
   Windows se ejecuta en terminal con `FIXIT_AUTH_TTY_TEST=1` y
   `FIXIT_WINPTY_PATH` apuntando a `winpty.exe`, mediante
   `sh scripts/ci/check-auth.sh`; requiere Git Bash y Docker. La prueba usa
   una base desechable y captura la contrasena dentro del proceso, sin imprimirla.
4. El proxy HTTPS dirige `/api/v1/auth/*` y `/api/v1/admin/*` a Auth; **no**
  debe publicar ninguna ruta `/internal/v1/*`. Usar mismo origen para
   el navegador y `X-CSRF-Token` en mutaciones. Tickets y Chat usan sus
   credenciales internas por red privada, no desde React.

## Seguridad y limites

- Tickets puede consultar `GET /internal/v1/users/{userId}/agent-eligibility`
  con su credencial interna: solo un `SUPPORT_AGENT` `ACTIVE` resulta elegible;
  Chat recibe 403. La respuesta no se almacena. La consulta y la reasignacion
  no son atomicas entre servicios; Tickets debe negar el cambio si Auth falla.
- La introspeccion acepta `csrfToken` opcional y responde `csrfValid` cuando
  se solicita: solo es verdadero para una sesion FULL activa y su propio token.
  Tickets debe validar Origin/Fetch Metadata, exigir ambos `active:true` y
  `csrfValid:true` en cada mutacion y rechazar errores o respuesta incompleta.
  No compartir `AUTH_CSRF_KEY` ni tratar introspeccion exitosa por si sola
  como validacion CSRF. La integracion con Tickets sigue pendiente de prueba.

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
  esta vacio, no contiene ninguna entrada compatible con la politica de
  longitud de FixIt o no es UTF-8 valido. Se preservan los espacios que forman
  parte de cada entrada. Esto por si solo no certifica cumplimiento de NIST.
  La lista NCSC de 100 000 contrasenas difundidas corresponde a un analisis de
  [2019](https://www.ncsc.gov.uk/sites/default/files/documents/NCSC_Annual%20Review_2019%20FINAL%20double%20pages%20V2.pdf)
  y no se ha seleccionado como corpus definitivo. [Pwned Passwords](https://haveibeenpwned.com/Passwords)
  permite descargar hashes para consulta local, pero el cargador actual espera
  texto UTF-8, no hashes: no se puede usar directamente esa descarga. Quedan
  pendientes la seleccion y validacion de fuente, formato, actualizacion y capacidad.
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
