# FixIt — IT Help Desk

Proyecto academico de **Web Development II (COP 3851)** y **Cloud & Internet Computing (CEN 4086)**. **El equipo aprobo el alcance IT Help Desk**; las decisiones tecnicas siguen propuestas. No hay aplicacion ni infraestructura AWS desplegada.

> **Empezar en [docs/000.INDEX.md](docs/000.INDEX.md)**. Indice canonico con producto, FR/NFR, arquitectura, Cloud, plan y ADR. La documentacion previa permanece como antecedente historico.

## Equipo

- [caml07](https://github.com/caml07) — Web II; Cloud (segun lo conversado).
- [avaleria13](https://github.com/avaleria13) — Web II; Cloud (segun lo conversado).
- [Rinahrrg](https://github.com/Rinahrrg) — Web II; colaboracion en interfaz/datos. No ha cursado Cloud, segun informacion mas reciente.

La distribucion concreta de tareas todavia no esta aprobada por el equipo.

## Dos enfoques en evaluacion

1. **Propuesta original de mantenimiento general:** documento completo compartido por Valeria, conservado sin modificar en [docs/references/FixIt_Project_Specification.pdf](docs/references/FixIt_Project_Specification.pdf).
2. **Propuesta provisional de IT Help Desk:** tickets de soporte tecnico y chat asociado a cada ticket. Vease [docs/requirements.md](docs/requirements.md).

El equipo dio su visto bueno para continuar con la segunda. Se preserva el PDF original; no se pretende que el MVP replique todas sus funciones. Comparacion previa en [docs/comparison.md](docs/comparison.md).

## Estado actual

- [x] Repositorio privado creado.
- [x] Ramas `main` y `dev` creadas; esta documentacion se prepara en `dev`.
- [x] Alcance IT Help Desk aprobado como direccion del producto por el equipo.
- [x] Chat dentro de cada ticket y autoasignacion de tickets disponibles planteados.
- [x] Una infraestructura de bases de datos **compartida por los tres** como criterio de diseno.
- [x] Documentos canonicos de producto, requisitos, arquitectura, Cloud, delivery y ADR redactados **en borrador**.
- [ ] Aprobacion de decisiones tecnicas, rubricas y costos AWS con el equipo y docentes.
- [ ] Implementacion, pruebas y recursos AWS: **no iniciados**.

## Documentacion canonica

- [Indice de documentacion](docs/000.INDEX.md)
- [Producto y alcance](docs/001.Product.md)
- [Requisitos FR/NFR](docs/002.Requirements.md)
- [Arquitectura tecnica](docs/003.Architecture.md)
- [AWS, S3 Versioning y costos](docs/004.Cloud.md)
- [Plan y pruebas](docs/005.Delivery.md)
- [ADR y preguntas abiertas](docs/006.Decisions.md)
- [Evaluación EDA/microservicios y gates](docs/007.EDA-Evaluation.md)
- [Estructura propuesta, agents y tests](docs/008.Repository-Structure.md)

## Borradores historicos conservados

- [Requisitos y flujos propuestos](docs/requirements.md)
- [Comparacion con la propuesta original](docs/comparison.md)
- [Cloud, datos y acceso del equipo](docs/cloud-access.md)
- [Cobertura de materias y preguntas pendientes](docs/course-alignment.md)

**Regla de colaboracion:** no tratar las decisiones tecnicas propuestas como implantadas; no guardar credenciales en Git. El codigo y los cambios futuros via ramas feat/* y PR hacia dev, segun acuerdo del grupo.
