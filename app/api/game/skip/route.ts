import { NextRequest, NextResponse } from "next/server";

import { skipQuestion } from "@/lib/game";
import { skipQuestionSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = skipQuestionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "跳题请求格式错误。",
        },
        { status: 400 },
      );
    }

    const payload = await skipQuestion(
      parsed.data.sessionId,
      parsed.data.questionId,
      parsed.data.protectedQuestionIds,
    );

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "跳过题目失败。",
      },
      { status: 400 },
    );
  }
}
