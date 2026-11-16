import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "docs/database/schema.prisma",
  migrations: { path: "docs/database/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
