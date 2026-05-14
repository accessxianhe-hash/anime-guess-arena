-- CreateTable
CREATE TABLE "SeriesHeartVote" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "yearlySeriesId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeriesHeartVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageStarVote" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "yearlySeriesId" TEXT NOT NULL,
    "yearlySeriesImageId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageStarVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeriesHeartVote_sessionId_yearlySeriesId_key" ON "SeriesHeartVote"("sessionId", "yearlySeriesId");

-- CreateIndex
CREATE INDEX "SeriesHeartVote_dateKey_createdAt_idx" ON "SeriesHeartVote"("dateKey", "createdAt");

-- CreateIndex
CREATE INDEX "SeriesHeartVote_weekKey_createdAt_idx" ON "SeriesHeartVote"("weekKey", "createdAt");

-- CreateIndex
CREATE INDEX "SeriesHeartVote_yearlySeriesId_dateKey_idx" ON "SeriesHeartVote"("yearlySeriesId", "dateKey");

-- CreateIndex
CREATE INDEX "SeriesHeartVote_yearlySeriesId_weekKey_idx" ON "SeriesHeartVote"("yearlySeriesId", "weekKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImageStarVote_sessionId_key" ON "ImageStarVote"("sessionId");

-- CreateIndex
CREATE INDEX "ImageStarVote_dateKey_createdAt_idx" ON "ImageStarVote"("dateKey", "createdAt");

-- CreateIndex
CREATE INDEX "ImageStarVote_weekKey_createdAt_idx" ON "ImageStarVote"("weekKey", "createdAt");

-- CreateIndex
CREATE INDEX "ImageStarVote_yearlySeriesImageId_dateKey_idx" ON "ImageStarVote"("yearlySeriesImageId", "dateKey");

-- CreateIndex
CREATE INDEX "ImageStarVote_yearlySeriesImageId_weekKey_idx" ON "ImageStarVote"("yearlySeriesImageId", "weekKey");

-- AddForeignKey
ALTER TABLE "SeriesHeartVote" ADD CONSTRAINT "SeriesHeartVote_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeriesHeartVote" ADD CONSTRAINT "SeriesHeartVote_yearlySeriesId_fkey" FOREIGN KEY ("yearlySeriesId") REFERENCES "YearlySeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageStarVote" ADD CONSTRAINT "ImageStarVote_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageStarVote" ADD CONSTRAINT "ImageStarVote_yearlySeriesId_fkey" FOREIGN KEY ("yearlySeriesId") REFERENCES "YearlySeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageStarVote" ADD CONSTRAINT "ImageStarVote_yearlySeriesImageId_fkey" FOREIGN KEY ("yearlySeriesImageId") REFERENCES "YearlySeriesImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
