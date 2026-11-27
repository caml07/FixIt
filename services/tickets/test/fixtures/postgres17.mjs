import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const docker = process.env.CONTAINER_ENGINE || "docker";
const name = `fixit-tickets-test-${randomUUID()}`;
const password = randomBytes(24).toString("hex");
const runtimePassword = randomBytes(24).toString("hex");
let containerId;
let started = false;

function run(args, options = {}) {
  const host = process.platform === "win32"
    ? "npipe:////./pipe/dockerDesktopLinuxEngine"
    : "unix:///var/run/docker.sock";
  const env = { ...process.env };
  delete env.DOCKER_CONTEXT;
  delete env.DOCKER_HOST;
  return execFileSync(docker, ["--host", host, ...args], { encoding: "utf8", timeout: 30000, env, ...options }).trim();
}

export async function createDatabase(dockerRun = run) {
  try {
    started = true;
    containerId = dockerRun(["create", "--pull", "never", "--name", name,
      "--label", "fixit.tickets.test=" + name, "-p", "127.0.0.1::5432",
      "--tmpfs", "/var/lib/postgresql/data:rw,size=256m",
      "-e", "POSTGRES_PASSWORD=" + password, "postgres:17-alpine"]);
    dockerRun(["start", containerId]);
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        run(["exec", containerId, "pg_isready", "-U", "postgres"]);
        break;
      } catch (error) {
        if (attempt === 59) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    const address = run(["port", containerId, "5432/tcp"]);
    const match = /^127\.0\.0\.1:(\d+)$/.exec(address);
    if (!match) throw new Error("Invalid loopback port");
    const port = match[1];
    const adminUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
    const sql = `CREATE ROLE tickets_owner LOGIN PASSWORD '${password}'; ALTER DATABASE postgres OWNER TO tickets_owner; GRANT CREATE ON DATABASE postgres TO tickets_owner; CREATE ROLE tickets_runtime LOGIN PASSWORD '${runtimePassword}';`;
    run(["exec", containerId, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql]);
    const ownerUrl = `postgresql://tickets_owner:${password}@127.0.0.1:${port}/postgres`;
    return { adminUrl, ownerUrl, runtimeUrl: `postgresql://tickets_runtime:${runtimePassword}@127.0.0.1:${port}/postgres`, containerId };
  } catch (error) {
    await cleanup(dockerRun);
    throw error;
  }
}

export async function cleanup(dockerRun = run) {
  if (!started) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    const ids = dockerRun(["ps", "-aq", "--filter", "name=^/" + name + "$",
      "--filter", "label=fixit.tickets.test=" + name]).split(/\s+/).filter(Boolean);
    for (const id of ids) dockerRun(["rm", "-f", id]);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  containerId = undefined;
  started = false;
}
