import { NextRequest, NextResponse } from "next/server";

import { submitAnswer } from "@/lib/game";
import { answerQuestionSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = answerQuestionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "答案请求格式错误。",
        },
        { status: 400 },
      );
    }

    const payload = await submitAnswer(
      parsed.data.sessionId,
      parsed.data.questionId,
      parsed.data.answer,
      parsed.data.protectedQuestionIds,
    );

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "提交答案失败。",
      },
      { status: 400 },
    );
  }
}
