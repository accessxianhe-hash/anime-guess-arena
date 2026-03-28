import { NextRequest, NextResponse } from "next/server";

import { finishGameSession } from "@/lib/game";
import { finishGameSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = finishGameSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "结束会话请求格式错误。",
        },
        { status: 400 },
      );
    }

    const session = await finishGameSession(parsed.data.sessionId);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "结束本局失败。",
      },
      { status: 400 },
    );
  }
}

