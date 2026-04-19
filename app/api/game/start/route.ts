import { NextRequest, NextResponse } from "next/server";

import { startGameSession } from "@/lib/game";
import { startGameSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = startGameSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "开始挑战参数错误。" },
        { status: 400 },
      );
    }

    const payload = await startGameSession({
      mode: parsed.data.mode,
      years: parsed.data.years,
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "无法开始游戏。",
      },
      { status: 400 },
    );
  }
}
