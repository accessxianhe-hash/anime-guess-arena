import { NextRequest, NextResponse } from "next/server";

import { finishGameSession } from "@/lib/game";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { finishGameSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.game.finish",
    requestId,
  });

  try {
    const body = await request.json();
    const parsed = finishGameSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid finish payload.";
      logger.warn("game.finish.validationFailed", { message });
      return NextResponse.json(
        { error: message },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }

    const session = await finishGameSession(parsed.data.sessionId);
    logger.info("game.finish.success", {
      sessionId: parsed.data.sessionId,
      score: session.score,
      answeredCount: session.answeredCount,
      correctCount: session.correctCount,
      mode: session.mode,
      status: session.status,
    });

    return NextResponse.json(
      { session },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(error, "Failed to finish game session.");
    logger.error("game.finish.failed", {
      message,
      error,
    });
    return NextResponse.json(
      { error: message },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
}
