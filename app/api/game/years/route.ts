import { NextResponse } from "next/server";

import { listYearlyAvailableYears } from "@/lib/game";

export async function GET() {
  try {
    const years = await listYearlyAvailableYears();
    return NextResponse.json({ years });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "无法获取可用年份列表。",
      },
      { status: 500 },
    );
  }
}
