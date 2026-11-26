import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { io } from "socket.io-client";
import { startFixtures, ticketId } from "../local/fixtures.js";
import { type ChatOptions, startChat } from "../src/server.js";

export async function scenario(
  t: TestContext,
  overrides: Partial<ChatOptions> = {},
) {
  const fixtures = await startFixtures();
  t.after(() => fixtures.close());
  const options = {
    mongoUri: `${process.env.MONGO_URI}/chat_${randomUUID().replaceAll("-", "")}`,
    authUrl: fixtures.url,
    ticketsUrl: fixtures.url,
    serviceToken: fixtures.serviceToken,
    origin: "http://localhost:8080",
    port: 0,
    ...overrides,
  };
  const chat = await startChat(options);
  t.after(() => chat.close());
  async function connect(token = "fixture-reporter", origin = options.origin) {
    const socket = io(chat.url, {
      transports: ["websocket"],
      extraHeaders: {
        Origin: origin,
        ...(token ? { Cookie: `__Host-fixit_session=${token}` } : {}),
      },
      reconnection: false,
      timeout: 2000,
    });
    t.after(() => socket.disconnect());
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return socket;
  }
  async function history(
    token = "fixture-reporter",
    query = "",
    id = ticketId,
  ) {
    return fetch(`${chat.url}/api/v1/tickets/${id}/messages${query}`, {
      headers: { Cookie: `__Host-fixit_session=${token}` },
    });
  }
  return { fixtures, chat, connect, history };
}
