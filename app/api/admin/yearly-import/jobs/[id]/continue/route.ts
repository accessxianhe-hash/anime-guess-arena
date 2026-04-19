import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { continueYearlyImportJob } from "@/lib/yearly-import";

type Context = {
  params: Promise<{ id: string }>;
};

function resolveStatus(message: string) {
  return /unauthorized|未授权|请先登录/i.test(message) ? 401 : 400;
}

export async function POST(request: Request, context: Context) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      batchSize?: number;
      maxBatches?: number;
    };

    const job = await continueYearlyImportJob(id, {
      batchSize: body.batchSize,
      maxBatches: body.maxBatches,
    });

    revalidatePath("/");
    revalidatePath("/play");
    revalidatePath("/admin");
    revalidatePath("/admin/questions");
    revalidatePath("/admin/import");

    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "继续导入任务失败。";
    return NextResponse.json({ error: message }, { status: resolveStatus(message) });
  }
}
