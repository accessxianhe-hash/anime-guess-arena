import { Buffer } from "node:buffer";

import { NextRequest, NextResponse } from "next/server";

import { createRouteLogger, getRequestId } from "@/lib/observability";
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

function buildImageResponse(
  body: Uint8Array,
  contentType: string,
  requestId: string,
  source: "storage" | "url",
) {
  return new NextResponse(Buffer.from(body), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "x-request-id": requestId,
      "x-image-source": source,
    },
  });
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const logger = createRouteLogger({
    module: "api.question-image",
    requestId,
  });

  const requestedKey = request.nextUrl.searchParams.get("key")?.trim() ?? "";
  const requestedUrl = request.nextUrl.searchParams.get("url")?.trim() ?? "";
  const key = requestedKey || normalizeStorageKeyFromUrl(requestedUrl);

  if (!key && !requestedUrl) {
    logger.warn("questionImage.invalidRequest");
    return NextResponse.json(
      { error: "Invalid image key." },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  if (key && key.includes("questions/")) {
    try {
      const file = await downloadQuestionImage(key);
      logger.info("questionImage.storageHit", {
        key,
        contentType: file.contentType,
        bytes: file.body.byteLength,
      });
      return buildImageResponse(file.body, file.contentType, requestId, "storage");
    } catch (error) {
      logger.warn("questionImage.storageMiss", {
        key,
        error,
      });
    }
  }

  if (requestedUrl) {
    try {
      const response = await fetch(requestedUrl, {
        cache: "no-store",
      });

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const body = new Uint8Array(arrayBuffer);
        const contentType = response.headers.get("content-type") || "image/jpeg";
        logger.info("questionImage.remoteHit", {
          url: requestedUrl,
          contentType,
          bytes: body.byteLength,
        });
        return buildImageResponse(body, contentType, requestId, "url");
      }

      logger.warn("questionImage.remoteStatusNonOk", {
        url: requestedUrl,
        status: response.status,
      });
    } catch (error) {
      logger.warn("questionImage.remoteFetchFailed", {
        url: requestedUrl,
        error,
      });
    }
  }

  logger.warn("questionImage.notFound", {
    key,
    requestedUrl: requestedUrl || null,
  });
  return NextResponse.json(
    { error: "Image not found." },
    { status: 404, headers: { "x-request-id": requestId } },
  );
}
