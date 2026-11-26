import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";

const url = process.env.CHAT_URL || "https://localhost:8443";
const ticketId = "11111111-1111-4111-8111-111111111111";
const socket = io(url, {
  transports: ["websocket"],
  extraHeaders: {
    Origin: url,
    Cookie: "__Host-fixit_session=fixture-reporter",
  },
  reconnection: false,
  timeout: 5000,
});
try {
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  assert.equal(
    (await socket.timeout(5000).emitWithAck("ticket:join", { ticketId })).ok,
    true,
  );
  const delivery = new Promise((resolve) =>
    socket.once("chat:message", resolve),
  );
  const ack = await socket.timeout(5000).emitWithAck("chat:send", {
    ticketId,
    clientMessageId: randomUUID(),
    body: "Prueba local HTTPS/WSS",
  });
  assert.equal(ack.ok, true);
  const delivered = await Promise.race([
    delivery,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Broadcast timeout")),
        5000,
      );
      timer.unref();
    }),
  ]);
  assert.equal(delivered.id, ack.data.messageId);
  const response = await fetch(`${url}/api/v1/tickets/${ticketId}/messages`, {
    headers: { Cookie: "__Host-fixit_session=fixture-reporter" },
  });
  assert.equal(response.status, 200);
  assert.ok(
    (await response.json()).data.items.some(
      (message) => message.id === ack.data.messageId,
    ),
  );
  assert.equal(
    (await fetch(`${url}/internal/v1/sessions/introspect`)).status,
    404,
  );
  console.log(
    "PASS: HTTPS/WSS, join, persistencia, ACK, broadcast, historial y rutas internas no expuestas.",
  );
} finally {
  socket.disconnect();
}
