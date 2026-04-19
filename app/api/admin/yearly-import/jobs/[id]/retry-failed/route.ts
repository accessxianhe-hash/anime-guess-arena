import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/admin";
import { retryFailedYearlyImportItems } from "@/lib/yearly-import";

type Context = {
  params: Promise<{ id: string }>;
};

function resolveStatus(message: string) {
  return /unauthorized|鏈巿鏉億璇峰厛鐧诲綍/i.test(message) ? 401 : 400;
}

export async function POST(_: Request, context: Context) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const result = await retryFailedYearlyImportItems(id);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "閲嶈瘯澶辫触椤瑰け璐ャ€?";
    return NextResponse.json({ error: message }, { status: resolveStatus(message) });
  }
}
