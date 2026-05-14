import { GameSessionStatus } from "@prisma/client";

import { APP_TIMEZONE, LEADERBOARD_LIMIT } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { buildQuestionImageSrc } from "@/lib/question-images";
import { toDateKey, toWeekKey } from "@/lib/timezone";

type ReactionScope = "daily" | "weekly";
type ReactionTargetKind = "classic" | "yearly";

type ReactionTargetId = {
  kind: ReactionTargetKind;
  id: string;
};

export type ChallengeSeriesOption = {
  id: string;
  kind: ReactionTargetKind;
  title: string;
  year: number | null;
};

export type ChallengeImageOption = {
  id: string;
  kind: ReactionTargetKind;
  seriesId: string;
  title: string;
  year: number | null;
  imageUrl: string;
};

export type ReactionLeaderboardEntry = {
  id: string;
  title: string;
  year: number | null;
  imageUrl?: string;
  count: number;
};

function buildReactionKeys(date = new Date()) {
  return {
    dateKey: toDateKey(date, APP_TIMEZONE),
    weekKey: toWeekKey(date, APP_TIMEZONE),
  };
}

function encodeReactionId(kind: ReactionTargetKind, id: string) {
  return `${kind}:${id}`;
}

function decodeReactionId(value: string): ReactionTargetId | null {
  const [kind, ...rest] = value.split(":");
  const id = rest.join(":");
  if ((kind !== "classic" && kind !== "yearly") || !id) {
    return null;
  }

  return { kind, id };
}

function voteSeriesId(vote: { questionId: string | null; yearlySeriesId: string | null }) {
  if (vote.questionId) {
    return encodeReactionId("classic", vote.questionId);
  }
  if (vote.yearlySeriesId) {
    return encodeReactionId("yearly", vote.yearlySeriesId);
  }
  return null;
}

function voteImageId(vote: { questionId: string | null; yearlySeriesImageId: string | null }) {
  if (vote.questionId) {
    return encodeReactionId("classic", vote.questionId);
  }
  if (vote.yearlySeriesImageId) {
    return encodeReactionId("yearly", vote.yearlySeriesImageId);
  }
  return null;
}

async function getFinishedSession(sessionId: string) {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true },
  });

  if (!session) {
    throw new Error("Challenge session does not exist.");
  }

  if (session.status === GameSessionStatus.ACTIVE) {
    throw new Error("Challenge reactions can only be submitted after the run ends.");
  }

  return session;
}

async function getAttemptOptions(sessionId: string) {
  const attempts = await prisma.answerAttempt.findMany({
    where: {
      sessionId,
      OR: [
        { questionId: { not: null } },
        {
          yearlySeriesId: { not: null },
          yearlySeriesImageId: { not: null },
        },
      ],
    },
    orderBy: { answeredAt: "asc" },
    include: {
      question: {
        select: {
          id: true,
          canonicalTitle: true,
          imageUrl: true,
          imageStorageKey: true,
        },
      },
      yearlySeries: {
        select: {
          id: true,
          title: true,
          year: true,
        },
      },
      yearlySeriesImage: {
        select: {
          id: true,
          imageUrl: true,
          imageStorageKey: true,
        },
      },
    },
  });

  const series = new Map<string, ChallengeSeriesOption>();
  const images = new Map<string, ChallengeImageOption>();

  for (const attempt of attempts) {
    if (attempt.question) {
      const id = encodeReactionId("classic", attempt.question.id);
      if (!series.has(id)) {
        series.set(id, {
          id,
          kind: "classic",
          title: attempt.question.canonicalTitle,
          year: null,
        });
      }

      if (!images.has(id)) {
        images.set(id, {
          id,
          kind: "classic",
          seriesId: id,
          title: attempt.question.canonicalTitle,
          year: null,
          imageUrl: buildQuestionImageSrc(
            attempt.question.imageStorageKey,
            attempt.question.imageUrl,
          ),
        });
      }
    }

    const yearlySeries = attempt.yearlySeries;
    const yearlySeriesImage = attempt.yearlySeriesImage;
    if (!yearlySeries || !yearlySeriesImage) {
      continue;
    }

    const seriesId = encodeReactionId("yearly", yearlySeries.id);
    const imageId = encodeReactionId("yearly", yearlySeriesImage.id);
    if (!series.has(seriesId)) {
      series.set(seriesId, {
        id: seriesId,
        kind: "yearly",
        title: yearlySeries.title,
        year: yearlySeries.year,
      });
    }

    if (!images.has(imageId)) {
      images.set(imageId, {
        id: imageId,
        kind: "yearly",
        seriesId,
        title: yearlySeries.title,
        year: yearlySeries.year,
        imageUrl: buildQuestionImageSrc(
          yearlySeriesImage.imageStorageKey,
          yearlySeriesImage.imageUrl,
        ),
      });
    }
  }

  return {
    series: Array.from(series.values()),
    images: Array.from(images.values()),
  };
}

export async function getChallengeReactionOptions(sessionId: string) {
  await getFinishedSession(sessionId);

  const [{ series, images }, heartVotes, starVote] = await Promise.all([
    getAttemptOptions(sessionId),
    prisma.seriesHeartVote.findMany({
      where: { sessionId },
      select: { questionId: true, yearlySeriesId: true },
    }),
    prisma.imageStarVote.findUnique({
      where: { sessionId },
      select: { questionId: true, yearlySeriesImageId: true },
    }),
  ]);

  return {
    series,
    images,
    selectedSeriesIds: heartVotes
      .map((vote) => voteSeriesId(vote))
      .filter((id): id is string => Boolean(id)),
    selectedImageId: starVote ? voteImageId(starVote) : null,
  };
}

export async function submitChallengeReactions(
  sessionId: string,
  likedSeriesIds: string[],
  favoriteImageId: string | null,
) {
  await getFinishedSession(sessionId);
  const { series, images } = await getAttemptOptions(sessionId);
  const allowedSeriesIds = new Set(series.map((item) => item.id));
  const allowedImageIds = new Set(images.map((item) => item.id));

  const safeLikedSeriesIds = Array.from(new Set(likedSeriesIds)).filter((id) =>
    allowedSeriesIds.has(id),
  );
  const safeFavoriteImageId =
    favoriteImageId && allowedImageIds.has(favoriteImageId) ? favoriteImageId : null;
  const favoriteImage = safeFavoriteImageId
    ? images.find((item) => item.id === safeFavoriteImageId)
    : null;
  const { dateKey, weekKey } = buildReactionKeys();

  await prisma.$transaction(async (tx) => {
    await tx.seriesHeartVote.deleteMany({ where: { sessionId } });

    if (safeLikedSeriesIds.length > 0) {
      await tx.seriesHeartVote.createMany({
        data: safeLikedSeriesIds
          .map((optionId) => decodeReactionId(optionId))
          .filter((target): target is ReactionTargetId => Boolean(target))
          .map((target) => ({
            sessionId,
            questionId: target.kind === "classic" ? target.id : null,
            yearlySeriesId: target.kind === "yearly" ? target.id : null,
            dateKey,
            weekKey,
          })),
        skipDuplicates: true,
      });
    }

    if (favoriteImage) {
      const target = decodeReactionId(favoriteImage.id);
      const seriesTarget = decodeReactionId(favoriteImage.seriesId);
      if (target && seriesTarget) {
        await tx.imageStarVote.upsert({
          where: { sessionId },
          update: {
            questionId: target.kind === "classic" ? target.id : null,
            yearlySeriesId: seriesTarget.kind === "yearly" ? seriesTarget.id : null,
            yearlySeriesImageId: target.kind === "yearly" ? target.id : null,
            dateKey,
            weekKey,
          },
          create: {
            sessionId,
            questionId: target.kind === "classic" ? target.id : null,
            yearlySeriesId: seriesTarget.kind === "yearly" ? seriesTarget.id : null,
            yearlySeriesImageId: target.kind === "yearly" ? target.id : null,
            dateKey,
            weekKey,
          },
        });
      }
    } else {
      await tx.imageStarVote.deleteMany({ where: { sessionId } });
    }
  });

  return getChallengeReactionOptions(sessionId);
}

function scopeWhere(scope: ReactionScope) {
  const keys = buildReactionKeys();
  return scope === "daily" ? { dateKey: keys.dateKey } : { weekKey: keys.weekKey };
}

export async function getReactionLeaderboards(
  scope: ReactionScope,
  limit = LEADERBOARD_LIMIT,
) {
  const where = scopeWhere(scope);
  const [heartVotes, starVotes] = await Promise.all([
    prisma.seriesHeartVote.findMany({
      where,
      include: {
        question: {
          select: {
            id: true,
            canonicalTitle: true,
          },
        },
        yearlySeries: {
          select: {
            id: true,
            title: true,
            year: true,
          },
        },
      },
    }),
    prisma.imageStarVote.findMany({
      where,
      include: {
        question: {
          select: {
            id: true,
            canonicalTitle: true,
            imageUrl: true,
            imageStorageKey: true,
          },
        },
        yearlySeriesImage: {
          select: {
            id: true,
            imageUrl: true,
            imageStorageKey: true,
            series: {
              select: {
                title: true,
                year: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const heartCounts = new Map<string, ReactionLeaderboardEntry>();
  for (const vote of heartVotes) {
    const key = vote.questionId
      ? encodeReactionId("classic", vote.questionId)
      : vote.yearlySeriesId
        ? encodeReactionId("yearly", vote.yearlySeriesId)
        : null;
    if (!key) continue;

    const existing = heartCounts.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }

    if (vote.question) {
      heartCounts.set(key, {
        id: key,
        title: vote.question.canonicalTitle,
        year: null,
        count: 1,
      });
    } else if (vote.yearlySeries) {
      heartCounts.set(key, {
        id: key,
        title: vote.yearlySeries.title,
        year: vote.yearlySeries.year,
        count: 1,
      });
    }
  }

  const starCounts = new Map<string, ReactionLeaderboardEntry>();
  for (const vote of starVotes) {
    const key = vote.questionId
      ? encodeReactionId("classic", vote.questionId)
      : vote.yearlySeriesImageId
        ? encodeReactionId("yearly", vote.yearlySeriesImageId)
        : null;
    if (!key) continue;

    const existing = starCounts.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }

    if (vote.question) {
      starCounts.set(key, {
        id: key,
        title: vote.question.canonicalTitle,
        year: null,
        imageUrl: buildQuestionImageSrc(vote.question.imageStorageKey, vote.question.imageUrl),
        count: 1,
      });
    } else if (vote.yearlySeriesImage) {
      starCounts.set(key, {
        id: key,
        title: vote.yearlySeriesImage.series.title,
        year: vote.yearlySeriesImage.series.year,
        imageUrl: buildQuestionImageSrc(
          vote.yearlySeriesImage.imageStorageKey,
          vote.yearlySeriesImage.imageUrl,
        ),
        count: 1,
      });
    }
  }

  const sortEntries = (entries: ReactionLeaderboardEntry[]) =>
    entries.sort((left, right) => right.count - left.count || left.title.localeCompare(right.title));

  return {
    scope,
    hearts: sortEntries(Array.from(heartCounts.values())).slice(0, limit),
    stars: sortEntries(Array.from(starCounts.values())).slice(0, limit),
  };
}
