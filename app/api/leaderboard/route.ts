import { NextRequest, NextResponse } from "next/server";

import { LEADERBOARD_LIMIT } from "@/lib/constants";
import { getLeaderboard } from "@/lib/leaderboard";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { leaderboardModeSchema, leaderboardScopeSchema } from "@/lib/validators";

function parseLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return LEADERBOARD_LIMIT;
  }
  return Math.min(LEADERBOARD_LIMIT, Math.floor(parsed));
}

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
    const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
    const entries = await getLeaderboard(scope, mode, limit);

    logger.info("leaderboard.fetch.success", {
      scope,
      mode,
      limit,
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
