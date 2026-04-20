import { NextRequest, NextResponse } from "next/server";

import { submitAnswer } from "@/lib/game";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { answerQuestionSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.game.answer",
    requestId,
  });

  try {
    const body = await request.json();
    const parsed = answerQuestionSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid answer payload.";
      logger.warn("game.answer.validationFailed", { message });
      return NextResponse.json(
        { error: message },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }

    const payload = await submitAnswer(
      parsed.data.sessionId,
      parsed.data.questionId,
      parsed.data.answer,
      parsed.data.protectedQuestionIds,
    );

    logger.info("game.answer.success", {
      sessionId: parsed.data.sessionId,
      questionId: parsed.data.questionId,
      mode: payload.session.mode,
      status: payload.session.status,
      answeredCount: payload.session.answeredCount,
      correctCount: payload.session.correctCount,
      score: payload.session.score,
      isCorrect: payload.result?.isCorrect ?? null,
      skipped: payload.result?.skipped ?? null,
      scoreAwarded: payload.result?.scoreAwarded ?? null,
    });

    return NextResponse.json(payload, {
      headers: { "x-request-id": requestId },
    });
  } catch (error) {
    const message = errorMessage(error, "Failed to submit answer.");
    logger.error("game.answer.failed", {
      message,
      error,
    });
    return NextResponse.json(
      { error: message },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
}
