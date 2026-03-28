import type { Difficulty } from "@prisma/client";

import { DIFFICULTY_POINTS } from "@/lib/constants";

export function normalizeAnswer(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/[·・]/g, "")
    .replace(/['".,!?~`!@#$%^&*()_+=[\]{};:\\|<>/?\-]/g, "")
    .replace(/\s+/g, "");
}

export function normalizeTag(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

export function normalizeNickname(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, "");
}

export function splitPipeList(value: string) {
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function calculateQuestionScore(difficulty: Difficulty) {
  return DIFFICULTY_POINTS[difficulty];
}

export function isAnswerCorrect(
  submitted: string,
  canonicalTitle: string,
  aliases: string[],
) {
  const normalized = normalizeAnswer(submitted);
  if (!normalized) {
    return false;
  }

  const accepted = new Set([
    normalizeAnswer(canonicalTitle),
    ...aliases.map((alias) => normalizeAnswer(alias)),
  ]);

  return accepted.has(normalized);
}
