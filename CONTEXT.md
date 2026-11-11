# FixIt — CONTEXT

> Estado al cierre del 10 de noviembre de 2026 (America/Managua).
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
  acceder. Las operaciones nuevas del agente anterior deben rechazarse tras
  una reasignación. La semántica precisa de una operación iniciada *durante*
  esa reasignación es todavía una propuesta de diseño, no garantía probada.

**Preferencias técnicas en estudio, no ratificadas por el equipo:**

- Candidato principal: **Auth, Tickets y Chat**, con REST interno, Socket.IO
  para chat, PostgreSQL para identidad/tickets, MongoDB para mensajes y NATS
  JetStream para eventos. Sesiones **opacas**, hashes bcrypt, autorización
  interna por servicio. Ver [G1-Contracts](docs/010.G1-Contracts.md).
- Alternativa conservada: **Core (Auth+Tickets) + Chat**. El monolito modular
  es una opción histórica de respaldo. La comparación de rendimiento NO
  acepta ni rechaza por sí sola [ADR-005](docs/adr/ADR-005-three-services-opaque-sessions.md).
- No ejecutar despliegues de AWS ni modificar el plan de cuenta, costos o
  permisos sin autorización explícita.

## Por qué hay tantos archivos ahora

**Hay una separación deliberada entre especificaciones, experimentos y datos
de ejecución. El gran número de archivos NO significa que hayamos construido
todo FixIt.**

| Ubicación | Qué contiene | Por qué se conserva |
| --- | --- | --- |
| `docs/000`–`012`, `docs/adr/` | Scope, requisitos, arquitectura, decisiones, gates y revisión de seguridad | Trazabilidad de lo acordado, lo propuesto y lo pendiente |
| `docs/references/` | PDFs entregados para el proyecto y alineación de cursos | Referencia histórica; no sustituyen rúbricas oficiales |
| `scripts/g2-baseline.sh` | Prueba sintética de infraestructura bajo cgroups y Podman rootless | Verificar que PG, Mongo, NATS y procesos Node arrancan |
| `spikes/g2/src/server.mjs` | **Servidor experimental**, no productivo, con Express, PG, Mongo, NATS y Socket.IO | Simular un recorrido de los dos diseños sin comprometer G4 |
| `spikes/g2/run.sh`, `bench.mjs`, `resilience.mjs`, `g3-security.mjs` | Orquestación local, carga, fallos y pruebas de permisos | Permiten repetir escenarios con datos ficticios |
| `spikes/g2/analyze*.py`, `results/*/SUMMARY.md` | Análisis de resultados de las distintas rondas | Comparaciones reproducibles, con advertencias metodológicas |
| `spikes/g2/results/**/*.json` | Salidas estructuradas de pruebas exitosas | Evidencia medible por corrida |
| `spikes/g2/results/**/*-stats.tsv` | Muestras de consumo de memoria/CPU de Podman | Trazabilidad del pico observado |
| `spikes/g2/results/**/*-run.log` | Salida de ejecución, incluidas pruebas fallidas y correcciones | Diagnosticar errores y no ocultar los intentos anteriores |
| `spikes/g2/package*.json` | Dependencias y lockfile de los experimentos | Repetirlos con versiones controladas |

Los nombres de resultados incluyen **fecha UTC**, que puede ser el
**11 de noviembre** aunque la ejecución haya ocurrido la noche del
**10 de noviembre en Nicaragua**. Esto no implica trabajo de otro día.

`spikes/g2/node_modules/` pesa significativamente más que los resultados,
pero está **ignorado por Git**, no debe subirse. Los contenedores, redes y
volúmenes utilizados en las pruebas son temporales. No mezclar código del
spike con `services/` cuando iniciemos G4.

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

Todos los números, limitaciones y enlaces de evidencia están en
[011.Gates](docs/011.Gates.md). Las pruebas no son autorización de
producción: no incluyen todavía TLS/CSRF de extremo a extremo, calibración
en el host final, seguridad exhaustiva, pruebas prolongadas ni AWS real.

## Estado de gates al cerrar la sesión

| Gate | Estado honesto | ¿Qué impide PASS? |
| --- | --- | --- |
| G0 · Alcance/academia | **PARCIAL** | Rúbricas y entregables docentes por confirmar |
| G1 · Diseño | **REVIEWED; NO PASS** | Contratos definitivos, política de carreras y aprobación de equipo/ADR-005 |
| G2 · Capacidad/Cloud | **EVIDENCIA PARCIAL; APLAZADO** | Carga prolongada, EC2/T3, costos, backup/restore y producto real |
| G3 · Seguridad/consistencia | **PRUEBAS PARCIALES EN SPIKE; NO PASS** | CSRF/Origin, eventos duplicados/desordenados, carrera en vuelo, permisos y tests del producto |
| G4 · Implementación | **NO INICIADO** | Implementación real y tests del MVP en `services/` y `apps/` |
| G5 · Cloud/entrega | **NO DESPLEGADO** | Presupuesto y autorización, AWS, observabilidad, rollback/restore |

**Ningún gate G0–G5 está completamente aprobado.** Lo que se ha
**validado** es el comportamiento de escenarios concretos sobre el spike;
no confundir `PASS_SPIKE` con `PASS` del proyecto.

## Por dónde retomar mañana

1. Leer [011.Gates](docs/011.Gates.md) y
   [012.G3-Security-Consistency](docs/012.G3-Security-Consistency.md).
2. Continuar **G3**, empezando por CSRF/Origin y revocación de sockets;
   después probar la carrera entre envío y reasignación y reentrega de eventos.
3. Preparar **G4** con código real y tests, reutilizando las lecciones del
   spike **sin copiar mecanismos experimentales inseguros**.
4. Mantener **G2 final aplazado**, pero exigir su revisión y confirmación de
   costos antes de AWS/G5.
5. Cuando el equipo ratifique la arquitectura, actualizar ADR-005, los
   contratos y este CONTEXT; al cerrar todos los gates, revisar además
   `AGENTS.md` según el recordatorio de [Gates](docs/011.Gates.md).

## Convenciones de trabajo

- `dev`: integración; `main`: estable; preferir PR desde `feat/*` con
  tests y revisión. El commit y push se realizan solo cuando el usuario lo
  autoriza explícitamente.
- Mantener secretos fuera de Git, no subir `node_modules`, `.env`, tokens
  ni datos reales. El spike usa solo credenciales ficticias/efímeras.
- Las pruebas en contenedores deben aislarse y limpiar solo sus propios
  recursos. No desplegar, incurrir costos ni marcar gates PASS por inferencia.
- Para decisiones: separar **acuerdo explícito del usuario/equipo**,
  **propuesta documentada** y **prueba técnica reproducible**.
