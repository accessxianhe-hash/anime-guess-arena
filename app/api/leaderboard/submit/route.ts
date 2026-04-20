import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { submitLeaderboardEntry } from "@/lib/game";
import { createRouteLogger, errorMessage, getRequestId } from "@/lib/observability";
import { submitLeaderboardSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.leaderboard.submit",
    requestId,
  });

  try {
    const body = await request.json();
    const parsed = submitLeaderboardSchema.safeParse(body);

    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ?? "Invalid leaderboard submit payload.";
      logger.warn("leaderboard.submit.validationFailed", {
        message,
      });
      return NextResponse.json(
        { error: message },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }

    const entries = await submitLeaderboardEntry(
      parsed.data.sessionId,
      parsed.data.nickname,
    );

    revalidatePath("/");
    revalidatePath("/leaderboard");

    logger.info("leaderboard.submit.success", {
      sessionId: parsed.data.sessionId,
      nickname: parsed.data.nickname,
      returnedCount: entries.length,
    });

    return NextResponse.json(
      { entries },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const message = errorMessage(error, "Failed to submit leaderboard entry.");
    logger.error("leaderboard.submit.failed", {
      message,
      error,
    });
    return NextResponse.json(
      { error: message },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
}
