#!/bin/sh
# Run the same real-service G2 fixture benchmark in "three" and "two" modes.
# Only rootless, isolated and ephemeral containers; no AWS, published DB ports
# or production datasets. The only host listener is loopback with a random port.
set -eu
mode="${1:-}"
profile="${2:-legacy}"
case "$mode" in two|three) ;; *) echo 'Usage: sh spikes/g2/run.sh two|three [legacy|balanced|expanded|shared2|shared4]' >&2; exit 2 ;; esac
cpuSet=''
case "$profile" in
  legacy)
    pgCpu=.35; mongoCpu=.50; natsCpu=.15; chatCpu=.30; proxyCpu=.15
    authCpu=.20; ticketsCpu=.30; coreCpu=.50; cpuTotal=1.95
    ;;
  balanced)
    pgCpu=.20; mongoCpu=.25; natsCpu=.10; chatCpu=.30; proxyCpu=.10
    authCpu=.65; ticketsCpu=.40; coreCpu=1.05; cpuTotal=2.0
    ;;
  expanded)
    pgCpu=.50; mongoCpu=.50; natsCpu=.15; chatCpu=.60; proxyCpu=.15
    authCpu=1.40; ticketsCpu=.70; coreCpu=2.10; cpuTotal=4.0
    ;;
  shared2)
    # Same two physical cores for every container: idle services give Auth
    # their unused CPU. Each container can individually use both cores.
    cpuSet="${G2_CPUSET_2:-0,2}"
    pgCpu=2; mongoCpu=2; natsCpu=2; chatCpu=2; proxyCpu=2
    authCpu=2; ticketsCpu=2; coreCpu=2; cpuTotal=2.0
    ;;
  shared4)
    cpuSet="${G2_CPUSET_4:-0,1,2,3}"
    pgCpu=4; mongoCpu=4; natsCpu=4; chatCpu=4; proxyCpu=4
    authCpu=4; ticketsCpu=4; coreCpu=4; cpuTotal=4.0
    ;;
  *) echo 'Unknown profile; choose legacy, balanced, expanded, shared2, shared4' >&2; exit 2 ;;
esac
bcryptEngine="${G2_BCRYPT_ENGINE:-bcryptjs}"
bcryptCost="${G2_BCRYPT_COST:-9}"
suite="${G2_SUITE:-baseline}"
case "$suite" in baseline|resilience|g3) ;; *) echo 'G2_SUITE must be baseline, resilience or g3' >&2; exit 2 ;; esac
soakSeconds="${G2_SOAK_SECONDS:-25}"
case "$soakSeconds" in *[!0-9]*|'') echo 'G2_SOAK_SECONDS must be an integer' >&2; exit 2 ;; esac
case "$bcryptEngine" in native|bcryptjs) ;; *) echo 'Invalid G2_BCRYPT_ENGINE' >&2; exit 2 ;; esac
case "$bcryptCost" in 9|10|11|12|13) ;; *) echo 'Invalid G2_BCRYPT_COST' >&2; exit 2 ;; esac
project="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
repo="$(CDPATH='' cd -- "$project/../.." && pwd)"
test -d "$project/node_modules" || { echo 'Run npm ci --prefix spikes/g2 first' >&2; exit 2; }
network="fixit-g2-work-$mode-$$"
prefix="$network"
containers=""
watcher=''
clean() {
  if test -n "$watcher"; then
    kill "$watcher" 2>/dev/null || :
    wait "$watcher" 2>/dev/null || :
  fi
  for name in $containers; do podman rm -f "$name" >/dev/null 2>&1 || :; done
  podman network rm "$network" >/dev/null 2>&1 || :
}
trap clean EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
command -v podman >/dev/null
command -v node >/dev/null
command -v timeout >/dev/null
podman info --format '{{.Host.CgroupsVersion}}' | grep -qx v2
test -z "$(podman ps --format '{{.Names}}' | grep "^$prefix-" || :)" || {
  echo 'Scoped container name conflict' >&2; exit 1;
}
podman network create "$network" >/dev/null
randhex() { od -An -N20 -tx1 /dev/urandom | tr -d ' \n'; }
dbpass="$(randhex)"
serviceSecret="$(randhex)"
fixturePassword="$(randhex)"

pg="$prefix-pg"; mongo="$prefix-mongo"; nats="$prefix-nats"
auth="$prefix-auth"; tickets="$prefix-tickets"; core="$prefix-core"; chat="$prefix-chat"; proxy="$prefix-proxy"
authHost="$auth"
ticketsHost="$tickets"
if test "$mode" = two; then authHost="$core"; ticketsHost="$core"; fi
pgUrl="postgres://postgres:$dbpass@$pg:5432/postgres"
mongoUrl="mongodb://$mongo:27017"
natsUrl="nats://$nats:4222"

start() {
  name="$1"; shift
  if test -n "$cpuSet"; then
    podman run -d --name "$name" --network "$network" \
      --cpuset-cpus "$cpuSet" --security-opt no-new-privileges \
      --pids-limit 160 "$@" >/dev/null
  else
    podman run -d --name "$name" --network "$network" \
      --security-opt no-new-privileges --pids-limit 160 "$@" >/dev/null
  fi
  containers="$name $containers"
}
nodeService() {
  name="$1"; appRole="$2"; cpus="$3"; mem="$4"
  start "$name" --memory "$mem" --memory-swap "$mem" --cpus "$cpus" \
    -v "$project:/app:ro" -w /app \
    -e "G2_ROLE=$appRole" -e "G2_PG_URL=$pgUrl" \
    -e "G2_MONGO_URL=$mongoUrl" -e "G2_NATS_URL=$natsUrl" \
    -e "G2_AUTH_URL=http://$authHost:3000" \
    -e "G2_TICKETS_URL=http://$ticketsHost:3000" \
    -e "G2_INTERNAL_SECRET=$serviceSecret" \
    -e "G2_FIXTURE_PASSWORD=$fixturePassword" \
    -e "G2_BCRYPT_ENGINE=$bcryptEngine" \
    -e "G2_BCRYPT_COST=$bcryptCost" \
    -e "NODE_OPTIONS=--max-old-space-size=180" \
    docker.io/library/node:26-alpine node src/server.mjs
}
waitNode() {
  name="$1"
  i=0
  until podman exec "$name" node -e \
    "fetch('http://127.0.0.1:3000/internal/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; do
    i=$((i + 1))
    if test "$i" -ge 60; then
      echo "Server not ready: $name" >&2
      podman logs --tail 60 "$name" >&2 || :
      exit 1
    fi
    sleep 1
  done
}
echo "G2_REAL_SPIKE mode=$mode profile=$profile bcrypt=$bcryptEngine cost=$bcryptCost suite=$suite $(date -Iseconds)"
if test -n "$cpuSet"; then
  echo "Shared CPU-set $cpuSet: max $cpuTotal physical cores (no individual fixed CPU slice), memory caps total 2510 MiB"
else
  echo "Cgroup caps total: 2510 MiB, $cpuTotal vCPU (DB + broker + services + Caddy)"
fi
start "$pg" --memory 500m --memory-swap 500m --cpus "$pgCpu" \
  -e "POSTGRES_PASSWORD=$dbpass" docker.io/library/postgres:17-alpine
start "$mongo" --memory 1000m --memory-swap 1000m --cpus "$mongoCpu" \
  docker.io/mongodb/mongodb-community-server:8.0-ubi8
start "$nats" --memory 200m --memory-swap 200m --cpus "$natsCpu" \
  docker.io/library/nats:2.12-alpine -js -m 8222 -sd /tmp/jetstream

i=0
until podman exec "$pg" pg_isready -U postgres >/dev/null 2>&1; do
  i=$((i + 1)); test "$i" -lt 70 || { podman logs --tail 30 "$pg"; exit 1; }; sleep 1
done
i=0
until podman exec "$mongo" mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' 2>/dev/null | grep -qx 1; do
  i=$((i + 1)); test "$i" -lt 45 || { podman logs --tail 30 "$mongo"; exit 1; }; sleep 1
done
i=0
until podman exec "$pg" sh -c 'true' >/dev/null 2>&1; do
  i=$((i + 1)); test "$i" -lt 20 || exit 1; sleep 1
done
if test "$mode" = two; then
  nodeService "$core" core "$coreCpu" 460m
  waitNode "$core"
else
  nodeService "$auth" auth "$authCpu" 220m
  waitNode "$auth"
  nodeService "$tickets" tickets "$ticketsCpu" 240m
  waitNode "$tickets"
fi
nodeService "$chat" chat "$chatCpu" 240m
waitNode "$chat"

start "$proxy" --memory 110m --memory-swap 110m --cpus "$proxyCpu" \
  -p 127.0.0.1::80 \
  -v "$project/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -e "G2_AUTH_HOST=$authHost" -e "G2_TICKETS_HOST=$ticketsHost" \
  -e "G2_CHAT_HOST=$chat" \
  docker.io/library/caddy:2-alpine caddy run --config /etc/caddy/Caddyfile

listen="$(podman port "$proxy" 80/tcp)"
hostport="${listen##*:}"
test -n "$hostport" || { echo 'Proxy did not publish loopback port' >&2; exit 1; }
i=0
until curl -fsS "http://127.0.0.1:$hostport/" >/dev/null 2>&1; do
  i=$((i + 1))
  if test "$i" -ge 30; then podman logs --tail 60 "$proxy" >&2; exit 1; fi
  sleep 1
done
echo "PROXY_READY loopback_port=$hostport"
resultDir="$project/results"
runSuffix=''
if test "$suite" = g3; then
  resultDir="$project/results/g3"
  runSuffix="-$profile-$bcryptEngine-c$bcryptCost"
elif test "$suite" = resilience; then
  resultDir="$project/results/resilience"
  runSuffix="-$profile-$bcryptEngine-c$bcryptCost-soak$soakSeconds"
elif test "$profile" != legacy || test "$bcryptEngine" != bcryptjs || test "$bcryptCost" != 9; then
  resultDir="$project/results/tuning"
  runSuffix="-$profile-$bcryptEngine-c$bcryptCost"
fi
mkdir -p "$resultDir"
now="$(date -u +%Y%m%dT%H%M%SZ)"
stats="$resultDir/g2-$mode$runSuffix-$now-stats.tsv"
log="$resultDir/g2-$mode$runSuffix-$now-run.log"
result="$resultDir/g2-$mode$runSuffix-$now.json"
(
  while :; do
    echo "timestamp=$(date -Iseconds)"
    # Output is process snapshots; percent is not a reliable long-term CPU budget.
    podman stats --no-stream --format '{{.Name}}|{{.MemUsage}}|{{.CPU}}' $containers || exit
    sleep 2
  done
) > "$stats" 2>&1 &
watcher="$!"
echo "METRICS_SAMPLING=$stats"
benchScript="$project/bench.mjs"
if test "$suite" = resilience; then benchScript="$project/resilience.mjs"; fi
if test "$suite" = g3; then benchScript="$project/g3-security.mjs"; fi
if G2_BASE_URL="http://127.0.0.1:$hostport" G2_PREFIX="$prefix" \
   G2_MODE="$mode" G2_FIXTURE_PASSWORD="$fixturePassword" \
   G2_PROFILE="$profile" G2_BCRYPT_ENGINE="$bcryptEngine" G2_BCRYPT_COST="$bcryptCost" \
   G2_SOAK_SECONDS="$soakSeconds" timeout 180s node "$benchScript" > "$log" 2>&1; then
  grep '^G2_RESULT_JSON=' "$log" | sed 's/^G2_RESULT_JSON=//' > "$result"
  test -s "$result" || { cat "$log"; exit 1; }
  echo "BENCHMARK_PASS result=$result"
  node -e "let j=JSON.parse(require('node:fs').readFileSync(process.argv[1]));console.log(JSON.stringify({mode:j.mode,seconds:j.total_seconds ?? j.actualSoakSeconds,checks:j.checks.length,requests:j.request_latency ?? {socketSend:j.socketSend,reads:j.reads},sends:j.successfulSends},null,2))" "$result"
else
  echo "BENCHMARK_FAILED mode=$mode" >&2
  tail -n 90 "$log" >&2 || :
  for name in $containers; do
    echo "=== $name ===" >&2
    podman logs --tail 35 "$name" >&2 || :
  done
  exit 1
fi
