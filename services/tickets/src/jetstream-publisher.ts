import { jetstream } from "@nats-io/jetstream";
import { connect, type NatsConnection } from "@nats-io/transport-node";
import type { loadOutboxConfig } from "./config.js";
import type { OutboxPublisher } from "./outbox-worker.js";

const stream = "FIXIT_TICKET_EVENTS";
const timeout = 1000;

export function createJetStreamPublisher(config: NonNullable<ReturnType<typeof loadOutboxConfig>>): OutboxPublisher {
  let connection: NatsConnection | undefined;
  async function close() {
    const active = connection;
    connection = undefined;
    await active?.close();
  }
  return {
    async publish(message) {
      try {
        connection ??= await connect({
          servers: config.endpoint,
          token: config.token,
          tls: config.tls ? {} : null,
          timeout,
          reconnect: false,
          ignoreClusterUpdates: true
        });
        const ack = await jetstream(connection).publish(message.subject, Buffer.from(message.body), {
          msgID: message.id, timeout, retries: 1, expect: { streamName: stream }
        });
        if (ack.stream !== stream || !Number.isSafeInteger(ack.seq) || ack.seq < 1) {
          throw new Error("Unexpected JetStream acknowledgement");
        }
      } catch {
        await close();
        throw new Error("JetStream publish not acknowledged");
      }
    },
    close
  };
}
