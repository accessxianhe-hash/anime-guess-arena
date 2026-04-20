import { NextRequest, NextResponse } from "next/server";

import { startGameSession } from "@/lib/game";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { startGameSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.game.start",
    requestId,
  });

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = startGameSchema.safeParse(body);
    if (!parsed.success) {
      const validationMessage =
        parsed.error.issues[0]?.message ?? "Invalid start game payload.";
      logger.warn("game.start.validationFailed", {
        message: validationMessage,
      });
      return NextResponse.json(
        { error: validationMessage },
        {
          status: 400,
          headers: { "x-request-id": requestId },
        },
      );
    }

    const payload = await startGameSession({
      mode: parsed.data.mode,
      years: parsed.data.years,
    });
    logger.info("game.start.success", {
      sessionId: payload.session.sessionId,
      mode: parsed.data.mode,
      yearsCount: parsed.data.years?.length ?? 0,
      questionId: payload.question?.id ?? null,
    });
    return NextResponse.json(payload, {
      headers: { "x-request-id": requestId },
    });
  } catch (error) {
    const message = errorMessage(error, "Failed to start game.");
    logger.error("game.start.failed", {
      message,
      error,
    });
    return NextResponse.json(
      { error: message },
      {
        status: 400,
        headers: { "x-request-id": requestId },
      },
    );
  }
}
