#!/bin/sh
# G2 infra baseline only: these Node processes are NOT FixIt services.
# Podman rootless + cgroups v2 required. No host ports, AWS, or persistent volumes.
set -eu

network="fixit-g2-$$"
created=""
cleanup() {
  for name in $created; do
    podman rm -f "$name" >/dev/null 2>&1 || :
  done
  podman network rm "$network" >/dev/null 2>&1 || :
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

command -v podman >/dev/null 2>&1 || { echo 'Podman required' >&2; exit 1; }
podman info --format '{{.Host.CgroupsVersion}}' | grep -qx v2 || {
  echo 'cgroups v2 required for resource caps' >&2
  exit 1
}
podman network create "$network" >/dev/null

start() {
  name="$1"
  shift
  podman run -d --rm --name "$name" --network "$network" \
    --security-opt no-new-privileges --pids-limit 120 "$@" >/dev/null
  created="$name $created"
}

mongo="$network-mongo"
pg="$network-pg"
nats="$network-nats"
auth="$network-auth"
tickets="$network-tickets"
chat="$network-chat"

printf 'G2 synthetic baseline: %s\n' "$(date -Iseconds)"
echo 'Memory caps total: 2540 MiB; CPU quotas total: 1.95 vCPU'
start "$mongo" --memory 1100m --memory-swap 1100m --cpus .55 \
  docker.io/mongodb/mongodb-community-server:8.0-ubi8

# Ephemeral DB password: isolated network, no published ports, no persistent volume.
password="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
start "$pg" --memory 600m --memory-swap 600m --cpus .40 \
  -e "POSTGRES_PASSWORD=$password" docker.io/library/postgres:17-alpine
unset password

start "$nats" --memory 300m --memory-swap 300m --cpus .25 \
  docker.io/library/nats:2.12-alpine -js -m 8222 -sd /tmp/jetstream

for svc in auth tickets chat; do
  name="$network-$svc"
  start "$name" --memory 180m --memory-swap 180m --cpus .25 \
    docker.io/library/node:26-alpine node -e \
    "require('node:http').createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({service:'$svc',status:'synthetic'}))}).listen(3000,'0.0.0.0')"
done

i=0
until podman exec "$pg" pg_isready -U postgres >/dev/null 2>&1; do
  i=$((i + 1))
  test "$i" -lt 30 || { echo 'PostgreSQL not ready' >&2; exit 1; }
  sleep 1
done
echo 'PostgreSQL: ready'

i=0
until podman exec "$auth" node -e \
  "Promise.all([fetch('http://$tickets:3000/'),fetch('http://$chat:3000/'),fetch('http://$nats:8222/jsz')]).then(async responses=>{const js=await responses[2].json();if(!responses[0].ok||!responses[1].ok||!js.config)process.exit(1)}).catch(()=>process.exit(1))" \
  >/dev/null 2>&1; do
  i=$((i + 1))
  test "$i" -lt 30 || { echo 'Node peers or JetStream monitor not ready' >&2; exit 1; }
  sleep 1
done
echo 'Three Node processes and JetStream monitor: reachable'

if podman exec "$mongo" mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' | grep -qx 1; then
  echo 'MongoDB: ping OK'
else
  echo 'MongoDB ping failed' >&2
  exit 1
fi

echo "Node memory cgroup: $(podman exec "$auth" cat /sys/fs/cgroup/memory.max)"
echo "Node CPU cgroup: $(podman exec "$auth" cat /sys/fs/cgroup/cpu.max)"
echo 'Idle baseline samples (not FixIt benchmark):'
sample=1
while test "$sample" -le 3; do
  printf 'sample=%s time=%s\n' "$sample" "$(date -Iseconds)"
  podman stats --no-stream --format '{{.Name}}|{{.MemUsage}}|{{.CPU}}' \
    "$mongo" "$pg" "$nats" "$auth" "$tickets" "$chat"
  sample=$((sample + 1))
  if test "$sample" -le 3; then sleep 5; fi
done

running="$(podman ps --filter "name=$network" --format '{{.Names}}' | wc -l | tr -d ' ')"
test "$running" -eq 6 || { echo "Expected six containers, got $running" >&2; exit 1; }
echo 'BASELINE_OK: synthetic processes only; no Express/DB queries/proxy/load testing'
