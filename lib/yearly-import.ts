import {
  YearlyImportItemStatus,
  YearlyImportJobStatus,
} from "@prisma/client";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { uploadQuestionImage } from "@/lib/storage";

const IMPORT_ARCHIVE_DIR = path.join(
  process.cwd(),
  "data",
  "yearly-import-jobs",
);
const DEFAULT_BATCH_SIZE = 120;
const MAX_BATCH_SIZE = 300;
const CREATE_MANY_CHUNK_SIZE = 500;
const IMPORT_ITEM_TIMEOUT_MS = 20_000;
const IMPORT_ITEM_MAX_AUTO_RETRIES = 2;
const IMPORT_ITEM_RETRY_BACKOFF_MS = 600;
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
]);

type ParsedImportEntry = {
  year: number;
  seriesTitle: string;
  normalizedSeriesTitle: string;
  filePath: string;
  fileName: string;
};

type YearlyImportJobSummary = {
  id: string;
  status: YearlyImportJobStatus;
  archiveName: string;
  totalItems: number;
  processedItems: number;
  importedItems: number;
  errorItems: number;
  cursor: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  summary: Record<string, unknown> | null;
};

export type YearlyImportLogRecord = {
  itemIndex: number;
  year: number;
  seriesTitle: string;
  filePath: string;
  fileName: string;
  fileHash: string | null;
  status: YearlyImportItemStatus;
  error: string | null;
  updatedAt: string;
};

class ImportItemTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportItemTimeoutError";
  }
}

function normalizeSeriesTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeArchivePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function isImageFile(fileName: string) {
  const ext = path.posix.extname(fileName).toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.has(ext);
}

function parseImportEntry(filePath: string): ParsedImportEntry | null {
  const normalizedPath = normalizeArchivePath(filePath);
  if (!normalizedPath) {
    return null;
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length < 3) {
    return null;
  }

  for (let index = 0; index <= segments.length - 3; index += 1) {
    const yearSegment = segments[index];
    if (!/^\d{4}$/.test(yearSegment)) {
      continue;
    }

    const year = Number(yearSegment);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      continue;
    }

    const seriesTitle = segments[index + 1]?.trim() ?? "";
    const fileName = segments.at(-1)?.trim() ?? "";

    if (!seriesTitle || !fileName || !isImageFile(fileName)) {
      return null;
    }

    return {
      year,
      seriesTitle,
      normalizedSeriesTitle: normalizeSeriesTitle(seriesTitle),
      filePath: segments.slice(index).join("/"),
      fileName,
    };
  }

  return null;
}

function buildArchiveStoragePath(jobId: string) {
  return path.join(IMPORT_ARCHIVE_DIR, `${jobId}.zip`);
}

function mapJobSummary(
  job: {
    id: string;
    status: YearlyImportJobStatus;
    archiveName: string;
    totalItems: number;
    processedItems: number;
    importedItems: number;
    errorItems: number;
    cursor: number;
    createdAt: Date;
    updatedAt: Date;
    finishedAt: Date | null;
    lastError: string | null;
    summary: unknown;
  },
): YearlyImportJobSummary {
  return {
    id: job.id,
    status: job.status,
    archiveName: job.archiveName,
    totalItems: job.totalItems,
    processedItems: job.processedItems,
    importedItems: job.importedItems,
    errorItems: job.errorItems,
    cursor: job.cursor,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    lastError: job.lastError,
    summary:
      job.summary && typeof job.summary === "object"
        ? (job.summary as Record<string, unknown>)
        : null,
  };
}

function mapLogRecord(item: {
  itemIndex: number;
  year: number;
  seriesTitle: string;
  filePath: string;
  fileName: string;
  fileHash: string | null;
  status: YearlyImportItemStatus;
  error: string | null;
  updatedAt: Date;
}): YearlyImportLogRecord {
  return {
    itemIndex: item.itemIndex,
    year: item.year,
    seriesTitle: item.seriesTitle,
    filePath: item.filePath,
    fileName: item.fileName,
    fileHash: item.fileHash,
    status: item.status,
    error: item.error,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function escapeCsvCell(value: unknown) {
  const raw = value == null ? "" : String(value);
  if (!/[",\r\n]/.test(raw)) {
    return raw;
  }
  return `"${raw.replaceAll('"', '""')}"`;
}

export function toYearlyImportLogCsv(items: YearlyImportLogRecord[]) {
  const header = [
    "item_index",
    "year",
    "series_title",
    "file_path",
    "file_name",
    "file_hash",
    "status",
    "error",
    "updated_at",
  ];

  const lines = items.map((item) =>
    [
      item.itemIndex,
      item.year,
      item.seriesTitle,
      item.filePath,
      item.fileName,
      item.fileHash ?? "",
      item.status,
      item.error ?? "",
      item.updatedAt,
    ]
      .map(escapeCsvCell)
      .join(","),
  );

  return [header.join(","), ...lines].join("\n");
}

async function loadZipFromArchive(jobId: string) {
  const archivePath = buildArchiveStoragePath(jobId);
  const archiveBuffer = await readFile(archivePath);
  return JSZip.loadAsync(archiveBuffer);
}

async function cleanupArchive(jobId: string) {
  try {
    await unlink(buildArchiveStoragePath(jobId));
  } catch {}
}

function hashBuffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function inferContentType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".avif")) {
    return "image/avif";
  }
  return "application/octet-stream";
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ImportItemTimeoutError(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function isRetryableImportError(error: unknown) {
  if (error instanceof ImportItemTimeoutError) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|timeout|timed out/i.test(message);
}

function isSeriesImageUniqueConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Unique constraint failed.*YearlySeriesImage.*seriesId_fileHash|seriesId_fileHash/i.test(
    message,
  );
}

async function resolveZipFile(zip: JSZip, sourcePath: string) {
  const normalized = normalizeArchivePath(sourcePath).toLowerCase();

  const direct = zip.file(sourcePath);
  if (direct) {
    return direct;
  }

  return (
    zip
      .filter(
        (candidatePath, entry) =>
          !entry.dir && normalizeArchivePath(candidatePath).toLowerCase() === normalized,
      )
      .at(0) ?? null
  );
}

type ProcessImportItemResult = {
  imported: boolean;
};

type AutoHealItemProcessResult = {
  handled: boolean;
  processedDelta: number;
  importedDelta: number;
  errorDelta: number;
  cursor: number;
};

async function processImportItem(
  item: {
    id: string;
    year: number;
    seriesTitle: string;
    normalizedSeriesTitle: string;
    filePath: string;
    fileName: string;
  },
  zip: JSZip,
): Promise<ProcessImportItemResult> {
  const zipEntry = await resolveZipFile(zip, item.filePath);
  if (!zipEntry) {
    throw new Error(`未在压缩包中找到文件：${item.filePath}`);
  }

  const imageBuffer = Buffer.from(await zipEntry.async("uint8array"));
  const fileHash = hashBuffer(imageBuffer);

  const series = await prisma.yearlySeries.upsert({
    where: {
      year_normalizedTitle: {
        year: item.year,
        normalizedTitle: item.normalizedSeriesTitle,
      },
    },
    update: {
      title: item.seriesTitle,
      active: true,
    },
    create: {
      year: item.year,
      title: item.seriesTitle,
      normalizedTitle: item.normalizedSeriesTitle,
      tags: [],
      studios: [],
      authors: [],
      active: true,
    },
    select: { id: true },
  });

  const existingImage = await prisma.yearlySeriesImage.findUnique({
    where: {
      seriesId_fileHash: {
        seriesId: series.id,
        fileHash,
      },
    },
    select: { id: true },
  });

  if (existingImage) {
    await prisma.yearlyImportItem.update({
      where: { id: item.id },
      data: {
        status: YearlyImportItemStatus.SKIPPED,
        fileHash,
        error: null,
      },
    });
    return { imported: false };
  }

  const uploaded = await uploadQuestionImage(
    imageBuffer,
    item.fileName,
    inferContentType(item.fileName),
  );

  try {
    await prisma.$transaction(async (tx) => {
      await tx.yearlySeriesImage.create({
        data: {
          seriesId: series.id,
          imageUrl: uploaded.publicUrl,
          imageStorageKey: uploaded.storageKey,
          sourcePath: item.filePath,
          sourceFileName: item.fileName,
          fileHash,
        },
      });

      await tx.yearlyImportItem.update({
        where: { id: item.id },
        data: {
          status: YearlyImportItemStatus.IMPORTED,
          fileHash,
          error: null,
        },
      });
    });

    return { imported: true };
  } catch (error) {
    if (!isSeriesImageUniqueConflict(error)) {
      throw error;
    }

    await prisma.yearlyImportItem.update({
      where: { id: item.id },
      data: {
        status: YearlyImportItemStatus.SKIPPED,
        fileHash,
        error: "重复图片（并发冲突自动跳过）",
      },
    });
    return { imported: false };
  }
}

async function processImportItemWithAutoHeal(
  item: {
    id: string;
    itemIndex: number;
    year: number;
    seriesTitle: string;
    normalizedSeriesTitle: string;
    filePath: string;
    fileName: string;
  },
  zip: JSZip,
): Promise<AutoHealItemProcessResult> {
  const maxAttempts = IMPORT_ITEM_MAX_AUTO_RETRIES + 1;
  let attempt = 0;
  let lastErrorMessage = "";

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const result = await withTimeout(
        processImportItem(item, zip),
        IMPORT_ITEM_TIMEOUT_MS,
        `导入项超时（>${IMPORT_ITEM_TIMEOUT_MS}ms）：${item.filePath}`,
      );

      return {
        handled: true,
        processedDelta: 1,
        importedDelta: result.imported ? 1 : 0,
        errorDelta: 0,
        cursor: item.itemIndex + 1,
      };
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : "未知错误";
      const canRetry = attempt < maxAttempts && isRetryableImportError(error);
      if (canRetry) {
        await delay(IMPORT_ITEM_RETRY_BACKOFF_MS * attempt);
        continue;
      }

      await prisma.yearlyImportItem.update({
        where: { id: item.id },
        data: {
          status: YearlyImportItemStatus.FAILED,
          error: `[auto-heal] attempts=${attempt}/${maxAttempts}; ${lastErrorMessage.slice(0, 520)}`,
        },
      });
      return {
        handled: true,
        processedDelta: 1,
        importedDelta: 0,
        errorDelta: 1,
        cursor: item.itemIndex + 1,
      };
    }
  }

  return {
    handled: false,
    processedDelta: 0,
    importedDelta: 0,
    errorDelta: 0,
    cursor: item.itemIndex,
  };
}

async function createJobItems(
  jobId: string,
  items: ParsedImportEntry[],
) {
  for (let index = 0; index < items.length; index += CREATE_MANY_CHUNK_SIZE) {
    const chunk = items.slice(index, index + CREATE_MANY_CHUNK_SIZE);
    await prisma.yearlyImportItem.createMany({
      data: chunk.map((item, offset) => ({
        jobId,
        itemIndex: index + offset,
        year: item.year,
        seriesTitle: item.seriesTitle,
        normalizedSeriesTitle: item.normalizedSeriesTitle,
        filePath: item.filePath,
        fileName: item.fileName,
        status: YearlyImportItemStatus.PENDING,
      })),
      skipDuplicates: true,
    });
  }
}

async function markJobCompleted(jobId: string) {
  const updated = await prisma.yearlyImportJob.update({
    where: { id: jobId },
    data: {
      status: YearlyImportJobStatus.COMPLETED,
      finishedAt: new Date(),
      lastError: null,
    },
  });

  await cleanupArchive(jobId);
  return updated;
}

export async function createYearlyImportJob(file: File) {
  const archiveBuffer = Buffer.from(await file.arrayBuffer());
  const zip = await JSZip.loadAsync(archiveBuffer);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => parseImportEntry(entry.name))
    .filter((item): item is ParsedImportEntry => Boolean(item));

  if (entries.length === 0) {
    throw new Error(
      "ZIP 中未检测到有效图片。请使用 YYYY/番剧名/*.jpg|png|webp 目录结构。",
    );
  }

  const years = Array.from(new Set(entries.map((item) => item.year))).sort((a, b) => a - b);
  const seriesCount = new Set(
    entries.map((item) => `${item.year}:${item.normalizedSeriesTitle}`),
  ).size;

  const job = await prisma.yearlyImportJob.create({
    data: {
      status: YearlyImportJobStatus.PENDING,
      archiveName: file.name,
      totalItems: entries.length,
      summary: {
        years,
        seriesCount,
        validImageCount: entries.length,
      },
    },
  });

  await mkdir(IMPORT_ARCHIVE_DIR, { recursive: true });
  await writeFile(buildArchiveStoragePath(job.id), archiveBuffer);

  await createJobItems(job.id, entries);

  const refreshed = await prisma.yearlyImportJob.findUnique({
    where: { id: job.id },
  });

  if (!refreshed) {
    throw new Error("创建导入任务失败，请稍后重试。");
  }

  return mapJobSummary(refreshed);
}

export async function getYearlyImportJob(jobId: string) {
  const job = await prisma.yearlyImportJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    throw new Error("导入任务不存在。");
  }

  return mapJobSummary(job);
}

export async function listYearlyImportJobs(limit = 10) {
  const jobs = await prisma.yearlyImportJob.findMany({
    orderBy: { updatedAt: "desc" },
    take: Math.max(1, Math.min(50, limit)),
  });

  return jobs.map(mapJobSummary);
}

export async function pauseYearlyImportJob(jobId: string) {
  const job = await prisma.yearlyImportJob.findUnique({
    where: { id: jobId },
  });
  if (!job) {
    throw new Error("导入任务不存在。");
  }

  if (job.status === YearlyImportJobStatus.COMPLETED) {
    return mapJobSummary(job);
  }

  const updated = await prisma.yearlyImportJob.update({
    where: { id: jobId },
    data: {
      status: YearlyImportJobStatus.PAUSED,
    },
  });

  return mapJobSummary(updated);
}

export async function retryFailedYearlyImportItems(
  jobId: string,
): Promise<RetryFailedResult> {
  const job = await prisma.yearlyImportJob.findUnique({
    where: { id: jobId },
  });
  if (!job) {
    throw new Error("瀵煎叆浠诲姟涓嶅瓨鍦ㄣ€?");
  }

  const failedItems = await prisma.yearlyImportItem.findMany({
    where: {
      jobId,
      status: YearlyImportItemStatus.FAILED,
    },
    select: {
      id: true,
    },
  });

  const retriedCount = failedItems.length;
  if (retriedCount === 0) {
    return {
      job: mapJobSummary(job),
      retriedCount: 0,
    };
  }

  const failedItemIds = failedItems.map((item) => item.id);
  const nextProcessedItems = Math.max(0, job.processedItems - retriedCount);
  const nextErrorItems = Math.max(0, job.errorItems - retriedCount);

  const updatedJob = await prisma.$transaction(async (tx) => {
    await tx.yearlyImportItem.updateMany({
      where: {
        id: { in: failedItemIds },
      },
      data: {
        status: YearlyImportItemStatus.PENDING,
        error: null,
      },
    });

    return tx.yearlyImportJob.update({
      where: { id: jobId },
      data: {
        status: YearlyImportJobStatus.PAUSED,
        processedItems: nextProcessedItems,
        errorItems: nextErrorItems,
        finishedAt: null,
        lastError: null,
      },
    });
  });

  return {
    job: mapJobSummary(updatedJob),
    retriedCount,
  };
}

type ContinueOptions = {
  batchSize?: number;
  maxBatches?: number;
};

type RetryFailedResult = {
  job: YearlyImportJobSummary;
  retriedCount: number;
};

export async function continueYearlyImportJob(
  jobId: string,
  options: ContinueOptions = {},
) {
  const batchSize = Math.max(
    20,
    Math.min(MAX_BATCH_SIZE, options.batchSize ?? DEFAULT_BATCH_SIZE),
  );
  const maxBatches = Math.max(1, Math.min(5, options.maxBatches ?? 1));

  let job = await prisma.yearlyImportJob.findUnique({
    where: { id: jobId },
  });
  if (!job) {
    throw new Error("导入任务不存在。");
  }

  if (job.status === YearlyImportJobStatus.COMPLETED) {
    return mapJobSummary(job);
  }

  job = await prisma.yearlyImportJob.update({
    where: { id: jobId },
    data: {
      status: YearlyImportJobStatus.RUNNING,
      lastError: null,
    },
  });

  const zip = await loadZipFromArchive(jobId);

  for (let loop = 0; loop < maxBatches; loop += 1) {
    const pendingItems = await prisma.yearlyImportItem.findMany({
      where: {
        jobId,
        status: YearlyImportItemStatus.PENDING,
      },
      orderBy: { itemIndex: "asc" },
      take: batchSize,
    });

    if (pendingItems.length === 0) {
      const completed = await markJobCompleted(jobId);
      return mapJobSummary(completed);
    }

    let processedDelta = 0;
    let importedDelta = 0;
    let errorDelta = 0;
    let maxCursor: number = job.cursor;

    for (const item of pendingItems) {
      const autoHealResult = await processImportItemWithAutoHeal(item, zip);
      if (autoHealResult.handled) {
        processedDelta += autoHealResult.processedDelta;
        importedDelta += autoHealResult.importedDelta;
        errorDelta += autoHealResult.errorDelta;
        maxCursor = Math.max(maxCursor, autoHealResult.cursor);
        continue;
      }

      processedDelta += 1;
      maxCursor = Math.max(maxCursor, item.itemIndex + 1);

      try {
        const zipEntry = await resolveZipFile(zip, item.filePath);
        if (!zipEntry) {
          throw new Error(`未在压缩包中找到文件：${item.filePath}`);
        }

        const imageBuffer = Buffer.from(await zipEntry.async("uint8array"));
        const fileHash = hashBuffer(imageBuffer);

        const series = await prisma.yearlySeries.upsert({
          where: {
            year_normalizedTitle: {
              year: item.year,
              normalizedTitle: item.normalizedSeriesTitle,
            },
          },
          update: {
            title: item.seriesTitle,
            active: true,
          },
          create: {
            year: item.year,
            title: item.seriesTitle,
            normalizedTitle: item.normalizedSeriesTitle,
            tags: [],
            studios: [],
            authors: [],
            active: true,
          },
          select: { id: true },
        });

        const existingImage = await prisma.yearlySeriesImage.findUnique({
          where: {
            seriesId_fileHash: {
              seriesId: series.id,
              fileHash,
            },
          },
          select: { id: true },
        });

        if (existingImage) {
          await prisma.yearlyImportItem.update({
            where: { id: item.id },
            data: {
              status: YearlyImportItemStatus.SKIPPED,
              fileHash,
              error: null,
            },
          });
          continue;
        }

        const uploaded = await uploadQuestionImage(
          imageBuffer,
          item.fileName,
          inferContentType(item.fileName),
        );

        await prisma.$transaction(async (tx) => {
          await tx.yearlySeriesImage.create({
            data: {
              seriesId: series.id,
              imageUrl: uploaded.publicUrl,
              imageStorageKey: uploaded.storageKey,
              sourcePath: item.filePath,
              sourceFileName: item.fileName,
              fileHash,
            },
          });

          await tx.yearlyImportItem.update({
            where: { id: item.id },
            data: {
              status: YearlyImportItemStatus.IMPORTED,
              fileHash,
              error: null,
            },
          });
        });

        importedDelta += 1;
      } catch (error) {
        errorDelta += 1;
        await prisma.yearlyImportItem.update({
          where: { id: item.id },
          data: {
            status: YearlyImportItemStatus.FAILED,
            error: error instanceof Error ? error.message.slice(0, 600) : "未知错误",
          },
        });
      }
    }

    job = await prisma.yearlyImportJob.update({
      where: { id: jobId },
      data: {
        processedItems: { increment: processedDelta },
        importedItems: { increment: importedDelta },
        errorItems: { increment: errorDelta },
        cursor: maxCursor,
        status: YearlyImportJobStatus.RUNNING,
      },
    });

    if (job.processedItems >= job.totalItems) {
      const completed = await markJobCompleted(jobId);
      return mapJobSummary(completed);
    }
  }

  const refreshed = await prisma.yearlyImportJob.findUnique({
    where: { id: jobId },
  });
  if (!refreshed) {
    throw new Error("导入任务不存在。");
  }
  return mapJobSummary(refreshed);
}

export async function getYearlyImportJobLog(jobId: string) {
  const job = await prisma.yearlyImportJob.findUnique({
    where: { id: jobId },
  });
  if (!job) {
    throw new Error("导入任务不存在。");
  }

  const rawItems = await prisma.yearlyImportItem.findMany({
    where: { jobId },
    orderBy: { itemIndex: "asc" },
    select: {
      itemIndex: true,
      year: true,
      seriesTitle: true,
      filePath: true,
      fileName: true,
      fileHash: true,
      status: true,
      error: true,
      updatedAt: true,
    },
  });

  const items = rawItems.map(mapLogRecord);
  const failedItems = items.filter((item) => item.status === YearlyImportItemStatus.FAILED);

  return {
    generatedAt: new Date().toISOString(),
    job: mapJobSummary(job),
    items,
    failedItems,
  };
}
