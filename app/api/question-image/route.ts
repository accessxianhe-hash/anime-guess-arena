import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { downloadQuestionImage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key")?.trim();

  if (!key || !key.includes("questions/")) {
    return NextResponse.json({ error: "Invalid image key." }, { status: 400 });
  }

  try {
    const file = await downloadQuestionImage(key);

    return new NextResponse(Buffer.from(file.body), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }
}
