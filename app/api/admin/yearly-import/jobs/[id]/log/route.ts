import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { getYearlyImportJobLog, toYearlyImportLogCsv } from "@/lib/yearly-import";

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
    module: "api.admin.yearly-import.jobs.id.log",
    requestId,
  });

  try {
    await requireAdminSession();

    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "json").toLowerCase();
    const scope = (url.searchParams.get("scope") ?? "failed").toLowerCase();

    const log = await getYearlyImportJobLog(id);
    const rows = scope === "all" ? log.items : log.failedItems;

    if (format === "csv") {
      const csv = toYearlyImportLogCsv(rows);
      logger.info("yearlyImport.job.log.exportCsv.success", {
        jobId: id,
        scope,
        totalRows: rows.length,
        failedCount: log.failedItems.length,
      });
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=\"yearly-import-${id}-${scope}.csv\"`,
          "x-request-id": requestId,
        },
      });
    }

    logger.info("yearlyImport.job.log.get.success", {
      jobId: id,
      scope,
      totalRows: rows.length,
      failedCount: log.failedItems.length,
    });
    return NextResponse.json(
      {
        generatedAt: log.generatedAt,
        scope,
        job: log.job,
        totalRows: rows.length,
        rows,
        failedCount: log.failedItems.length,
      },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(error, "Failed to export yearly import log.");
    logger.error("yearlyImport.job.log.get.failed", { jobId: id, error, message });
    return NextResponse.json(
      { error: message },
      { status: resolveStatus(message), headers: { "x-request-id": requestId } },
    );
  }
}
