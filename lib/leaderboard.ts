import { GameMode, LeaderboardScope, Prisma } from "@prisma/client";

import { APP_TIMEZONE, LEADERBOARD_LIMIT } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { toDateKey } from "@/lib/timezone";

export type LeaderboardView = "daily" | "all_time";
export type LeaderboardMode = "classic" | "yearly";

function toGameMode(mode: LeaderboardMode) {
  return mode === "yearly" ? GameMode.YEARLY : GameMode.CLASSIC;
}

export async function getLeaderboard(
  scope: LeaderboardView,
  mode: LeaderboardMode = "classic",
  limit = LEADERBOARD_LIMIT,
) {
  const gameMode = toGameMode(mode);
  const where: Prisma.LeaderboardEntryWhereInput =
    scope === "daily"
      ? {
          scope: LeaderboardScope.DAILY,
          mode: gameMode,
          dateKey: toDateKey(new Date(), APP_TIMEZONE),
        }
      : {
          scope: LeaderboardScope.ALL_TIME,
          mode: gameMode,
        };

  return prisma.leaderboardEntry.findMany({
    where,
    orderBy: [
      { score: "desc" },
      { durationMs: "asc" },
      { createdAt: "asc" },
    ],
    take: limit,
  });
}

export function calculateAccuracy(correctCount: number, answeredCount: number) {
  if (answeredCount === 0) {
    return 0;
  }

  return Number((correctCount / answeredCount).toFixed(4));
}

export function calculateDurationMs(startedAt: Date, finishedAt: Date, expiresAt: Date) {
  const end = Math.min(finishedAt.getTime(), expiresAt.getTime());
  return Math.max(0, end - startedAt.getTime());
}
