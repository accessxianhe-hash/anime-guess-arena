import { Difficulty, type Prisma } from "@prisma/client";
import JSZip from "jszip";

import { auth } from "@/auth";
import { parseCsv } from "@/lib/csv";
import { normalizeAnswer, normalizeTag } from "@/lib/answers";
import { prisma } from "@/lib/prisma";
import { deleteQuestionImage, uploadQuestionImage } from "@/lib/storage";
import { importRowSchema, questionFormSchema } from "@/lib/validators";

export async function requireAdminSession() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("未授权访问后台。");
  }

  return session;
}

export async function getAdminDashboardStats() {
  const [questionCount, activeQuestionCount, sessionCount, leaderboardCount] =
    await Promise.all([
      prisma.question.count(),
      prisma.question.count({ where: { active: true } }),
      prisma.gameSession.count(),
      prisma.leaderboardEntry.count(),
    ]);

  return {
    questionCount,
    activeQuestionCount,
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
    throw new Error(parsed.error.issues[0]?.message ?? "题目表单校验失败。");
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
    throw new Error("创建题目时必须上传截图。");
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
      throw new Error("要编辑的题目不存在。");
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
    });

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
    throw new Error("要删除的题目不存在。");
  }

  if (existing._count.attempts > 0) {
    throw new Error("该题目已经被对局使用，不能直接删除。请先下架。");
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

export async function importQuestionsFromArchive(file: File): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
  const csvFile =
    zip.file("questions.csv") ??
    zip
      .filter((path, entry) => !entry.dir && path.toLowerCase().endsWith("/questions.csv"))
      .at(0);

  if (!csvFile) {
    throw new Error("ZIP 包中缺少 questions.csv。");
  }

  const rows = parseCsv(await csvFile.async("string"));
  const seenTitles = new Set<string>();
  const errors: ImportResult["errors"] = [];
  let imported = 0;

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const parsed = importRowSchema.safeParse(row);

    if (!parsed.success) {
      errors.push({
        row: rowNumber,
        message: parsed.error.issues[0]?.message ?? "CSV 行格式错误。",
      });
      continue;
    }

    const normalizedTitle = normalizeAnswer(parsed.data.canonical_title);
    if (seenTitles.has(normalizedTitle)) {
      errors.push({
        row: rowNumber,
        message: "同一个导入包中存在重复作品名。",
      });
      continue;
    }
    seenTitles.add(normalizedTitle);

    const zipImage = resolveZipFile(zip, parsed.data.image_filename);
    if (!zipImage) {
      errors.push({
        row: rowNumber,
        message: `找不到图片文件：${parsed.data.image_filename}`,
      });
      continue;
    }

    try {
      const uploaded = await uploadQuestionImage(
        Buffer.from(await zipImage.async("uint8array")),
        parsed.data.image_filename,
        inferContentType(parsed.data.image_filename),
      );

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
      });

      imported += 1;
    } catch (error) {
      errors.push({
        row: rowNumber,
        message: error instanceof Error ? error.message : "导入本行时发生未知错误。",
      });
    }
  }

  return {
    imported,
    errors,
  };
}
