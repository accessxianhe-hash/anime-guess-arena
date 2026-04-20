import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { continueYearlyImportJob } from "@/lib/yearly-import";

type Context = {
  params: Promise<{ id: string }>;
};

function resolveStatus(message: string) {
  return /unauthorized|未授权|请先登录/i.test(message) ? 401 : 400;
}

export async function POST(request: Request, context: Context) {
  const requestId = getRequestId(request);
  const { id } = await context.params;
  const logger = createRouteLogger({
    module: "api.admin.yearly-import.jobs.id.continue",
    requestId,
  });

  try {
    await requireAdminSession();
    const body = (await request.json().catch(() => ({}))) as {
      batchSize?: number;
      maxBatches?: number;
    };

    logger.info("yearlyImport.job.continue.started", {
      jobId: id,
      batchSize: body.batchSize ?? null,
      maxBatches: body.maxBatches ?? null,
    });
    const job = await continueYearlyImportJob(id, {
      batchSize: body.batchSize,
      maxBatches: body.maxBatches,
    });

    revalidatePath("/");
    revalidatePath("/play");
    revalidatePath("/admin");
    revalidatePath("/admin/questions");
    revalidatePath("/admin/import");

    const failedRatio = job.totalItems > 0 ? job.errorItems / job.totalItems : 0;
    if (failedRatio >= 0.15) {
      logger.warn("yearlyImport.job.continue.highFailureRatio", {
        jobId: id,
        errorItems: job.errorItems,
        totalItems: job.totalItems,
        failedRatio,
      });
    }
    logger.info("yearlyImport.job.continue.finished", {
      jobId: id,
      status: job.status,
      processedItems: job.processedItems,
      importedItems: job.importedItems,
      errorItems: job.errorItems,
      remainingItems: Math.max(0, job.totalItems - job.processedItems),
    });

    return NextResponse.json(
      { job },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(error, "Failed to continue yearly import job.");
    logger.error("yearlyImport.job.continue.failed", { jobId: id, error, message });
    return NextResponse.json(
      { error: message },
      { status: resolveStatus(message), headers: { "x-request-id": requestId } },
    );
  }
}
