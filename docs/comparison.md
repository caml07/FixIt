# Comparacion de alcances: documento compartido vs. IT Help Desk

**Estado:** comparacion para debate; no sustituye la especificacion original.
**Documento conservado:** [FixIt_Project_Specification.pdf](references/FixIt_Project_Specification.pdf), 21 paginas; su portada identifica a **Yaderling Garcia** como estudiante. El documento fue **compartido por Valeria**, lo que no demuestra que Valeria sea su autora.

## Por que vale la pena conservar el documento original

El PDF ya resuelve varias preguntas que nuestra alternativa necesita aprovechar:

- **Contexto y motivacion claros:** solicitudes que se pierden, poca visibilidad y falta de trazabilidad (pp. 3–4).
- **Scope y matriz RBAC concretos:** responsabilidades separadas para Reporter, Technician y Admin (pp. 4–6).
- **Modelo de datos y contratos REST:** esquemas de Prisma/Mongoose, relaciones, endpoints, convenciones HTTP y manejo de errores (pp. 9–12).
- **Seguridad en varias capas:** bcrypt, JWT en cookie httpOnly, rate limiting, validacion y ownership (pp. 12–14).
- **Defensa frente a problemas de IA:** salida estructurada, deteccion de peligros y salida manual si falla el proveedor (pp. 14–15).
- **Testing y demostracion pensados con antelacion:** unitarias, integracion, escenarios demo, esquema de Docker, OpenAPI y calendario hacia el 7 de diciembre (pp. 16–21).

Su **matriz de cobertura de COP3851** (p. 19) facilita justificar cada tecnologia ante el docente.

## Por que preferimos reducir el alcance

| Dimension | Propuesta original | IT Help Desk provisional | Beneficio esperado / sacrificio |
| --- | --- | --- | --- |
| Problema | Mantenimiento general de campus/edificios | Incidentes IT | Casos y validaciones mas acotados; menor versatilidad |
| Categorias | HVAC, plomeria, electricidad, IT y mas | Redes, hardware, software, cuentas | Menos reglas de negocio y menos riesgos fisicos |
| IA | Triage vision+texto, autoayuda y hazard detection en MVP | No bloquea MVP; opcional | Menos dependencias externas/costo; demo con menos efecto sorpresa |
| Comunicacion | Comentarios en ticket + notificaciones Socket.io | Chat persistente en el ticket + notificaciones | Prueba de WebSockets mas directa; requiere historial y control de acceso |
| Base relacional | Users, tickets, categorias, ubicaciones, tags | Users, tickets, asignaciones, estados | Modelo mas reducido; menos amplitud de relaciones |
| Base documental | ActivityLog y triage logs | Mensajes/chat; logs de IA solo si se implementa | Caso de uso NoSQL claro; mantiene complejidad de dos almacenes |
| Cloud | Deploy clasificado entre extras del MVP (p. 4), descrito en p. 17 | Cloud parte central para quienes cursan CEN4086 | Mas alineacion con segundo curso; mas riesgo operativo |
| Demo | Tres casos de IA, estados, dashboard, seguridad | Incidente real -> agente -> chat -> resolucion -> cloud | Historia demostrable de extremo a extremo; menos features |

La alternativa **no es objetivamente mejor en todo**. Gana en foco y probabilidad de entrega; pierde alcance funcional y el atractivo de la IA como diferenciador. Si el profesor exige IA o mantenimiento general, habria que reabrir la discusion.

## Riesgos que no queremos esconder

1. **Sigue habiendo mucho trabajo para cuatro semanas:** autenticacion, tickets, chat, tests y AWS son varios frentes simultaneos.
2. **Dos bases no son gratis en complejidad:** backups, despliegue, permisos, errores parciales y consistencia; se justifica solo si se demuestra su aporte.
3. **Chat no es solo Socket.io:** requiere persistencia, orden de mensajes, autorizacion por ticket, reconexion y pruebas.
4. **Cloud compartida puede interrumpir el trabajo:** detener una EC2 que almacena ambas DB desconecta a los tres y cualquier demo que dependa de ella.
5. **Documento original no equivale a rubric oficial:** confirmar si dos cursos admiten el mismo producto y que requisitos de cada presentacion son obligatorios.

## Recomendacion de debate

Proponer al equipo el **IT Help Desk con chat por ticket** como producto principal y conservar el documento original como propuesta completa de referencia, no como especificacion a implementar linea por linea. Reservar IA, dashboards complejos y SLA para despues de demostrar login -> ticket -> asignacion atomica -> chat -> resolucion -> deployment.

**Siguiente validacion humana:** obtener acuerdo de Valeria y Rina sobre scope, responsabilidades y demo. El PDF permanece intacto.
