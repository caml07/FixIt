# G2 — Benchmark exploratorio

**Estado: evidencia de spike, G2 NO PASS.** Datos de procesos reales
Express + PostgreSQL + MongoDB + NATS + Socket.IO; no es el FixIt final.

Cuotas de los contenedores: **2,510 MiB / 1.95 vCPU** en ambos escenarios.
Cada corrida usa diez actores y verifica 13 comportamientos.

| Indicador | 3 servicios | Core + Chat |
| --- | ---: | ---: |
| Login (p95 ms) | 6613.2–7113.5 | 2461.3–2610.7 |
| Crear ticket (p95 ms) | 784.3–917.8 | 72.4–80.8 |
| Claim de ticket (p95 ms) | 178.9–188.4 | 24.8–61.3 |
| Chat send (p95 ms) | 1504.7–1602 | 1597.8–1690.1 |
| Consulta de sesión (p95 ms) | 577.1–668.7 | 197.6–246 |
| Memoria pico observada (MiB) | 342.0–352.0 | 278.6–287.3 |

## Corridas

| Modo | JSON | Checks | Duración (s) | Memoria pico (MiB) | Samples |
| --- | --- | ---: | ---: | ---: | ---: |
| three | `g2-three-20261111T033426Z.json` | 13/13 | 30.5 | 352.0 | 15 |
| three | `g2-three-20261111T033840Z.json` | 13/13 | 30.4 | 344.9 | 15 |
| three | `g2-three-20261111T034454Z.json` | 13/13 | 34.2 | 342.0 | 17 |
| two | `g2-two-20261111T033616Z.json` | 13/13 | 21.3 | 280.3 | 10 |
| two | `g2-two-20261111T034021Z.json` | 13/13 | 21.6 | 278.6 | 11 |
| two | `g2-two-20261111T034641Z.json` | 13/13 | 21.9 | 287.3 | 11 |

Los rangos son **mínimo–máximo de p95 por corrida**, no intervalos de confianza.
La memoria es suma máxima de muestras de podman stats y no incluye todo el host.
La CPU total asignada es igual, pero en tres servicios Auth recibe 0.20 vCPU
y Tickets 0.30, mientras Core comparte 0.50 vCPU; esa diferencia importa.

**Limitaciones:** bcryptjs cost 9, no TLS/CSRF, un solo socket WebSocket,
muestras pequeñas, sin carga prolongada, sin backups ni race in-flight,
sin memoria de kernel y sistema operativo EC2, sin costos de AWS validados.
La recuperación probada es de Chat/consumo JetStream, no de la base de datos.

Un primer intento de tres servicios falló por un matcher incompleto del
proxy Caddy. Se corrigió y ese intento no se incluye en las corridas válidas.
