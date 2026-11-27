import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

const engine = process.env.CONTAINER_ENGINE || "podman";
const name = `fixit-chat-test-${randomUUID()}`;
const owned = !process.env.MONGO_URI;
try {
  if (owned) {
    const port = await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          reject(new Error("Could not reserve a MongoDB port"));
          return;
        }
        server.close((error) =>
          error ? reject(error) : resolve(address.port),
        );
      });
    });
    execFileSync(
      engine,
      [
        "run",
        "-d",
        "--name",
        name,
        "-p",
        `127.0.0.1:${port}:27017`,
        "docker.io/library/mongo:8.0",
      ],
      { stdio: "pipe" },
    );
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
  if (owned) spawnSync(engine, ["rm", "-fv", name], { stdio: "ignore" });
}
