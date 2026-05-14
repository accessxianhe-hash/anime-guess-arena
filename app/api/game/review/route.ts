import { NextRequest, NextResponse } from "next/server";

import { listGameMistakes } from "@/lib/game";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { finishGameSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.game.review",
    requestId,
  });

  try {
    const body = await request.json();
    const parsed = finishGameSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid review payload.";
      logger.warn("game.review.validationFailed", { message });
      return NextResponse.json(
        { error: message },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }

    const mistakes = await listGameMistakes(parsed.data.sessionId);
    logger.info("game.review.success", {
      sessionId: parsed.data.sessionId,
      mistakeCount: mistakes.length,
    });

    return NextResponse.json(
      { mistakes },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(error, "Failed to load game review.");
    logger.error("game.review.failed", {
      message,
      error,
    });
    return NextResponse.json(
      { error: message },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
}
