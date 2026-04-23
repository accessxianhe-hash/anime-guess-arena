import { Difficulty, type Prisma } from "@prisma/client";
import JSZip from "jszip";
import { createHash } from "node:crypto";

import { auth } from "@/auth";
import { parseCsv } from "@/lib/csv";
import { normalizeAnswer, normalizeTag } from "@/lib/answers";
import { prisma } from "@/lib/prisma";
import { deleteQuestionImage, uploadQuestionImage } from "@/lib/storage";
import { importRowSchema, questionFormSchema } from "@/lib/validators";

const INTERACTIVE_TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 30_000,
} as const;
const IMPORT_ROW_TIMEOUT_MS = 45_000;
const IMPORT_UPLOAD_MAX_RETRIES = 2;
const IMPORT_UPLOAD_RETRY_BACKOFF_MS = 500;

export async function requireAdminSession() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized admin access.");
  }

  return session;
}

export async function getAdminDashboardStats() {
  const [
    questionCount,
    activeQuestionCount,
    yearlySeriesCount,
    activeYearlySeriesCount,
    yearlyImageCount,
    sessionCount,
    leaderboardCount,
  ] =
    await Promise.all([
      prisma.question.count(),
      prisma.question.count({ where: { active: true } }),
      prisma.yearlySeries.count(),
      prisma.yearlySeries.count({ where: { active: true } }),
      prisma.yearlySeriesImage.count(),
      prisma.gameSession.count(),
      prisma.leaderboardEntry.count(),
    ]);

  return {
    questionCount,
    activeQuestionCount,
    yearlySeriesCount,
    activeYearlySeriesCount,
    yearlyImageCount,
    sessionCount,
    leaderboardCount,
  };
}

export async function getQuestionsForAdmin() {
  return prisma.question.findMany({
    include: {
      aliases: {
        orderBy: { createdAt: "asc" },
      },
      _count: {
        select: {
          attempts: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
}

type ParsedQuestionForm = {
  data: {
    canonicalTitle: string;
    aliases: string[];
    difficulty: Difficulty;
    tags: string[];
    active: boolean;
  };
  image:
    | {
        filename: string;
        contentType: string;
        buffer: Buffer;
      }
    | null;
};

function splitTextInput(value: string) {
  return value
    .split(/[\n,|]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toBoolean(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return false;
  }

  return value === "true" || value === "on" || value === "1";
}

function inferContentType(filename: string) {
  const lower = filename.toLowerCase();
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
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }

  return "application/octet-stream";
}

export async function parseQuestionFormData(
  formData: FormData,
  requireImage: boolean,
): Promise<ParsedQuestionForm> {
  const aliases = splitTextInput(String(formData.get("aliases") ?? ""));
  const tags = splitTextInput(String(formData.get("tags") ?? "")).map(normalizeTag);

  const parsed = questionFormSchema.safeParse({
    canonicalTitle: formData.get("canonicalTitle"),
    aliases,
    difficulty: String(formData.get("difficulty") ?? "MEDIUM").toUpperCase(),
    tags,
    active: toBoolean(formData.get("active")),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Question form validation failed.");
  }

  const imageEntry = formData.get("image");
  let image: ParsedQuestionForm["image"] = null;

  if (imageEntry instanceof File && imageEntry.size > 0) {
    image = {
      filename: imageEntry.name,
      contentType: imageEntry.type || inferContentType(imageEntry.name),
      buffer: Buffer.from(await imageEntry.arrayBuffer()),
    };
  }

  if (requireImage && !image) {
    throw new Error("Image is required when creating a question.");
  }

  return {
    data: parsed.data,
    image,
  };
}

export async function saveQuestion(
  input: ParsedQuestionForm,
  questionId?: string,
) {
  let uploaded:
    | {
        storageKey: string;
        publicUrl: string;
      }
    | undefined;

  if (input.image) {
    uploaded = await uploadQuestionImage(
      input.image.buffer,
      input.image.filename,
      input.image.contentType,
    );
  }

  const payload: Prisma.QuestionUncheckedCreateInput = {
    canonicalTitle: input.data.canonicalTitle,
    normalizedCanonicalTitle: normalizeAnswer(input.data.canonicalTitle),
    difficulty: input.data.difficulty,
    tags: input.data.tags,
    active: input.data.active,
    imageUrl: uploaded?.publicUrl ?? "",
    imageStorageKey: uploaded?.storageKey ?? null,
  };

  if (questionId) {
    const existing = await prisma.question.findUnique({
      where: { id: questionId },
    });

    if (!existing) {
      throw new Error("Question to edit was not found.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const question = await tx.question.update({
        where: { id: questionId },
        data: {
          ...payload,
          imageUrl: uploaded?.publicUrl ?? existing.imageUrl,
          imageStorageKey: uploaded?.storageKey ?? existing.imageStorageKey,
        },
      });

      await tx.questionAlias.deleteMany({
        where: { questionId },
      });

      if (input.data.aliases.length > 0) {
        await tx.questionAlias.createMany({
          data: input.data.aliases.map((alias) => ({
            questionId,
            alias,
            normalizedAlias: normalizeAnswer(alias),
          })),
          skipDuplicates: true,
        });
      }

      return question;
    }, INTERACTIVE_TX_OPTIONS);

    return updated;
  }

  return prisma.question.create({
    data: {
      ...payload,
      aliases: {
        create: input.data.aliases.map((alias) => ({
          alias,
          normalizedAlias: normalizeAnswer(alias),
        })),
      },
    },
  });
}

export async function deleteQuestion(questionId: string) {
  const existing = await prisma.question.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      imageStorageKey: true,
      _count: {
        select: {
          attempts: true,
        },
      },
    },
  });

  if (!existing) {
    throw new Error("Question to delete was not found.");
  }

  if (existing._count.attempts > 0) {
    throw new Error("This question has attempts and cannot be deleted directly. Please disable it first.");
  }

  await prisma.question.delete({
    where: { id: questionId },
  });

  try {
    await deleteQuestionImage(existing.imageStorageKey);
  } catch (error) {
    console.error("Failed to delete question image", error);
  }
}

type ImportResult = {
  imported: number;
  errors: Array<{
    row: number;
    message: string;
  }>;
};

function mapDifficulty(value: "easy" | "medium" | "hard") {
  switch (value) {
    case "easy":
      return Difficulty.EASY;
    case "medium":
      return Difficulty.MEDIUM;
    case "hard":
      return Difficulty.HARD;
  }
}

function resolveZipFile(zip: JSZip, filename: string) {
  const direct = zip.file(filename);
  if (direct) {
    return direct;
  }

  const normalized = filename.replace(/\\/g, "/").toLowerCase();
  return zip
    .filter((path, entry) => !entry.dir && path.toLowerCase() === normalized)
    .at(0);
}

function normalizeZipLookupKey(filename: string) {
  return filename.replace(/\\/g, "/").replace(/^\/+/, "").trim().toLowerCase();
}

function buildZipFileLookup(zip: JSZip) {
  const lookup = new Map<string, JSZip.JSZipObject>();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    lookup.set(normalizeZipLookupKey(path), entry);
  }
  return lookup;
}

function resolveZipFileFast(
  zip: JSZip,
  filename: string,
  lookup: Map<string, JSZip.JSZipObject>,
) {
  const normalized = normalizeZipLookupKey(filename);
  const hit = lookup.get(normalized);
  if (hit) {
    return hit;
  }
  return resolveZipFile(zip, filename);
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
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function isRetryableImportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|timeout|timed out|socket/i.test(message);
}

async function uploadQuestionImageWithRetry(
  buffer: Buffer,
  filename: string,
  contentType: string,
) {
  const maxAttempts = IMPORT_UPLOAD_MAX_RETRIES + 1;
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await uploadQuestionImage(buffer, filename, contentType);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxAttempts && isRetryableImportError(error);
      if (!canRetry) {
        throw error;
      }
      await delay(IMPORT_UPLOAD_RETRY_BACKOFF_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Image upload failed.");
}

export async function importQuestionsFromArchive(file: File): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
  const zipLookup = buildZipFileLookup(zip);
  const csvFile =
    zip.file("questions.csv") ??
    zip
      .filter((path, entry) => !entry.dir && path.toLowerCase().endsWith("/questions.csv"))
      .at(0);

  if (!csvFile) {
    throw new Error("questions.csv is missing in the ZIP archive.");
  }

  const rows = parseCsv(await csvFile.async("string"));
  const seenTitles = new Set<string>();
  const uploadedByHash = new Map<
    string,
    {
      storageKey: string;
      publicUrl: string;
    }
  >();
  const errors: ImportResult["errors"] = [];
  let imported = 0;

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const parsed = importRowSchema.safeParse(row);

    if (!parsed.success) {
      errors.push({
        row: rowNumber,
        message: parsed.error.issues[0]?.message ?? "CSV row validation failed.",
      });
      continue;
    }

    const normalizedTitle = normalizeAnswer(parsed.data.canonical_title);
    if (seenTitles.has(normalizedTitle)) {
      errors.push({
        row: rowNumber,
        message: "Duplicate canonical title found in the same import package.",
      });
      continue;
    }
    seenTitles.add(normalizedTitle);

    const zipImage = resolveZipFileFast(zip, parsed.data.image_filename, zipLookup);
    if (!zipImage) {
      errors.push({
        row: rowNumber,
        message: `鎵句笉鍒板浘鐗囨枃浠讹細${parsed.data.image_filename}`,
      });
      continue;
    }

    try {
      const imageBuffer = Buffer.from(await zipImage.async("uint8array"));
      const contentType = inferContentType(parsed.data.image_filename);
      const fileHash = createHash("sha256").update(imageBuffer).digest("hex");
      let uploaded = uploadedByHash.get(fileHash);

      if (!uploaded) {
        uploaded = await withTimeout(
          uploadQuestionImageWithRetry(imageBuffer, parsed.data.image_filename, contentType),
          IMPORT_ROW_TIMEOUT_MS,
          `Import row ${rowNumber} image upload timed out`,
        );
        uploadedByHash.set(fileHash, uploaded);
      }

      const aliases = parsed.data.aliases
        ? parsed.data.aliases
            .split("|")
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
      const tags = parsed.data.tags
        ? parsed.data.tags
            .split("|")
            .map((item) => normalizeTag(item))
            .filter(Boolean)
        : [];

      await prisma.$transaction(async (tx) => {
        const question = await tx.question.upsert({
          where: { normalizedCanonicalTitle: normalizedTitle },
          update: {
            canonicalTitle: parsed.data.canonical_title,
            normalizedCanonicalTitle: normalizedTitle,
            imageUrl: uploaded.publicUrl,
            imageStorageKey: uploaded.storageKey,
            difficulty: mapDifficulty(parsed.data.difficulty),
            tags,
            active: parsed.data.active === "true",
          },
          create: {
            canonicalTitle: parsed.data.canonical_title,
            normalizedCanonicalTitle: normalizedTitle,
            imageUrl: uploaded.publicUrl,
            imageStorageKey: uploaded.storageKey,
            difficulty: mapDifficulty(parsed.data.difficulty),
            tags,
            active: parsed.data.active === "true",
          },
        });

        await tx.questionAlias.deleteMany({
          where: { questionId: question.id },
        });

        if (aliases.length > 0) {
          await tx.questionAlias.createMany({
            data: aliases.map((alias) => ({
              questionId: question.id,
              alias,
              normalizedAlias: normalizeAnswer(alias),
            })),
            skipDuplicates: true,
          });
        }
      }, INTERACTIVE_TX_OPTIONS);

      imported += 1;
    } catch (error) {
      errors.push({
        row: rowNumber,
        message: error instanceof Error ? error.message : "Unknown error while importing this row.",
      });
    }
  }

  return {
    imported,
    errors,
  };
}
