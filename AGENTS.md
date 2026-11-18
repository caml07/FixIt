# FixIt — reglas para agentes (Codex, Claude, OpenCode)

**Leer primero:** [CONTEXT.md](CONTEXT.md), [docs/000.INDEX.md](docs/000.INDEX.md), [docs/016.CI-Team-Workflow.md](docs/016.CI-Team-Workflow.md).

- **Contract First:** API `docs/openapi.json` + SQL/Prisma 3NF/FK migrados y validados en commit **anterior** a generar los controladores correspondientes. El contrato previo no incluye urgencia/prioridad ni video; ver [G1 B3](docs/010.G1-Contracts.md). No inventar endpoints sin revisión.
- **Responsables:** usuario = **Chat + React** (confirmado); Valeria = **Tickets** (propuesto, pendiente de aceptar); Rina = **Auth** (propuesto, pendiente de aceptar); Cloud = usuario/Valeria. No escribir módulos ajenos sin coordinación. No atribuir aceptaciones ficticias.
- **Cam Route:** detectar tarea, aplicar solo skills pertinentes. Skills locales: [fixit-contract-first](.agents/skills/fixit-contract-first/SKILL.md) y [fixit-ci-handoff](.agents/skills/fixit-ci-handoff/SKILL.md).
- **Cloud híbrido:** inicialmente APIs, JetStream y web **locales**; RDS/Atlas solo si se habilita acceso seguro y se autoriza costo. Fallback total local. CI **nunca** utiliza bases Cloud ni credenciales reales; ver [015](docs/015.Hybrid-Development.md).
- **Seguridad:** sesiones opacas verificadas con Auth; RBAC/ownership y audiencia se verifican en backend y en cada operación Socket.IO. Reporter propone urgencia; solo agente **asignado**/Admin fija prioridad. No datos institucionales reales, credenciales, tokens ni videos sensibles.
- **Pruebas:** ejecutar `node scripts/ci/check-docs.mjs`, `node scripts/ci/check-contract.mjs`, `npx --yes @redocly/cli@2.79.0 lint docs/openapi.json` y, con motor de contenedores, `sh scripts/ci/check-migration.sh`. Son checks contract/documentales y SQL, **no** prueban aplicación integral.
- **Control humano:** sin commit, push, merge, creación de AWS/Atlas, acceso a datos reales ni gasto sin autorización explícita. `dev` es documentación/contratos; código producto en ramas separadas tras revisión.
- Antes de declarar una tarea lista: decir **qué comando corrió**, resultado real y qué queda sin probar. No alterar `main`.

Para requisitos académicos de Mr Félix se mantiene [CLAUDE.md](CLAUDE.md).
