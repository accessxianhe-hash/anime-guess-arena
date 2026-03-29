import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  deleteQuestion,
  parseQuestionFormData,
  requireAdminSession,
  saveQuestion,
} from "@/lib/admin";

type Params = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: Params) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const formData = await request.formData();
    const parsed = await parseQuestionFormData(formData, false);
    const question = await saveQuestion(parsed, id);

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/questions");

    return NextResponse.json({ question });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新题目失败。";
    const status = message.includes("未授权") ? 401 : 400;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, context: Params) {
  try {
    await requireAdminSession();
    const { id } = await context.params;

    await deleteQuestion(id);

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/questions");

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除题目失败。";
    const status = message.includes("未授权") ? 401 : 400;

    return NextResponse.json({ error: message }, { status });
  }
}
