import { startChat } from "../src/server.js";
import { startFixtures } from "./fixtures.js";

const serviceToken = process.env.CHAT_SERVICE_TOKEN;
const mongoUri = process.env.MONGO_URI;
const origin = process.env.PUBLIC_ORIGIN;
if (!serviceToken || !mongoUri || !origin)
  throw new Error("Missing local preview configuration");
const fixtures = await startFixtures({ port: 4001, serviceToken });
try {
  const chat = await startChat({
    mongoUri,
    authUrl: fixtures.url,
    ticketsUrl: fixtures.url,
    serviceToken,
    origin,
    port: 4000,
  });
  process.stdout.write("Local preview Chat ready\n");
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      void chat.close().finally(() => fixtures.close());
    });
  }
} catch (error) {
  await fixtures.close();
  throw error;
}
