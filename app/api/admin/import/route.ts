import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { importQuestionsFromArchive, requireAdminSession } from "@/lib/admin";

export async function POST(request: Request) {
  try {
    await requireAdminSession();
    const formData = await request.formData();
    const archive = formData.get("archive");

    if (!(archive instanceof File) || archive.size === 0) {
      return NextResponse.json(
        { error: "请上传一个有效的 ZIP 文件。" },
        { status: 400 },
      );
    }

    const result = await importQuestionsFromArchive(archive);

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/questions");
    revalidatePath("/admin/import");

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量导入失败。";
    const status = message.includes("未授权") ? 401 : 400;

    return NextResponse.json({ error: message }, { status });
  }
}
