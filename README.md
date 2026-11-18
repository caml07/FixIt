# FixIt — IT Help Desk

**MVP académico single-tenant para Keiser University LAC.** Tres roles (Reporter, Support Agent, Admin), tickets IT, toma atómica, chat y notificaciones dentro del ticket. No es un servicio oficial de la universidad ni usa identidades institucionales reales.

**Estado (16 nov):** `dev` contiene **documentación, OpenAPI y contratos de base de datos**, sin aplicación ejecutable. El prototipo de Auth y sus pruebas se conservaron por separado en la rama `prototype/auth-g4` (no es el MVP integrado). Tickets/Chat/React y AWS siguen pendientes; los contratos requieren revisión del equipo.

## Leer solamente lo necesario

- [Índice y fuentes](docs/000.INDEX.md) — qué documento es la referencia vigente
- [Producto y requisitos](docs/001.Product.md) · [FR/NFR](docs/002.Requirements.md)
- [Arquitectura actual](docs/003.Architecture.md) · [Contratos y permisos](docs/010.G1-Contracts.md)
- [API OpenAPI (draft)](docs/openapi.json) · [DB 3NF/FK/migración](docs/database/README.md)
- [Cloud: EC2 vs Fargate/RDS/Atlas, NATS y backups S3](docs/004.Cloud.md) · [Entrega](docs/005.Delivery.md) · [Estado de gates](docs/011.Gates.md)
- [Decisiones](docs/006.Decisions.md) · [Resumen para docentes](docs/014.Resumen-Ejecutivo.md)

## Desarrollo compartido

Para el arranque: [entorno híbrido y fallback local](docs/015.Hybrid-Development.md) y [CI / distribución del trabajo](docs/016.CI-Team-Workflow.md). Las IAs deben leer [AGENTS.md](AGENTS.md) y las skills de proyecto. **Chat + React corresponde al usuario**; Tickets/Valeria y Auth/Rina aún requieren aceptación. El CI valida Markdown, OpenAPI con Redocly y SQL aislado; el job de aplicaciones devuelve **SKIP explícito** hasta que existan paquetes, y después exige lint, tipos, tests, build y audit. No confundir CI documental verde con producto probado.


## Reglas de colaboración

[CONTEXT.md](CONTEXT.md) es la guía canónica; [CLAUDE.md](CLAUDE.md) es el puente mínimo exigido por COP3851. El profesor Félix exige **OpenAPI y esquema 3NF/FK/migraciones validados y commiteados antes de generar controladores con IA**. El commit inicial de borradores no equivale a validación formal.

No hacer commits, push, merge ni crear recursos AWS sin autorización expresa. Preparar el MVP y probarlo localmente antes de desplegar.

## Implementación de referencia (fuera de `dev`)

La rama `prototype/auth-g4` conserva el servicio Auth con Express/Prisma, la CLI de bootstrap, scripts SQL para roles y sus pruebas PostgreSQL. **No se ejecuta desde esta rama documental** y no equivale al MVP. Continuar el trabajo de código desde una rama específica cuando los contratos G1 estén revisados.

## Equipo y fuentes originales

- caml07: Web II y Cloud
- Valeria (avaleria13): Web II y Cloud; autora de la [propuesta original](docs/references/FixIt_Project_Specification.pdf), aunque su portada identifica la cuenta de Yaderling
- Rina (Rinahrrg): Web II y trabajo de Software Engineering II; también puede colaborar con desarrollo y datos

Los roles operativos todavía deben acordarse en equipo. La [adaptación para tres cursos](docs/references/FixIt_Adapting_Cloud_and_Software_Engineering_II_2026-11-10.pdf) es un estudio de alcance, no una rúbrica docente aprobada. La [hoja Contract-First de Félix](docs/references/COP3851_Capstone_2026-11-11.md) sí debe verificarse en la implementación. Las alternativas anteriores se pueden consultar en el historial Git; no son arquitectura vigente.
