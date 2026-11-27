import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const image = "nats:2.14.10-alpine";
const host = process.platform === "win32" ? "npipe:////./pipe/dockerDesktopLinuxEngine" : "unix:///var/run/docker.sock";

function docker(args) {
  const env = { ...process.env };
  delete env.DOCKER_HOST;
  delete env.DOCKER_CONTEXT;
  return execFileSync(process.env.CONTAINER_ENGINE || "docker", ["--host", host, ...args], {
    env, encoding: "utf8", timeout: 45_000, stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export async function createJetStreamFixture() {
  const name = `fixit-tickets-nats-${randomUUID()}`;
  const label = `fixit.tickets.test=${name}`;
  const token = randomUUID();
  let id;
  let paused = false;
  async function cleanup() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const containers = docker(["ps", "-aq", "--filter", `name=^/${name}$`, "--filter", `label=${label}`]);
      for (const container of containers.split(/\s+/).filter(Boolean)) {
        if (docker(["inspect", "-f", "{{.State.Paused}}", container]) === "true") docker(["unpause", container]);
        docker(["rm", "-f", container]);
      }
      if (id) break;
      await delay(200);
    }
  }
  try {
    id = docker(["create", "--pull", "missing", "--name", name, "--label", label,
      "-p", "127.0.0.1::4222", "--memory", "128m", "--cpus", "1", image,
      "-js", "-sd", "/tmp/fixit-jetstream", "--auth", token]);
    docker(["start", id]);
    const address = docker(["port", id, "4222/tcp"]);
    if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error("Unexpected NATS port binding");
    return {
      endpoint: `nats://${address}`,
      token,
      pause() { docker(["pause", id]); paused = true; },
      resume() { if (paused) { docker(["unpause", id]); paused = false; } },
      cleanup
    };
  } catch {
    await cleanup();
    throw new Error("Unable to start the disposable NATS fixture");
  }
}
