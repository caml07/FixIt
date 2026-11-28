import pg, { type Pool, type PoolClient, type QueryResultRow } from "pg";

export function openTicketsDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 3000,
    query_timeout: 3000,
    statement_timeout: 2500,
    lock_timeout: 2000,
    idle_in_transaction_session_timeout: 5000
  });
  pool.on("error", () => console.warn("Idle HTTP database connection lost"));
  return pool;
}

export function isDatabaseRejection(error: unknown) {
  return error instanceof pg.DatabaseError && error.severity === "ERROR";
}

export async function checkoutTicketsDatabase(pool: Pool) {
  const disconnect = new AbortController();
  const { signal } = disconnect;
  const discard = () => disconnect.abort(new Error("HTTP database connection unavailable"));
  const client = await new Promise<PoolClient>((resolve, reject) => {
    pool.connect((error, checkedOut) => {
      if (error || !checkedOut) return reject(error ?? new Error("HTTP database connection unavailable"));
      checkedOut.on("error", discard);
      resolve(checkedOut);
    });
  });

  async function query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) {
    signal.throwIfAborted();
    try {
      return await client.query<Row>(sql, values);
    } catch (error) {
      if (!isDatabaseRejection(error)) discard();
      throw error;
    }
  }

  return {
    signal,
    query,
    async rollback() {
      if (!signal.aborted) await query("ROLLBACK").catch(discard);
    },
    release() {
      client.removeListener("error", discard);
      client.release(signal.aborted);
    }
  };
}

export function openOutboxDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 1000,
    query_timeout: 1000,
    options: "-c statement_timeout=1000 -c idle_in_transaction_session_timeout=5000"
  });
  pool.on("error", () => console.warn("Idle outbox database connection lost"));
  return pool;
}
