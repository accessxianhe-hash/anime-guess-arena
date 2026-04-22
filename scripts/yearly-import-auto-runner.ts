import { YearlyImportJobStatus } from "@prisma/client";

import { createRouteLogger } from "@/lib/observability";
import {
  continueYearlyImportJob,
  listYearlyImportJobs,
  retryFailedYearlyImportItems,
} from "@/lib/yearly-import";

type RunnerConfig = {
  batchSize: number;
  maxBatches: number;
  maxJobsPerRun: number;
  retryFailed: boolean;
  resumePaused: boolean;
  runningCooldownMs: number;
};

function parsePositiveInt(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function parseBoolean(raw: string | undefined, fallback: boolean) {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function readConfig(): RunnerConfig {
  return {
    batchSize: Math.max(20, Math.min(300, parsePositiveInt(process.env.AUTO_IMPORT_BATCH_SIZE, 180))),
    maxBatches: Math.max(1, Math.min(5, parsePositiveInt(process.env.AUTO_IMPORT_MAX_BATCHES, 3))),
    maxJobsPerRun: Math.max(1, Math.min(8, parsePositiveInt(process.env.AUTO_IMPORT_MAX_JOBS, 3))),
    retryFailed: parseBoolean(process.env.AUTO_IMPORT_RETRY_FAILED, true),
    resumePaused: parseBoolean(process.env.AUTO_IMPORT_RESUME_PAUSED, false),
    runningCooldownMs: Math.max(
      0,
      Math.min(300_000, parsePositiveInt(process.env.AUTO_IMPORT_RUNNING_COOLDOWN_MS, 15_000)),
    ),
  };
}

async function main() {
  const logger = createRouteLogger({
    module: "scripts.yearly-import-auto-runner",
    requestId: `runner-${Date.now()}`,
  });
  const config = readConfig();

  logger.info("yearlyImport.autoRunner.started", config);

  const jobs = await listYearlyImportJobs(40);
  if (jobs.length === 0) {
    logger.info("yearlyImport.autoRunner.noJobs");
    return;
  }

  const now = Date.now();
  const candidates = jobs
    .filter((job) => {
      if (job.status === YearlyImportJobStatus.COMPLETED) return false;
      if (job.status === YearlyImportJobStatus.PAUSED && !config.resumePaused) return false;
      if (job.status === YearlyImportJobStatus.RUNNING) {
        const updatedAt = new Date(job.updatedAt).getTime();
        if (Number.isFinite(updatedAt) && now - updatedAt < config.runningCooldownMs) {
          return false;
        }
      }
      return true;
    })
    .slice(0, config.maxJobsPerRun);

  if (candidates.length === 0) {
    logger.info("yearlyImport.autoRunner.noEligibleJobs", {
      totalJobs: jobs.length,
      runningCooldownMs: config.runningCooldownMs,
      resumePaused: config.resumePaused,
    });
    return;
  }

  for (const job of candidates) {
    logger.info("yearlyImport.autoRunner.job.start", {
      jobId: job.id,
      status: job.status,
      totalItems: job.totalItems,
      processedItems: job.processedItems,
      errorItems: job.errorItems,
    });

    try {
      const continued = await continueYearlyImportJob(job.id, {
        batchSize: config.batchSize,
        maxBatches: config.maxBatches,
      });

      logger.info("yearlyImport.autoRunner.job.continued", {
        jobId: continued.id,
        status: continued.status,
        processedItems: continued.processedItems,
        importedItems: continued.importedItems,
        errorItems: continued.errorItems,
      });

      if (config.retryFailed && continued.errorItems > 0) {
        const retryResult = await retryFailedYearlyImportItems(continued.id);
        if (retryResult.retriedCount > 0) {
          logger.warn("yearlyImport.autoRunner.job.retryFailed.triggered", {
            jobId: continued.id,
            retriedCount: retryResult.retriedCount,
          });

          const afterRetry = await continueYearlyImportJob(continued.id, {
            batchSize: config.batchSize,
            maxBatches: 1,
          });

          logger.info("yearlyImport.autoRunner.job.afterRetryContinue", {
            jobId: afterRetry.id,
            status: afterRetry.status,
            processedItems: afterRetry.processedItems,
            importedItems: afterRetry.importedItems,
            errorItems: afterRetry.errorItems,
          });
        }
      }
    } catch (error) {
      logger.error("yearlyImport.autoRunner.job.failed", {
        jobId: job.id,
        error,
      });
    }
  }

  logger.info("yearlyImport.autoRunner.finished", {
    scannedJobs: jobs.length,
    eligibleJobs: candidates.length,
  });
}

main().catch((error) => {
  const logger = createRouteLogger({
    module: "scripts.yearly-import-auto-runner",
    requestId: `runner-fatal-${Date.now()}`,
  });
  logger.error("yearlyImport.autoRunner.crashed", { error });
  process.exitCode = 1;
});
