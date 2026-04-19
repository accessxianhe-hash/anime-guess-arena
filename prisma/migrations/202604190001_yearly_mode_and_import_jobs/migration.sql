-- Create enums
CREATE TYPE "GameMode" AS ENUM ('CLASSIC', 'YEARLY');
CREATE TYPE "YearlyImportJobStatus" AS ENUM ('PENDING', 'RUNNING', 'PAUSED', 'FAILED', 'COMPLETED');
CREATE TYPE "YearlyImportItemStatus" AS ENUM ('PENDING', 'IMPORTED', 'SKIPPED', 'FAILED');

-- Alter game_session
ALTER TABLE "GameSession"
ADD COLUMN "mode" "GameMode" NOT NULL DEFAULT 'CLASSIC',
ADD COLUMN "selectedYears" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "lastServedYear" INTEGER;

-- Alter answer_attempt
ALTER TABLE "AnswerAttempt"
ADD COLUMN "mode" "GameMode" NOT NULL DEFAULT 'CLASSIC',
ADD COLUMN "turnKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN "yearlySeriesId" TEXT,
ADD COLUMN "yearlySeriesImageId" TEXT,
ADD COLUMN "selectedOption" TEXT;

ALTER TABLE "AnswerAttempt"
ALTER COLUMN "questionId" DROP NOT NULL;

UPDATE "AnswerAttempt"
SET "turnKey" = "questionId"
WHERE "turnKey" = '';

DROP INDEX "AnswerAttempt_sessionId_questionId_key";
CREATE UNIQUE INDEX "AnswerAttempt_sessionId_turnKey_key" ON "AnswerAttempt"("sessionId", "turnKey");
CREATE INDEX "AnswerAttempt_sessionId_mode_answeredAt_idx" ON "AnswerAttempt"("sessionId", "mode", "answeredAt");

-- Alter leaderboard_entry
ALTER TABLE "LeaderboardEntry"
ADD COLUMN "mode" "GameMode" NOT NULL DEFAULT 'CLASSIC';

DROP INDEX "LeaderboardEntry_scope_dateKey_normalizedNickname_key";
CREATE UNIQUE INDEX "LeaderboardEntry_scope_mode_dateKey_normalizedNickname_key"
  ON "LeaderboardEntry"("scope", "mode", "dateKey", "normalizedNickname");

DROP INDEX "LeaderboardEntry_scope_dateKey_score_durationMs_idx";
CREATE INDEX "LeaderboardEntry_scope_mode_dateKey_score_durationMs_idx"
  ON "LeaderboardEntry"("scope", "mode", "dateKey", "score" DESC, "durationMs");

-- Create yearly series tables
CREATE TABLE "YearlySeries" (
  "id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "normalizedTitle" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "studios" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "authors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "YearlySeries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "YearlySeries_year_normalizedTitle_key" ON "YearlySeries"("year", "normalizedTitle");
CREATE INDEX "YearlySeries_year_active_idx" ON "YearlySeries"("year", "active");

CREATE TABLE "YearlySeriesImage" (
  "id" TEXT NOT NULL,
  "seriesId" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "imageStorageKey" TEXT,
  "sourcePath" TEXT,
  "sourceFileName" TEXT,
  "fileHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "YearlySeriesImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "YearlySeriesImage_seriesId_fileHash_key" ON "YearlySeriesImage"("seriesId", "fileHash");
CREATE INDEX "YearlySeriesImage_seriesId_idx" ON "YearlySeriesImage"("seriesId");

-- Create import job tables
CREATE TABLE "YearlyImportJob" (
  "id" TEXT NOT NULL,
  "status" "YearlyImportJobStatus" NOT NULL DEFAULT 'PENDING',
  "archiveName" TEXT NOT NULL,
  "totalItems" INTEGER NOT NULL DEFAULT 0,
  "processedItems" INTEGER NOT NULL DEFAULT 0,
  "importedItems" INTEGER NOT NULL DEFAULT 0,
  "errorItems" INTEGER NOT NULL DEFAULT 0,
  "cursor" INTEGER NOT NULL DEFAULT 0,
  "summary" JSONB,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "YearlyImportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "YearlyImportJob_status_updatedAt_idx" ON "YearlyImportJob"("status", "updatedAt");

CREATE TABLE "YearlyImportItem" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "itemIndex" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "seriesTitle" TEXT NOT NULL,
  "normalizedSeriesTitle" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileHash" TEXT,
  "status" "YearlyImportItemStatus" NOT NULL DEFAULT 'PENDING',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "YearlyImportItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "YearlyImportItem_jobId_itemIndex_key" ON "YearlyImportItem"("jobId", "itemIndex");
CREATE INDEX "YearlyImportItem_jobId_status_itemIndex_idx" ON "YearlyImportItem"("jobId", "status", "itemIndex");

-- Foreign keys
ALTER TABLE "AnswerAttempt"
ADD CONSTRAINT "AnswerAttempt_yearlySeriesId_fkey"
FOREIGN KEY ("yearlySeriesId") REFERENCES "YearlySeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AnswerAttempt"
ADD CONSTRAINT "AnswerAttempt_yearlySeriesImageId_fkey"
FOREIGN KEY ("yearlySeriesImageId") REFERENCES "YearlySeriesImage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "YearlySeriesImage"
ADD CONSTRAINT "YearlySeriesImage_seriesId_fkey"
FOREIGN KEY ("seriesId") REFERENCES "YearlySeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "YearlyImportItem"
ADD CONSTRAINT "YearlyImportItem_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "YearlyImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
