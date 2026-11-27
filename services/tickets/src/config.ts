export function loadConfig() {
  const rawPort = process.env.PORT ?? "3002";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid PORT");
  }
  return { port, host: process.env.TICKETS_BIND_HOST ?? "127.0.0.1" };
}
