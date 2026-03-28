import { hash } from "bcryptjs";
import { Difficulty } from "@prisma/client";

import { normalizeAnswer } from "@/lib/answers";
import { prisma } from "@/lib/prisma";

export async function seedAdminUser() {
  const email = (process.env.ADMIN_SEED_EMAIL || "admin@example.com").toLowerCase();
  const name = process.env.ADMIN_SEED_NAME || "Site Admin";
  const password = process.env.ADMIN_SEED_PASSWORD || "change-this-password";
  const passwordHash = await hash(password, 10);

  return prisma.adminUser.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
    },
    create: {
      email,
      name,
      passwordHash,
    },
  });
}

export async function seedDemoQuestions() {
  const demoQuestions = [
    {
      canonicalTitle: "火影忍者",
      imageUrl: "/demo/ninja-dawn.svg",
      imageStorageKey: "demo/ninja-dawn.svg",
      difficulty: Difficulty.EASY,
      tags: ["热血", "忍者"],
      aliases: ["Naruto", "NARUTO", "ナルト"],
    },
    {
      canonicalTitle: "海贼王",
      imageUrl: "/demo/ocean-dream.svg",
      imageStorageKey: "demo/ocean-dream.svg",
      difficulty: Difficulty.MEDIUM,
      tags: ["冒险", "海贼"],
      aliases: ["航海王", "One Piece", "ワンピース"],
    },
    {
      canonicalTitle: "进击的巨人",
      imageUrl: "/demo/wall-breaker.svg",
      imageStorageKey: "demo/wall-breaker.svg",
      difficulty: Difficulty.HARD,
      tags: ["战斗", "悬疑"],
      aliases: ["Attack on Titan", "AOT", "進撃の巨人"],
    },
  ];

  for (const question of demoQuestions) {
    const normalizedCanonicalTitle = normalizeAnswer(question.canonicalTitle);

    await prisma.$transaction(async (tx) => {
      const saved = await tx.question.upsert({
        where: {
          normalizedCanonicalTitle,
        },
        update: {
          canonicalTitle: question.canonicalTitle,
          normalizedCanonicalTitle,
          imageUrl: question.imageUrl,
          imageStorageKey: question.imageStorageKey,
          difficulty: question.difficulty,
          tags: question.tags,
          active: true,
        },
        create: {
          canonicalTitle: question.canonicalTitle,
          normalizedCanonicalTitle,
          imageUrl: question.imageUrl,
          imageStorageKey: question.imageStorageKey,
          difficulty: question.difficulty,
          tags: question.tags,
          active: true,
        },
      });

      await tx.questionAlias.deleteMany({
        where: {
          questionId: saved.id,
        },
      });

      await tx.questionAlias.createMany({
        data: question.aliases.map((alias) => ({
          questionId: saved.id,
          alias,
          normalizedAlias: normalizeAnswer(alias),
        })),
        skipDuplicates: true,
      });
    });
  }
}

export async function closeSeedClient() {
  await prisma.$disconnect();
}

