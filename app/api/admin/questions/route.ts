import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { parseQuestionFormData, requireAdminSession, saveQuestion } from "@/lib/admin";

export async function POST(request: Request) {
  try {
    await requireAdminSession();
    const formData = await request.formData();
    const parsed = await parseQuestionFormData(formData, true);
    const question = await saveQuestion(parsed);

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/questions");

    return NextResponse.json({ question });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建题目失败。";
    const status = message.includes("未授权") ? 401 : 400;

    return NextResponse.json({ error: message }, { status });
  }
}

