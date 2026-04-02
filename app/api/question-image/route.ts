import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { downloadQuestionImage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeStorageKeyFromUrl(url: string | null) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");

    if (pathname.includes("questions/")) {
      return pathname;
    }
  } catch {
    const trimmed = url.trim();

    if (trimmed.startsWith("/uploads/")) {
      const pathname = trimmed.replace(/^\/uploads\/+/, "");
      if (pathname.includes("questions/")) {
        return pathname;
      }
    }
  }

  return null;
}

function buildImageResponse(body: Uint8Array, contentType: string) {
  return new NextResponse(Buffer.from(body), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}

export async function GET(request: NextRequest) {
  const requestedKey = request.nextUrl.searchParams.get("key")?.trim() ?? "";
  const requestedUrl = request.nextUrl.searchParams.get("url")?.trim() ?? "";
  const key = requestedKey || normalizeStorageKeyFromUrl(requestedUrl);

  if (!key && !requestedUrl) {
    return NextResponse.json({ error: "Invalid image key." }, { status: 400 });
  }

  if (key && key.includes("questions/")) {
    try {
      const file = await downloadQuestionImage(key);
      return buildImageResponse(file.body, file.contentType);
    } catch {
      // Fall through to URL fetch if available.
    }
  }

  if (requestedUrl) {
    try {
      const response = await fetch(requestedUrl, {
        cache: "no-store",
      });

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        return buildImageResponse(
          new Uint8Array(arrayBuffer),
          response.headers.get("content-type") || "image/jpeg",
        );
      }
    } catch {
      // Ignore and return 404 below.
    }
  }

  return NextResponse.json({ error: "Image not found." }, { status: 404 });
}
