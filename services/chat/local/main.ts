import { startFixtures } from "./fixtures.js";

if (process.env.FIXIT_FIXTURES !== "1" || !process.env.CHAT_SERVICE_TOKEN) {
  process.stderr.write(
    "Simuladores solo disponibles con FIXIT_FIXTURES=1 y token de servicio local\n",
  );
  process.exit(1);
}
const fixtures = await startFixtures({
  host: "0.0.0.0",
  port: 4001,
  serviceToken: process.env.CHAT_SERVICE_TOKEN,
});
process.stdout.write(
  "Simuladores locales Auth/Tickets iniciados; no usar datos reales\n",
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    void fixtures.close();
  });
