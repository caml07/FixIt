# FixIt — IT Help Desk

**MVP académico single-tenant para Keiser University LAC.** Tres roles (Reporter, Support Agent, Admin), tickets IT, toma atómica, chat y notificaciones dentro del ticket. No es un servicio oficial de la universidad ni usa identidades institucionales reales.

**Estado (26 nov):** dev conserva contratos, documentación e infraestructura versionada. Baseline Contract-First 0.2.0 congelada. Auth está en feat/auth, Chat en feat/chat y React en feat/ui, sin integración entre features. Revisión técnica del equipo y G1/G4 pendientes.

## Leer solamente lo necesario

- [Índice y fuentes](docs/000.INDEX.md) — qué documento es la referencia vigente
- [UI/UX design brief](.impeccable/surfaces/fixit-workspace.md) — navegación, pantallas, permisos y estados para desktop y mobile
- [Flujos UI/UX (Mermaid)](docs/017.UI-Flows.md) — recorridos por rol, estados y errores
- [Producto y requisitos](docs/001.Product.md) · [FR/NFR](docs/002.Requirements.md)
- [Arquitectura actual](docs/003.Architecture.md) · [Contratos y permisos](docs/010.G1-Contracts.md)
- [API OpenAPI 0.2.0 (frozen baseline)](docs/openapi.json) · [DB 3NF/FK/migración](docs/database/README.md)
- [Cloud: EC2 vs Fargate/RDS/Atlas, NATS y backups S3](docs/004.Cloud.md) · [Entrega](docs/005.Delivery.md) · [Estado de gates](docs/011.Gates.md)
- [Decisiones](docs/006.Decisions.md) · [Resumen para docentes](docs/014.Resumen-Ejecutivo.md)

## Desarrollo compartido

Para el arranque: [entorno híbrido](docs/015.Hybrid-Development.md) y [CI / distribución del trabajo](docs/016.CI-Team-Workflow.md). Los módulos se desarrollan por separado; no confundir pruebas locales con integración real. Ver [AGENTS.md](AGENTS.md).


## Reglas de colaboración

[CONTEXT.md](CONTEXT.md) es la guía canónica; [CLAUDE.md](CLAUDE.md) es el puente mínimo exigido por COP3851. El profesor Félix exige **OpenAPI y esquema 3NF/FK/migraciones validados y commiteados antes de generar controladores con IA**. La baseline 0.2.0 pasó validaciones locales en PostgreSQL 17 desechable y quedó registrada en `dev` antes de cualquier commit de controladores. La revisión técnica de Valeria/Rina sigue pendiente.

No hacer commits, push, merge ni crear recursos AWS sin autorización expresa. Preparar el MVP y probarlo localmente antes de desplegar.

## Implementación de referencia (fuera de `dev`)

En `feat/auth`, consultar el [runbook de Auth](services/auth/README.md) para pruebas locales, configuracion y seguridad.

La rama `prototype/auth-g4` conserva el prototipo Auth. La implementacion del MVP continua en ramas de feature despues de registrar la baseline Contract-First 0.2.0 en `dev`.

## Equipo y fuentes originales

- caml07: Web II y Cloud
- Valeria (avaleria13): Web II y Cloud; autora de la [propuesta original](docs/references/FixIt_Project_Specification.pdf), aunque su portada identifica la cuenta de Yaderling
- Rina (Rinahrrg): Web II y trabajo de Software Engineering II; también puede colaborar con desarrollo y datos

Los roles operativos todavía deben acordarse en equipo. La [adaptación para tres cursos](docs/references/FixIt_Adapting_Cloud_and_Software_Engineering_II_2026-11-10.pdf) es un estudio de alcance, no una rúbrica docente aprobada. La [hoja Contract-First de Félix](docs/references/COP3851_Capstone_2026-11-11.md) sí debe verificarse en la implementación. Las alternativas anteriores se pueden consultar en el historial Git; no son arquitectura vigente.
