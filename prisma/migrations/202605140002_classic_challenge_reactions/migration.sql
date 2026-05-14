-- Support reactions for classic-mode questions as well as yearly-mode series/images.
ALTER TABLE "SeriesHeartVote" ADD COLUMN "questionId" TEXT;
ALTER TABLE "SeriesHeartVote" ALTER COLUMN "yearlySeriesId" DROP NOT NULL;

ALTER TABLE "ImageStarVote" ADD COLUMN "questionId" TEXT;
ALTER TABLE "ImageStarVote" ALTER COLUMN "yearlySeriesId" DROP NOT NULL;
ALTER TABLE "ImageStarVote" ALTER COLUMN "yearlySeriesImageId" DROP NOT NULL;

CREATE UNIQUE INDEX "SeriesHeartVote_sessionId_questionId_key" ON "SeriesHeartVote"("sessionId", "questionId");

CREATE INDEX "SeriesHeartVote_questionId_dateKey_idx" ON "SeriesHeartVote"("questionId", "dateKey");
CREATE INDEX "SeriesHeartVote_questionId_weekKey_idx" ON "SeriesHeartVote"("questionId", "weekKey");

CREATE INDEX "ImageStarVote_questionId_dateKey_idx" ON "ImageStarVote"("questionId", "dateKey");
CREATE INDEX "ImageStarVote_questionId_weekKey_idx" ON "ImageStarVote"("questionId", "weekKey");

ALTER TABLE "SeriesHeartVote" ADD CONSTRAINT "SeriesHeartVote_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImageStarVote" ADD CONSTRAINT "ImageStarVote_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
