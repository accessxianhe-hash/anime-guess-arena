import { Difficulty } from "@prisma/client";
import { z } from "zod";

import { NICKNAME_MAX_LENGTH } from "@/lib/constants";

const nicknameRegex = /^[\p{Script=Han}\p{Letter}\p{Number}_-]{2,20}$/u;

export const startGameSchema = z.object({});

export const answerQuestionSchema = z.object({
  sessionId: z.string().min(1),
  questionId: z.string().min(1),
  answer: z.string().trim().min(1).max(120),
});

export const skipQuestionSchema = z.object({
  sessionId: z.string().min(1),
  questionId: z.string().min(1),
});

export const finishGameSchema = z.object({
  sessionId: z.string().min(1),
});

export const submitLeaderboardSchema = z.object({
  sessionId: z.string().min(1),
  nickname: z
    .string()
    .trim()
    .min(2, "昵称至少 2 个字符")
    .max(NICKNAME_MAX_LENGTH, `昵称不能超过 ${NICKNAME_MAX_LENGTH} 个字符`)
    .regex(nicknameRegex, "昵称仅支持中文、字母、数字、下划线和短横线"),
});

export const leaderboardScopeSchema = z.enum(["daily", "all_time"]).default("daily");

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
