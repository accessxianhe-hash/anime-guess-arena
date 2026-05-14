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
  seriesId: string;
  year: number;
  options: string[];
};

type QuestionCard = ClassicQuestionCard | YearlyQuestionCard;
type CurrentQuestion = QuestionCard | null;

type MistakeReviewItem = {
  id: string;
  mode: "CLASSIC" | "YEARLY";
  imageUrl: string;
  submittedAnswer: string;
  acceptedAnswer: string;
  skipped: boolean;
  answeredAt: string;
  year: number | null;
};

type ChallengeSeriesOption = {
  id: string;
  kind: "classic" | "yearly";
  title: string;
  year: number | null;
};

type ChallengeImageOption = {
  id: string;
  kind: "classic" | "yearly";
  seriesId: string;
  title: string;
  year: number | null;
  imageUrl: string;
};

type ChallengeReactionOptions = {
  series: ChallengeSeriesOption[];
  images: ChallengeImageOption[];
  selectedSeriesIds: string[];
  selectedImageId: string | null;
};

type ReactionLeaderboardEntry = {
  id: string;
  title: string;
  year: number | null;
  imageUrl?: string;
  count: number;
};

type ReactionLeaderboards = {
  scope: "daily" | "weekly";
  hearts: ReactionLeaderboardEntry[];
  stars: ReactionLeaderboardEntry[];
};

type TurnTask = {
  path: "/api/game/answer" | "/api/game/skip";
  body: Record<string, string | string[]>;
  immediateNextQuestion: CurrentQuestion;
  remainingQueue: QuestionCard[];
  previousQuestion: CurrentQuestion;
  previousAnswer: string;
  previousOption: string;
};

const NEXT_QUESTION_DELAY_MS = 0;
const IMAGE_LOAD_TIMEOUT_MS = 8_000;
const PREFETCH_LOOKAHEAD_COUNT = 4;
const TURN_REQUEST_TIMEOUT_MS = 10_000;
type ImageFetchPriority = "high" | "low" | "auto";

const difficultyText = {
  EASY: "简单",
  MEDIUM: "普通",
  HARD: "困难",
} as const;

function formatClock(ms: number | null) {
  const totalSeconds = Math.max(0, Math.ceil((ms ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTagText(tag: string) {
  return tag.startsWith("year-") ? tag.replace("year-", "") : tag;
}

function gradeFromAccuracy(accuracy: number, answeredCount: number) {
  if (answeredCount === 0) {
    return "READY";
  }
  if (accuracy >= 0.9) {
    return "SS";
  }
  if (accuracy >= 0.75) {
    return "S";
  }
  if (accuracy >= 0.55) {
    return "A";
  }
  return "B";
}

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
  const [error, setError] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(false);
  const [pendingTurnCount, setPendingTurnCount] = useState(0);
  const [submittingQuestionId, setSubmittingQuestionId] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState<MistakeReviewItem[]>([]);
  const [isLoadingMistakes, setIsLoadingMistakes] = useState(false);
  const [reactionOptions, setReactionOptions] = useState<ChallengeReactionOptions | null>(
    null,
  );
  const [selectedReactionSeriesIds, setSelectedReactionSeriesIds] = useState<string[]>(
    [],
  );
  const [selectedReactionImageId, setSelectedReactionImageId] = useState<string | null>(
    null,
  );
  const [reactionBoards, setReactionBoards] = useState<{
    daily: ReactionLeaderboards | null;
    weekly: ReactionLeaderboards | null;
  }>({ daily: null, weekly: null });
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [reactionSaving, setReactionSaving] = useState(false);

  const finishTriggeredRef = useRef(false);
  const advanceTimerRef = useRef<number | null>(null);
  const imageFallbackTimerRef = useRef<number | null>(null);
  const loadedImageCacheRef = useRef<Set<string>>(new Set());
  const failedImageCacheRef = useRef<Set<string>>(new Set());
  const inflightImageLoadsRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const processedQuestionIdsRef = useRef<Set<string>>(new Set());
  const blockedQuestionIdsRef = useRef<Set<string>>(new Set());
  const submissionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const currentQuestionIdRef = useRef<string | null>(null);
  const questionQueueRef = useRef<QuestionCard[]>([]);
  const advancePastUnusableQuestionRef = useRef<(question: QuestionCard) => void>(
    () => {},
  );

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

  function clearImageFallbackTimer() {
    if (imageFallbackTimerRef.current !== null) {
      window.clearTimeout(imageFallbackTimerRef.current);
      imageFallbackTimerRef.current = null;
    }
  }

  function resetRuntimeState() {
    setError(null);
    setAnswer("");
    setSelectedOption("");
    setQuestion(null);
    setQuestionQueue([]);
    setSession(null);
    setDisplayedImageSrc(null);
    setDisplayedImageQuestionId(null);
    setIsQuestionImageReady(false);
    setPendingTurnCount(0);
    setSubmittingQuestionId(null);
    setMistakes([]);
    setIsLoadingMistakes(false);
    setReactionOptions(null);
    setSelectedReactionSeriesIds([]);
    setSelectedReactionImageId(null);
    setReactionBoards({ daily: null, weekly: null });
    setReactionError(null);
    setReactionSaving(false);
    processedQuestionIdsRef.current.clear();
    blockedQuestionIdsRef.current.clear();
    finishTriggeredRef.current = false;
    clearAdvanceTimer();
    clearImageFallbackTimer();
    submissionQueueRef.current = Promise.resolve();
  }

  const primeImage = useCallback((
    src: string | null | undefined,
    fetchPriority: ImageFetchPriority = "high",
  ) => {
    if (!src) {
      return Promise.resolve(false);
    }

    if (loadedImageCacheRef.current.has(src)) {
      return Promise.resolve(true);
    }

    if (failedImageCacheRef.current.has(src)) {
      return Promise.resolve(false);
    }

    const inflightRequest = inflightImageLoadsRef.current.get(src);
    if (inflightRequest) {
      return inflightRequest;
    }

    const request = new Promise<boolean>((resolve) => {
      const image = new window.Image();
      try {
        image.fetchPriority = fetchPriority;
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
        resolve(true);
      };
      image.onerror = () => {
        failedImageCacheRef.current.add(src);
        inflightImageLoadsRef.current.delete(src);
        resolve(false);
      };
      image.src = src;
    });

    inflightImageLoadsRef.current.set(src, request);
    return request;
  }, []);

  const primeQueuedImages = useCallback(async (queue: QuestionCard[]) => {
    for (const queuedQuestion of queue.slice(0, PREFETCH_LOOKAHEAD_COUNT)) {
      if (processedQuestionIdsRef.current.has(queuedQuestion.id)) {
        continue;
      }
      if (blockedQuestionIdsRef.current.has(queuedQuestion.id)) {
        continue;
      }
      await primeImage(queuedQuestion.imageUrl, "low");
    }
  }, [primeImage]);

  useEffect(() => {
    return () => {
      clearAdvanceTimer();
      clearImageFallbackTimer();
    };
  }, []);

  useEffect(() => {
    currentQuestionIdRef.current = question?.id ?? null;
  }, [question?.id]);

  useEffect(() => {
    questionQueueRef.current = questionQueue;
  }, [questionQueue]);

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
    const nextQuestionId = question.id;

    if (loadedImageCacheRef.current.has(nextImageSrc)) {
      setDisplayedImageSrc(nextImageSrc);
      setDisplayedImageQuestionId(nextQuestionId);
      setIsQuestionImageReady(true);
      return;
    }

    setDisplayedImageSrc(null);
    setDisplayedImageQuestionId(nextQuestionId);
    setIsQuestionImageReady(false);

    let cancelled = false;
    void primeImage(nextImageSrc).then((loaded) => {
      if (cancelled || currentQuestionIdRef.current !== nextQuestionId) {
        return;
      }

      if (!loaded) {
        advancePastUnusableQuestionRef.current(question);
        return;
      }

      setDisplayedImageSrc(nextImageSrc);
      setDisplayedImageQuestionId(nextQuestionId);
      setIsQuestionImageReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [primeImage, question]);

  useEffect(() => {
    advancePastUnusableQuestionRef.current = advancePastUnusableQuestion;
  });

  useEffect(() => {
    if (!question?.imageUrl || isQuestionImageReady) {
      clearImageFallbackTimer();
      return;
    }

    clearImageFallbackTimer();
    const timedQuestion = question;
    imageFallbackTimerRef.current = window.setTimeout(() => {
      imageFallbackTimerRef.current = null;
      advancePastUnusableQuestionRef.current(timedQuestion);
    }, IMAGE_LOAD_TIMEOUT_MS);

    return () => {
      clearImageFallbackTimer();
    };
  }, [isQuestionImageReady, question]);

  useEffect(() => {
    if (!isQuestionImageReady) {
      return;
    }

    void primeQueuedImages(questionQueue);
  }, [isQuestionImageReady, primeQueuedImages, questionQueue]);

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

  const isCurrentQuestionSubmitting =
    Boolean(question) && submittingQuestionId === question?.id;
  const sessionId = session?.sessionId ?? null;
  const sessionStatus = session?.status ?? null;
  const remainingSeconds = Math.ceil((remainingMs ?? 0) / 1000);
  const isFinalSeconds = session?.status === "ACTIVE" && remainingSeconds <= 10;
  const totalDurationMs =
    session?.expiresAt && session?.startedAt
      ? Math.max(
          1,
          new Date(session.expiresAt).getTime() - new Date(session.startedAt).getTime(),
        )
      : 1;
  const timerProgress = Math.max(
    0,
    Math.min(100, ((remainingMs ?? totalDurationMs) / totalDurationMs) * 100),
  );

  useEffect(() => {
    if (!sessionId || sessionStatus === "ACTIVE") {
      return;
    }

    let cancelled = false;
    setIsLoadingMistakes(true);

    void (async () => {
      try {
        const response = await fetch("/api/game/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const payload = await response.json();
        if (!response.ok) {
          return;
        }
        if (!cancelled) {
          setMistakes((payload.mistakes ?? []) as MistakeReviewItem[]);
        }
      } catch {
      } finally {
        if (!cancelled) {
          setIsLoadingMistakes(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, sessionStatus]);

  const loadReactionBoards = useCallback(async () => {
    const [dailyResponse, weeklyResponse] = await Promise.all([
      fetch("/api/reaction-leaderboard?scope=daily", { cache: "no-store" }),
      fetch("/api/reaction-leaderboard?scope=weekly", { cache: "no-store" }),
    ]);
    const [daily, weekly] = await Promise.all([
      dailyResponse.json(),
      weeklyResponse.json(),
    ]);

    setReactionBoards({
      daily: dailyResponse.ok ? (daily as ReactionLeaderboards) : null,
      weekly: weeklyResponse.ok ? (weekly as ReactionLeaderboards) : null,
    });
  }, []);

  useEffect(() => {
    if (!sessionId || sessionStatus === "ACTIVE") {
      return;
    }

    let cancelled = false;
    setReactionError(null);

    void (async () => {
      try {
        const response = await fetch("/api/game/reactions/options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load challenge reactions.");
        }

        if (!cancelled) {
          const options = payload as ChallengeReactionOptions;
          setReactionOptions(options);
          setSelectedReactionSeriesIds(options.selectedSeriesIds);
          setSelectedReactionImageId(options.selectedImageId);
        }

        await loadReactionBoards();
      } catch (loadError) {
        if (!cancelled) {
          setReactionError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load challenge reactions.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadReactionBoards, sessionId, sessionStatus]);

  async function saveChallengeReactions(
    likedSeriesIds: string[],
    favoriteImageId: string | null,
  ) {
    if (!sessionId || reactionSaving) {
      return;
    }

    setReactionSaving(true);
    setReactionError(null);
    try {
      const response = await fetch("/api/game/reactions/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          likedSeriesIds,
          favoriteImageId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save challenge reactions.");
      }

      const options = payload as ChallengeReactionOptions;
      setReactionOptions(options);
      setSelectedReactionSeriesIds(options.selectedSeriesIds);
      setSelectedReactionImageId(options.selectedImageId);
      await loadReactionBoards();
    } catch (saveError) {
      setReactionError(
        saveError instanceof Error ? saveError.message : "Failed to save challenge reactions.",
      );
    } finally {
      setReactionSaving(false);
    }
  }

  function toggleChallengeHeart(seriesId: string) {
    const nextSeriesIds = selectedReactionSeriesIds.includes(seriesId)
      ? selectedReactionSeriesIds.filter((id) => id !== seriesId)
      : [...selectedReactionSeriesIds, seriesId];

    setSelectedReactionSeriesIds(nextSeriesIds);
    void saveChallengeReactions(nextSeriesIds, selectedReactionImageId);
  }

  function selectChallengeStar(imageId: string) {
    const nextImageId = selectedReactionImageId === imageId ? null : imageId;
    setSelectedReactionImageId(nextImageId);
    void saveChallengeReactions(selectedReactionSeriesIds, nextImageId);
  }

  function skipChallengeHearts() {
    setSelectedReactionSeriesIds([]);
    void saveChallengeReactions([], selectedReactionImageId);
  }

  function skipChallengeStar() {
    setSelectedReactionImageId(null);
    void saveChallengeReactions(selectedReactionSeriesIds, null);
  }

  function skipChallengeReactions() {
    setSelectedReactionSeriesIds([]);
    setSelectedReactionImageId(null);
    void saveChallengeReactions([], null);
  }

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
      const queuedQuestions = (payload.queuedQuestions ?? []) as QuestionCard[];
      setQuestionQueue(queuedQuestions);
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
    const sanitizedQueue = remainingQueue.filter((queuedQuestion) => {
      if (processedQuestionIdsRef.current.has(queuedQuestion.id)) {
        return false;
      }
      if (blockedQuestionIdsRef.current.has(queuedQuestion.id)) {
        return false;
      }
      return !nextQuestion || queuedQuestion.id !== nextQuestion.id;
    });

    setQuestionQueue(sanitizedQueue);
    setDisplayedImageSrc(null);
    setDisplayedImageQuestionId(null);
    setIsQuestionImageReady(false);
    setSelectedOption("");

    if (!nextQuestion) {
      advanceTimerRef.current = window.setTimeout(() => {
        setQuestion(null);
        advanceTimerRef.current = null;
      }, 0);
      return;
    }

    advanceTimerRef.current = window.setTimeout(() => {
      setQuestion(nextQuestion);
      advanceTimerRef.current = null;
    }, NEXT_QUESTION_DELAY_MS);

    void primeImage(nextQuestion.imageUrl, "high");
  }

  function advancePastUnusableQuestion(unusableQuestion: QuestionCard) {
    if (currentQuestionIdRef.current !== unusableQuestion.id) {
      return;
    }
    if (processedQuestionIdsRef.current.has(unusableQuestion.id)) {
      return;
    }

    blockedQuestionIdsRef.current.add(unusableQuestion.id);
    failedImageCacheRef.current.add(unusableQuestion.imageUrl);
    setAnswer("");
    setSelectedOption("");
    setError(null);

    const availableQueue = questionQueueRef.current.filter((queuedQuestion) => {
      if (queuedQuestion.id === unusableQuestion.id) {
        return false;
      }
      if (processedQuestionIdsRef.current.has(queuedQuestion.id)) {
        return false;
      }
      return !blockedQuestionIdsRef.current.has(queuedQuestion.id);
    });
    const immediateNextQuestion = availableQueue[0] ?? null;

    if (immediateNextQuestion) {
      queueNextQuestion(immediateNextQuestion, availableQueue.slice(1));
      return;
    }

    submitTurn("", true);
  }

  async function processTurn(task: TurnTask) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, TURN_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(task.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(task.body),
        signal: controller.signal,
      });

      const payload = await response.json();
      if (!response.ok) {
        const message = payload.error ?? "处理当前题目失败，请稍后再试。";
        if (currentQuestionIdRef.current === task.previousQuestion?.id || !currentQuestionIdRef.current) {
          setError(message);
        }
        processedQuestionIdsRef.current.delete(task.previousQuestion?.id ?? "");
        setSubmittingQuestionId((currentId) =>
          currentId === task.previousQuestion?.id ? null : currentId,
        );
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
      if (payload.session.status !== "ACTIVE") {
        queueNextQuestion(null, []);
        return;
      }

      const queuedQuestion = (payload.queuedQuestion ?? null) as CurrentQuestion;

      if (queuedQuestion && processedQuestionIdsRef.current.has(queuedQuestion.id)) {
        return;
      }

      if (queuedQuestion && !task.immediateNextQuestion) {
        queueNextQuestion(queuedQuestion, []);
        return;
      }

      setQuestionQueue((currentQueue) => {
        if (!queuedQuestion) {
          return currentQueue;
        }
        if (currentQueue.some((currentQuestion) => currentQuestion.id === queuedQuestion.id)) {
          return currentQueue;
        }
        return [...currentQueue, queuedQuestion];
      });
    } catch (requestError) {
      const message =
        requestError instanceof DOMException && requestError.name === "AbortError"
          ? "提交超时，请重试。"
          : requestError instanceof Error
            ? requestError.message
            : "提交失败，请重试。";

      if (currentQuestionIdRef.current === task.previousQuestion?.id || !currentQuestionIdRef.current) {
        setError(message);
      }
      processedQuestionIdsRef.current.delete(task.previousQuestion?.id ?? "");
      setSubmittingQuestionId((currentId) =>
        currentId === task.previousQuestion?.id ? null : currentId,
      );
    } finally {
      window.clearTimeout(timeoutId);
      setSubmittingQuestionId((currentId) =>
        currentId === task.previousQuestion?.id ? null : currentId,
      );
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
    if (submittingQuestionId === question.id) {
      return;
    }

    processedQuestionIdsRef.current.add(question.id);
    setSubmittingQuestionId(question.id);
    setError(null);

    const previousQuestion = question;
    const availableQueue = questionQueue.filter((queuedQuestion) => {
      if (queuedQuestion.id === question.id) {
        return false;
      }
      if (processedQuestionIdsRef.current.has(queuedQuestion.id)) {
        return false;
      }
      return !blockedQuestionIdsRef.current.has(queuedQuestion.id);
    });
    const immediateNextQuestion = availableQueue[0] ?? null;
    const remainingQueue = availableQueue.slice(1);
    const protectedQuestionIds = Array.from(
      new Set([
        ...blockedQuestionIdsRef.current,
        ...availableQueue.map((queuedQuestion) => queuedQuestion.id),
      ]),
    );
    const protectedSeriesIds = availableQueue
      .filter(
        (queuedQuestion): queuedQuestion is YearlyQuestionCard =>
          queuedQuestion.mode === "YEARLY",
      )
      .map((queuedQuestion) => queuedQuestion.seriesId);

    if (immediateNextQuestion) {
      queueNextQuestion(immediateNextQuestion, remainingQueue);
    } else {
      clearAdvanceTimer();
      clearImageFallbackTimer();
      setQuestion(null);
      setDisplayedImageSrc(null);
      setDisplayedImageQuestionId(null);
      setIsQuestionImageReady(false);
      setSelectedOption("");
    }

    enqueueTurn({
      path: skipped ? "/api/game/skip" : "/api/game/answer",
      body: skipped
        ? {
            sessionId: session.sessionId,
            questionId: previousQuestion.id,
            protectedQuestionIds,
            protectedSeriesIds,
          }
        : {
            sessionId: session.sessionId,
            questionId: previousQuestion.id,
            answer: submittedAnswer,
            protectedQuestionIds,
            protectedSeriesIds,
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
      <section className="panel stack start-panel">
        <span className="eyebrow">模式选择</span>
        <h1 className="section-title">选择玩法并开始挑战</h1>
        <p className="muted">90 秒内连续看图作答。先选题库模式，再开始冲榜。</p>

        <div className="segmented-control" aria-label="选择玩法模式">
          <button
            type="button"
            className={selectedMode === "classic" ? "segment active" : "segment"}
            onClick={() => setSelectedMode("classic")}
          >
            经典模式
          </button>
          <button
            type="button"
            className={selectedMode === "yearly" ? "segment active" : "segment"}
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

        <div className="toolbar start-actions">
          <button
            type="button"
            className="button button-primary-large"
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
    const finalGrade = gradeFromAccuracy(summary?.accuracy ?? 0, summary?.answeredCount ?? 0);
    return (
      <div className="stack" style={{ gap: 24 }}>
        <section className="panel result-hero">
          <div>
            <span className="eyebrow">挑战结束</span>
            <h1 className="hero-title hero-title-compact">本局已结算。</h1>
            <p className="hero-copy">
              {summary?.correctCount ?? 0} 题命中，正确率 {Math.round((summary?.accuracy ?? 0) * 100)}%。提交成绩后可以冲击排行榜。
            </p>
          </div>
          <div className="result-grade" aria-label={`本局评级 ${finalGrade}`}>
            <span>{finalGrade}</span>
            <small>RANK</small>
          </div>
        </section>
        <SubmitScoreForm
          sessionId={session.sessionId}
          score={summary?.score ?? 0}
          correctCount={summary?.correctCount ?? 0}
          answeredCount={summary?.answeredCount ?? 0}
          accuracy={summary?.accuracy ?? 0}
          onReplay={() => void startRound()}
        />
        <section className="panel stack challenge-reactions-panel">
          <div className="split-header">
            <div>
              <span className="eyebrow">After Party</span>
              <h2 className="section-title review-title">本局最喜欢的番剧和截图</h2>
            </div>
            {reactionSaving ? <span className="pill">保存中</span> : <span className="pill">每日 / 每周榜</span>}
          </div>

          {reactionError ? <div className="message error">{reactionError}</div> : null}

          {reactionOptions ? (
            <div className="reaction-skip-row">
              <span className="muted">跳过后，本局不会新增爱心或星星。</span>
              <button
                type="button"
                className="button-secondary"
                onClick={skipChallengeReactions}
                disabled={reactionSaving}
              >
                跳过本环节
              </button>
            </div>
          ) : null}

          {!reactionOptions ? (
            <div className="empty-state">正在整理本局出现过的番剧...</div>
          ) : reactionOptions.series.length === 0 ? (
            <div className="empty-state">本局没有可投票的年份题目。</div>
          ) : (
            <>
              <div className="stack" style={{ gap: 12 }}>
                <div>
                  <h3 className="reaction-heading">你喜欢本局出现的哪些番剧？</h3>
                  <p className="muted">可以多选，点小红心会立即计入今日榜和本周榜。</p>
                </div>
                <div className="reaction-section-actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={skipChallengeHearts}
                    disabled={reactionSaving}
                  >
                    跳过爱心
                  </button>
                </div>
                <div className="reaction-series-grid">
                  {reactionOptions.series.map((item) => {
                    const active = selectedReactionSeriesIds.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={active ? "reaction-chip active" : "reaction-chip"}
                        onClick={() => toggleChallengeHeart(item.id)}
                        disabled={reactionSaving}
                      >
                        <span className="reaction-icon">♥</span>
                        <span>{item.title}</span>
                        <small>{item.year ?? "经典"}</small>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="stack" style={{ gap: 12 }}>
                <div>
                  <h3 className="reaction-heading">本局你最喜欢哪一张截图？</h3>
                  <p className="muted">只能选择一张，点小星星会更新你的选择。</p>
                </div>
                <div className="reaction-section-actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={skipChallengeStar}
                    disabled={reactionSaving}
                  >
                    跳过星星
                  </button>
                </div>
                <div className="reaction-image-grid">
                  {reactionOptions.images.map((item) => {
                    const active = selectedReactionImageId === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={active ? "reaction-image-card active" : "reaction-image-card"}
                        onClick={() => selectChallengeStar(item.id)}
                        disabled={reactionSaving}
                      >
                        <span className="reaction-star">★</span>
                        <img src={item.imageUrl} alt={`${item.title} 截图`} loading="lazy" />
                        <strong>{item.title}</strong>
                        <small>{item.year ?? "经典题库"}</small>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="reaction-board-grid">
                <ReactionBoard title="小红心 今日榜" entries={reactionBoards.daily?.hearts ?? []} />
                <ReactionBoard title="小红心 本周榜" entries={reactionBoards.weekly?.hearts ?? []} />
                <ReactionBoard title="小星星 今日榜" entries={reactionBoards.daily?.stars ?? []} showImages />
                <ReactionBoard title="小星星 本周榜" entries={reactionBoards.weekly?.stars ?? []} showImages />
              </div>
            </>
          )}
        </section>
        <section className="panel stack">
          <div className="split-header">
            <div>
              <span className="eyebrow">错题回顾</span>
              <h2 className="section-title review-title">本局答错的题</h2>
            </div>
            <span className="pill">{mistakes.length} 题</span>
          </div>

          {isLoadingMistakes ? (
            <div className="empty-state">正在整理错题...</div>
          ) : mistakes.length === 0 ? (
            <div className="message success">本局没有错题，保持住。</div>
          ) : (
            <div className="mistake-list">
              {mistakes.map((item, index) => (
                <article key={item.id} className="mistake-card">
                  <div className="mistake-image">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="错题截图" loading="lazy" />
                    ) : (
                      <span>无题图</span>
                    )}
                  </div>
                  <div className="mistake-body">
                    <div className="label-row">
                      <span className="pill">#{index + 1}</span>
                      <span className="pill">
                        {item.mode === "YEARLY" ? "年份模式" : "经典模式"}
                      </span>
                      {item.year ? <span className="pill">{item.year}</span> : null}
                    </div>
                    <div className="mistake-answer-grid">
                      <div>
                        <span className="muted">你的答案</span>
                        <strong className="mistake-wrong">
                          {item.skipped ? "跳过" : item.submittedAnswer || "未填写"}
                        </strong>
                      </div>
                      <div>
                        <span className="muted">正确答案</span>
                        <strong>{item.acceptedAnswer || "未知"}</strong>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="play-layout">
      <section className="panel stack play-stage-panel">
        <div className="split-header split-header-top">
          <div className="play-stage-copy">
            <span className="eyebrow">进行中</span>
            <h1 className="section-title play-stage-title">
              <span>看图答题</span>
            </h1>
            <p className="play-stage-subtitle">盯住截图，选出作品名；时间会持续倒计。</p>
            <div className="mobile-mini-score">
              得分 {summary?.score ?? 0} · 答对 {summary?.correctCount ?? 0}
            </div>
          </div>
          <div className={isFinalSeconds ? "countdown countdown-danger" : "countdown"}>
            <span>TIME</span>
            <strong>{formatClock(remainingMs)}</strong>
            <div className="countdown-track" aria-hidden="true">
              <div
                className="countdown-bar"
                style={{ width: `${timerProgress}%` }}
              />
            </div>
          </div>
        </div>

        {question ? (
          <>
            <div className={`play-image ${!isQuestionImageReady ? "play-image-loading" : ""}`}>
              {displayedImageSrc && displayedImageQuestionId === question.id ? (
                <img
                  key={`${question.id}-${displayedImageSrc}`}
                  src={displayedImageSrc}
                  alt="动画截图题目"
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  onLoad={() => {
                    loadedImageCacheRef.current.add(displayedImageSrc);
                    clearImageFallbackTimer();
                    setIsQuestionImageReady(true);
                  }}
                  onError={() => {
                    failedImageCacheRef.current.add(displayedImageSrc);
                    setDisplayedImageSrc(null);
                    setDisplayedImageQuestionId(null);
                    setIsQuestionImageReady(false);
                    advancePastUnusableQuestion(question);
                  }}
                />
              ) : (
                <div className="play-image-placeholder">
                  <span>正在加载题图，超过 8 秒会自动换题...</span>
                </div>
              )}
            </div>
            <div className="label-row">
              <span className="pill">难度: {difficultyText[question.difficulty]}</span>
              {question.mode === "YEARLY" ? <span className="pill">年份: {question.year}</span> : null}
              <div className="secondary-tag-row" aria-label="题目标签">
                {question.tags
                  .filter((tag) => !tag.startsWith("year-"))
                  .slice(0, 6)
                  .map((tag) => (
                    <span key={tag} className="tag">
                      {formatTagText(tag)}
                    </span>
                  ))}
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            {submittingQuestionId ? "正在提交答案并抽取下一题..." : "正在切到下一题..."}
          </div>
        )}

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
                      className={active ? "answer-option active" : "answer-option"}
                      onClick={() => setSelectedOption(option)}
                      disabled={!question || isCurrentQuestionSubmitting}
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
                disabled={!question || !selectedOption || isCurrentQuestionSubmitting}
                onClick={handleYearlySubmit}
              >
                {isCurrentQuestionSubmitting ? "提交中..." : "提交答案"}
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={!question || isCurrentQuestionSubmitting}
                onClick={handleSkip}
              >
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
                disabled={!question || isCurrentQuestionSubmitting}
              />
            </div>
            <div className="toolbar">
              <button
                type="submit"
                className="button"
                disabled={!question || !answer.trim() || isCurrentQuestionSubmitting}
              >
                {isCurrentQuestionSubmitting ? "提交中..." : "提交答案"}
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={!question || isCurrentQuestionSubmitting}
                onClick={handleSkip}
              >
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
          <ul className="rule-list">
            <li>
              <strong>经典模式</strong>
              <span>自由输入作品名，支持别名匹配，按难度计分。</span>
            </li>
            <li>
              <strong>年份模式</strong>
              <span>每题都从你勾选年份里抽取，并提供四个选项。</span>
            </li>
            <li>
              <strong>跳过规则</strong>
              <span>可直接跳题，跳过不计入答题总数，也不扣分。</span>
            </li>
          </ul>
        </section>
      </aside>
    </div>
  );
}

function ReactionBoard({
  title,
  entries,
  showImages = false,
}: {
  title: string;
  entries: ReactionLeaderboardEntry[];
  showImages?: boolean;
}) {
  return (
    <article className="reaction-board">
      <div className="reaction-board-head">
        <h3>{title}</h3>
        <span>{entries.length} 项</span>
      </div>
      {entries.length === 0 ? (
        <div className="reaction-board-empty">还没有投票</div>
      ) : (
        <ol className="reaction-board-list">
          {entries.map((entry, index) => (
            <li key={entry.id}>
              <span className="reaction-rank">#{index + 1}</span>
              {showImages && entry.imageUrl ? (
                <img src={entry.imageUrl} alt={`${entry.title} 截图`} loading="lazy" />
              ) : null}
              <div>
                <strong>{entry.title}</strong>
                <small>{entry.year ?? "经典题库"}</small>
              </div>
              <span className="reaction-count">{entry.count}</span>
            </li>
          ))}
        </ol>
      )}
    </article>
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
