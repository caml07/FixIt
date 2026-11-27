# AWS CloudShell evidence — 24 November 2026

Retrieved from AWS CloudShell in us-east-1 on 2026-11-24 15:04:23 UTC (09:04:23 CST). This is **read-only evidence**, not a second deployment.

## Historical and current evidence

- `historical-stack-events.json`: 77 historical CloudFormation events returned by AWS; initial REVIEW_IN_PROGRESS at 2026-11-23 22:23:42 CST, final CREATE_COMPLETE at 22:25:21 CST (UTC timestamps in JSON are November 24).
- `stack.json`, `resources.json`: current stack status CREATE_COMPLETE, 23/23 resources complete.
- `vpc.json`, `subnets.json`, `routes.json`, `security-group.json`, `nat.json`: live network configuration and zero NAT gateways.
- `s3-versioning.json`, `s3-public-access.json`, `s3-encryption.json`, `s3-objects.json`: versioning, access block, encryption and zero object versions/delete markers.
- `ecs.json`, `ecr.json`: ACTIVE cluster, zero running/pending tasks and services; four immutable ECR repositories.
- `iam-summary.json`, `plan.json`: root MFA enabled, zero IAM users/root access keys, PAID/ACTIVE, USD 119.937897 remaining credits at query time.
- `aws-version.txt`, `retrieved-at.txt`, `template-sha256.txt`: provenance and template integrity.
- `change-set-unavailable.txt`: executed change set could not be retrieved on this date. See the [original deployment record](../../DEPLOYMENT-2026-11-23.md) for the previously observed 23 Add actions. No reconstructed JSON is presented as original output.

## Provenance and privacy

Collected via [collect-evidence.sh](../../collect-evidence.sh), using AWS CLI read-only API operations and jq projections to exclude physical identifiers and irrelevant fields. Transfer of the original compressed archive from CloudShell was verified against the SHA-256 in `archive-sha256.txt` before extraction. Eight system-generated stack ARN tag values in VPC/subnet/route outputs were subsequently redacted locally; consequently the repository files are sanitized output and not a byte-identical copy of the original archive. All JSON parsed successfully. The original archive remains in CloudShell at `~/fixit-infra/evidence-2026-11-24.tar.gz`; it contains account/stack identifiers and must not be published. No credentials or root access keys are included in the repository evidence.

These are original AWS historical events and newly retrieved, projected CLI outputs, **not a complete terminal transcript of November 23**. No screenshots, Fargate smoke execution, CloudWatch alarm, application deployment, S3 sample versions or full billing audit are claimed. No resources were created or changed during collection. Remaining credits are not a guaranteed spend cap.
