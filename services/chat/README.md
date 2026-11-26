# Chat local

Implementacion del [contrato Chat](../../docs/010.G1-Contracts.md#7-contrato-socketio--chat) en la rama `feat/chat`. HTTP de historial y Socket.IO usan Mongo real. Auth/Tickets son simuladores con datos ficticios, sin acceso a sus tablas ni codigo de sus modulos.

## Arranque en contenedores

Desde la raiz del repositorio, con Docker Compose:

```sh
docker compose -f compose.chat.yml up -d --build
```

Con Podman y `uv`, el comando equivalente probado en este entorno es:

```sh
uv tool run --from podman-compose==1.5.0 podman-compose -f compose.chat.yml up -d --build
```

Servicios: Mongo, simuladores Auth/Tickets, Chat y proxy Caddy. Solo el proxy publica `127.0.0.1:8443`. Mongo y las rutas internas no tienen puertos publicados. Mongo conserva mensajes en el volumen `chat-mongo`; no usar `down -v` para parar el entorno.

El origen es `https://localhost:8443`. Caddy genera una CA local. Para conducir la prueba desde Node sin desactivar la validacion TLS:

```sh
podman cp fixit-chat-local_proxy_1:/data/caddy/pki/authorities/local/root.crt /tmp/opencode/fixit-chat-ca.crt
cd services/chat
npm ci
NODE_EXTRA_CA_CERTS=/tmp/opencode/fixit-chat-ca.crt node scripts/smoke.mjs
```

Con Docker, consultar `docker compose -f compose.chat.yml ps -q proxy` y usar ese ID en `docker cp`. El certificado es publico; no copiar la clave de la CA. No hace falta instalar confianza global en el sistema para este test.

El smoke conecta por WSS, se une al ticket ficticio, envia texto, verifica ACK y broadcast, recupera el mensaje por HTTPS y comprueba que `/internal/v1` no se publica. No hay interfaz web ni login real: `/` devuelve 404.

## Fixtures

Ticket: `11111111-1111-4111-8111-111111111111`, inicialmente `ASSIGNED`.

| Cookie ficticia `__Host-fixit_session` | Actor |
| --- | --- |
| `fixture-reporter` | Reporter propietario |
| `fixture-agent` | Agente asignado |
| `fixture-admin` | Admin |
| `fixture-other` | Reporter ajeno, sin acceso |
| `fixture-restricted` | Sesion restringida, sin acceso |

Estas cadenas y el bearer `fixture-service-not-production` son fixtures publicos, no credenciales de personas. Los simuladores solo arrancan con `FIXIT_FIXTURES=1`, en un contenedor separado. No exponer este stack a Internet. Chat obtiene identidad/permisos por HTTP interno; no reconoce tokens ficticios por su cuenta.

## Pruebas

18 pruebas de integración locales verificadas antes de separar ramas. No se afirma integración de producción.

Desde `services/chat`:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

`npm test` crea Mongo en un contenedor desechable con puerto aleatorio ligado a loopback, usa una base aleatoria por escenario y elimina solo su contenedor al terminar. Requiere Podman; con Docker usar `CONTAINER_ENGINE=docker npm test`. El test de caida detiene y recupera exclusivamente ese contenedor. Si se proporciona `MONGO_URI`, usar una base de pruebas desechable: se omite la parada del motor externo y no se elimina su almacenamiento.

El runner verifica persistencia tras reiniciar Chat, reintentos concurrentes, conflicto por texto cambiado, revocacion, reasignacion en vuelo, BOLA, limites compartidos por usuario, UTF-8, paginacion, estados de lectura, Origin y caida de dependencias. No reemplaza pruebas con Auth/Tickets reales.

Configuracion de Chat: `MONGO_URI`, `AUTH_URL`, `TICKETS_URL`, `CHAT_SERVICE_TOKEN`, `PUBLIC_ORIGIN`; opcionales `PORT=4000`, `CHAT_SEND_LIMIT=30`, `CHAT_READ_LIMIT=120`, `INTERNAL_TIMEOUT_MS=3000`. Tokens fuera de Git salvo fixtures. Ventana de limites: 60 segundos, un proceso. Solo transporte WebSocket; el futuro cliente debe usar `transports: ['websocket']`.

## Parar

```sh
uv tool run --from podman-compose==1.5.0 podman-compose -f compose.chat.yml down
```

Con Docker: `docker compose -f compose.chat.yml down`. Ambos conservan volumenes y mensajes.

## Pendiente de integracion

Auth y Tickets reales, emision de cookies y login/CSRF del navegador, integración definitiva con la UI de feat/ui, consumidor JetStream/outbox y recuperacion de su proyeccion. Chat textual no necesita NATS para persistir o autorizar; esta entrega no implementa `ticket:updated` ni declara G1/G3/G4 PASS. Contadores en memoria, fixtures y CA local son para desarrollo. No se hicieron deploy ni cambios Cloud.
