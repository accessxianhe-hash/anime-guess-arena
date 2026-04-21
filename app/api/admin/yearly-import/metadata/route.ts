import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { importYearlyMetadataFromCsv } from "@/lib/yearly-metadata";

function resolveStatus(message: string) {
  return /unauthorized|auth|login/i.test(message) ? 401 : 400;
}

function parseBoolean(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return false;
  }

  return value.trim().toLowerCase() === "true";
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.admin.yearly-import.metadata",
    requestId,
  });

  try {
    await requireAdminSession();
    const formData = await request.formData();
    const metadata = formData.get("metadata");

    if (!(metadata instanceof File) || metadata.size === 0) {
      logger.warn("yearlyImport.metadata.invalidFile");
      return NextResponse.json(
        { error: "Please upload a valid metadata CSV file." },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }

    const createMissing = parseBoolean(formData.get("createMissing"));
    const replaceExisting = parseBoolean(formData.get("replaceExisting"));

    const result = await importYearlyMetadataFromCsv(metadata, {
      createMissing,
      replaceExisting,
    });

    revalidatePath("/");
    revalidatePath("/play");
    revalidatePath("/admin");
    revalidatePath("/admin/import");

    logger.info("yearlyImport.metadata.success", {
      fileName: metadata.name,
      fileSize: metadata.size,
      totalRows: result.totalRows,
      updatedSeries: result.updatedSeries,
      createdSeries: result.createdSeries,
      skippedRows: result.skippedRows,
      errorRows: result.errors.length,
      createMissing,
      replaceExisting,
    });

    return NextResponse.json(result, {
      headers: { "x-request-id": requestId },
    });
  } catch (error) {
    const message = errorMessage(error, "Failed to import yearly metadata.");
    logger.error("yearlyImport.metadata.failed", {
      message,
      error,
    });
    return NextResponse.json(
      { error: message },
      { status: resolveStatus(message), headers: { "x-request-id": requestId } },
    );
  }
}
