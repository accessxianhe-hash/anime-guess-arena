import { NextRequest, NextResponse } from "next/server";

import { skipQuestion } from "@/lib/game";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { skipQuestionSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.game.skip",
    requestId,
  });

  try {
    const body = await request.json();
    const parsed = skipQuestionSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid skip payload.";
      logger.warn("game.skip.validationFailed", { message });
      return NextResponse.json(
        { error: message },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }

    const payload = await skipQuestion(
      parsed.data.sessionId,
      parsed.data.questionId,
      parsed.data.protectedQuestionIds,
    );

    logger.info("game.skip.success", {
      sessionId: parsed.data.sessionId,
      questionId: parsed.data.questionId,
      mode: payload.session.mode,
      status: payload.session.status,
      answeredCount: payload.session.answeredCount,
      correctCount: payload.session.correctCount,
      score: payload.session.score,
      skipped: payload.result?.skipped ?? null,
      isCorrect: payload.result?.isCorrect ?? null,
    });

    return NextResponse.json(payload, {
      headers: { "x-request-id": requestId },
    });
  } catch (error) {
    const message = errorMessage(error, "Failed to skip question.");
    logger.error("game.skip.failed", {
      message,
      error,
    });
    return NextResponse.json(
      { error: message },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
}
