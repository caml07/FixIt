# Dependencias de Chat

[DEPENDENCY RFC], 20 nov 2026. Alcance: modulo local de Chat, sin integrar Auth/Tickets reales.

| Paquete | Version | Motivo y alternativa |
| --- | --- | --- |
| express | 5.3.0 | HTTP del stack elegido; evita un router manual |
| socket.io | 4.8.4 | Protocolo de eventos elegido; WebSocket puro cambiaria el contrato |
| mongoose | 9.12.3 | ODM elegido para Mongo; incluye driver e indices, sin segundo cliente |
| zod | 4.6.7 | Validacion de payloads y respuestas internas; evita guards manuales repetidos |
| rate-limiter-flexible | 11.5.0 | Contadores compartidos por usuario en un proceso; evita implementar ventanas manualmente |

Desarrollo: TypeScript 7.0.2, tsx 4.23.15, Biome 2.6.8, tipos Node/Express y socket.io-client 4.8.4 para pruebas del protocolo real. Lockfile fija versiones transitivas. Node 24 o superior.

`npm audit --audit-level=high` ejecutado el 20 nov 2026: **0 vulnerabilidades** en el lockfile de Chat. No se aprueban dependencias por el audit del prototipo Auth. Limitadores en memoria solo para una instancia local; antes de replicas hace falta almacenamiento compartido y pruebas de bypass. Sin Redis ni otra infraestructura en esta fase.
