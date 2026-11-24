# Foundation deployment record — 2026-11-23 (America/Managua)

Status: deployed and verified. Scope: authorized foundation only, AWS us-east-1. No runtime stack, database, NAT, IAM user or credentials created. This is sanitized CLI evidence, not screenshots or a complete account audit.

## Evidence retrieved November 24

See [AWS CLI evidence (2026-11-24)](evidence/2026-11-24/README.md) for the 77 historical stack events and current sanitized JSON outputs, with verified archive transfer. No new resources were created.

## Source and integrity

Source: dev commit 6ec654f8e662751484b8236368994a89557d44ee, infra/cloudformation/foundation.json.
SHA256: 0b29a73819f2304eadd559f69ff2376089f55f9e188464cec85fe18664ec9a85.
Transferred exact Git blob using gzip/base64 into CloudShell ~/fixit-infra/foundation.json; sha256sum matched. AWS CLI 2.41.0. No private Git credentials required.

## Preflight (read-only)

- aws sts get-caller-identity: root console session, no credentials exported.
- aws freetier get-account-plan-state: PAID / ACTIVE, remaining credits USD 119.93795 (Billing displayed USD 119.95 available; different update times). Do not treat credits as a hard spending limit.
- aws iam list-users: zero users. aws iam get-account-summary: root MFA=1, root access keys=0 (rechecked).
- aws ec2 describe-vpcs: default 172.31.0.0/16 only before deployment; no overlap with 10.20.0.0/16.
- aws ec2 describe-availability-zones: six names returned.
- aws cloudformation list-stacks: no existing stacks before deployment.

## Successful commands (sanitized, output filters omitted)

```sh
aws cloudformation validate-template --template-body file://$HOME/fixit-infra/foundation.json --region us-east-1
aws cloudformation create-change-set --stack-name fixit-foundation --change-set-name foundation-review --change-set-type CREATE --template-body file://$HOME/fixit-infra/foundation.json --region us-east-1 --tags Key=Project,Value=FixIt Key=Environment,Value=academic-pilot
aws cloudformation wait change-set-create-complete --stack-name fixit-foundation --change-set-name foundation-review --region us-east-1
aws cloudformation describe-change-set --stack-name fixit-foundation --change-set-name foundation-review --region us-east-1
aws cloudformation execute-change-set --stack-name fixit-foundation --change-set-name foundation-review --region us-east-1
aws cloudformation describe-stacks --stack-name fixit-foundation --region us-east-1
aws cloudformation list-stack-resources --stack-name fixit-foundation --region us-east-1
aws cloudformation describe-stack-events --stack-name fixit-foundation --region us-east-1
```

Change set CREATE_COMPLETE / AVAILABLE; 23 Add, no Modify/Remove. User authorized execution. Final stack CREATE_COMPLETE; 23 resource CREATE_COMPLETE.

Read-only verification:
- aws cloudformation describe-stack-resource for ReleaseBucket, Cluster, Vpc to resolve physical IDs; IDs omitted.
- aws s3api get-bucket-versioning: Enabled.
- aws s3api get-public-access-block: all four settings true.
- aws ecs describe-clusters: ACTIVE, running=0, pending=0, services=0.
- aws ec2 describe-subnets: 10.20.1.0/24 public in 1a; 10.20.10.0/24 app in 1a; 10.20.20.0/24 data in 1a; 10.20.21.0/24 data in 1b; automatic public IP assignment false for all.
- aws ec2 describe-route-tables: app/data only local CIDR; public local + 0.0.0.0/0.
- aws ec2 describe-nat-gateways: no NAT in FixIt.
- aws ecr describe-repositories: four FixIt repos IMMUTABLE, scanOnPush true.
- Some initial CLI JMESPath quoting attempts failed client-side and were corrected; no state change from them.

## Additional read-only account inventory after deployment

In us-east-1: aws ec2 describe-instances (pending/running/stopping/stopped), describe-volumes, describe-addresses, describe-nat-gateways (excluding deleted/failed), aws rds describe-db-instances, describe-db-clusters, aws elbv2 describe-load-balancers, aws secretsmanager list-secrets: all returned zero. aws kms list-aliases: zero non-AWS aliases; this is not proof that no customer-managed unaliased keys exist. aws s3api list-buckets: one bucket account-wide returned. aws iam list-users: zero; root MFA enabled and no root access keys. Not an all-regions/services billing audit.

## Next steps and costs

Signing out does not delete AWS resources or stop metered billing. Foundation has no active compute/NAT/EIP/DB; empty ECR and private S3 definitions should not imply recurring compute cost. S3 requests, object versions, ECR storage/scanning and other services may incur charges. Billing may lag; monitor actual spend. Paid account can bill beyond credits. Do not create more resources until separately authorized.

Human access: prefer IAM Identity Center or federation with temporary credentials and named individual identities/MFA; IAM users with limited permissions only if required. No shared root login or permanent access keys. Root is for account administration. Confirm billing access, budget/alerts and credit applicability/expiry; do not enable new services or change account plan without approval. Scope IAM execution and deployment roles before runtime, not during this review. No integrated deployment; no smoke/NAT/DB provisioned, no JetStream cloud decision, no screenshots or annual Calculator estimate yet. Instructor approval for substitutions pending. See [evaluation report](../../docs/017.Cloud-Evaluation.md) and [runbook](README.md).
