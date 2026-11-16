---
type: architecture-decision-record
status: proposed
date: 2026-11-10
---

# ADR-003 — AWS Lean: una EC2, S3 privado versionado y costo controlado

**Estado:** Proposed, sujeto a Free Plan, rúbrica, prueba local y confirmación del profesor Marvin. **Actualizacion 15 nov:** el usuario eligio publicar mediante un dominio DigitalPlat delegado a Cloudflare DNS y un Tunnel nombrado; usuario sera titular de DigitalPlat/Cloudflare y Valeria delegada si se permite; **techo US$120 de consumo acumulado contra creditos AWS elegibles** (no dinero personal), pero sin autorizacion de provisionamiento.

## Contexto

La infraestructura debe ser lo bastante real para demostrar Cloud Computing y accesible al equipo, sin costos desproporcionados. Rina no cursó Cloud, pero requiere acceso remoto a datos de desarrollo; caml07 y Valeria se encargan de evaluación de Cloud. El profesor sugirió **S3 para gestión de versiones** en la nube.

## Opciones

| Opción | Ventajas | Desventajas |
| --- | --- | --- |
| EC2 única + Docker Compose (preferida) | Despliegue y cleanup simples, base de costos reducida, control del stack | Punto único de fallo; aislar DB depende de Docker/SG |
| EC2 app y EC2 DB separadas | Red aislada, reinicios independientes | Doble compute, más IP/SG/operación |
| RDS/ECS/ALB + S3/CloudFront | Más servicios gestionados y enfoque empresarial | Costo/incertidumbre Free, mayor curva y más partes que demostrar |

## Decisión propuesta

Una EC2 Linux de tamaño acorde a RAM medida, una VPC simple, un reverse proxy HTTPS, Node/Express, PostgreSQL y MongoDB internos por Compose con volúmenes EBS. **S3 privado con Versioning para releases**, confirmado como pedido de Marvin segun el usuario el 15 nov; Lifecycle para evitar versiones antiguas infinitas. El usuario eligio **EC2 Spot `persistent`/EBS-backed con `stop` ante interrupcion** y apagado manual fuera de pruebas. Si falla Spot durante una demo, habilitar **otra EC2 On-Demand temporal** desde configuracion reproducible y recuperar datos, solo dentro de los creditos y sin conversion in-place. No se ha provisionado ni probado.

Tres identidades humanas con MFA, permisos separados; Rina podrá consultar/iniciar la EC2 designada y conectarse a sus DB por SSM port forwarding, **sin permisos globales ni apagar la instancia al principio**. No abrir DB ni SSH a Internet.

## Consecuencias

- Spot cobra mientras esta encendida; stop manual (solo request persistent, EBS-backed) detiene computo pero EBS sigue cobrando. AWS puede interrumpirla con ~2 minutos de aviso y reanudarla cuando regresa capacidad. Definir responsable y pruebas de recuperacion; Spot no garantiza disponibilidad de demo.
- El acceso vía SSM necesita rol, agente y ruta de red de salida. Usar subnet con Internet Gateway y SG inbound limitado puede evitar NAT Gateway caro; sigue existiendo costo de IPv4 pública.
- S3 Versioning consume almacenamiento por **cada versión completa**; se requiere Lifecycle y evidencia de costos.
- Costos aproximados: consultar [004.Cloud](../004.Cloud.md); no asumir créditos elegibles ni precio final.
- S3 **no sustituye Git** ni hace rollback automatico de DB. **Backups PG/Mongo privados y cifrados, en prefijo S3 aparte, sin caducidad automatica**; restaurar en prueba y exportar copia al final antes de cleanup. Conservarlos consume almacenamiento, no borrar sin autorizacion.
- **Dominio y TLS elegidos para diseno:** DigitalPlat + Cloudflare DNS + Tunnel nombrado para HTTPS/WSS. Registro, salida EC2 y pruebas pendientes, ver [Cloud 004, seccion 9](../004.Cloud.md). Restore real sigue siendo gate.

## Gate de aceptación

1. Comprobar estado Free/Paid y saldo de la cuenta legítimamente elegible.
2. Costear EC2 + EBS + egreso IPv4/IPv6/NAT + S3 + trafico/logs con Marvin; comparar el costo **total hasta US$120** con saldo/vencimiento real de creditos (hasta US$200 promocionales, no garantizados).
3. Probar contenedores locales, consumo RAM y respaldo/restore.
4. Confirmar política IAM/SSM y qué puertos se exponen.
5. Aplicar el techo elegido de **US$120 de costo bruto acumulado cubierto con creditos reales**, alertas y procedimiento de cleanup; autorizar recursos por separado antes de crearlos.

Si falla, mantener demo local y revisar alternativas sin crear infraestructura por inercia. El estado del ADR permanece Proposed hasta validar esos gates.

Fuentes: [AWS Free](https://aws.amazon.com/free/), [S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html), [SSM](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html), [AWS budgets](https://aws.amazon.com/aws-cost-management/aws-budgets/).
