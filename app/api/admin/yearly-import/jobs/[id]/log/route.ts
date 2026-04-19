import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { getYearlyImportJobLog, toYearlyImportLogCsv } from "@/lib/yearly-import";

type Context = {
  params: Promise<{ id: string }>;
};

function resolveStatus(message: string) {
  return /unauthorized|未授权|请先登录/i.test(message) ? 401 : 400;
}

export async function GET(request: Request, context: Context) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "json").toLowerCase();
    const scope = (url.searchParams.get("scope") ?? "failed").toLowerCase();

    const log = await getYearlyImportJobLog(id);
    const rows = scope === "all" ? log.items : log.failedItems;

    if (format === "csv") {
      const csv = toYearlyImportLogCsv(rows);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="yearly-import-${id}-${scope}.csv"`,
        },
      });
    }

    return NextResponse.json({
      generatedAt: log.generatedAt,
      scope,
      job: log.job,
      totalRows: rows.length,
      rows,
      failedCount: log.failedItems.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导出导入日志失败。";
    return NextResponse.json({ error: message }, { status: resolveStatus(message) });
  }
}
