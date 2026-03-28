import { NextRequest, NextResponse } from "next/server";

import { getLeaderboard } from "@/lib/leaderboard";
import { leaderboardScopeSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  try {
    const scope = leaderboardScopeSchema.parse(
      request.nextUrl.searchParams.get("scope") ?? "daily",
    );
    const entries = await getLeaderboard(scope);

    return NextResponse.json({ scope, entries });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "读取排行榜失败。",
      },
      { status: 400 },
    );
  }
}

