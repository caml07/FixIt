# FixIt — Pull Request

## Qué cambia
Explicar en 2–4 frases qué comportamiento o documento se modifica y por qué.

**Módulo / responsable:** Auth / Tickets / Chat+React / Contratos / Cloud / CI
**Requisito:** FR-___ / NFR-___ / ADR-___
**Rama base:** dev (docs/contratos) / integration/mvp (aplicación, cuando se apruebe)

## Contract First
- [ ] Si cambia API/DB, OpenAPI + Prisma + SQL/migración se revisaron y validaron **antes** del código que depende de ellos.
- [ ] La ruta/schema/documentos compartidos se coordinaron con los demás responsables.
- [ ] No estoy presentando el acuerdo de Rina sobre video y prioridades como si ya estuviera modelado por el OpenAPI antiguo.
- [ ] Este PR no cambia alcance ni decisiones Cloud sin registro en el índice/ADR.

## Pruebas realizadas
Indicar comando exacto, salida y si fue ejecutado en esta rama (no escribir «PASS» por suposición).

- [ ] Docs/contratos: `node scripts/ci/check-docs.mjs` + `node scripts/ci/check-contract.mjs` + Redocly.
- [ ] DDL: `sh scripts/ci/check-migration.sh` con PostgreSQL efímero, si aplica.
- [ ] Servicio: lint, typecheck, tests, build, npm audit (cuando exista paquete real).
- [ ] Test negativo: otro usuario/rol no puede acceder ni manipular tickets, sesiones, prioridad oficial, adjuntos o Chat.
- [ ] Verifiqué riesgos de concurrencia o caída de DB/broker si el cambio toca estado.

**Pruebas no ejecutadas y motivos:** ...

## Seguridad y entrega
- [ ] No hay secretos, datos reales de Keiser, videos privados, URLs con tokens o credenciales en Git/logs.
- [ ] No se usó RDS/Atlas real desde CI; no se crearon recursos AWS ni se generaron cargos.
- [ ] Otro integrante/IA revisó el diff y tiene contexto para continuarlo.
- [ ] Sin auto-merge, push/deploy o cambio de infraestructura sin autorización.

Guías: [AGENTS.md](../AGENTS.md) · [CI / equipo](../docs/016.CI-Team-Workflow.md) · [G1](../docs/010.G1-Contracts.md).
