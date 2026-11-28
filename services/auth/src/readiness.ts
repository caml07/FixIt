import pg from "pg";

const DEADLINE_MS = 3000;

export function createReadinessProbe(connectionString: string): () => Promise<boolean> {
  let pending: Promise<boolean> | undefined;

  async function probe(): Promise<boolean> {
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: DEADLINE_MS });
    client.on("error", () => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Readiness deadline exceeded")), DEADLINE_MS);
    });
    try {
      await Promise.race([deadline, (async () => {
        await client.connect();
        await client.query("SELECT 1 FROM auth.users LIMIT 0");
        await client.query("SELECT 1 FROM auth.sessions LIMIT 0");
      })()]);
      return true;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
      void client.end().catch(() => {});
    }
  }

  return () => {
    if (!pending) pending = probe().finally(() => { pending = undefined; });
    return pending;
  };
}
