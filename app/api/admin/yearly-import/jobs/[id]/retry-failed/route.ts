import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { retryFailedYearlyImportItems } from "@/lib/yearly-import";

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
    module: "api.admin.yearly-import.jobs.id.retry-failed",
    requestId,
  });

  try {
    await requireAdminSession();

    const result = await retryFailedYearlyImportItems(id);
    revalidatePath("/admin");
    revalidatePath("/admin/import");
    revalidatePath("/admin/questions");
    if (result.retriedCount === 0) {
      logger.warn("yearlyImport.job.retryFailed.empty", {
        jobId: id,
        status: result.job.status,
      });
    } else {
      logger.info("yearlyImport.job.retryFailed.success", {
        jobId: id,
        retriedCount: result.retriedCount,
        status: result.job.status,
        processedItems: result.job.processedItems,
        errorItems: result.job.errorItems,
      });
    }

    return NextResponse.json(result, {
      headers: { "x-request-id": requestId },
    });
  } catch (error) {
    const message = errorMessage(error, "Failed to retry failed yearly import items.");
    logger.error("yearlyImport.job.retryFailed.failed", { jobId: id, error, message });
    return NextResponse.json(
      { error: message },
      { status: resolveStatus(message), headers: { "x-request-id": requestId } },
    );
  }
}
