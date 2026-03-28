import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { submitLeaderboardEntry } from "@/lib/game";
import { submitLeaderboardSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = submitLeaderboardSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "提交成绩参数错误。",
        },
        { status: 400 },
      );
    }

    const entries = await submitLeaderboardEntry(
      parsed.data.sessionId,
      parsed.data.nickname,
    );

    revalidatePath("/");
    revalidatePath("/leaderboard");

    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "提交成绩失败。",
      },
      { status: 400 },
    );
  }
}
