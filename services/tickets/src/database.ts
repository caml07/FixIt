import pg from "pg";

export function openTicketsDatabase(connectionString: string) {
  return new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 3000 });
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
