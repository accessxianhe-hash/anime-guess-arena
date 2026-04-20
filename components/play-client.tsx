"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SubmitScoreForm } from "@/components/submit-score-form";

type SessionSummary = {
  sessionId: string;
  mode: "CLASSIC" | "YEARLY";
  selectedYears: number[];
  status: "ACTIVE" | "COMPLETED" | "EXPIRED";
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
  difficulty: "EASY" | "MEDIUM" | "HARD";
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
type CurrentQuestion = QuestionCard | null;

type FeedbackState = {
  acceptedAnswer: string;
  isCorrect: boolean;
  scoreAwarded: number;
  skipped: boolean;
} | null;

type TurnTask = {
  path: "/api/game/answer" | "/api/game/skip";
  body: Record<string, string | string[]>;
  immediateNextQuestion: CurrentQuestion;
  remainingQueue: QuestionCard[];
  previousQuestion: CurrentQuestion;
  previousAnswer: string;
  previousOption: string;
};

const MIN_FEEDBACK_MS = 90;
const NEXT_QUESTION_DELAY_MS = 0;
const IMAGE_READY_FALLBACK_MS = 1200;
const PREFETCH_LOOKAHEAD_COUNT = 3;

const difficultyText = {
  EASY: "简单",
  MEDIUM: "普通",
  HARD: "困难",
} as const;

export function PlayClient() {
  const [selectedMode, setSelectedMode] = useState<"classic" | "yearly">("classic");
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);

  const [session, setSession] = useState<SessionSummary | null>(null);
  const [question, setQuestion] = useState<CurrentQuestion>(null);
  const [questionQueue, setQuestionQueue] = useState<QuestionCard[]>([]);
  const [displayedImageSrc, setDisplayedImageSrc] = useState<string | null>(null);
  const [displayedImageQuestionId, setDisplayedImageQuestionId] = useState<string | null>(
    null,
  );
  const [isQuestionImageReady, setIsQuestionImageReady] = useState(false);

  const [answer, setAnswer] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(false);
  const [pendingTurnCount, setPendingTurnCount] = useState(0);

  const finishTriggeredRef = useRef(false);
  const advanceTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const imageFallbackTimerRef = useRef<number | null>(null);
  const loadedImageCacheRef = useRef<Set<string>>(new Set());
  const failedImageCacheRef = useRef<Set<string>>(new Set());
  const inflightImageLoadsRef = useRef<Map<string, Promise<void>>>(new Map());
  const processedQuestionIdsRef = useRef<Set<string>>(new Set());
  const submissionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const currentQuestionIdRef = useRef<string | null>(null);

  const remainingMs = useCountdown(
    session?.expiresAt ?? null,
    session?.serverNow ?? null,
    session?.status ?? "ACTIVE",
  );

  const canStartYearly = selectedYears.length > 0;

  function clearAdvanceTimer() {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  }

  function clearFeedbackTimer() {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  }

  function clearImageFallbackTimer() {
    if (imageFallbackTimerRef.current !== null) {
      window.clearTimeout(imageFallbackTimerRef.current);
      imageFallbackTimerRef.current = null;
    }
  }

  function resetRuntimeState() {
    setError(null);
    setFeedback(null);
    setAnswer("");
    setSelectedOption("");
    setQuestion(null);
    setQuestionQueue([]);
    setSession(null);
    setDisplayedImageSrc(null);
    setDisplayedImageQuestionId(null);
    setIsQuestionImageReady(false);
    setPendingTurnCount(0);
    processedQuestionIdsRef.current.clear();
    finishTriggeredRef.current = false;
    clearAdvanceTimer();
    clearFeedbackTimer();
    clearImageFallbackTimer();
    submissionQueueRef.current = Promise.resolve();
  }

  function scheduleFeedbackReset() {
    clearFeedbackTimer();
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback(null);
      feedbackTimerRef.current = null;
    }, MIN_FEEDBACK_MS);
  }

  function findReadyQuestionIndex(
    queue: QuestionCard[],
    ignoreQuestionId: string | null = null,
  ) {
    return queue.findIndex((queuedQuestion) => {
      if (ignoreQuestionId && queuedQuestion.id === ignoreQuestionId) {
        return false;
      }
      return loadedImageCacheRef.current.has(queuedQuestion.imageUrl);
    });
  }

  const promoteReadyQuestion = useCallback((ignoreQuestionId: string | null = null) => {
    let promoted = false;

    setQuestionQueue((currentQueue) => {
      const readyIndex = findReadyQuestionIndex(currentQueue, ignoreQuestionId);
      if (readyIndex < 0) {
        return currentQueue;
      }

      const nextQueue = [...currentQueue];
      const [readyQuestion] = nextQueue.splice(readyIndex, 1);
      if (!readyQuestion) {
        return currentQueue;
      }

      promoted = true;
      setQuestion(readyQuestion);
      setDisplayedImageSrc(readyQuestion.imageUrl);
      setDisplayedImageQuestionId(readyQuestion.id);
      setIsQuestionImageReady(true);

      return nextQueue;
    });

    return promoted;
  }, []);

  function primeImage(src: string | null | undefined) {
    if (!src) {
      return Promise.resolve();
    }

    if (loadedImageCacheRef.current.has(src)) {
      return Promise.resolve();
    }

    if (failedImageCacheRef.current.has(src)) {
      return Promise.resolve();
    }

    const inflightRequest = inflightImageLoadsRef.current.get(src);
    if (inflightRequest) {
      return inflightRequest;
    }

    const request = new Promise<void>((resolve) => {
      const image = new window.Image();
      try {
        image.fetchPriority = "high";
      } catch {}

      image.decoding = "async";
      image.onload = async () => {
        try {
          if (typeof image.decode === "function") {
            await image.decode();
          }
        } catch {}

        loadedImageCacheRef.current.add(src);
        inflightImageLoadsRef.current.delete(src);
        resolve();
      };
      image.onerror = () => {
        failedImageCacheRef.current.add(src);
        inflightImageLoadsRef.current.delete(src);
        resolve();
      };
      image.src = src;
    });

    inflightImageLoadsRef.current.set(src, request);
    return request;
  }

  useEffect(() => {
    return () => {
      clearAdvanceTimer();
      clearFeedbackTimer();
      clearImageFallbackTimer();
    };
  }, []);

  useEffect(() => {
    currentQuestionIdRef.current = question?.id ?? null;
  }, [question?.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadYears() {
      try {
        const response = await fetch("/api/game/years");
        const payload = await response.json();
        if (!response.ok || !payload?.years) {
          return;
        }

        if (cancelled) {
          return;
        }

        const years = (payload.years as number[]).filter((year) => Number.isInteger(year));
        setAvailableYears(years);
        if (years.length > 0 && selectedYears.length === 0) {
          const preferred = years.includes(2025) ? [2025] : [years[0]!];
          setSelectedYears(preferred);
        }
      } catch {}
    }

    void loadYears();
    return () => {
      cancelled = true;
    };
  }, [selectedYears.length]);

  useEffect(() => {
    if (!question?.imageUrl) {
      setDisplayedImageSrc(null);
      setDisplayedImageQuestionId(null);
      setIsQuestionImageReady(false);
      return;
    }

    const nextImageSrc = question.imageUrl;
    let cancelled = false;

    if (loadedImageCacheRef.current.has(nextImageSrc)) {
      setDisplayedImageSrc(nextImageSrc);
      setDisplayedImageQuestionId(question.id);
      setIsQuestionImageReady(true);
      return;
    }

    setDisplayedImageSrc(null);
    setDisplayedImageQuestionId(null);
    setIsQuestionImageReady(false);

    void primeImage(nextImageSrc).then(() => {
      if (cancelled) {
        return;
      }
      if (loadedImageCacheRef.current.has(nextImageSrc)) {
        setDisplayedImageSrc(nextImageSrc);
        setDisplayedImageQuestionId(question.id);
        setIsQuestionImageReady(true);
        return;
      }

      if (failedImageCacheRef.current.has(nextImageSrc)) {
        setDisplayedImageSrc(null);
        setDisplayedImageQuestionId(null);
        setIsQuestionImageReady(false);
        promoteReadyQuestion(question.id);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [question?.id, question?.imageUrl, promoteReadyQuestion]);

  useEffect(() => {
    questionQueue.slice(0, PREFETCH_LOOKAHEAD_COUNT).forEach((queuedQuestion) => {
      void primeImage(queuedQuestion.imageUrl);
    });
  }, [questionQueue]);

  useEffect(() => {
    if (!session || session.status !== "ACTIVE") {
      return;
    }

    if (remainingMs === null || remainingMs > 0 || finishTriggeredRef.current) {
      return;
    }

    finishTriggeredRef.current = true;

    void (async () => {
      const response = await fetch("/api/game/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
      const payload = await response.json();
      if (response.ok) {
        setSession(payload.session);
        setQuestion(null);
        setQuestionQueue([]);
      } else {
        setError(payload.error ?? "结束本局失败，请稍后再试。");
      }
    })();
  }, [remainingMs, session]);

  const summary = useMemo(() => {
    if (!session) {
      return null;
    }
    return {
      score: session.score,
      answeredCount: session.answeredCount,
      correctCount: session.correctCount,
      accuracy: session.accuracy,
    };
  }, [session]);

  async function startRound() {
    setIsBooting(true);
    resetRuntimeState();

    try {
      const response = await fetch("/api/game/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: selectedMode,
          years: selectedMode === "yearly" ? selectedYears : [],
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "无法开始挑战，请稍后再试。");
        setIsBooting(false);
        return;
      }

      setSession(payload.session);
      setQuestion(payload.question);
      setQuestionQueue((payload.queuedQuestions ?? []) as QuestionCard[]);
      setIsBooting(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "无法开始挑战。");
      setIsBooting(false);
    }
  }

  function toggleYear(year: number) {
    setSelectedYears((current) => {
      if (current.includes(year)) {
        return current.filter((item) => item !== year);
      }
      return [...current, year].sort((a, b) => a - b);
    });
  }

  function queueNextQuestion(nextQuestion: CurrentQuestion, remainingQueue: QuestionCard[]) {
    clearAdvanceTimer();
    clearImageFallbackTimer();
    setQuestionQueue(remainingQueue);
    setDisplayedImageSrc(null);
    setDisplayedImageQuestionId(null);
    setIsQuestionImageReady(false);
    setSelectedOption("");

    if (!nextQuestion) {
      advanceTimerRef.current = window.setTimeout(() => {
        setQuestion(null);
        advanceTimerRef.current = null;
      }, MIN_FEEDBACK_MS);
      return;
    }

    void primeImage(nextQuestion.imageUrl);

    advanceTimerRef.current = window.setTimeout(() => {
      setQuestion(nextQuestion);
      advanceTimerRef.current = null;
    }, NEXT_QUESTION_DELAY_MS);

    imageFallbackTimerRef.current = window.setTimeout(() => {
      if (currentQuestionIdRef.current !== nextQuestion.id) {
        imageFallbackTimerRef.current = null;
        return;
      }

      if (loadedImageCacheRef.current.has(nextQuestion.imageUrl)) {
        imageFallbackTimerRef.current = null;
        return;
      }

      setQuestionQueue((currentQueue) => {
        const queueWithRetry = currentQueue.some(
          (queuedQuestion) => queuedQuestion.id === nextQuestion.id,
        )
          ? [...currentQueue]
          : [...currentQueue, nextQuestion];

        const readyIndex = findReadyQuestionIndex(queueWithRetry, nextQuestion.id);
        if (readyIndex < 0) {
          return queueWithRetry;
        }

        const [readyQuestion] = queueWithRetry.splice(readyIndex, 1);
        if (!readyQuestion) {
          return queueWithRetry;
        }

        setQuestion(readyQuestion);
        setDisplayedImageSrc(readyQuestion.imageUrl);
        setDisplayedImageQuestionId(readyQuestion.id);
        setIsQuestionImageReady(true);

        return queueWithRetry;
      });

      imageFallbackTimerRef.current = null;
    }, IMAGE_READY_FALLBACK_MS);
  }

  async function processTurn(task: TurnTask) {
    try {
      const response = await fetch(task.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(task.body),
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "处理当前题目失败，请稍后再试。");
        clearImageFallbackTimer();
        clearAdvanceTimer();

        setQuestion((currentQuestion) => {
          if (!currentQuestion) {
            setQuestionQueue(
              task.immediateNextQuestion
                ? [task.immediateNextQuestion, ...task.remainingQueue]
                : task.remainingQueue,
            );
            setAnswer(task.previousAnswer);
            setSelectedOption(task.previousOption);
            return task.previousQuestion;
          }
          return currentQuestion;
        });
        return;
      }

      setSession(payload.session);
      if (payload.result) {
        setFeedback(payload.result);
        scheduleFeedbackReset();
      }

      if (payload.session.status !== "ACTIVE") {
        queueNextQuestion(null, []);
        return;
      }

      if (payload.queuedQuestion?.imageUrl) {
        void primeImage(payload.queuedQuestion.imageUrl);
      }
      setQuestionQueue((currentQueue) =>
        payload.queuedQuestion ? [...currentQueue, payload.queuedQuestion] : currentQueue,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "提交失败，请重试。");
    } finally {
      setPendingTurnCount((count) => Math.max(0, count - 1));
    }
  }

  function enqueueTurn(task: TurnTask) {
    setPendingTurnCount((count) => count + 1);
    submissionQueueRef.current = submissionQueueRef.current
      .catch(() => undefined)
      .then(() => processTurn(task));
  }

  function submitTurn(submittedAnswer: string, skipped: boolean) {
    if (!session || !question) {
      return;
    }
    if (processedQuestionIdsRef.current.has(question.id)) {
      return;
    }

    processedQuestionIdsRef.current.add(question.id);
    setError(null);

    const previousQuestion = question;
    const immediateNextQuestion = questionQueue[0] ?? null;
    const remainingQueue = questionQueue.slice(1);
    const protectedQuestionIds = questionQueue.map((queuedQuestion) => queuedQuestion.id);

    if (immediateNextQuestion) {
      queueNextQuestion(immediateNextQuestion, remainingQueue);
    }

    enqueueTurn({
      path: skipped ? "/api/game/skip" : "/api/game/answer",
      body: skipped
        ? {
            sessionId: session.sessionId,
            questionId: previousQuestion.id,
            protectedQuestionIds,
          }
        : {
            sessionId: session.sessionId,
            questionId: previousQuestion.id,
            answer: submittedAnswer,
            protectedQuestionIds,
          },
      immediateNextQuestion,
      remainingQueue,
      previousQuestion,
      previousAnswer: answer,
      previousOption: selectedOption,
    });
  }

  function handleClassicSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question || question.mode !== "CLASSIC") {
      return;
    }
    const submitted = answer.trim();
    if (!submitted) {
      return;
    }
    setAnswer("");
    submitTurn(submitted, false);
  }

  function handleYearlySubmit() {
    if (!question || question.mode !== "YEARLY" || !selectedOption) {
      return;
    }
    submitTurn(selectedOption, false);
  }

  function handleSkip() {
    if (!question) {
      return;
    }
    submitTurn("", true);
  }

  if (isBooting) {
    return (
      <section className="panel">
        <span className="eyebrow">正在生成挑战</span>
        <h1 className="section-title">正在抽取第一张截图...</h1>
        <p className="muted">如果题库为空，需要先在后台导入题目。</p>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="panel stack">
        <span className="eyebrow">模式选择</span>
        <h1 className="section-title">选择玩法并开始挑战</h1>
        <p className="muted">经典模式保持自由输入；年份模式支持多选年份并四选一答题。</p>

        <div className="toolbar" style={{ justifyContent: "flex-start", gap: 10 }}>
          <button
            type="button"
            className={selectedMode === "classic" ? "button" : "button-ghost"}
            onClick={() => setSelectedMode("classic")}
          >
            经典模式
          </button>
          <button
            type="button"
            className={selectedMode === "yearly" ? "button" : "button-ghost"}
            onClick={() => setSelectedMode("yearly")}
          >
            年份模式
          </button>
        </div>

        {selectedMode === "yearly" ? (
          <div className="stack" style={{ gap: 12 }}>
            <p className="muted">可多选年份，每道题都会在你勾选的年份范围内抽取。</p>
            <div className="label-row">
              {availableYears.length === 0 ? (
                <span className="muted">暂无可用年份，请先导入年份题库。</span>
              ) : (
                availableYears.map((year) => {
                  const active = selectedYears.includes(year);
                  return (
                    <button
                      key={year}
                      type="button"
                      className={active ? "button" : "button-ghost"}
                      onClick={() => toggleYear(year)}
                      style={{ padding: "6px 12px" }}
                    >
                      {year}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : null}

        {error ? <div className="message error">{error}</div> : null}

        <div className="toolbar">
          <button
            type="button"
            className="button"
            onClick={() => void startRound()}
            disabled={selectedMode === "yearly" && !canStartYearly}
          >
            开始挑战
          </button>
        </div>
      </section>
    );
  }

  if (session.status !== "ACTIVE") {
    return (
      <div className="stack" style={{ gap: 24 }}>
        <section className="panel">
          <span className="eyebrow">挑战结束</span>
          <h1 className="hero-title hero-title-compact">本局已结束，看看你能不能冲上榜。</h1>
          <p className="hero-copy">
            倒计时归零或题库抽完后会自动结算。你可以提交成绩，也可以直接再来一局。
          </p>
        </section>
        <SubmitScoreForm
          sessionId={session.sessionId}
          score={summary?.score ?? 0}
          correctCount={summary?.correctCount ?? 0}
          answeredCount={summary?.answeredCount ?? 0}
          accuracy={summary?.accuracy ?? 0}
          onReplay={() => void startRound()}
        />
      </div>
    );
  }

  return (
    <div className="play-layout">
      <section className="panel stack play-stage-panel">
        <div className="split-header split-header-top">
          <div>
            <span className="eyebrow">进行中</span>
            <h1 className="section-title play-stage-title">看图、答题、继续下一题。</h1>
          </div>
          <div className="countdown">剩余 {Math.ceil((remainingMs ?? 0) / 1000)} 秒</div>
        </div>

        {question ? (
          <>
            <div className="play-preload-strip" aria-hidden="true">
              {questionQueue.slice(0, PREFETCH_LOOKAHEAD_COUNT).map((queuedQuestion, index) => (
                <img
                  key={`preload-${queuedQuestion.id}`}
                  src={queuedQuestion.imageUrl}
                  alt=""
                  loading="eager"
                  decoding="async"
                  fetchPriority={index === 0 ? "high" : "low"}
                />
              ))}
            </div>
            <div className={`play-image ${!isQuestionImageReady ? "play-image-loading" : ""}`}>
              {displayedImageSrc && displayedImageQuestionId === question.id ? (
                <img
                  key={`${question.id}-${displayedImageSrc}`}
                  src={displayedImageSrc}
                  alt="动画截图题目"
                  loading="eager"
                  decoding="async"
                />
              ) : (
                <div className="play-image-placeholder">
                  <span>正在加载下一张题图...</span>
                </div>
              )}
            </div>
            <div className="label-row">
              <span className="pill">难度: {difficultyText[question.difficulty]}</span>
              {question.mode === "YEARLY" ? <span className="pill">年份: {question.year}</span> : null}
              {question.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">正在切到下一题...</div>
        )}

        {feedback ? (
          <div className={`feedback-card ${feedback.isCorrect ? "ok" : "error"}`}>
            <strong>
              {feedback.skipped ? "已跳过本题" : feedback.isCorrect ? "回答正确" : "回答错误"}
            </strong>
            <p className="muted">
              正确答案: {feedback.acceptedAnswer}
              {feedback.skipped
                ? "，已切换下一题。"
                : feedback.isCorrect
                  ? `，本题 +${feedback.scoreAwarded} 分。`
                  : "，继续冲下一题。"}
            </p>
          </div>
        ) : null}

        {error ? <div className="message error">{error}</div> : null}

        {question?.mode === "YEARLY" ? (
          <div className="form-stack">
            <div className="field">
              <label>请选择正确作品名</label>
              <div className="stack" style={{ gap: 8 }}>
                {question.options.map((option) => {
                  const active = selectedOption === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      className={active ? "button" : "button-ghost"}
                      style={{ justifyContent: "flex-start", textAlign: "left" }}
                      onClick={() => setSelectedOption(option)}
                      disabled={!question}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="toolbar">
              <button
                type="button"
                className="button"
                disabled={!question || !selectedOption}
                onClick={handleYearlySubmit}
              >
                提交答案
              </button>
              <button type="button" className="button-ghost" disabled={!question} onClick={handleSkip}>
                跳过本题
              </button>
            </div>
          </div>
        ) : (
          <form className="form-stack" onSubmit={handleClassicSubmit}>
            <div className="field">
              <label htmlFor="answer">输入动画作品名</label>
              <input
                id="answer"
                autoComplete="off"
                placeholder="例如: 海贼王"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                disabled={!question}
              />
            </div>
            <div className="toolbar">
              <button type="submit" className="button" disabled={!question || !answer.trim()}>
                提交答案
              </button>
              <button type="button" className="button-ghost" disabled={!question} onClick={handleSkip}>
                跳过本题
              </button>
            </div>
          </form>
        )}

        {pendingTurnCount > 0 ? (
          <p className="muted">后台正在同步 {pendingTurnCount} 道题的判定结果...</p>
        ) : null}
      </section>

      <aside className="stack">
        <section className="panel stack">
          <span className="eyebrow">当前成绩</span>
          <div className="stat-grid stat-grid-play" style={{ marginTop: 0 }}>
            <div className="score-card">
              <span className="muted">总分</span>
              <strong>{summary?.score ?? 0}</strong>
            </div>
            <div className="score-card">
              <span className="muted">答题数</span>
              <strong>{summary?.answeredCount ?? 0}</strong>
            </div>
            <div className="score-card">
              <span className="muted">答对数</span>
              <strong>{summary?.correctCount ?? 0}</strong>
            </div>
          </div>
        </section>

        <section className="panel stack">
          <span className="eyebrow">规则提示</span>
          <div className="feature-card">
            <h3>经典模式</h3>
            <p className="muted">自由输入作品名，支持别名匹配，按难度计分。</p>
          </div>
          <div className="feature-card">
            <h3>年份模式</h3>
            <p className="muted">每题都从你勾选年份里抽取，并提供四个选项。</p>
          </div>
          <div className="feature-card">
            <h3>跳过规则</h3>
            <p className="muted">可直接跳题，跳过不计入答题总数，也不扣分。</p>
          </div>
        </section>
      </aside>
    </div>
  );
}

function useCountdown(
  expiresAt: string | null,
  serverNow: string | null,
  status: SessionSummary["status"],
) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt || !serverNow) {
      setRemainingMs(null);
      return;
    }

    const initialRemaining = Math.max(
      0,
      new Date(expiresAt).getTime() - new Date(serverNow).getTime(),
    );
    const localStart = performance.now();

    const update = () => {
      const elapsed = performance.now() - localStart;
      const next = Math.max(0, initialRemaining - elapsed);
      setRemainingMs(next);
    };

    update();

    if (status !== "ACTIVE") {
      return;
    }

    const timer = window.setInterval(update, 200);
    return () => {
      window.clearInterval(timer);
    };
  }, [expiresAt, serverNow, status]);

  return remainingMs;
}
