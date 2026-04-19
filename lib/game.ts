import {
  Difficulty,
  GameMode,
  GameSessionStatus,
  LeaderboardScope,
  Prisma,
} from "@prisma/client";

import {
  APP_TIMEZONE,
  GAME_DURATION_SECONDS,
  YEARLY_CORRECT_SCORE,
  YEARLY_GAME_DURATION_SECONDS,
  YEARLY_SWITCH_YEAR_PROBABILITY,
} from "@/lib/constants";
import {
  calculateQuestionScore,
  normalizeAnswer,
  normalizeNickname,
} from "@/lib/answers";
import { calculateAccuracy, calculateDurationMs } from "@/lib/leaderboard";
import { prisma } from "@/lib/prisma";
import { buildQuestionImageSrc } from "@/lib/question-images";
import { toDateKey } from "@/lib/timezone";

const INTERACTIVE_TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 30_000,
} as const;

const YEARLY_QUEUE_SIZE = 6;
const YEARLY_OPTION_COUNT = 4;

type GameClient = Prisma.TransactionClient | typeof prisma;

type StartModeInput = {
  mode: "classic" | "yearly";
  years: number[];
};

type SessionSummary = {
  sessionId: string;
  mode: "CLASSIC" | "YEARLY";
  selectedYears: number[];
  status: GameSessionStatus;
  score: number;
  correctCount: number;
  answeredCount: number;
  startedAt: string;
  expiresAt: string;
  finishedAt: string | null;
  accuracy: number;
  serverNow: string;
};

type BaseQuestionCard = {
  id: string;
  mode: "CLASSIC" | "YEARLY";
  imageUrl: string;
  difficulty: Difficulty;
  tags: string[];
};

type ClassicQuestionCard = BaseQuestionCard & {
  mode: "CLASSIC";
};

type YearlyQuestionCard = BaseQuestionCard & {
  mode: "YEARLY";
  year: number;
  options: string[];
};

type QuestionCard = ClassicQuestionCard | YearlyQuestionCard;

type AnswerResult = {
  acceptedAnswer: string;
  isCorrect: boolean;
  scoreAwarded: number;
  skipped: boolean;
};

type GameSessionRecord = {
  id: string;
  mode: GameMode;
  selectedYears: number[];
  status: GameSessionStatus;
  score: number;
  correctCount: number;
  answeredCount: number;
  startedAt: Date;
  expiresAt: Date;
  finishedAt: Date | null;
};

type ClassicQuestionPayload = {
  id: string;
  canonicalTitle: string;
  normalizedCanonicalTitle: string;
  imageUrl: string;
  imageStorageKey: string | null;
  difficulty: Difficulty;
  tags: string[];
};

type YearlyImagePayload = {
  id: string;
  imageUrl: string;
  imageStorageKey: string | null;
  series: {
    id: string;
    year: number;
    title: string;
    normalizedTitle: string;
    tags: string[];
    studios: string[];
    authors: string[];
  };
};

type SimilarSeriesPayload = {
  id: string;
  year: number;
  title: string;
  tags: string[];
  studios: string[];
  authors: string[];
};

function shuffle<T>(items: T[]) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function pickRandom<T>(items: T[]) {
  if (items.length === 0) {
    return null;
  }

  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function normalizeYears(years: number[]) {
  return Array.from(new Set(years.map((year) => Number(year)))).sort((a, b) => a - b);
}

function buildSummary(session: GameSessionRecord): SessionSummary {
  return {
    sessionId: session.id,
    mode: session.mode,
    selectedYears: session.selectedYears,
    status: session.status,
    score: session.score,
    correctCount: session.correctCount,
    answeredCount: session.answeredCount,
    startedAt: session.startedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    finishedAt: session.finishedAt?.toISOString() ?? null,
    accuracy: calculateAccuracy(session.correctCount, session.answeredCount),
    serverNow: new Date().toISOString(),
  };
}

function mapClassicQuestion(question: ClassicQuestionPayload): ClassicQuestionCard {
  return {
    id: question.id,
    mode: "CLASSIC",
    imageUrl: buildQuestionImageSrc(question.imageStorageKey, question.imageUrl),
    difficulty: question.difficulty,
    tags: question.tags,
  };
}

function mapYearlyQuestion(
  image: YearlyImagePayload,
  options: string[],
): YearlyQuestionCard {
  return {
    id: image.id,
    mode: "YEARLY",
    imageUrl: buildQuestionImageSrc(image.imageStorageKey, image.imageUrl),
    difficulty: Difficulty.MEDIUM,
    year: image.series.year,
    tags: [
      `year-${image.series.year}`,
      ...image.series.tags.slice(0, 6),
      ...image.series.studios.slice(0, 2),
    ],
    options,
  };
}

function wasSkippedAttempt(attempt: {
  submittedAnswer: string;
  isCorrect: boolean;
  scoreAwarded: number;
}) {
  return (
    attempt.submittedAnswer.trim().length === 0 &&
    !attempt.isCorrect &&
    attempt.scoreAwarded === 0
  );
}

function similarityScore(
  source: { tags: string[]; studios: string[]; authors: string[]; year: number },
  target: { tags: string[]; studios: string[]; authors: string[]; year: number },
) {
  const setScore = (left: string[], right: string[]) => {
    if (left.length === 0 || right.length === 0) {
      return 0;
    }
    const rightSet = new Set(right.map((value) => value.toLowerCase()));
    return left.reduce((score, value) => {
      return score + (rightSet.has(value.toLowerCase()) ? 1 : 0);
    }, 0);
  };

  const tagScore = setScore(source.tags, target.tags) * 2;
  const studioScore = setScore(source.studios, target.studios) * 3;
  const authorScore = setScore(source.authors, target.authors) * 3;
  const yearScore = source.year === target.year ? 2 : 0;

  return tagScore + studioScore + authorScore + yearScore;
}

async function buildYearlyOptions(
  client: GameClient,
  image: YearlyImagePayload,
  selectedYears: number[],
) {
  const localCandidates = await client.yearlySeries.findMany({
    where: {
      active: true,
      year: { in: selectedYears },
      id: { not: image.series.id },
    },
    select: {
      id: true,
      year: true,
      title: true,
      tags: true,
      studios: true,
      authors: true,
    },
    take: 240,
  });

  const globalCandidates =
    localCandidates.length >= YEARLY_OPTION_COUNT - 1
      ? []
      : await client.yearlySeries.findMany({
          where: {
            active: true,
            id: { not: image.series.id },
          },
          select: {
            id: true,
            year: true,
            title: true,
            tags: true,
            studios: true,
            authors: true,
          },
          take: 120,
        });

  const merged = [...localCandidates, ...globalCandidates];
  const scored = merged
    .map((candidate) => ({
      ...candidate,
      score: similarityScore(image.series, candidate),
      randomness: Math.random(),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.randomness - right.randomness;
    });

  const distractors: string[] = [];
  const usedTitles = new Set<string>([image.series.title.toLowerCase()]);

  for (const candidate of scored) {
    const key = candidate.title.trim().toLowerCase();
    if (!key || usedTitles.has(key)) {
      continue;
    }

    distractors.push(candidate.title);
    usedTitles.add(key);

    if (distractors.length >= YEARLY_OPTION_COUNT - 1) {
      break;
    }
  }

  if (distractors.length < YEARLY_OPTION_COUNT - 1) {
    const placeholders = ["未知作品A", "未知作品B", "未知作品C"];
    for (const label of placeholders) {
      if (distractors.length >= YEARLY_OPTION_COUNT - 1) {
        break;
      }
      distractors.push(label);
    }
  }

  return shuffle([image.series.title, ...distractors.slice(0, YEARLY_OPTION_COUNT - 1)]);
}

async function getClassicAvailableQuestions(
  client: GameClient,
  sessionId: string,
) {
  const candidates = await client.question.findMany({
    where: {
      active: true,
      attempts: {
        none: {
          sessionId,
        },
      },
    },
    select: {
      id: true,
      canonicalTitle: true,
      normalizedCanonicalTitle: true,
      imageUrl: true,
      imageStorageKey: true,
      difficulty: true,
      tags: true,
    },
  });

  return shuffle(candidates);
}

function chooseTargetYear(selectedYears: number[], lastYear: number | null) {
  if (selectedYears.length === 1) {
    return selectedYears[0]!;
  }

  if (lastYear === null) {
    return pickRandom(selectedYears);
  }

  const differentYears = selectedYears.filter((year) => year !== lastYear);
  if (differentYears.length === 0) {
    return lastYear;
  }

  if (Math.random() < YEARLY_SWITCH_YEAR_PROBABILITY) {
    return pickRandom(differentYears);
  }

  return pickRandom(selectedYears);
}

async function pickYearlyImageByYear(
  client: GameClient,
  sessionId: string,
  year: number,
  excludeImageIds: string[],
) {
  const rows = await client.yearlySeriesImage.findMany({
    where: {
      id: excludeImageIds.length > 0 ? { notIn: excludeImageIds } : undefined,
      series: {
        active: true,
        year,
      },
      attempts: {
        none: {
          sessionId,
        },
      },
    },
    select: {
      id: true,
      imageUrl: true,
      imageStorageKey: true,
      series: {
        select: {
          id: true,
          year: true,
          title: true,
          normalizedTitle: true,
          tags: true,
          studios: true,
          authors: true,
        },
      },
    },
    take: 60,
  });

  return pickRandom(rows);
}

async function drawYearlyQuestion(
  client: GameClient,
  input: {
    sessionId: string;
    selectedYears: number[];
    lastYear: number | null;
    excludeImageIds: string[];
  },
) {
  const targetYear = chooseTargetYear(input.selectedYears, input.lastYear);
  const fallbackYears = shuffle(
    input.selectedYears.filter((year) => year !== targetYear),
  );
  const probeYears = [targetYear, ...fallbackYears].filter(
    (value): value is number => typeof value === "number",
  );

  let pickedImage: YearlyImagePayload | null = null;
  for (const year of probeYears) {
    pickedImage = await pickYearlyImageByYear(
      client,
      input.sessionId,
      year,
      input.excludeImageIds,
    );
    if (pickedImage) {
      break;
    }
  }

  if (!pickedImage) {
    return null;
  }

  const options = await buildYearlyOptions(client, pickedImage, input.selectedYears);
  return {
    question: mapYearlyQuestion(pickedImage, options),
    year: pickedImage.series.year,
  };
}

async function drawYearlyQuestionBatch(
  client: GameClient,
  input: {
    sessionId: string;
    selectedYears: number[];
    initialLastYear: number | null;
    count: number;
    protectedIds?: string[];
  },
) {
  const questions: YearlyQuestionCard[] = [];
  let lastYear = input.initialLastYear;
  const reserved = new Set<string>(input.protectedIds ?? []);

  for (let index = 0; index < input.count; index += 1) {
    const next = await drawYearlyQuestion(client, {
      sessionId: input.sessionId,
      selectedYears: input.selectedYears,
      lastYear,
      excludeImageIds: Array.from(reserved),
    });

    if (!next) {
      break;
    }

    reserved.add(next.question.id);
    questions.push(next.question);
    lastYear = next.year;
  }

  return { questions, lastYear };
}

export async function startGameSession(startInput: StartModeInput) {
  const mode = startInput.mode === "yearly" ? GameMode.YEARLY : GameMode.CLASSIC;
  const normalizedYears = normalizeYears(startInput.years);
  const durationSeconds =
    mode === GameMode.YEARLY ? YEARLY_GAME_DURATION_SECONDS : GAME_DURATION_SECONDS;
  const expiresAt = new Date(Date.now() + durationSeconds * 1000);

  if (mode === GameMode.YEARLY && normalizedYears.length === 0) {
    throw new Error("年份模式至少选择一个年份");
  }

  const session = await prisma.gameSession.create({
    data: {
      mode,
      selectedYears: mode === GameMode.YEARLY ? normalizedYears : [],
      expiresAt,
    },
  });

  if (mode === GameMode.CLASSIC) {
    const [question, ...queuedQuestions] = await getClassicAvailableQuestions(
      prisma,
      session.id,
    );

    if (!question) {
      throw new Error("未能抽取题目，请稍后再试。");
    }

    return {
      session: buildSummary(session),
      question: mapClassicQuestion(question),
      queuedQuestions: queuedQuestions.map(mapClassicQuestion),
    };
  }

  const { questions, lastYear } = await drawYearlyQuestionBatch(prisma, {
    sessionId: session.id,
    selectedYears: normalizedYears,
    initialLastYear: null,
    count: YEARLY_QUEUE_SIZE + 1,
  });

  const [firstQuestion, ...queuedQuestions] = questions;
  if (!firstQuestion) {
    throw new Error("所选年份暂时没有可用题目，请先导入年份题库。");
  }

  const updatedSession =
    typeof lastYear === "number"
      ? await prisma.gameSession.update({
          where: { id: session.id },
          data: { lastServedYear: lastYear },
        })
      : session;

  return {
    session: buildSummary(updatedSession),
    question: firstQuestion,
    queuedQuestions,
  };
}

export async function listYearlyAvailableYears() {
  const rows = await prisma.yearlySeries.findMany({
    where: { active: true },
    distinct: ["year"],
    select: { year: true },
    orderBy: { year: "desc" },
  });

  return rows
    .map((row) => row.year)
    .filter((year) => Number.isInteger(year));
}

async function resolveClassicTurn(
  session: GameSessionRecord,
  questionId: string,
  submittedAnswer: string,
  skipped: boolean,
  protectedQuestionIds: string[],
) {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: {
      aliases: {
        select: {
          normalizedAlias: true,
        },
      },
    },
  });

  if (!question || !question.active) {
    throw new Error("题目不存在或已下架。");
  }

  const normalizedSubmittedAnswer = skipped ? "" : normalizeAnswer(submittedAnswer);
  const isCorrect =
    !skipped &&
    (normalizedSubmittedAnswer === question.normalizedCanonicalTitle ||
      question.aliases.some((alias) => alias.normalizedAlias === normalizedSubmittedAnswer));
  const scoreAwarded = isCorrect ? calculateQuestionScore(question.difficulty) : 0;
  const reservedQuestionIds = Array.from(new Set([questionId, ...protectedQuestionIds]));

  try {
    const [, nextSession] = await prisma.$transaction([
      prisma.answerAttempt.create({
        data: {
          mode: GameMode.CLASSIC,
          turnKey: question.id,
          sessionId: session.id,
          questionId: question.id,
          submittedAnswer,
          normalizedSubmittedAnswer,
          isCorrect,
          scoreAwarded,
        },
      }),
      prisma.gameSession.update({
        where: { id: session.id },
        data: {
          score: { increment: scoreAwarded },
          correctCount: { increment: isCorrect ? 1 : 0 },
          answeredCount: { increment: skipped ? 0 : 1 },
        },
      }),
    ]);

    let updatedSession = nextSession;
    if (
      updatedSession.status === GameSessionStatus.ACTIVE &&
      reservedQuestionIds.length === 1
    ) {
      updatedSession = await prisma.gameSession.update({
        where: { id: session.id },
        data: {
          status: GameSessionStatus.COMPLETED,
          finishedAt: new Date(),
        },
      });
    }

    const result: AnswerResult = {
      acceptedAnswer: question.canonicalTitle,
      isCorrect,
      scoreAwarded,
      skipped,
    };

    return {
      session: buildSummary(updatedSession),
      result,
      nextQuestion: null,
      queuedQuestion: null,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const [existingAttempt, currentSession] = await Promise.all([
        prisma.answerAttempt.findUnique({
          where: {
            sessionId_turnKey: {
              sessionId: session.id,
              turnKey: question.id,
            },
          },
          include: {
            question: {
              select: {
                canonicalTitle: true,
              },
            },
          },
        }),
        prisma.gameSession.findUnique({
          where: { id: session.id },
        }),
      ]);

      if (!existingAttempt || !currentSession) {
        throw error;
      }

      return {
        session: buildSummary(currentSession),
        result: {
          acceptedAnswer: existingAttempt.question?.canonicalTitle ?? "",
          isCorrect: existingAttempt.isCorrect,
          scoreAwarded: existingAttempt.scoreAwarded,
          skipped: wasSkippedAttempt(existingAttempt),
        },
        nextQuestion: null,
        queuedQuestion: null,
      };
    }

    throw error;
  }
}

async function resolveYearlyTurn(
  session: GameSessionRecord,
  imageId: string,
  submittedAnswer: string,
  skipped: boolean,
  protectedQuestionIds: string[],
) {
  const image = await prisma.yearlySeriesImage.findUnique({
    where: { id: imageId },
    select: {
      id: true,
      imageUrl: true,
      imageStorageKey: true,
      series: {
        select: {
          id: true,
          year: true,
          title: true,
          normalizedTitle: true,
          tags: true,
          studios: true,
          authors: true,
          active: true,
        },
      },
    },
  });

  if (!image || !image.series.active) {
    throw new Error("年份题目不存在或已下架。");
  }

  const normalizedSubmittedAnswer = skipped ? "" : normalizeAnswer(submittedAnswer);
  const isCorrect = !skipped && normalizedSubmittedAnswer === image.series.normalizedTitle;
  const scoreAwarded = isCorrect ? YEARLY_CORRECT_SCORE : 0;

  try {
    const [, nextSession] = await prisma.$transaction([
      prisma.answerAttempt.create({
        data: {
          mode: GameMode.YEARLY,
          turnKey: image.id,
          sessionId: session.id,
          yearlySeriesId: image.series.id,
          yearlySeriesImageId: image.id,
          selectedOption: skipped ? null : submittedAnswer,
          submittedAnswer,
          normalizedSubmittedAnswer,
          isCorrect,
          scoreAwarded,
        },
      }),
      prisma.gameSession.update({
        where: { id: session.id },
        data: {
          score: { increment: scoreAwarded },
          correctCount: { increment: isCorrect ? 1 : 0 },
          answeredCount: { increment: skipped ? 0 : 1 },
        },
      }),
    ]);

    const next = await drawYearlyQuestion(prisma, {
      sessionId: session.id,
      selectedYears: session.selectedYears,
      lastYear: nextSession.lastServedYear ?? image.series.year,
      excludeImageIds: [image.id, ...protectedQuestionIds],
    });

    const updatedSession = next
      ? await prisma.gameSession.update({
          where: { id: session.id },
          data: {
            lastServedYear: next.year,
          },
        })
      : await prisma.gameSession.update({
          where: { id: session.id },
          data: {
            status: GameSessionStatus.COMPLETED,
            finishedAt: new Date(),
          },
        });

    const result: AnswerResult = {
      acceptedAnswer: image.series.title,
      isCorrect,
      scoreAwarded,
      skipped,
    };

    return {
      session: buildSummary(updatedSession),
      result,
      nextQuestion: null,
      queuedQuestion: next?.question ?? null,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const [existingAttempt, currentSession] = await Promise.all([
        prisma.answerAttempt.findUnique({
          where: {
            sessionId_turnKey: {
              sessionId: session.id,
              turnKey: image.id,
            },
          },
          include: {
            yearlySeries: {
              select: { title: true },
            },
          },
        }),
        prisma.gameSession.findUnique({
          where: { id: session.id },
        }),
      ]);

      if (!existingAttempt || !currentSession) {
        throw error;
      }

      return {
        session: buildSummary(currentSession),
        result: {
          acceptedAnswer: existingAttempt.yearlySeries?.title ?? "",
          isCorrect: existingAttempt.isCorrect,
          scoreAwarded: existingAttempt.scoreAwarded,
          skipped: wasSkippedAttempt(existingAttempt),
        },
        nextQuestion: null,
        queuedQuestion: null,
      };
    }

    throw error;
  }
}

async function resolveQuestionTurn(
  sessionId: string,
  questionId: string,
  submittedAnswer: string,
  skipped: boolean,
  protectedQuestionIds: string[],
) {
  const existingSession = await prisma.gameSession.findUnique({
    where: { id: sessionId },
  });

  if (!existingSession) {
    throw new Error("答题会话不存在。");
  }

  const now = Date.now();
  const expired = now >= existingSession.expiresAt.getTime();
  const session =
    existingSession.status === GameSessionStatus.ACTIVE && expired
      ? await prisma.gameSession.update({
          where: { id: sessionId },
          data: {
            status: GameSessionStatus.EXPIRED,
            finishedAt: new Date(),
          },
        })
      : existingSession;

  if (session.status !== GameSessionStatus.ACTIVE) {
    return {
      session: buildSummary(session),
      result: null,
      nextQuestion: null,
      queuedQuestion: null,
    };
  }

  if (session.mode === GameMode.CLASSIC) {
    return resolveClassicTurn(
      session,
      questionId,
      submittedAnswer,
      skipped,
      protectedQuestionIds,
    );
  }

  return resolveYearlyTurn(
    session,
    questionId,
    submittedAnswer,
    skipped,
    protectedQuestionIds,
  );
}

export async function submitAnswer(
  sessionId: string,
  questionId: string,
  answer: string,
  protectedQuestionIds: string[],
) {
  return resolveQuestionTurn(
    sessionId,
    questionId,
    answer,
    false,
    protectedQuestionIds,
  );
}

export async function skipQuestion(
  sessionId: string,
  questionId: string,
  protectedQuestionIds: string[],
) {
  return resolveQuestionTurn(
    sessionId,
    questionId,
    "",
    true,
    protectedQuestionIds,
  );
}

export async function finishGameSession(sessionId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.gameSession.findUnique({
      where: { id: sessionId },
    });

    if (!existing) {
      throw new Error("答题会话不存在。");
    }

    if (existing.status !== GameSessionStatus.ACTIVE) {
      return buildSummary(existing);
    }

    const now = new Date();
    const finished = await tx.gameSession.update({
      where: { id: sessionId },
      data: {
        status:
          now.getTime() >= existing.expiresAt.getTime()
            ? GameSessionStatus.EXPIRED
            : GameSessionStatus.COMPLETED,
        finishedAt: now,
      },
    });

    return buildSummary(finished);
  }, INTERACTIVE_TX_OPTIONS);
}

export async function submitLeaderboardEntry(sessionId: string, nickname: string) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.gameSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error("答题会话不存在。");
    }

    const finalizedSession =
      session.status === GameSessionStatus.ACTIVE
        ? await tx.gameSession.update({
            where: { id: sessionId },
            data: {
              status:
                Date.now() >= session.expiresAt.getTime()
                  ? GameSessionStatus.EXPIRED
                  : GameSessionStatus.COMPLETED,
              finishedAt: new Date(),
            },
          })
        : session;

    const finishedAt = finalizedSession.finishedAt ?? finalizedSession.expiresAt;
    const normalizedNickname = normalizeNickname(nickname);
    const dailyKey = toDateKey(finishedAt, APP_TIMEZONE);
    const accuracy = calculateAccuracy(
      finalizedSession.correctCount,
      finalizedSession.answeredCount,
    );
    const durationMs = calculateDurationMs(
      finalizedSession.startedAt,
      finishedAt,
      finalizedSession.expiresAt,
    );

    const existingEntries = await tx.leaderboardEntry.findMany({
      where: { sessionId },
    });

    if (existingEntries.length > 0) {
      return existingEntries;
    }

    const dailyExisting = await tx.leaderboardEntry.findUnique({
      where: {
        scope_mode_dateKey_normalizedNickname: {
          scope: LeaderboardScope.DAILY,
          mode: finalizedSession.mode,
          dateKey: dailyKey,
          normalizedNickname,
        },
      },
    });

    if (
      !dailyExisting ||
      finalizedSession.score > dailyExisting.score ||
      (finalizedSession.score === dailyExisting.score &&
        durationMs < dailyExisting.durationMs)
    ) {
      await tx.leaderboardEntry.upsert({
        where: {
          scope_mode_dateKey_normalizedNickname: {
            scope: LeaderboardScope.DAILY,
            mode: finalizedSession.mode,
            dateKey: dailyKey,
            normalizedNickname,
          },
        },
        update: {
          nickname,
          score: finalizedSession.score,
          correctCount: finalizedSession.correctCount,
          answeredCount: finalizedSession.answeredCount,
          accuracy,
          durationMs,
          sessionId,
        },
        create: {
          scope: LeaderboardScope.DAILY,
          mode: finalizedSession.mode,
          dateKey: dailyKey,
          nickname,
          normalizedNickname,
          score: finalizedSession.score,
          correctCount: finalizedSession.correctCount,
          answeredCount: finalizedSession.answeredCount,
          accuracy,
          durationMs,
          sessionId,
        },
      });
    }

    await tx.leaderboardEntry.create({
      data: {
        scope: LeaderboardScope.ALL_TIME,
        mode: finalizedSession.mode,
        dateKey: null,
        nickname,
        normalizedNickname,
        score: finalizedSession.score,
        correctCount: finalizedSession.correctCount,
        answeredCount: finalizedSession.answeredCount,
        accuracy,
        durationMs,
        sessionId,
      },
    });

    await tx.gameSession.update({
      where: { id: sessionId },
      data: {
        submittedAt: new Date(),
      },
    });

    return tx.leaderboardEntry.findMany({
      where: { sessionId },
      orderBy: [{ scope: "asc" }],
    });
  }, INTERACTIVE_TX_OPTIONS);
}
