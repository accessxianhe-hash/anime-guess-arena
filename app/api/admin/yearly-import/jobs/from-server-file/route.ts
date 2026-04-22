import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { createYearlyImportJobFromServerPath } from "@/lib/yearly-import";

function resolveStatus(message: string) {
  return /unauthorized|auth|login/i.test(message) ? 401 : 400;
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.admin.yearly-import.jobs.from-server-file",
    requestId,
  });

  try {
    await requireAdminSession();
    const body = (await request.json().catch(() => ({}))) as {
      serverPath?: unknown;
    };
    const serverPath =
      typeof body.serverPath === "string" ? body.serverPath.trim() : "";

    if (!serverPath) {
      logger.warn("yearlyImport.jobs.createFromServer.invalidPath");
      return NextResponse.json(
        { error: "Please provide a valid server ZIP path." },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }

    const job = await createYearlyImportJobFromServerPath(serverPath);
    logger.info("yearlyImport.jobs.createFromServer.success", {
      jobId: job.id,
      archiveName: job.archiveName,
      totalItems: job.totalItems,
    });

    return NextResponse.json(
      { job },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(
      error,
      "Failed to create yearly import job from server file.",
    );
    logger.error("yearlyImport.jobs.createFromServer.failed", {
      error,
      message,
    });
    return NextResponse.json(
      { error: message },
      { status: resolveStatus(message), headers: { "x-request-id": requestId } },
    );
  }
}
