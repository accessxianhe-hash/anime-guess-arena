import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { getYearlyImportJob, pauseYearlyImportJob } from "@/lib/yearly-import";

type Context = {
  params: Promise<{ id: string }>;
};

function resolveStatus(message: string) {
  return /unauthorized|未授权|请先登录/i.test(message) ? 401 : 400;
}

export async function GET(_: Request, context: Context) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const job = await getYearlyImportJob(id);
    return NextResponse.json({ job });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "无法读取导入任务状态。";
    return NextResponse.json({ error: message }, { status: resolveStatus(message) });
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { action?: string };

    if (body.action !== "pause") {
      return NextResponse.json(
        { error: "仅支持 action=pause。" },
        { status: 400 },
      );
    }

    const job = await pauseYearlyImportJob(id);
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "暂停导入任务失败。";
    return NextResponse.json({ error: message }, { status: resolveStatus(message) });
  }
}
