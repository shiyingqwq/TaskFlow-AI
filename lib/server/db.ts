import { PrismaLibSQL } from "@prisma/adapter-libsql";
import path from "path";

import { PrismaClient } from "@/generated/prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

function resolveLibsqlUrl() {
  const raw = process.env.DATABASE_URL || "file:./dev.db";
  if (!raw.startsWith("file:")) {
    return raw;
  }

  const filePath = raw.slice("file:".length);

  if (!filePath.startsWith("./") && !filePath.startsWith("../")) {
    return raw;
  }

  // Prisma CLI resolves relative SQLite paths from the schema directory.
  const schemaDir = path.join(process.cwd(), "prisma");
  return `file:${path.resolve(schemaDir, filePath)}`;
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaLibSQL({
      url: resolveLibsqlUrl(),
    }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// In development, schema changes can invalidate the cached client shape.
// Recreate the client on module reload so new relations/fields are visible immediately.
export const prisma = process.env.NODE_ENV === "development" ? createPrismaClient() : global.prisma || createPrismaClient();

if (process.env.NODE_ENV === "production") {
  global.prisma = prisma;
}
