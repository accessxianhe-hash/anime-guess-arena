import { NextRequest, NextResponse } from "next/server";

import { listYearlyAvailableYears } from "@/lib/game";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.game.years",
    requestId,
  });

  try {
    const years = await listYearlyAvailableYears();
    logger.info("game.years.success", {
      count: years.length,
      years,
    });

    return NextResponse.json(
      { years },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(error, "Failed to list available years.");
    logger.error("game.years.failed", {
      message,
      error,
    });
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }
}
