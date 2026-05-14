import { NextRequest, NextResponse } from "next/server";

import { getReactionLeaderboards } from "@/lib/challenge-reactions";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { reactionLeaderboardScopeSchema } from "@/lib/validators";

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
    const boards = await getReactionLeaderboards(scope);

    logger.info("reactionLeaderboard.fetch.success", {
      scope,
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
