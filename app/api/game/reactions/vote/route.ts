import { NextRequest, NextResponse } from "next/server";

import { submitChallengeReactions } from "@/lib/challenge-reactions";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { submitChallengeReactionsSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.game.reactions.vote",
    requestId,
  });

  try {
    const body = await request.json();
    const parsed = submitChallengeReactionsSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid reaction vote payload.";
      logger.warn("game.reactions.vote.validationFailed", { message });
      return NextResponse.json(
        { error: message },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }

    const options = await submitChallengeReactions(
      parsed.data.sessionId,
      parsed.data.likedSeriesIds,
      parsed.data.favoriteImageId,
    );

    logger.info("game.reactions.vote.success", {
      sessionId: parsed.data.sessionId,
      likedSeriesCount: options.selectedSeriesIds.length,
      favoriteImageId: options.selectedImageId,
    });

    return NextResponse.json(
      options,
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(error, "Failed to save challenge reactions.");
    logger.error("game.reactions.vote.failed", { message, error });
    return NextResponse.json(
      { error: message },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
}
