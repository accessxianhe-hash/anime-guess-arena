import {
  Difficulty,
  GameSessionStatus,
  LeaderboardScope,
  type Prisma,
} from "@prisma/client";

import { APP_TIMEZONE, GAME_DURATION_SECONDS } from "@/lib/constants";
import {
  calculateQuestionScore,
  normalizeAnswer,
  normalizeNickname,
} from "@/lib/answers";
import { calculateAccuracy, calculateDurationMs } from "@/lib/leaderboard";
import { prisma } from "@/lib/prisma";
import { toDateKey } from "@/lib/timezone";

type QuestionPayload = {
  id: string;
  canonicalTitle: string;
  imageUrl: string;
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
};

function mapQuestion(question: QuestionPayload) {
  return {
    id: question.id,
    imageUrl: question.imageUrl,
    difficulty: question.difficulty,
    tags: question.tags,
  };
}

function buildSummary(
  session: {
    id: string;
    status: GameSessionStatus;
    score: number;
    correctCount: number;
    answeredCount: number;
    startedAt: Date;
    expiresAt: Date;
    finishedAt: Date | null;
  },
): SessionSummary {
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

async function getAvailableQuestion(
  tx: Prisma.TransactionClient,
  sessionId: string,
) {
  const attempts = await tx.answerAttempt.findMany({
    where: { sessionId },
    select: { questionId: true },
  });

  const excludedIds = attempts.map((attempt) => attempt.questionId);

  const candidates = await tx.question.findMany({
    where: {
      active: true,
      id: {
        notIn: excludedIds,
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      canonicalTitle: true,
      imageUrl: true,
      difficulty: true,
      tags: true,
    },
  });

  if (candidates.length === 0) {
    return null;
  }

  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

export async function startGameSession() {
  return prisma.$transaction(async (tx) => {
    const firstQuestion = await tx.question.findFirst({
      where: { active: true },
      select: { id: true },
    });

    if (!firstQuestion) {
      throw new Error("当前没有可用题目，请先在后台添加题目。");
    }

    const expiresAt = new Date(Date.now() + GAME_DURATION_SECONDS * 1000);
    const session = await tx.gameSession.create({
      data: {
        expiresAt,
      },
    });

    const question = await getAvailableQuestion(tx, session.id);
    if (!question) {
      throw new Error("未能抽取题目，请稍后再试。");
    }

    return {
      session: buildSummary(session),
      question: mapQuestion(question),
    };
  });
}

async function expireSessionIfNeeded(
  tx: Prisma.TransactionClient,
  sessionId: string,
) {
  const session = await tx.gameSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new Error("答题会话不存在。");
  }

  if (
    session.status === GameSessionStatus.ACTIVE &&
    Date.now() >= session.expiresAt.getTime()
  ) {
    return tx.gameSession.update({
      where: { id: sessionId },
      data: {
        status: GameSessionStatus.EXPIRED,
        finishedAt: new Date(),
      },
    });
  }

  return session;
}

export async function submitAnswer(
  sessionId: string,
  questionId: string,
  answer: string,
) {
  return prisma.$transaction(async (tx) => {
    const session = await expireSessionIfNeeded(tx, sessionId);
    if (session.status !== GameSessionStatus.ACTIVE) {
      return {
        session: buildSummary(session),
        result: null,
        nextQuestion: null,
      };
    }

    const existingAttempt = await tx.answerAttempt.findUnique({
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
    });

    if (existingAttempt) {
      return {
        session: buildSummary(session),
        result: {
          acceptedAnswer: existingAttempt.question.canonicalTitle,
          isCorrect: existingAttempt.isCorrect,
          scoreAwarded: existingAttempt.scoreAwarded,
        },
        nextQuestion: await getAvailableQuestion(tx, sessionId).then((next) =>
          next ? mapQuestion(next) : null,
        ),
      };
    }

    const question = await tx.question.findFirst({
      where: {
        id: questionId,
        active: true,
      },
      include: {
        aliases: true,
      },
    });

    if (!question) {
      throw new Error("题目不存在或已下架。");
    }

    const normalizedSubmittedAnswer = normalizeAnswer(answer);
    const isCorrect =
      normalizedSubmittedAnswer === question.normalizedCanonicalTitle ||
      question.aliases.some((alias) => alias.normalizedAlias === normalizedSubmittedAnswer);
    const scoreAwarded = isCorrect ? calculateQuestionScore(question.difficulty) : 0;

    await tx.answerAttempt.create({
      data: {
        sessionId,
        questionId,
        submittedAnswer: answer,
        normalizedSubmittedAnswer,
        isCorrect,
        scoreAwarded,
      },
    });

    const updatedSession = await tx.gameSession.update({
      where: { id: sessionId },
      data: {
        score: { increment: scoreAwarded },
        correctCount: { increment: isCorrect ? 1 : 0 },
        answeredCount: { increment: 1 },
      },
    });

    const nextQuestion = await getAvailableQuestion(tx, sessionId);
    const shouldFinish = !nextQuestion || Date.now() >= updatedSession.expiresAt.getTime();

    const finalizedSession = shouldFinish
      ? await tx.gameSession.update({
          where: { id: sessionId },
          data: {
            status:
              Date.now() >= updatedSession.expiresAt.getTime()
                ? GameSessionStatus.EXPIRED
                : GameSessionStatus.COMPLETED,
            finishedAt: new Date(),
          },
        })
      : updatedSession;

    const result: AnswerResult = {
      acceptedAnswer: question.canonicalTitle,
      isCorrect,
      scoreAwarded,
    };

    return {
      session: buildSummary(finalizedSession),
      result,
      nextQuestion:
        finalizedSession.status === GameSessionStatus.ACTIVE && nextQuestion
          ? mapQuestion(nextQuestion)
          : null,
    };
  });
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
  });
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
  });
}
