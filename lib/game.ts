import {
  Difficulty,
  GameSessionStatus,
  LeaderboardScope,
  Prisma,
} from "@prisma/client";

import { APP_TIMEZONE, GAME_DURATION_SECONDS } from "@/lib/constants";
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

type GameClient = Prisma.TransactionClient | typeof prisma;

type QuestionPayload = {
  id: string;
  canonicalTitle: string;
  imageUrl: string;
  imageStorageKey: string | null;
  difficulty: Difficulty;
  tags: string[];
};

type SessionSummary = {
  sessionId: string;
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

type AnswerResult = {
  acceptedAnswer: string;
  isCorrect: boolean;
  scoreAwarded: number;
  skipped: boolean;
};

type GameSessionRecord = {
  id: string;
  status: GameSessionStatus;
  score: number;
  correctCount: number;
  answeredCount: number;
  startedAt: Date;
  expiresAt: Date;
  finishedAt: Date | null;
};

function mapQuestion(question: QuestionPayload) {
  return {
    id: question.id,
    imageUrl: buildQuestionImageSrc(question.imageStorageKey, question.imageUrl),
    difficulty: question.difficulty,
    tags: question.tags,
  };
}

function buildSummary(session: GameSessionRecord): SessionSummary {
  return {
    sessionId: session.id,
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

async function getAvailableQuestions(
  client: GameClient,
  sessionId: string,
  take: number,
) {
  return client.question.findMany({
    where: {
      active: true,
      attempts: {
        none: {
          sessionId,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take,
    select: {
      id: true,
      canonicalTitle: true,
      imageUrl: true,
      imageStorageKey: true,
      difficulty: true,
      tags: true,
    },
  });
}

async function getQueuedQuestionReplacement(
  client: GameClient,
  sessionId: string,
  protectedQuestionIds: string[],
) {
  const [replacement] = await client.question.findMany({
    where: {
      active: true,
      id: {
        notIn: protectedQuestionIds,
      },
      attempts: {
        none: {
          sessionId,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 1,
    select: {
      id: true,
      canonicalTitle: true,
      imageUrl: true,
      imageStorageKey: true,
      difficulty: true,
      tags: true,
    },
  });

  return replacement ?? null;
}

export async function startGameSession() {
  const expiresAt = new Date(Date.now() + GAME_DURATION_SECONDS * 1000);
  const session = await prisma.gameSession.create({
    data: {
      expiresAt,
    },
  });

  const [question, ...queuedQuestions] = await getAvailableQuestions(
    prisma,
    session.id,
    7,
  );

  if (!question) {
    throw new Error("未能抽取题目，请稍后再试。");
  }

  return {
    session: buildSummary(session),
    question: mapQuestion(question),
    queuedQuestions: queuedQuestions.map(mapQuestion),
  };
}

async function resolveQuestionTurn(
  sessionId: string,
  questionId: string,
  submittedAnswer: string,
  skipped: boolean,
  protectedQuestionIds: string[],
) {
  const [existingSession, question] = await prisma.$transaction([
    prisma.gameSession.findUnique({
      where: { id: sessionId },
    }),
    prisma.question.findUnique({
      where: {
        id: questionId,
      },
      include: {
        aliases: {
          select: {
            normalizedAlias: true,
          },
        },
      },
    }),
  ]);

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

  if (!question || !question.active) {
    throw new Error("题目不存在或已下架。");
  }

  const normalizedSubmittedAnswer = skipped
    ? ""
    : normalizeAnswer(submittedAnswer);
  const isCorrect =
    !skipped &&
    (normalizedSubmittedAnswer === question.normalizedCanonicalTitle ||
      question.aliases.some(
        (alias) => alias.normalizedAlias === normalizedSubmittedAnswer,
      ));
  const scoreAwarded = isCorrect ? calculateQuestionScore(question.difficulty) : 0;
  const reservedQuestionIds = Array.from(
    new Set([questionId, ...protectedQuestionIds]),
  );

  try {
    const [[, nextSession], queuedReplacement] = await Promise.all([
      prisma.$transaction([
        prisma.answerAttempt.create({
          data: {
            sessionId,
            questionId,
            submittedAnswer,
            normalizedSubmittedAnswer,
            isCorrect,
            scoreAwarded,
          },
        }),
        prisma.gameSession.update({
          where: { id: sessionId },
          data: {
            score: { increment: scoreAwarded },
            correctCount: { increment: isCorrect ? 1 : 0 },
            answeredCount: { increment: skipped ? 0 : 1 },
          },
        }),
      ]),
      session.status === GameSessionStatus.ACTIVE
        ? getQueuedQuestionReplacement(prisma, sessionId, reservedQuestionIds)
        : Promise.resolve(null),
    ]);

    let updatedSession = nextSession;

    if (
      updatedSession.status === GameSessionStatus.ACTIVE &&
      protectedQuestionIds.length === 0 &&
      !queuedReplacement
    ) {
      updatedSession = await prisma.gameSession.update({
        where: { id: sessionId },
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
      queuedQuestion:
        updatedSession.status === GameSessionStatus.ACTIVE && queuedReplacement
          ? mapQuestion(queuedReplacement)
          : null,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const [existingAttempt, currentSession] = await Promise.all([
        prisma.answerAttempt.findUnique({
          where: {
            sessionId_questionId: {
              sessionId,
              questionId,
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
          where: { id: sessionId },
        }),
      ]);

      if (!existingAttempt) {
        throw error;
      }

      if (!currentSession) {
        throw new Error("答题会话不存在。");
      }

      const queuedReplacement =
        currentSession.status === GameSessionStatus.ACTIVE
          ? await getQueuedQuestionReplacement(
              prisma,
              sessionId,
              reservedQuestionIds,
            )
          : null;

      return {
        session: buildSummary(currentSession),
        result: {
          acceptedAnswer: existingAttempt.question.canonicalTitle,
          isCorrect: existingAttempt.isCorrect,
          scoreAwarded: existingAttempt.scoreAwarded,
          skipped: wasSkippedAttempt(existingAttempt),
        },
        nextQuestion: null,
        queuedQuestion:
          currentSession.status === GameSessionStatus.ACTIVE && queuedReplacement
            ? mapQuestion(queuedReplacement)
            : null,
      };
    }

    throw error;
  }
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
        scope_dateKey_normalizedNickname: {
          scope: LeaderboardScope.DAILY,
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
          scope_dateKey_normalizedNickname: {
            scope: LeaderboardScope.DAILY,
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
