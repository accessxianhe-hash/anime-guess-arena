import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { getYearlyImportJob, pauseYearlyImportJob } from "@/lib/yearly-import";

type Context = {
  params: Promise<{ id: string }>;
};

function resolveStatus(message: string) {
  return /unauthorized|未授权|请先登录/i.test(message) ? 401 : 400;
}

export async function GET(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const { id } = await context.params;
  const logger = createRouteLogger({
    module: "api.admin.yearly-import.jobs.id",
    requestId,
  });

  try {
    await requireAdminSession();
    const job = await getYearlyImportJob(id);
    logger.info("yearlyImport.job.get.success", {
      jobId: id,
      status: job.status,
      processedItems: job.processedItems,
      totalItems: job.totalItems,
      errorItems: job.errorItems,
    });
    return NextResponse.json(
      { job },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(error, "Unable to fetch yearly import job.");
    logger.error("yearlyImport.job.get.failed", { jobId: id, error, message });
    return NextResponse.json(
      { error: message },
      { status: resolveStatus(message), headers: { "x-request-id": requestId } },
    );
  }
}

export async function PATCH(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const { id } = await context.params;
  const logger = createRouteLogger({
    module: "api.admin.yearly-import.jobs.id",
    requestId,
  });

  try {
    await requireAdminSession();
    const body = (await request.json().catch(() => ({}))) as { action?: string };

    if (body.action !== "pause") {
      logger.warn("yearlyImport.job.pause.invalidAction", {
        jobId: id,
        action: body.action ?? null,
      });
      return NextResponse.json(
        { error: "Only action=pause is supported." },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }

    const job = await pauseYearlyImportJob(id);
    logger.info("yearlyImport.job.pause.success", {
      jobId: id,
      status: job.status,
    });
    return NextResponse.json(
      { job },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(error, "Failed to pause yearly import job.");
    logger.error("yearlyImport.job.pause.failed", { jobId: id, error, message });
    return NextResponse.json(
      { error: message },
      { status: resolveStatus(message), headers: { "x-request-id": requestId } },
    );
  }
}
