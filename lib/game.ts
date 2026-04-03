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

async function finalizeSessionAfterTurn(
  client: GameClient,
  session: GameSessionRecord,
  nextQuestion: QuestionPayload | null,
) {
  if (session.status !== GameSessionStatus.ACTIVE) {
    return session;
  }

  const expired = Date.now() >= session.expiresAt.getTime();
  if (!nextQuestion || expired) {
    return client.gameSession.update({
      where: { id: session.id },
      data: {
        status: expired
          ? GameSessionStatus.EXPIRED
          : GameSessionStatus.COMPLETED,
        finishedAt: new Date(),
      },
    });
  }

  return session;
}

async function expireSessionIfNeeded(
  client: GameClient,
  sessionId: string,
) {
  const session = await client.gameSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new Error("答题会话不存在。");
  }

  if (
    session.status === GameSessionStatus.ACTIVE &&
    Date.now() >= session.expiresAt.getTime()
  ) {
    return client.gameSession.update({
      where: { id: sessionId },
      data: {
        status: GameSessionStatus.EXPIRED,
        finishedAt: new Date(),
      },
    });
  }

  return session;
}

export async function startGameSession() {
  const expiresAt = new Date(Date.now() + GAME_DURATION_SECONDS * 1000);
  const session = await prisma.gameSession.create({
    data: {
      expiresAt,
    },
  });

  const [question, queuedQuestion] = await getAvailableQuestions(
    prisma,
    session.id,
    2,
  );
  if (!question) {
    throw new Error("未能抽取题目，请稍后再试。");
  }

  return {
    session: buildSummary(session),
    question: mapQuestion(question),
    queuedQuestion: queuedQuestion ? mapQuestion(queuedQuestion) : null,
  };
}

async function resolveQuestionTurn(
  sessionId: string,
  questionId: string,
  submittedAnswer: string,
  skipped: boolean,
) {
  const session = await expireSessionIfNeeded(prisma, sessionId);
  if (session.status !== GameSessionStatus.ACTIVE) {
    return {
      session: buildSummary(session),
      result: null,
      nextQuestion: null,
    };
  }

  const question = await prisma.question.findUnique({
    where: {
      id: questionId,
    },
    include: {
      aliases: true,
    },
  });

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

  try {
    await prisma.answerAttempt.create({
      data: {
        sessionId,
        questionId,
        submittedAnswer,
        normalizedSubmittedAnswer,
        isCorrect,
        scoreAwarded,
      },
    });
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

      const [nextQuestion, queuedQuestion] = await getAvailableQuestions(
        prisma,
        sessionId,
        2,
      );
      const finalizedSession = await finalizeSessionAfterTurn(
        prisma,
        currentSession,
        nextQuestion,
      );

      return {
        session: buildSummary(finalizedSession),
        result: {
          acceptedAnswer: existingAttempt.question.canonicalTitle,
          isCorrect: existingAttempt.isCorrect,
          scoreAwarded: existingAttempt.scoreAwarded,
          skipped: wasSkippedAttempt(existingAttempt),
        },
        nextQuestion:
          finalizedSession.status === GameSessionStatus.ACTIVE && nextQuestion
            ? mapQuestion(nextQuestion)
            : null,
        queuedQuestion:
          finalizedSession.status === GameSessionStatus.ACTIVE && queuedQuestion
            ? mapQuestion(queuedQuestion)
            : null,
      };
    }

    throw error;
  }

  const [updatedSession, upcomingQuestions] = await Promise.all([
    prisma.gameSession.update({
      where: { id: sessionId },
      data: {
        score: { increment: scoreAwarded },
        correctCount: { increment: isCorrect ? 1 : 0 },
        answeredCount: { increment: skipped ? 0 : 1 },
      },
    }),
    getAvailableQuestions(prisma, sessionId, 2),
  ]);
  const [nextQuestion, queuedQuestion] = upcomingQuestions;

  const finalizedSession = await finalizeSessionAfterTurn(
    prisma,
    updatedSession,
    nextQuestion,
  );

  const result: AnswerResult = {
    acceptedAnswer: question.canonicalTitle,
    isCorrect,
    scoreAwarded,
    skipped,
  };

  return {
    session: buildSummary(finalizedSession),
    result,
    nextQuestion:
      finalizedSession.status === GameSessionStatus.ACTIVE && nextQuestion
        ? mapQuestion(nextQuestion)
        : null,
    queuedQuestion:
      finalizedSession.status === GameSessionStatus.ACTIVE && queuedQuestion
        ? mapQuestion(queuedQuestion)
        : null,
  };
}

export async function submitAnswer(
  sessionId: string,
  questionId: string,
  answer: string,
) {
  return resolveQuestionTurn(sessionId, questionId, answer, false);
}

export async function skipQuestion(sessionId: string, questionId: string) {
  return resolveQuestionTurn(sessionId, questionId, "", true);
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
