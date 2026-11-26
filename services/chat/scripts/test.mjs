import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const engine = process.env.CONTAINER_ENGINE || "podman";
const name = `fixit-chat-test-${randomUUID()}`;
const owned = !process.env.MONGO_URI;
try {
  if (owned) {
    execFileSync(
      engine,
      [
        "run",
        "-d",
        "--name",
        name,
        "-p",
        "127.0.0.1::27017",
        "docker.io/library/mongo:8.0",
      ],
      { stdio: "pipe" },
    );
    const port = execFileSync(engine, ["port", name, "27017"], {
      encoding: "utf8",
    })
      .trim()
      .split(":")
      .pop();
    process.env.MONGO_URI = `mongodb://127.0.0.1:${port}`;
    execFileSync(
      engine,
      [
        "exec",
        name,
        "sh",
        "-c",
        'until mongosh --quiet --eval "db.runCommand({ping:1}).ok" >/dev/null 2>&1; do sleep 1; done',
      ],
      { timeout: 60_000, stdio: "pipe" },
    );
    process.env.TEST_MONGO_CONTAINER = name;
  }
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "--test-concurrency=1", "test/chat.test.ts"],
    { stdio: "inherit", env: process.env },
  );
  process.exitCode = result.status ?? 1;
} finally {
  if (owned) spawnSync(engine, ["rm", "-f", name], { stdio: "ignore" });
}
