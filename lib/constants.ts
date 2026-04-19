import type { Difficulty } from "@prisma/client";

export const GAME_DURATION_SECONDS = 60;
export const YEARLY_GAME_DURATION_SECONDS = 90;
export const YEARLY_CORRECT_SCORE = 10;
export const YEARLY_SWITCH_YEAR_PROBABILITY = 0.7;
export const LEADERBOARD_LIMIT = 20;
export const HOME_PREVIEW_LIMIT = 5;
export const APP_TIMEZONE = process.env.APP_TIMEZONE ?? "Asia/Shanghai";

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  EASY: "简单",
  MEDIUM: "普通",
  HARD: "困难",
};

export const DIFFICULTY_POINTS: Record<Difficulty, number> = {
  EASY: 10,
  MEDIUM: 20,
  HARD: 30,
};

export const NICKNAME_MAX_LENGTH = 20;
