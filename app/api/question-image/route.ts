import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { createRouteLogger, getRequestId } from "@/lib/observability";
import { downloadQuestionImage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_PROXY_TIMEOUT_MS = 6_000;
const IMAGE_OPTIMIZE_TIMEOUT_MS = 4_000;
const IMAGE_CACHE_DIR = path.join(tmpdir(), "anime-question-image-cache");
const WEBP_QUALITY = 78;

function withTimeout<T>(task: Promise<T>, timeoutMs: number) {
  return Promise.race([
    task,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("Image request timed out.")), timeoutMs);
    }),
  ]);
}

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
  optimized = false,
) {
  const cacheControl =
    source === "storage"
      ? "public, max-age=31536000, immutable"
      : "public, max-age=86400, stale-while-revalidate=604800";

  return new NextResponse(Buffer.from(body), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      "x-request-id": requestId,
      "x-image-source": source,
      "x-image-optimized": optimized ? "webp" : "original",
    },
  });
}

function acceptsWebp(request: NextRequest) {
  return request.headers.get("accept")?.includes("image/webp") ?? false;
}

function canOptimizeContentType(contentType: string) {
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes("image/png") ||
    normalized.includes("image/jpeg") ||
    normalized.includes("image/gif")
  );
}

function getCacheName(cacheKey: string) {
  return createHash("sha256").update(cacheKey).digest("hex");
}

async function readCachedWebp(cacheKey: string) {
  try {
    return await readFile(path.join(IMAGE_CACHE_DIR, `${getCacheName(cacheKey)}.webp`));
  } catch {
    return null;
  }
}

async function optimizeToWebp(input: Uint8Array, cacheKey: string) {
  await mkdir(IMAGE_CACHE_DIR, { recursive: true });

  const cachePath = path.join(IMAGE_CACHE_DIR, `${getCacheName(cacheKey)}.webp`);
  const sharpModule = await Function("specifier", "return import(specifier)")("sharp");
  const sharp = sharpModule.default ?? sharpModule;
  const optimizeTask = sharp(Buffer.from(input), { failOn: "none" })
    .rotate()
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer() as Promise<Buffer>;

  const optimized = await withTimeout(optimizeTask, IMAGE_OPTIMIZE_TIMEOUT_MS);
  await writeFile(cachePath, optimized);
  return optimized;
}

async function maybeOptimizeImage(
  request: NextRequest,
  body: Uint8Array,
  contentType: string,
  cacheKey: string,
  logger: ReturnType<typeof createRouteLogger>,
) {
  if (!acceptsWebp(request) || !canOptimizeContentType(contentType)) {
    return null;
  }

  const cached = await readCachedWebp(cacheKey);
  if (cached) {
    logger.info("questionImage.optimizedCacheHit", {
      cacheKey,
      bytes: cached.byteLength,
    });
    return cached;
  }

  try {
    const optimized = await optimizeToWebp(body, cacheKey);
    logger.info("questionImage.optimizedGenerated", {
      cacheKey,
      originalBytes: body.byteLength,
      optimizedBytes: optimized.byteLength,
    });
    return optimized;
  } catch (error) {
    logger.warn("questionImage.optimizeFailed", {
      cacheKey,
      error,
    });
    return null;
  }
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
      const file = await withTimeout(
        downloadQuestionImage(key),
        IMAGE_PROXY_TIMEOUT_MS,
      );
      logger.info("questionImage.storageHit", {
        key,
        contentType: file.contentType,
        bytes: file.body.byteLength,
      });

      const optimized = await maybeOptimizeImage(
        request,
        file.body,
        file.contentType,
        key,
        logger,
      );
      if (optimized) {
        return buildImageResponse(optimized, "image/webp", requestId, "storage", true);
      }

      return buildImageResponse(file.body, file.contentType, requestId, "storage");
    } catch (error) {
      logger.warn("questionImage.storageMiss", {
        key,
        error,
      });
    }
  }

  if (requestedUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, IMAGE_PROXY_TIMEOUT_MS);

    try {
      const response = await fetch(requestedUrl, {
        cache: "no-store",
        signal: controller.signal,
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

        const optimized = await maybeOptimizeImage(
          request,
          body,
          contentType,
          requestedUrl,
          logger,
        );
        if (optimized) {
          return buildImageResponse(optimized, "image/webp", requestId, "url", true);
        }

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
    } finally {
      clearTimeout(timeoutId);
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
