import pg from "pg";

export function openTicketsDatabase(connectionString: string) {
  return new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 3000 });
}
