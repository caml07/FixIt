import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import { outboxMessage, type OutboxMessage, type OutboxRow } from "./outbox-event.js";

export interface OutboxPublisher {
  publish(message: OutboxMessage): Promise<void>;
  close(): Promise<void>;
}

async function publishNext(pool: Pool, publisher: OutboxPublisher, signal: AbortSignal, preferRetry: boolean): Promise<"idle" | "published" | "failed"> {
  const client = await pool.connect();
  let discard = false;
  const onClientError = () => { discard = true; };
  client.on("error", onClientError);
  try {
    await client.query("BEGIN");
    const result = await client.query<OutboxRow & { attempts: number }>(`
      SELECT event.id, event.ticket_id, event.aggregate_version, event.event_type, event.payload, event.attempts
      FROM tickets.outbox event
      WHERE event.published_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM tickets.outbox earlier
        WHERE earlier.ticket_id = event.ticket_id AND earlier.aggregate_version < event.aggregate_version
          AND earlier.published_at IS NULL
      )
      ORDER BY ((event.attempts > 0) = $1) DESC, event.attempts, event.occurred_at, event.id
      LIMIT 1 FOR UPDATE OF event SKIP LOCKED`, [preferRetry]);
    const event = result.rows[0];
    if (!event || signal.aborted) {
      await client.query("COMMIT");
      return "idle";
    }
    const message = outboxMessage(event);
    let acknowledged = false;
    if (message) {
      try {
        await publisher.publish(message);
        acknowledged = true;
      } catch {
        // Keep the same ID pending even if the broker stored the message and its ACK was lost.
      }
    }
    if (discard) throw new Error("Outbox database connection lost");
    if (acknowledged) {
      await client.query("UPDATE tickets.outbox SET published_at = clock_timestamp() WHERE id = $1", [event.id]);
    } else {
      await client.query(`UPDATE tickets.outbox SET attempts = LEAST(attempts::bigint + 1, 2147483647)::int
        WHERE id = $1`, [event.id]);
    }
    await client.query("COMMIT");
    if (acknowledged) return "published";
    const failures = event.attempts + 1;
    if ((failures & (failures - 1)) === 0) {
      console.warn(message ? "Outbox publish will retry" : "Invalid outbox event remains pending", { eventId: event.id, failures });
    }
    return "failed";
  } catch {
    // A database timeout can leave the connection busy. Discard it to release the transaction and lock.
    discard = true;
    throw new Error("Outbox database operation failed");
  } finally {
    client.removeListener("error", onClientError);
    client.release(discard);
  }
}

export function startOutboxWorker(pool: Pool, publisher: OutboxPublisher) {
  const stopping = new AbortController();
  const { signal } = stopping;
  const finished = (async () => {
    let consecutiveFailures = 0;
    let preferRetry = false;
    try {
      while (!signal.aborted) {
        let result: Awaited<ReturnType<typeof publishNext>> = "failed";
        try {
          result = await publishNext(pool, publisher, signal, preferRetry);
          // Give retries a turn even when the first-attempt queue stays full.
          if (result !== "idle") preferRetry = !preferRetry;
        } catch {
          if (consecutiveFailures === 0) console.warn("Outbox database unavailable");
        }
        if (signal.aborted) break;
        if (result === "published") {
          consecutiveFailures = 0;
          continue;
        }
        if (result === "idle") consecutiveFailures = 0;
        else consecutiveFailures = Math.min(consecutiveFailures + 1, 6);
        const milliseconds = result === "idle" ? 250 : Math.min(250 * (2 ** consecutiveFailures), 5000);
        await delay(milliseconds, undefined, { signal }).catch((error: unknown) => {
          if (!signal.aborted) throw error;
        });
      }
    } finally {
      await publisher.close();
    }
  })();
  return {
    stop() {
      stopping.abort();
      return finished;
    }
  };
}
