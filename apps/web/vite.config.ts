import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const chatTarget = process.env.FIXIT_CHAT_TARGET ?? "https://localhost:8443";
const fixturesTarget = process.env.FIXIT_FIXTURES_TARGET ?? chatTarget;
const origin = process.env.FIXIT_PUBLIC_ORIGIN ?? "https://localhost:8443";
const proxy = (target: string) => ({
  target,
  changeOrigin: true,
  secure: false,
  headers: { origin },
});

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api/v1": proxy(chatTarget),
      "/__dev": proxy(fixturesTarget),
      "/socket.io": { ...proxy(chatTarget), ws: true },
    },
  },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
