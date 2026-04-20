import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { createYearlyImportJob, listYearlyImportJobs } from "@/lib/yearly-import";

function resolveStatus(message: string) {
  return /unauthorized|未授权|请先登录/i.test(message) ? 401 : 400;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.admin.yearly-import.jobs",
    requestId,
  });

  try {
    await requireAdminSession();
    const jobs = await listYearlyImportJobs(12);
    logger.info("yearlyImport.jobs.list.success", {
      count: jobs.length,
    });
    return NextResponse.json(
      { jobs },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(error, "Unable to list yearly import jobs.");
    logger.error("yearlyImport.jobs.list.failed", { error, message });
    return NextResponse.json(
      { error: message },
      { status: resolveStatus(message), headers: { "x-request-id": requestId } },
    );
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.admin.yearly-import.jobs",
    requestId,
  });

  try {
    await requireAdminSession();
    const formData = await request.formData();
    const archive = formData.get("archive");

    if (!(archive instanceof File) || archive.size === 0) {
      logger.warn("yearlyImport.jobs.create.invalidArchive");
      return NextResponse.json(
        { error: "Please upload a valid ZIP archive file." },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }

    const job = await createYearlyImportJob(archive);
    logger.info("yearlyImport.jobs.create.success", {
      jobId: job.id,
      archiveName: archive.name,
      archiveSize: archive.size,
      totalItems: job.totalItems,
    });
    return NextResponse.json(
      { job },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(error, "Failed to create yearly import job.");
    logger.error("yearlyImport.jobs.create.failed", { error, message });
    return NextResponse.json(
      { error: message },
      { status: resolveStatus(message), headers: { "x-request-id": requestId } },
    );
  }
}
