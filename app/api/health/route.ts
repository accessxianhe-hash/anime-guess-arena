import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getDeploymentReadiness } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = getDeploymentReadiness();
  let databaseReady = true;
  let databaseMessage = "Database connection succeeded.";

  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } catch (error) {
    databaseReady = false;
    databaseMessage =
      error instanceof Error ? error.message : "Unknown database connection error.";
  }

  const issues = [...readiness.issues];
  if (!databaseReady) {
    issues.push({
      key: "DATABASE_URL",
      message: `数据库连接失败：${databaseMessage}`,
    });
  }

  const payload = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    stage: readiness.stage,
    appUrl: readiness.appUrl,
    database: {
      ok: databaseReady,
      message: databaseMessage,
    },
    storage: {
      provider: readiness.storage.provider,
      keyPrefix: readiness.storage.keyPrefix,
      ok: readiness.storage.isReady,
    },
    issues,
  };

  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 503,
  });
}
