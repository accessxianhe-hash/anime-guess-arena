import { Difficulty } from "@prisma/client";
import { z } from "zod";

import { NICKNAME_MAX_LENGTH } from "@/lib/constants";

const controlCharacterRegex = /[\p{Cc}\p{Cf}]/u;
export const gameModeSchema = z.enum(["classic", "yearly"]).default("classic");

export const startGameSchema = z
  .object({
    mode: gameModeSchema.optional().default("classic"),
    years: z.array(z.number().int().min(1900).max(2100)).optional().default([]),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "yearly" && value.years.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "年份模式至少选择一个年份。",
        path: ["years"],
      });
    }
  });

export const answerQuestionSchema = z.object({
  sessionId: z.string().min(1),
  questionId: z.string().min(1),
  answer: z.string().trim().min(1).max(120),
  protectedQuestionIds: z.array(z.string().min(1)).max(64).optional().default([]),
  protectedSeriesIds: z.array(z.string().min(1)).max(64).optional().default([]),
});

export const skipQuestionSchema = z.object({
  sessionId: z.string().min(1),
  questionId: z.string().min(1),
  protectedQuestionIds: z.array(z.string().min(1)).max(64).optional().default([]),
  protectedSeriesIds: z.array(z.string().min(1)).max(64).optional().default([]),
});

export const finishGameSchema = z.object({
  sessionId: z.string().min(1),
});

export const submitChallengeReactionsSchema = z.object({
  sessionId: z.string().min(1),
  likedSeriesIds: z.array(z.string().min(1)).max(64).default([]),
  favoriteImageId: z.string().min(1).nullable().default(null),
});

export const reactionLeaderboardScopeSchema = z.enum(["daily", "weekly"]).default("daily");

export const submitLeaderboardSchema = z.object({
  sessionId: z.string().min(1),
  nickname: z
    .string()
    .trim()
    .min(1, "昵称不能为空")
    .max(NICKNAME_MAX_LENGTH, `昵称不能超过 ${NICKNAME_MAX_LENGTH} 个字符`)
    .refine((value) => !controlCharacterRegex.test(value), "昵称不能包含不可见字符"),
});

export const leaderboardScopeSchema = z.enum(["daily", "all_time"]).default("daily");
export const leaderboardModeSchema = gameModeSchema.default("classic");

export const questionFormSchema = z.object({
  canonicalTitle: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(120)).default([]),
  difficulty: z.nativeEnum(Difficulty),
  tags: z.array(z.string().trim().min(1).max(32)).default([]),
  active: z.boolean().default(true),
});

export const importRowSchema = z.object({
  image_filename: z.string().trim().min(1),
  canonical_title: z.string().trim().min(1),
  aliases: z.string().trim().optional().default(""),
  difficulty: z.enum(["easy", "medium", "hard"]),
  tags: z.string().trim().optional().default(""),
  active: z.enum(["true", "false"]).default("true"),
});
