import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { createYearlyImportJob, listYearlyImportJobs } from "@/lib/yearly-import";

function resolveStatus(message: string) {
  return /unauthorized|未授权|请先登录/i.test(message) ? 401 : 400;
}

export async function GET() {
  try {
    await requireAdminSession();
    const jobs = await listYearlyImportJobs(12);
    return NextResponse.json({ jobs });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "无法获取年份导入任务列表。";
    return NextResponse.json({ error: message }, { status: resolveStatus(message) });
  }
}

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

    const job = await createYearlyImportJob(archive);
    return NextResponse.json({ job });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "创建年份导入任务失败。";
    return NextResponse.json({ error: message }, { status: resolveStatus(message) });
  }
}
