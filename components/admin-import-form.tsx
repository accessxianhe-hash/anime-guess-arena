"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type YearlyImportJob = {
  id: string;
  status: "PENDING" | "RUNNING" | "PAUSED" | "FAILED" | "COMPLETED";
  archiveName: string;
  totalItems: number;
  processedItems: number;
  importedItems: number;
  errorItems: number;
  cursor: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  summary: Record<string, unknown> | null;
};

type JobsResponse = {
  jobs?: YearlyImportJob[];
  error?: string;
};

type JobResponse = {
  job?: YearlyImportJob;
  error?: string;
};

type RetryFailedResponse = {
  job?: YearlyImportJob;
  retriedCount?: number;
  error?: string;
};

type ImportRuntimeProgress = {
  currentBatch: number;
  plannedBatches: number;
  currentBatchSize: number;
  currentBatchProcessed: number;
  remainingItems: number;
  remainingBatches: number;
  retryCount: number;
  retryErrorCount: number;
  staleRecoveries: number;
  lastProgressAt: string | null;
  lastAutoHealAt: string | null;
};

const POLL_INTERVAL_MS = 2500;

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function toNonNegativeInt(value: unknown, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function statusLabel(status: YearlyImportJob["status"]) {
  switch (status) {
    case "PENDING":
      return "等待中";
    case "RUNNING":
      return "运行中";
    case "PAUSED":
      return "已暂停";
    case "FAILED":
      return "已失败";
    case "COMPLETED":
      return "已完成";
    default:
      return status;
  }
}

function readImportRuntime(
  summary: Record<string, unknown> | null,
): ImportRuntimeProgress | null {
  if (!summary || typeof summary !== "object") return null;
  const raw = summary.importRuntime;
  if (!raw || typeof raw !== "object") return null;

  const runtime = raw as Record<string, unknown>;
  return {
    currentBatch: toNonNegativeInt(runtime.currentBatch),
    plannedBatches: toNonNegativeInt(runtime.plannedBatches),
    currentBatchSize: toNonNegativeInt(runtime.currentBatchSize),
    currentBatchProcessed: toNonNegativeInt(runtime.currentBatchProcessed),
    remainingItems: toNonNegativeInt(runtime.remainingItems),
    remainingBatches: toNonNegativeInt(runtime.remainingBatches),
    retryCount: toNonNegativeInt(runtime.retryCount),
    retryErrorCount: toNonNegativeInt(runtime.retryErrorCount),
    staleRecoveries: toNonNegativeInt(runtime.staleRecoveries),
    lastProgressAt:
      typeof runtime.lastProgressAt === "string" ? runtime.lastProgressAt : null,
    lastAutoHealAt:
      typeof runtime.lastAutoHealAt === "string"
        ? runtime.lastAutoHealAt
        : null,
  };
}

function ratioToPercent(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${Math.max(0, Math.min(100, safe * 100)).toFixed(1)}%`;
}

export function AdminImportForm() {
  const [jobs, setJobs] = useState<YearlyImportJob[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [batchSize, setBatchSize] = useState(120);
  const [maxBatches, setMaxBatches] = useState(1);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [exporting, setExporting] = useState<"failed" | "all" | null>(null);

  const pollingLockRef = useRef(false);

  const currentJob = useMemo(
    () => jobs.find((job) => job.id === currentJobId) ?? null,
    [jobs, currentJobId],
  );
  const currentRuntime = useMemo(
    () => readImportRuntime(currentJob?.summary ?? null),
    [currentJob?.summary],
  );

  const overallProgress = useMemo(() => {
    if (!currentJob || currentJob.totalItems <= 0) return 0;
    return currentJob.processedItems / currentJob.totalItems;
  }, [currentJob]);

  const batchProgress = useMemo(() => {
    if (!currentRuntime || currentRuntime.currentBatchSize <= 0) return 0;
    return currentRuntime.currentBatchProcessed / currentRuntime.currentBatchSize;
  }, [currentRuntime]);

  const upsertJob = useCallback((job: YearlyImportJob) => {
    setJobs((prev) => {
      const index = prev.findIndex((item) => item.id === job.id);
      if (index === -1) {
        return [job, ...prev];
      }
      const next = [...prev];
      next[index] = job;
      return next;
    });
  }, []);

  const fetchJobs = useCallback(
    async (keepCurrent = true) => {
      setLoadingJobs(true);
      try {
        const response = await fetch("/api/admin/yearly-import/jobs", {
          cache: "no-store",
        });
        const data = (await response.json()) as JobsResponse;
        if (!response.ok || !data.jobs) {
          throw new Error(data.error || "获取导入任务列表失败");
        }

        const nextJobs = data.jobs ?? [];
        setJobs(nextJobs);
        setCurrentJobId((prev) => {
          if (keepCurrent && prev && nextJobs.some((job) => job.id === prev)) {
            return prev;
          }
          return nextJobs[0]?.id ?? null;
        });
      } catch (fetchError) {
        setError(
          fetchError instanceof Error ? fetchError.message : "获取导入任务列表失败",
        );
      } finally {
        setLoadingJobs(false);
      }
    },
    [],
  );

  const fetchJob = useCallback(
    async (jobId: string) => {
      const response = await fetch(`/api/admin/yearly-import/jobs/${jobId}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as JobResponse;
      if (!response.ok || !data.job) {
        throw new Error(data.error || "获取导入任务详情失败");
      }
      upsertJob(data.job);
      return data.job;
    },
    [upsertJob],
  );

  useEffect(() => {
    void fetchJobs(false);
  }, [fetchJobs]);

  useEffect(() => {
    if (!currentJob || currentJob.status !== "RUNNING") return;

    const timer = window.setInterval(async () => {
      if (pollingLockRef.current) return;
      pollingLockRef.current = true;
      try {
        await fetchJob(currentJob.id);
      } catch (pollError) {
        setError(
          pollError instanceof Error
            ? pollError.message
            : "自动刷新任务状态失败",
        );
      } finally {
        pollingLockRef.current = false;
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [currentJob, fetchJob]);

  const handleCreateJob = useCallback(async () => {
    if (!archiveFile) {
      setError("请先选择 ZIP 文件");
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("archive", archiveFile);
      const response = await fetch("/api/admin/yearly-import/jobs", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as JobResponse;
      if (!response.ok || !data.job) {
        throw new Error(data.error || "创建导入任务失败");
      }

      upsertJob(data.job);
      setCurrentJobId(data.job.id);
      setMessage("导入任务已创建，可以继续导入。");
      setArchiveFile(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建导入任务失败");
    } finally {
      setSubmitting(false);
    }
  }, [archiveFile, upsertJob]);

  const handleContinue = useCallback(async () => {
    if (!currentJob) {
      setError("请先选择一个任务");
      return;
    }

    setContinuing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/yearly-import/jobs/${currentJob.id}/continue`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchSize, maxBatches }),
        },
      );
      const data = (await response.json()) as JobResponse;
      if (!response.ok || !data.job) {
        throw new Error(data.error || "继续导入失败");
      }

      upsertJob(data.job);
      setMessage("继续导入已执行。");
    } catch (continueError) {
      setError(continueError instanceof Error ? continueError.message : "继续导入失败");
    } finally {
      setContinuing(false);
    }
  }, [batchSize, currentJob, maxBatches, upsertJob]);

  const handlePause = useCallback(async () => {
    if (!currentJob) {
      setError("请先选择一个任务");
      return;
    }

    setPausing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/yearly-import/jobs/${currentJob.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      const data = (await response.json()) as JobResponse;
      if (!response.ok || !data.job) {
        throw new Error(data.error || "暂停导入失败");
      }

      upsertJob(data.job);
      setMessage("任务已暂停。");
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : "暂停导入失败");
    } finally {
      setPausing(false);
    }
  }, [currentJob, upsertJob]);

  const handleRetryFailed = useCallback(async () => {
    if (!currentJob) {
      setError("请先选择一个任务");
      return;
    }

    setRetryingFailed(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/yearly-import/jobs/${currentJob.id}/retry-failed`,
        { method: "POST" },
      );
      const data = (await response.json().catch(() => ({}))) as RetryFailedResponse;
      if (!response.ok || !data.job) {
        throw new Error(data.error || "重试失败项失败");
      }

      upsertJob(data.job);
      setMessage(
        (data.retriedCount ?? 0) > 0
          ? `已将 ${data.retriedCount ?? 0} 条失败项重置为待导入。`
          : "当前任务没有可重试的失败项。",
      );
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "重试失败项失败");
    } finally {
      setRetryingFailed(false);
    }
  }, [currentJob, upsertJob]);

  const handleExport = useCallback(
    async (scope: "failed" | "all") => {
      if (!currentJob) {
        setError("请先选择一个任务");
        return;
      }

      setExporting(scope);
      setError("");
      setMessage("");
      try {
        const response = await fetch(
          `/api/admin/yearly-import/jobs/${currentJob.id}/log?format=csv&scope=${scope}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "导出日志失败");
        }

        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = `yearly-import-${currentJob.id}-${scope}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(downloadUrl);

        setMessage(scope === "failed" ? "失败日志导出完成。" : "全部日志导出完成。");
      } catch (exportError) {
        setError(exportError instanceof Error ? exportError.message : "导出日志失败");
      } finally {
        setExporting(null);
      }
    },
    [currentJob],
  );

  return (
    <section className="panel stack" style={{ gap: 18 }}>
      <div className="stack" style={{ gap: 10 }}>
        <span className="eyebrow">Yearly Import Jobs</span>
        <h2 className="section-title">年份题库导入任务</h2>
        <p className="text-muted">
          上传年份 ZIP 后创建任务。运行中的任务会每 2.5 秒自动刷新，失败项可一键重试或导出日志。
        </p>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <label className="input-label" htmlFor="yearly-import-zip">
          ZIP 文件
        </label>
        <input
          id="yearly-import-zip"
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => setArchiveFile(event.target.files?.[0] ?? null)}
        />
        <button
          className="cta-primary"
          type="button"
          onClick={handleCreateJob}
          disabled={submitting}
        >
          {submitting ? "创建中..." : "创建导入任务"}
        </button>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            className="ghost-button"
            type="button"
            onClick={() => void fetchJobs(true)}
            disabled={loadingJobs}
          >
            {loadingJobs ? "刷新中..." : "刷新任务列表"}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={handleContinue}
            disabled={!currentJob || continuing}
          >
            {continuing ? "执行中..." : "继续导入一批"}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={handlePause}
            disabled={!currentJob || pausing || currentJob.status !== "RUNNING"}
          >
            {pausing ? "暂停中..." : "暂停任务"}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={handleRetryFailed}
            disabled={!currentJob || retryingFailed || (currentJob?.errorItems ?? 0) <= 0}
          >
            {retryingFailed ? "重置中..." : "重试失败项"}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => void handleExport("failed")}
            disabled={!currentJob || exporting !== null}
          >
            {exporting === "failed" ? "导出中..." : "导出失败日志 CSV"}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => void handleExport("all")}
            disabled={!currentJob || exporting !== null}
          >
            {exporting === "all" ? "导出中..." : "导出全部日志 CSV"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label className="input-label" htmlFor="batch-size">
            批大小
          </label>
          <input
            id="batch-size"
            type="number"
            min={20}
            max={300}
            value={batchSize}
            onChange={(event) =>
              setBatchSize(Math.max(20, Math.min(300, Number(event.target.value) || 120)))
            }
            style={{ width: 120 }}
          />
          <label className="input-label" htmlFor="max-batches">
            连续批次数
          </label>
          <input
            id="max-batches"
            type="number"
            min={1}
            max={5}
            value={maxBatches}
            onChange={(event) =>
              setMaxBatches(Math.max(1, Math.min(5, Number(event.target.value) || 1)))
            }
            style={{ width: 120 }}
          />
        </div>
      </div>

      {error ? <div className="message error">{error}</div> : null}
      {message ? <div className="message success">{message}</div> : null}

      <div className="stack" style={{ gap: 12 }}>
        <label className="input-label" htmlFor="job-selector">
          当前任务
        </label>
        <select
          id="job-selector"
          value={currentJobId ?? ""}
          onChange={(event) => setCurrentJobId(event.target.value || null)}
          disabled={jobs.length === 0}
        >
          {jobs.length === 0 ? <option value="">暂无任务</option> : null}
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.archiveName} [{statusLabel(job.status)}]
            </option>
          ))}
        </select>

        {currentJob ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="message" style={{ background: "#101a33", color: "#d6def2" }}>
              状态：{statusLabel(currentJob.status)}，已处理 {currentJob.processedItems}/
              {currentJob.totalItems}，导入 {currentJob.importedItems}，失败{" "}
              {currentJob.errorItems}
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div
                style={{
                  height: 10,
                  borderRadius: 999,
                  background: "rgba(148, 163, 184, 0.25)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: ratioToPercent(overallProgress),
                    height: "100%",
                    background: "linear-gradient(90deg, #38bdf8, #6366f1)",
                    transition: "width .25s ease",
                  }}
                />
              </div>
              <div className="text-muted" style={{ fontSize: "0.9rem" }}>
                总进度：{ratioToPercent(overallProgress)}（cursor: {currentJob.cursor}）
              </div>
            </div>

            {currentRuntime ? (
              <div className="message" style={{ background: "#0f172a", color: "#d6def2" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div>
                    当前批次：{currentRuntime.currentBatch}/
                    {Math.max(currentRuntime.plannedBatches, 1)}，批内进度{" "}
                    {currentRuntime.currentBatchProcessed}/
                    {Math.max(currentRuntime.currentBatchSize, 1)}（
                    {ratioToPercent(batchProgress)}）
                  </div>
                  <div>
                    剩余条目：{currentRuntime.remainingItems}，剩余批次：
                    {currentRuntime.remainingBatches}
                  </div>
                  <div>
                    错误重试计数：{currentRuntime.retryCount}，重试后仍失败：
                    {currentRuntime.retryErrorCount}
                  </div>
                  <div>自动自愈触发次数：{currentRuntime.staleRecoveries}</div>
                  <div style={{ fontSize: "0.86rem", opacity: 0.85 }}>
                    最近进度写回：{formatDateTime(currentRuntime.lastProgressAt)}，最近自愈：
                    {formatDateTime(currentRuntime.lastAutoHealAt)}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="text-muted" style={{ fontSize: "0.92rem" }}>
              创建时间：{formatDateTime(currentJob.createdAt)} | 更新时间：
              {formatDateTime(currentJob.updatedAt)} | 完成时间：
              {formatDateTime(currentJob.finishedAt)}
            </div>

            {currentJob.lastError ? (
              <div className="message error">最近错误：{currentJob.lastError}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

