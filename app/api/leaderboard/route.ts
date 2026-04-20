import { NextRequest, NextResponse } from "next/server";

import { getLeaderboard } from "@/lib/leaderboard";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { leaderboardModeSchema, leaderboardScopeSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.leaderboard",
    requestId,
  });

  try {
    const scope = leaderboardScopeSchema.parse(
      request.nextUrl.searchParams.get("scope") ?? "daily",
    );
    const mode = leaderboardModeSchema.parse(
      request.nextUrl.searchParams.get("mode") ?? "classic",
    );
    const entries = await getLeaderboard(scope, mode);

    logger.info("leaderboard.fetch.success", {
      scope,
      mode,
      count: entries.length,
    });

    return NextResponse.json(
      { scope, mode, entries },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(error, "Failed to fetch leaderboard.");
    logger.error("leaderboard.fetch.failed", {
      message,
      error,
    });
    return NextResponse.json(
      { error: message },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
}
