import { NextResponse } from "next/server";

import { startGameSession } from "@/lib/game";

export async function POST() {
  try {
    const payload = await startGameSession();
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

