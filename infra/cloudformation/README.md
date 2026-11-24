# FixIt CloudFormation preflight

**Foundation deployed and verified on 2026-11-23.** See [deployment record](DEPLOYMENT-2026-11-23.md) for account preflight, commands and results. The instructions below are historical/reusable preflight procedures; do not recreate the existing stack. Smoke/runtime not deployed. No EC2 instances created. This directory does not demonstrate the integrated FixIt application.

## Templates and local checks

- `foundation.json`: VPC, public/app/two isolated data subnets, route tables, IGW, smoke security group, ECS cluster, immutable ECR repositories and encrypted versioned private S3. No NAT, EIP, ECS task/service, database or alarm.
- `session-smoke.json`: temporary NAT/EIP, app default route, Fargate smoke task/service, scoped log writer role, log group (7 days), and CloudWatch CPU alarm. **Creating this stack is billable even at DesiredCount=0.** The smoke container only writes a startup log and sleeps; no app, broker, RDS, Atlas, public endpoint or application authentication is tested.

Validate without AWS credentials (cfn-lint 1.61.0):

```sh
uvx --from cfn-lint==1.61.0 cfn-lint -r us-east-1 -- infra/cloudformation/foundation.json infra/cloudformation/session-smoke.json
node scripts/ci/check-docs.mjs
```

Local lint passed on 2026-11-23; this verifies template structure/schema for the specified region, not live resource creation, permissions, quotas, AZ selection, image pull or network reachability.

## Preflight before any AWS action

1. Confirm instructor substitutions for VPC peering, two VMs, ICMP, S3 website and VM alarm.
2. Check root MFA, account plan, credits, permitted region and service eligibility, quotas, existing CIDR overlap and at least two available AZs. Verify the smoke image digest before running it. Set budget alert and obtain explicit authorization for each stack/session. Budget alerts do not guarantee a hard spending cap.
3. Prepare annual AWS Pricing Calculator estimate and short-session budget including NAT, public IPv4, Fargate (0.25 vCPU / 0.5 GiB), CloudWatch, S3/ECR and future RDS/Atlas. Review current region-specific charges.
4. Use authorized AWS CLI v2 credentials (never root access keys). Review change sets before executing them. For the completed foundation commands and results, see the deployment record; smoke commands remain unexecuted.

## Foundation change set (only after permission)

From the repository root, using the chosen profile and region (example us-east-1):

```sh
aws cloudformation validate-template --template-body file://infra/cloudformation/foundation.json --region us-east-1
aws cloudformation create-change-set --stack-name fixit-foundation --change-set-name foundation-review --change-set-type CREATE --template-body file://infra/cloudformation/foundation.json --region us-east-1
aws cloudformation wait change-set-create-complete --stack-name fixit-foundation --change-set-name foundation-review --region us-east-1
aws cloudformation describe-change-set --stack-name fixit-foundation --change-set-name foundation-review --region us-east-1
```

Review every change and stop before execute until approved. Use UPDATE rather than CREATE for an existing deployed stack; choose a new change set name. Capture stack outputs, VPC, route tables, security group, ECS cluster and S3 versioning/block public access after authorized creation. A change set is not a deployment. No NAT/EIP is created by this template.

## Temporary smoke session

Only after foundation is deployed and separate cost approval is given. Use the same region/account and foundation stack name. Set `DesiredCount=1` for the actual test; default 0 deliberately launches nothing. Creating the session stack with 0 still allocates NAT and EIP, which incur costs.

```sh
aws cloudformation validate-template --template-body file://infra/cloudformation/session-smoke.json --region us-east-1
aws cloudformation create-change-set --stack-name fixit-session --change-set-name smoke-review --change-set-type CREATE --template-body file://infra/cloudformation/session-smoke.json --parameters ParameterKey=FoundationStack,ParameterValue=fixit-foundation ParameterKey=DesiredCount,ParameterValue=1 --capabilities CAPABILITY_IAM --region us-east-1
aws cloudformation wait change-set-create-complete --stack-name fixit-session --change-set-name smoke-review --region us-east-1
aws cloudformation describe-change-set --stack-name fixit-session --change-set-name smoke-review --region us-east-1
```

Review the IAM role and billable resources. Execute only after authorization. Record the actual ECS task RUNNING, task private ENI/no public IP, NAT route, startup log, alarm configuration and status, and the isolated data route table with no Internet default route. An image pull and CloudWatch startup log provide evidence of outbound connectivity, not ICMP tests or RDS isolation. For S3, upload two small fictitious versions under the same key and record version IDs/retrieval after permission. Do not upload real credentials/data. Do not claim a public website or a complete deployed application.

## Teardown

After the smoke, scale the service to zero, verify no running task, export logs/screenshots, then delete the authorized session stack; wait for DELETE_COMPLETE and check NAT/EIP/route deletion in AWS. The session stack is dependent on foundation exports. Do not remove foundation while imports exist. Foundation release bucket and repositories have Retain policies; retained objects/images/versions still incur storage charges and need explicit final cleanup after verified exports. Check Billing and resource inventory; no automatic destructive command is provided.

## Next work

Future full app needs RDS private, Atlas allowlist, actual service SGs/discovery, task roles/secret injection, Cloudflare Tunnel and durable JetStream decision. There is no approved remote database access from local laptops without a secure path. Use local Compose until that is resolved. See [academic proposal](../../docs/017.Cloud-Evaluation.md).
