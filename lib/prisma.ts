import { PrismaClient } from "@prisma/client";

import { assertDatabaseRuntimeReady } from "@/lib/runtime-config";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

assertDatabaseRuntimeReady();

export const prisma =
  global.prismaGlobal ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = prisma;
}
