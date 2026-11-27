#!/bin/bash
set -euo pipefail
export AWS_PAGER="" AWS_DEFAULT_REGION=us-east-1
d="$HOME/fixit-infra/evidence-2026-11-24"; mkdir -p "$d"; cd "$d"
date -u +%FT%TZ > retrieved-at.txt
aws --version > aws-version.txt 2>&1
aws cloudformation describe-stacks --stack-name fixit-foundation | jq '{Stacks:[.Stacks[]|{StackName,CreationTime,StackStatus,Description,Tags}]}' > stack.json
aws cloudformation list-stack-resources --stack-name fixit-foundation | jq '{StackResourceSummaries:[.StackResourceSummaries[]|{LogicalResourceId,ResourceType,ResourceStatus,LastUpdatedTimestamp}]}' > resources.json
aws cloudformation describe-stack-events --stack-name fixit-foundation | jq '{StackEvents:[.StackEvents[]|{Timestamp,LogicalResourceId,ResourceType,ResourceStatus}]}' > historical-stack-events.json
if aws cloudformation describe-change-set --stack-name fixit-foundation --change-set-name foundation-review 2>change-set-error.txt | jq '{ChangeSetName,Status,ExecutionStatus,CreationTime,Changes:[.Changes[]|.ResourceChange|{Action,LogicalResourceId,ResourceType}]}' > change-set.json; then rm -f change-set-error.txt; else rm -f change-set.json change-set-error.txt; echo 'Executed change set not retrievable' > change-set-unavailable.txt; fi
getid(){ aws cloudformation describe-stack-resource --stack-name fixit-foundation --logical-resource-id "$1" --query StackResourceDetail.PhysicalResourceId --output text; }
v=$(getid Vpc); b=$(getid ReleaseBucket); c=$(getid Cluster)
aws ec2 describe-vpcs --vpc-ids "$v" | jq '{Vpcs:[.Vpcs[]|{CidrBlock,State,IsDefault,Tags}]}' > vpc.json
aws ec2 describe-subnets --filters "Name=vpc-id,Values=$v" | jq '{Subnets:[.Subnets[]|{CidrBlock,AvailabilityZone,State,MapPublicIpOnLaunch,Tags}]}' > subnets.json
aws ec2 describe-route-tables --filters "Name=vpc-id,Values=$v" | jq '{RouteTables:[.RouteTables[]|{Tags,Routes:[.Routes[]|{DestinationCidrBlock,State,Origin,Target:(if .GatewayId=="local" then "local" elif .GatewayId then "internet-gateway" elif .NatGatewayId then "nat-gateway" else "other" end)}]}]}' > routes.json
aws ec2 describe-security-groups --group-ids "$(getid SmokeSecurityGroup)" | jq '{SecurityGroups:[.SecurityGroups[]|{Description,IpPermissions,IpPermissionsEgress}]}' > security-group.json
aws ec2 describe-nat-gateways --filter "Name=vpc-id,Values=$v" | jq '{NatGateways:[.NatGateways[]|{State}]}' > nat.json
aws s3api get-bucket-versioning --bucket "$b" > s3-versioning.json
aws s3api get-public-access-block --bucket "$b" > s3-public-access.json
aws s3api get-bucket-encryption --bucket "$b" > s3-encryption.json
aws s3api list-object-versions --bucket "$b" | jq '{VersionCount:([.Versions[]?]|length),DeleteMarkerCount:([.DeleteMarkers[]?]|length)}' > s3-objects.json
aws ecs describe-clusters --clusters "$c" | jq '{clusters:[.clusters[]|{status,runningTasksCount,pendingTasksCount,activeServicesCount,settings}]}' > ecs.json
aws ecr describe-repositories | jq '{repositories:[.repositories[]|select(.repositoryName|startswith("fixit-foundation"))|{imageTagMutability,imageScanningConfiguration,encryptionConfiguration}]}' > ecr.json
aws iam get-account-summary | jq '{SummaryMap:(.SummaryMap|{AccountMFAEnabled,AccountAccessKeysPresent,Users})}' > iam-summary.json
aws freetier get-account-plan-state | jq '{accountPlanType,accountPlanStatus,accountPlanRemainingCredits}' > plan.json
sha256sum "$HOME/fixit-infra/foundation.json" | awk '{print $1}' > template-sha256.txt
tar -czf "$HOME/fixit-infra/evidence-2026-11-24.tar.gz" -- *.json *.txt
echo "EVIDENCE_READY"; ls -1; sha256sum "$HOME/fixit-infra/evidence-2026-11-24.tar.gz"
