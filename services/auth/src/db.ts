import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client.ts";

export function openAuthDatabase(connectionString: string) {
  const adapter = new PrismaPg({ connectionString, max: 5 });
  return new PrismaClient({ adapter });
}

export type AuthDatabase = ReturnType<typeof openAuthDatabase>;
