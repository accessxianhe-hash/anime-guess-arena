import { NextResponse } from "next/server";
import { YearlyImportItemStatus, YearlyImportJobStatus } from "@prisma/client";

import { createRouteLogger, getRequestId, withTiming } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { getDeploymentReadiness } from "@/lib/runtime-config";
import { probeStorageConnectivity } from "@/lib/storage";

export const dynamic = "force-dynamic";

type HealthAlert = {
  severity: "warn" | "error";
  code: string;
  message: string;
};

const DB_SLOW_THRESHOLD_MS = 1200;
const STORAGE_SLOW_THRESHOLD_MS = 1500;
const IMPORT_RUNNING_STALE_WARN_MS = 3 * 60_000;
const IMPORT_FAILED_ITEMS_WARN_COUNT = 25;

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.health",
    requestId,
  });
  const readiness = getDeploymentReadiness();

  logger.info("health.request.started", {
    stage: readiness.stage,
    storageProvider: readiness.storage.provider,
  });

  const alerts: HealthAlert[] = [];
  let databaseOk = true;
  let databaseMessage = "Database connection succeeded.";
  let databaseLatencyMs = 0;

  try {
    const { elapsedMs } = await withTiming(() => prisma.$queryRawUnsafe("SELECT 1"));
    databaseLatencyMs = elapsedMs;
    if (databaseLatencyMs >= DB_SLOW_THRESHOLD_MS) {
      alerts.push({
        severity: "warn",
        code: "DB_SLOW",
        message: `Database health query latency ${databaseLatencyMs}ms exceeded ${DB_SLOW_THRESHOLD_MS}ms.`,
      });
    }
  } catch (error) {
    databaseOk = false;
    databaseMessage =
      error instanceof Error ? error.message : "Unknown database connection error.";
    alerts.push({
      severity: "error",
      code: "DB_UNAVAILABLE",
      message: databaseMessage,
    });
  }

  const storageProbe = await probeStorageConnectivity();
  if (!storageProbe.ok) {
    alerts.push({
      severity: "error",
      code: "STORAGE_UNAVAILABLE",
      message: storageProbe.message,
    });
  } else if (storageProbe.elapsedMs >= STORAGE_SLOW_THRESHOLD_MS) {
    alerts.push({
      severity: "warn",
      code: "STORAGE_SLOW",
      message: `Storage probe latency ${storageProbe.elapsedMs}ms exceeded ${STORAGE_SLOW_THRESHOLD_MS}ms.`,
    });
  }

  const issues = [...readiness.issues];
  if (!databaseOk) {
    issues.push({
      key: "DATABASE_URL",
      message: `Database connection failed: ${databaseMessage}`,
    });
  }
  if (!storageProbe.ok) {
    issues.push({
      key: "STORAGE_PROVIDER",
      message: `Storage probe failed: ${storageProbe.message}`,
    });
  }

  let importProbe = {
    runningJobs: 0,
    staleRunningJobs: 0,
    oldestRunningUpdatedAt: null as string | null,
    failedItems: 0,
  };

  try {
    const now = Date.now();
    const runningJobs = await prisma.yearlyImportJob.findMany({
      where: { status: YearlyImportJobStatus.RUNNING },
      select: {
        id: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "asc" },
      take: 100,
    });
    const staleRunningJobs = runningJobs.filter(
      (job) => now - job.updatedAt.getTime() >= IMPORT_RUNNING_STALE_WARN_MS,
    );
    const failedItems = await prisma.yearlyImportItem.count({
      where: { status: YearlyImportItemStatus.FAILED },
    });

    importProbe = {
      runningJobs: runningJobs.length,
      staleRunningJobs: staleRunningJobs.length,
      oldestRunningUpdatedAt: runningJobs[0]?.updatedAt.toISOString() ?? null,
      failedItems,
    };

    if (staleRunningJobs.length > 0) {
      alerts.push({
        severity: "warn",
        code: "IMPORT_STALE_RUNNING",
        message: `Detected ${staleRunningJobs.length} running import job(s) with stale progress (>${Math.floor(
          IMPORT_RUNNING_STALE_WARN_MS / 1000,
        )}s).`,
      });
    }

    if (failedItems >= IMPORT_FAILED_ITEMS_WARN_COUNT) {
      alerts.push({
        severity: "warn",
        code: "IMPORT_FAILED_ITEMS_SPIKE",
        message: `Detected ${failedItems} failed yearly-import items (threshold ${IMPORT_FAILED_ITEMS_WARN_COUNT}).`,
      });
    }
  } catch (error) {
    alerts.push({
      severity: "warn",
      code: "IMPORT_PROBE_FAILED",
      message: error instanceof Error ? error.message : "Unknown yearly-import probe error.",
    });
  }

  const hasErrorAlerts = alerts.some((alert) => alert.severity === "error");
  const responseStatus = issues.length === 0 && !hasErrorAlerts ? 200 : 503;

  const payload = {
    ok: responseStatus === 200,
    checkedAt: new Date().toISOString(),
    requestId,
    stage: readiness.stage,
    appUrl: readiness.appUrl,
    database: {
      ok: databaseOk,
      message: databaseMessage,
      latencyMs: databaseLatencyMs,
    },
    storage: {
      provider: readiness.storage.provider,
      keyPrefix: readiness.storage.keyPrefix,
      configOk: readiness.storage.isReady,
      probeOk: storageProbe.ok,
      probeLatencyMs: storageProbe.elapsedMs,
      probeMessage: storageProbe.message,
    },
    alerts,
    importRuntime: importProbe,
    issues,
  };

  logger.info("health.request.finished", {
    ok: payload.ok,
    status: responseStatus,
    issueCount: issues.length,
    alertCount: alerts.length,
    dbLatencyMs: databaseLatencyMs,
    storageProbeLatencyMs: storageProbe.elapsedMs,
    importRunningJobs: importProbe.runningJobs,
    importStaleRunningJobs: importProbe.staleRunningJobs,
    importFailedItems: importProbe.failedItems,
  });

  for (const alert of alerts) {
    const method = alert.severity === "error" ? logger.error : logger.warn;
    method("health.alert", {
      code: alert.code,
      message: alert.message,
    });
  }

  return NextResponse.json(payload, {
    status: responseStatus,
    headers: {
      "x-request-id": requestId,
    },
  });
}
