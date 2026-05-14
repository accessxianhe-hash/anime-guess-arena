import { NextRequest, NextResponse } from "next/server";

import { getChallengeReactionOptions } from "@/lib/challenge-reactions";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { finishGameSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.game.reactions.options",
    requestId,
  });

  try {
    const body = await request.json();
    const parsed = finishGameSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid reaction options payload.";
      logger.warn("game.reactions.options.validationFailed", { message });
      return NextResponse.json(
        { error: message },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }

    const options = await getChallengeReactionOptions(parsed.data.sessionId);
    logger.info("game.reactions.options.success", {
      sessionId: parsed.data.sessionId,
      seriesCount: options.series.length,
      imageCount: options.images.length,
    });

    return NextResponse.json(
      options,
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(error, "Failed to load challenge reactions.");
    logger.error("game.reactions.options.failed", { message, error });
    return NextResponse.json(
      { error: message },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
}
