import { NextRequest, NextResponse } from "next/server";

import { getReactionLeaderboards } from "@/lib/challenge-reactions";
import { LEADERBOARD_LIMIT } from "@/lib/constants";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { reactionLeaderboardScopeSchema } from "@/lib/validators";

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
    module: "api.reaction-leaderboard",
    requestId,
  });

  try {
    const scope = reactionLeaderboardScopeSchema.parse(
      request.nextUrl.searchParams.get("scope") ?? "daily",
    );
    const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
    const boards = await getReactionLeaderboards(scope, limit);

    logger.info("reactionLeaderboard.fetch.success", {
      scope,
      limit,
      heartCount: boards.hearts.length,
      starCount: boards.stars.length,
    });

    return NextResponse.json(
      boards,
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(error, "Failed to fetch reaction leaderboard.");
    logger.error("reactionLeaderboard.fetch.failed", { message, error });
    return NextResponse.json(
      { error: message },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
}
