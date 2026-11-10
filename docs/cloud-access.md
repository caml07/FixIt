# Cloud y acceso compartido — diseno provisional

**Estado:** arquitectura en discusion, **no desplegada** ni verificada en AWS.
**Fuentes academicas:** syllabus CEN4086, semanas 8–13; guia local `Chapter_06_Securing_Cloud_Resources_Study_Guide.md` (secciones 6-1 a 6-4).

## Acuerdo del grupo en esta conversacion

**Los tres integrantes** usarian la **misma infraestructura de bases de datos** para desarrollar, en lugar de reservar una instancia exclusiva para Rina. Esto no significa compartir credenciales. Por lo conversado, la parte de Cloud se evaluaria para caml07 y avaleria13; confirmar situacion academica de Rinahrrg antes de asignar entregables.

Se considera una EC2 con **PostgreSQL y MongoDB en contenedores**, volumenes EBS persistentes y bases logicas aisladas (`fixit_dev`, `fixit_demo`), **sin definir aun** el hospedaje del frontend ni la API. Es una posibilidad de bajo numero de componentes, no una arquitectura aprobada en AWS.

## Modelo de accesos propuesto

| Capacidad | caml07 | avaleria13 | Rinahrrg |
| --- | --- | --- | --- |
| Entrar a AWS con identidad individual y MFA | Si | Si | Si |
| Consultar estado de EC2 de DB | Si | Si | Si |
| Iniciar EC2 de DB compartida | Si | Si | Si |
| Detener EC2 | Responsable designado | Responsable designado | No inicialmente |
| Conectar a DB de desarrollo desde laptop | Si | Si | Si |
| Consultar/modificar datos de desarrollo dentro de su rol DB | Si | Si | Si |
| Crear/borrar EC2, administrar IAM o red | Solo responsables Cloud, con permisos acotados | Solo responsables Cloud, con permisos acotados | No |
| Acceso a secretos ajenos, root de cuenta AWS | No por defecto | No por defecto | No |

**Importante:** este cuadro es una **propuesta de permisos**, no una politica IAM ya creada. El permiso `StartInstances` se limitara por ARN/tags/recursos permitidos y se revisaran acciones auxiliares necesarias. Operar AWS e iniciar EC2 **no implica** acceso a tablas o colecciones.

### Separacion de control

- **Identidad AWS:** usar identidades individuales (idealmente IAM Identity Center, si disponible), credenciales temporales y MFA. Nunca compartir usuario root ni access keys en Git.
- **Acceso a la instancia:** evaluar AWS Systems Manager Session Manager con tunel de puertos, IAM ajustado a la instancia y al documento de sesion; evitar abrir SSH, 5432 y 27017 a Internet. Verificar que los permisos de SSM no otorguen shell no autorizada.
- **Datos:** roles propios de PostgreSQL y MongoDB por integrante o funcion, permisos minimos y diferentes credenciales de aplicacion vs. operacion.
- **Red:** VPC/subnets/SG restringidos; endpoint/egress para que SSM opere desde una subnet privada; revisar costo de NAT o endpoints VPC.
- **Reposo y transito:** cifrar volumenes/backups, transporte protegido; evitar secretos en logs y variables versionadas.
- **Rastreo:** CloudTrail para acciones sobre EC2/IAM; auditoria de DB separada para consultas/escrituras. El tunel SSM no sustituye auditoria del motor.

## Operacion compartida

La instancia podra encenderse durante sesiones de trabajo; antes de apagarla, los tres deben coordinarse. Para una demo publica, **no depender de que un estudiante la haya apagado** ni de datos de prueba que se sobreescriben. En una EC2 detenida, EBS persiste y sigue costando; tambien pueden existir otros costos.

Separar `fixit_dev` y `fixit_demo` dentro de los motores ayuda contra errores de pruebas, **pero no es aislamiento operativo**: si cae o se detiene la EC2, caen ambos. Las copias y procedimientos de recuperacion deben probarse, no solo mencionarse.

## Materias que realmente demuestra

- **Cloud Chapter 6:** configuracion segura, Shared Responsibility, least privilege, Zero Trust, segmentacion, SG vs NACL, datos en reposo/en transito, hardening y seguridad de contenedores.
- **Proximos temas:** IAM, KMS/secretos, almacenamiento de datos, observabilidad e infraestructura como codigo (segun syllabus CEN4086).
- **Web II:** persistencia Postgres/Mongo, autorizacion, Docker, variables de entorno y health checks (segun syllabus COP3851).

## Preguntas tecnicas abiertas

1. ¿Una sola EC2 para API + DB por costo o separacion de app/DB por seguridad y disponibilidad?
2. ¿EC2 compartida o alternativas gestionadas? Comparar precio real, creditos, limites e interrupcion de la demo.
3. ¿Como mantener acceso SSM seguro sin costos inesperados de red? Verificar consola, politica IAM, instancia/agent y conectividad.
4. ¿Quien puede detener la maquina y en que horarios? Definir ownership y aviso.
5. ¿Como se guardaran backups, secretos y fotografias o archivos si luego se agregan?
6. ¿El profesor exige recursos especificos, evidencia AWS o criterios de evaluacion distintos para CEN4086?

**No se ha creado ninguna instancia, grupo de seguridad, politica IAM, usuario, base de datos ni pipeline.**
