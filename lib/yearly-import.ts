import {
  Prisma,
  YearlyImportItemStatus,
  YearlyImportJobStatus,
} from "@prisma/client";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { createRouteLogger } from "@/lib/observability";
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
const IMPORT_PROGRESS_FLUSH_EVERY_ITEMS = 10;
const IMPORT_RUNNING_STALE_MS = 3 * 60_000;
const IMPORT_BATCH_SLOW_WARN_MS = 15_000;
const IMPORT_RETRY_WARN_EVERY = 20;
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
]);
const importLogger = createRouteLogger({
  module: "lib.yearly-import",
});

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

type ImportRuntimeProgress = {
  currentBatch: number;
  plannedBatches: number;
  currentBatchSize: number;
  currentBatchProcessed: number;
  remainingItems: number;
  remainingBatches: number;
  retryCount: number;
  retryErrorCount: number;
  staleRecoveries: number;
  lastProgressAt: string | null;
  lastAutoHealAt: string | null;
};

type ImportRuntimeSummaryPatch = Partial<ImportRuntimeProgress>;
type AutoHealJobBase = {
  id: string;
  status: YearlyImportJobStatus;
  summary: unknown;
  updatedAt: Date;
  lastError: string | null;
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

function clampNonNegativeInt(value: unknown, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function readRuntimeProgress(summary: unknown): ImportRuntimeProgress {
  const container =
    summary && typeof summary === "object"
      ? ((summary as Record<string, unknown>).importRuntime as Record<string, unknown> | null)
      : null;

  return {
    currentBatch: clampNonNegativeInt(container?.currentBatch, 0),
    plannedBatches: clampNonNegativeInt(container?.plannedBatches, 0),
    currentBatchSize: clampNonNegativeInt(container?.currentBatchSize, 0),
    currentBatchProcessed: clampNonNegativeInt(container?.currentBatchProcessed, 0),
    remainingItems: clampNonNegativeInt(container?.remainingItems, 0),
    remainingBatches: clampNonNegativeInt(container?.remainingBatches, 0),
    retryCount: clampNonNegativeInt(container?.retryCount, 0),
    retryErrorCount: clampNonNegativeInt(container?.retryErrorCount, 0),
    staleRecoveries: clampNonNegativeInt(container?.staleRecoveries, 0),
    lastProgressAt: typeof container?.lastProgressAt === "string" ? container.lastProgressAt : null,
    lastAutoHealAt: typeof container?.lastAutoHealAt === "string" ? container.lastAutoHealAt : null,
  };
}

function buildSummaryWithRuntime(
  currentSummary: unknown,
  patch: ImportRuntimeSummaryPatch,
): Prisma.InputJsonValue {
  const summaryObject =
    currentSummary && typeof currentSummary === "object"
      ? { ...(currentSummary as Record<string, unknown>) }
      : {};

  const runtime = readRuntimeProgress(summaryObject);
  const nextRuntime: ImportRuntimeProgress = {
    ...runtime,
    ...patch,
  };

  summaryObject.importRuntime = nextRuntime;
  return summaryObject as Prisma.InputJsonValue;
}

function estimateRemainingBatches(remainingItems: number, batchSize: number) {
  if (batchSize <= 0) {
    return 0;
  }
  return Math.ceil(Math.max(0, remainingItems) / batchSize);
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
  retryCount: number;
  retryErrorCount: number;
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
    throw new Error(`文件在压缩包中不存在: ${item.filePath}`);
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
  let retryCount = 0;
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
        retryCount,
        retryErrorCount: retryCount > 0 ? 1 : 0,
      };
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : "未知错误";
      const canRetry = attempt < maxAttempts && isRetryableImportError(error);
      if (canRetry) {
        retryCount += 1;
        importLogger.warn("yearlyImport.item.retrying", {
          itemId: item.id,
          itemIndex: item.itemIndex,
          filePath: item.filePath,
          attempt,
          maxAttempts,
          message: lastErrorMessage,
        });
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
      importLogger.error("yearlyImport.item.failedAfterRetry", {
        itemId: item.id,
        itemIndex: item.itemIndex,
        filePath: item.filePath,
        attempt,
        maxAttempts,
        retryCount,
        message: lastErrorMessage,
      });
      return {
        handled: true,
        processedDelta: 1,
        importedDelta: 0,
        errorDelta: 1,
        cursor: item.itemIndex + 1,
        retryCount,
        retryErrorCount: retryCount > 0 ? 1 : 0,
      };
    }
  }

  return {
    handled: false,
    processedDelta: 0,
    importedDelta: 0,
    errorDelta: 0,
    cursor: item.itemIndex,
    retryCount,
    retryErrorCount: retryCount > 0 ? 1 : 0,
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

async function autoHealStuckRunningJob<T extends AutoHealJobBase>(job: T): Promise<T> {
  if (job.status !== YearlyImportJobStatus.RUNNING) {
    return job;
  }

  const runtime = readRuntimeProgress(job.summary);
  const lastProgressAt = runtime.lastProgressAt ? new Date(runtime.lastProgressAt) : null;
  const progressTickMs =
    lastProgressAt && Number.isFinite(lastProgressAt.getTime())
      ? Date.now() - lastProgressAt.getTime()
      : Date.now() - job.updatedAt.getTime();

  if (progressTickMs < IMPORT_RUNNING_STALE_MS) {
    return job;
  }

  const nowIso = new Date().toISOString();
  const staleRecoveries = runtime.staleRecoveries + 1;
  const updated = await prisma.yearlyImportJob.update({
    where: { id: job.id },
    data: {
      status: YearlyImportJobStatus.PAUSED,
      lastError: `自动自愈触发：任务超过 ${Math.floor(
        IMPORT_RUNNING_STALE_MS / 1000,
      )} 秒无进度，已自动暂停，可点击继续导入。`,
      summary: buildSummaryWithRuntime(job.summary, {
        staleRecoveries,
        lastAutoHealAt: nowIso,
      }),
    },
  });

  importLogger.warn("yearlyImport.autoHeal.staleJobPaused", {
    jobId: job.id,
    staleMs: progressTickMs,
    staleThresholdMs: IMPORT_RUNNING_STALE_MS,
    staleRecoveries,
  });

  return {
    ...job,
    status: updated.status,
    summary: updated.summary,
    updatedAt: updated.updatedAt,
    lastError: updated.lastError,
  };
}

export async function createYearlyImportJob(file: File) {
  const archiveBuffer = Buffer.from(await file.arrayBuffer());
  const zip = await JSZip.loadAsync(archiveBuffer);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => parseImportEntry(entry.name))
    .filter((item): item is ParsedImportEntry => Boolean(item));

  if (entries.length === 0) {
    throw new Error("ZIP 中未检测到有效图片。请使用 YYYY/番剧名/*.jpg|png|webp 目录结构。");
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
        importRuntime: {
          currentBatch: 0,
          plannedBatches: 0,
          currentBatchSize: 0,
          currentBatchProcessed: 0,
          remainingItems: entries.length,
          remainingBatches: 0,
          retryCount: 0,
          retryErrorCount: 0,
          staleRecoveries: 0,
          lastProgressAt: null,
          lastAutoHealAt: null,
        },
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

  importLogger.info("yearlyImport.job.created", {
    jobId: refreshed.id,
    archiveName: refreshed.archiveName,
    processedItems: refreshed.processedItems,
    importedItems: refreshed.importedItems,
    errorItems: refreshed.errorItems,
    totalItems: refreshed.totalItems,
    years,
    seriesCount,
  });
  return mapJobSummary(refreshed);
}

export async function getYearlyImportJob(jobId: string) {
  const job = await prisma.yearlyImportJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    throw new Error("导入任务不存在。");
  }

  const healedJob = await autoHealStuckRunningJob(job);
  return mapJobSummary(healedJob);
}

export async function listYearlyImportJobs(limit = 10) {
  const jobs = await prisma.yearlyImportJob.findMany({
    orderBy: { updatedAt: "desc" },
    take: Math.max(1, Math.min(50, limit)),
  });

  const healedJobs = await Promise.all(jobs.map((job) => autoHealStuckRunningJob(job)));
  return healedJobs.map(mapJobSummary);
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
    throw new Error("导入任务不存在。");
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
  const batchSize = Math.max(20, Math.min(MAX_BATCH_SIZE, options.batchSize ?? DEFAULT_BATCH_SIZE));
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
  const pendingTotal = await prisma.yearlyImportItem.count({
    where: {
      jobId,
      status: YearlyImportItemStatus.PENDING,
    },
  });
  const plannedBatches = estimateRemainingBatches(pendingTotal, batchSize);
  const runtimeBeforeRun = readRuntimeProgress(job.summary);
  let retryCount = runtimeBeforeRun.retryCount;
  let retryErrorCount = runtimeBeforeRun.retryErrorCount;
  let currentBatch = 0;

  job = await prisma.yearlyImportJob.update({
    where: { id: jobId },
    data: {
      summary: buildSummaryWithRuntime(job.summary, {
        currentBatch: 0,
        plannedBatches,
        currentBatchSize: 0,
        currentBatchProcessed: 0,
        remainingItems: Math.max(0, job.totalItems - job.processedItems),
        remainingBatches: estimateRemainingBatches(
          Math.max(0, job.totalItems - job.processedItems),
          batchSize,
        ),
        retryCount,
        retryErrorCount,
        lastProgressAt: new Date().toISOString(),
      }),
    },
  });

  importLogger.info("yearlyImport.continue.started", {
    jobId,
    batchSize,
    maxBatches,
    pendingTotal,
    plannedBatches,
    processedItems: job.processedItems,
    totalItems: job.totalItems,
  });

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
      importLogger.info("yearlyImport.continue.completed.noPending", {
        jobId,
        processedItems: completed.processedItems,
        importedItems: completed.importedItems,
        errorItems: completed.errorItems,
      });
      return mapJobSummary(completed);
    }

    currentBatch += 1;
    const currentBatchSize = pendingItems.length;
    const batchStartedAt = Date.now();
    let currentBatchProcessed = 0;
    let stagedProcessedDelta = 0;
    let stagedImportedDelta = 0;
    let stagedErrorDelta = 0;
    let maxCursor: number = job.cursor;

    const flushProgress = async (force = false) => {
      if (stagedProcessedDelta <= 0) {
        return;
      }
      if (!force && stagedProcessedDelta < IMPORT_PROGRESS_FLUSH_EVERY_ITEMS) {
        return;
      }
      if (!job) {
        throw new Error("导入任务不存在或已被移除。");
      }

      const nowIso = new Date().toISOString();
      const nextProcessed = job.processedItems + stagedProcessedDelta;
      const remainingItems = Math.max(0, job.totalItems - nextProcessed);

      job = await prisma.yearlyImportJob.update({
        where: { id: jobId },
        data: {
          processedItems: { increment: stagedProcessedDelta },
          importedItems: { increment: stagedImportedDelta },
          errorItems: { increment: stagedErrorDelta },
          cursor: Math.max(job.cursor, maxCursor),
          status: YearlyImportJobStatus.RUNNING,
          summary: buildSummaryWithRuntime(job.summary, {
            currentBatch,
            plannedBatches,
            currentBatchSize,
            currentBatchProcessed: Math.min(currentBatchProcessed, currentBatchSize),
            remainingItems,
            remainingBatches: estimateRemainingBatches(remainingItems, batchSize),
            retryCount,
            retryErrorCount,
            lastProgressAt: nowIso,
          }),
        },
      });

      stagedProcessedDelta = 0;
      stagedImportedDelta = 0;
      stagedErrorDelta = 0;
      maxCursor = job.cursor;
    };

    for (const item of pendingItems) {
      const autoHealResult = await processImportItemWithAutoHeal(item, zip);
      const previousRetryCount = retryCount;
      retryCount += autoHealResult.retryCount;
      retryErrorCount += autoHealResult.retryErrorCount;
      if (
        retryCount > 0 &&
        Math.floor(retryCount / IMPORT_RETRY_WARN_EVERY) >
          Math.floor(previousRetryCount / IMPORT_RETRY_WARN_EVERY)
      ) {
        importLogger.warn("yearlyImport.continue.retrySpike", {
          jobId,
          currentBatch,
          retryCount,
          retryErrorCount,
          itemIndex: item.itemIndex,
          filePath: item.filePath,
        });
      }
      if (autoHealResult.handled) {
        stagedProcessedDelta += autoHealResult.processedDelta;
        stagedImportedDelta += autoHealResult.importedDelta;
        stagedErrorDelta += autoHealResult.errorDelta;
        currentBatchProcessed += autoHealResult.processedDelta;
        maxCursor = Math.max(maxCursor, autoHealResult.cursor);
        await flushProgress();
        continue;
      }

      stagedProcessedDelta += 1;
      stagedErrorDelta += 1;
      currentBatchProcessed += 1;
      maxCursor = Math.max(maxCursor, item.itemIndex + 1);
      await prisma.yearlyImportItem.update({
        where: { id: item.id },
        data: {
          status: YearlyImportItemStatus.FAILED,
          error:
            "[auto-heal] unexpected fallback: item was not handled by retry pipeline",
        },
      });
      await flushProgress();
      continue;

    }

    await flushProgress(true);

    const batchElapsedMs = Date.now() - batchStartedAt;
    const batchRemainingItems = Math.max(0, job.totalItems - job.processedItems);
    if (batchElapsedMs >= IMPORT_BATCH_SLOW_WARN_MS) {
      importLogger.warn("yearlyImport.continue.batchSlow", {
        jobId,
        currentBatch,
        batchElapsedMs,
        batchSize: currentBatchSize,
        currentBatchProcessed,
        remainingItems: batchRemainingItems,
        retryCount,
        retryErrorCount,
      });
    } else {
      importLogger.info("yearlyImport.continue.batchCompleted", {
        jobId,
        currentBatch,
        batchElapsedMs,
        batchSize: currentBatchSize,
        currentBatchProcessed,
        remainingItems: batchRemainingItems,
        retryCount,
        retryErrorCount,
      });
    }

    if (job.processedItems >= job.totalItems) {
      const completed = await markJobCompleted(jobId);
      importLogger.info("yearlyImport.continue.completed", {
        jobId,
        processedItems: completed.processedItems,
        importedItems: completed.importedItems,
        errorItems: completed.errorItems,
      });
      return mapJobSummary(completed);
    }
  }

  const refreshed = await prisma.yearlyImportJob.findUnique({
    where: { id: jobId },
  });
  if (!refreshed) {
    throw new Error("导入任务不存在。");
  }

  importLogger.info("yearlyImport.continue.pausedAfterBatchLimit", {
    jobId: refreshed.id,
    processedItems: refreshed.processedItems,
    importedItems: refreshed.importedItems,
    errorItems: refreshed.errorItems,
    totalItems: refreshed.totalItems,
    retryCount,
    retryErrorCount,
  });

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

