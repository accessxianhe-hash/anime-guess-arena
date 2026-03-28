-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "GameSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LeaderboardScope" AS ENUM ('DAILY', 'ALL_TIME');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "canonicalTitle" TEXT NOT NULL,
    "normalizedCanonicalTitle" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "imageStorageKey" TEXT,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM',
    "tags" TEXT[] NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionAlias" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "status" "GameSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "score" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "answeredCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnswerAttempt" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "submittedAnswer" TEXT NOT NULL,
    "normalizedSubmittedAnswer" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "scoreAwarded" INTEGER NOT NULL DEFAULT 0,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardEntry" (
    "id" TEXT NOT NULL,
    "scope" "LeaderboardScope" NOT NULL,
    "dateKey" TEXT,
    "nickname" TEXT NOT NULL,
    "normalizedNickname" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "answeredCount" INTEGER NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderboardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Question_normalizedCanonicalTitle_key" ON "Question"("normalizedCanonicalTitle");

-- CreateIndex
CREATE INDEX "Question_active_difficulty_idx" ON "Question"("active", "difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionAlias_questionId_normalizedAlias_key" ON "QuestionAlias"("questionId", "normalizedAlias");

-- CreateIndex
CREATE INDEX "GameSession_status_expiresAt_idx" ON "GameSession"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerAttempt_sessionId_questionId_key" ON "AnswerAttempt"("sessionId", "questionId");

-- CreateIndex
CREATE INDEX "AnswerAttempt_sessionId_answeredAt_idx" ON "AnswerAttempt"("sessionId", "answeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardEntry_scope_sessionId_key" ON "LeaderboardEntry"("scope", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardEntry_scope_dateKey_normalizedNickname_key" ON "LeaderboardEntry"("scope", "dateKey", "normalizedNickname");

-- CreateIndex
CREATE INDEX "LeaderboardEntry_scope_dateKey_score_durationMs_idx" ON "LeaderboardEntry"("scope", "dateKey", "score" DESC, "durationMs");

-- AddForeignKey
ALTER TABLE "QuestionAlias" ADD CONSTRAINT "QuestionAlias_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerAttempt" ADD CONSTRAINT "AnswerAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerAttempt" ADD CONSTRAINT "AnswerAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
