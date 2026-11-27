import "dotenv/config";
import pg from "pg";

const connectionString = process.env.AUTH_DATABASE_URL;
if (!connectionString) {
  console.error("Auth database check: configuration missing.");
  process.exitCode = 1;
} else {
  let client: InstanceType<typeof pg.Client> | undefined;
  try {
    client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 3000,
      query_timeout: 3000,
    });
    await client.connect();
    await client.query("SELECT 1 FROM auth.users LIMIT 0");
    await client.query("SELECT 1 FROM auth.sessions LIMIT 0");
    console.info("Auth database check: available.");
  } catch {
    console.error("Auth database check: unavailable.");
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => { process.exitCode = 1; });
  }
}
