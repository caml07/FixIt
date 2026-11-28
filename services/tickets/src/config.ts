export function loadConfig() {
  const rawPort = process.env.PORT ?? "3002";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid PORT");
  }
  const publicOrigin = process.env.TICKETS_PUBLIC_ORIGIN;
  if (publicOrigin !== undefined && (!URL.canParse(publicOrigin) ||
      new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith("https://"))) {
    throw new Error("Invalid TICKETS_PUBLIC_ORIGIN");
  }
  return { port, host: process.env.TICKETS_BIND_HOST ?? "127.0.0.1", publicOrigin };
}

export function loadOutboxConfig(env = process.env) {
  const endpoint = env.TICKETS_NATS_URL;
  const token = env.TICKETS_NATS_TOKEN;
  if (endpoint === undefined && token === undefined) return;
  const invalid = () => new Error("Invalid TICKETS_NATS_URL or TICKETS_NATS_TOKEN");
  if (!endpoint || /[\s,]/.test(endpoint) ||
      (token !== undefined && !/^[\x21-\x7e]{1,1024}$/.test(token))) throw invalid();

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw invalid();
  }
  const tls = url.protocol === "tls:";
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (!url.hostname || (url.protocol !== "nats:" && !tls) || (!tls && !loopback) ||
      url.username || url.password || (url.pathname && url.pathname !== "/") ||
      url.search || url.hash || /[@?#%]/.test(endpoint) || url.port === "0") throw invalid();
  if (!env.TICKETS_DATABASE_URL) throw new Error("TICKETS_DATABASE_URL is required with TICKETS_NATS_URL");
  return { endpoint: `${url.protocol}//${url.host}`, token, tls };
}
