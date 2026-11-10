---
type: architecture-decision-record
status: proposed
date: 2026-11-10
---

# ADR-001 — IT Help Desk y monolito modular

**Estado del producto:** Accepted — IT Help Desk, chat dentro de ticket, agentes pueden tomar tickets.
**Estado de estrategia técnica:** alternativa inicialmente propuesta, **no aceptada**. El usuario expresó el 10-11-2026 interés en [ADR-004: EDA con dos microservicios](ADR-004-eda-two-services.md). Este ADR continúa como referencia hasta resolver G1/G2.

## Contexto

La especificación original compartida por Valeria plantea mantenimiento general, visión artificial, autoayuda, riesgos físicos, dashboards y dos motores de datos. El proyecto tiene tres integrantes y entregas cercanas; también sirve como evidencia para Cloud y Web II.

## Alternativas evaluadas

1. **Original completo:** conserva visión amplia e IA, pero multiplica validaciones, dominios, dependencias y posibilidades de incumplir fecha.
2. **IT Help Desk + monolito modular (opción inicial, ahora en evaluación):** tickets IT, tres roles, chat por ticket, API única Express, React separado como UI y persistencia propuesta.
3. **IT Help Desk + microservicios:** separación independiente de usuarios, tickets/chat, despliegues y datos, sin necesidad demostrada; añade contratos, red, observabilidad y fallos distribuidos.

## Decisión

**Aprobado:** FixIt se enfoca en incidentes técnicos IT; sus agentes toman tickets disponibles; la comunicación ocurre dentro del ticket.

**Propuesto:** una sola API Node/Express organizada por módulos, una SPA React, Socket.io compartiendo servidor HTTP del backend. Sin API Gateway/Kubernetes/colas/Redis para el MVP.

## Consecuencias

- A favor: menos overhead operativo, mejor trazabilidad y prueba de extremo a extremo; todavía aplica middleware, auth, REST, WebSockets y datos de ambos cursos.
- En contra: menos alcance que el documento original; un solo backend y, potencialmente, un solo host implican menos aislamiento/escalabilidad.
- Evitar implementar IA, chat libre, inventario, SLA y soporte físico antes del core.
- Riesgo: que la rúbrica requiera una característica pospuesta. Confirmar con profesores.

## Criterio de revisión

Reabrir si hay requisito docente vinculante, evidencia de carga o un módulo independiente que justifique desplegar separado. No crear otro servicio por la sola razón de «usar Cloud».

Fuentes: [PDF original](../references/FixIt_Project_Specification.pdf), [001.Product](../001.Product.md), [cobertura de cursos](../course-alignment.md).
