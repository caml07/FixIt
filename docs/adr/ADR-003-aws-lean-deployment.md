---
type: architecture-decision-record
status: proposed
date: 2026-11-10
---

# ADR-003 — AWS Lean: una EC2, S3 privado versionado y costo controlado

**Estado:** Proposed, sujeto a Free Plan, rúbrica, prueba local y confirmación del profesor Marvin.

## Contexto

La infraestructura debe ser lo bastante real para demostrar Cloud Computing y accesible al equipo, sin costos desproporcionados. Rina no cursó Cloud, pero requiere acceso remoto a datos de desarrollo; caml07 y Valeria se encargan de evaluación de Cloud. El profesor sugirió **S3 para gestión de versiones** en la nube.

## Opciones

| Opción | Ventajas | Desventajas |
| --- | --- | --- |
| EC2 única + Docker Compose (preferida) | Despliegue y cleanup simples, base de costos reducida, control del stack | Punto único de fallo; aislar DB depende de Docker/SG |
| EC2 app y EC2 DB separadas | Red aislada, reinicios independientes | Doble compute, más IP/SG/operación |
| RDS/ECS/ALB + S3/CloudFront | Más servicios gestionados y enfoque empresarial | Costo/incertidumbre Free, mayor curva y más partes que demostrar |

## Decisión propuesta

Una EC2 Linux de tamaño acorde a RAM medida, una VPC simple, un reverse proxy HTTPS, Node/Express, PostgreSQL y MongoDB internos por Compose con volúmenes EBS. S3 bucket **privado con Versioning** para artefactos compilados/manifiestos de release asociados a un commit Git; Lifecycle para evitar versiones antiguas infinitas.

Tres identidades humanas con MFA, permisos separados; Rina podrá consultar/iniciar la EC2 designada y conectarse a sus DB por SSM port forwarding, **sin permisos globales ni apagar la instancia al principio**. No abrir DB ni SSH a Internet.

## Consecuencias

- Una EC2 apagada detiene la demo y a los tres; definir horario y responsable.
- El acceso vía SSM necesita rol, agente y ruta de red de salida. Usar subnet con Internet Gateway y SG inbound limitado puede evitar NAT Gateway caro; sigue existiendo costo de IPv4 pública.
- S3 Versioning consume almacenamiento por **cada versión completa**; se requiere Lifecycle y evidencia de costos.
- Costos aproximados: consultar [004.Cloud](../004.Cloud.md); no asumir créditos elegibles ni precio final.
- S3 **no sustituye Git**, no hace rollback automático de DB ni sirve como estrategia suficiente de backup.
- Un dominio/certificado para HTTPS y un restore real quedan como gates.

## Gate de aceptación

1. Comprobar estado Free/Paid y saldo de la cuenta legítimamente elegible.
2. Costear tamaño EC2 + EBS + IPv4 + S3 + tráfico/logs en la región escogida junto con Marvin.
3. Probar contenedores locales, consumo RAM y respaldo/restore.
4. Confirmar política IAM/SSM y qué puertos se exponen.
5. Aprobar un techo de gasto y procedimiento de limpieza.

Si falla, mantener demo local y revisar alternativas sin crear infraestructura por inercia. El estado del ADR permanece Proposed hasta validar esos gates.

Fuentes: [AWS Free](https://aws.amazon.com/free/), [S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html), [SSM](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html), [AWS budgets](https://aws.amazon.com/aws-cost-management/aws-budgets/).
