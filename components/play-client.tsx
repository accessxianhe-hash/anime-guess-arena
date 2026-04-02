"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { SubmitScoreForm } from "@/components/submit-score-form";

type SessionSummary = {
  sessionId: string;
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

type CurrentQuestion = {
  id: string;
  imageUrl: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  tags: string[];
} | null;

type FeedbackState = {
  acceptedAnswer: string;
  isCorrect: boolean;
  scoreAwarded: number;
  skipped: boolean;
} | null;

const MIN_FEEDBACK_MS = 160;
const NEXT_QUESTION_DELAY_MS = 60;

const difficultyText = {
  EASY: "简单",
  MEDIUM: "普通",
  HARD: "困难",
} as const;

export function PlayClient() {
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [question, setQuestion] = useState<CurrentQuestion>(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [roundKey, setRoundKey] = useState(0);
  const [isPending, startTransition] = useTransition();
  const finishTriggeredRef = useRef(false);
  const advanceTimerRef = useRef<number | null>(null);
  const remainingMs = useCountdown(
    session?.expiresAt ?? null,
    session?.serverNow ?? null,
    session?.status ?? "ACTIVE",
  );

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current !== null) {
        window.clearTimeout(advanceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      setIsBooting(true);
      setError(null);
      setFeedback(null);
      setAnswer("");
      setQuestion(null);
      setSession(null);
      finishTriggeredRef.current = false;

      const response = await fetch("/api/game/start", {
        method: "POST",
      });

      const payload = await response.json();
      if (!response.ok) {
        if (!cancelled) {
          setError(payload.error ?? "无法开始游戏，请稍后再试。");
          setIsBooting(false);
        }
        return;
      }

      if (!cancelled) {
        setSession(payload.session);
        setQuestion(payload.question);
        setIsBooting(false);
      }
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, [roundKey]);

  useEffect(() => {
    if (!session || session.status !== "ACTIVE") {
      return;
    }

    if (remainingMs === null || remainingMs > 0 || finishTriggeredRef.current) {
      return;
    }

    finishTriggeredRef.current = true;
    startTransition(async () => {
      const response = await fetch("/api/game/finish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
      const payload = await response.json();
      if (response.ok) {
        setSession(payload.session);
        setQuestion(null);
      } else {
        setError(payload.error ?? "结束本局时出现问题。");
      }
    });
  }, [remainingMs, session, startTransition]);

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

  function queueNextQuestion(nextQuestion: CurrentQuestion) {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }

    if (!nextQuestion) {
      advanceTimerRef.current = window.setTimeout(() => {
        setFeedback(null);
        setQuestion(null);
      }, MIN_FEEDBACK_MS);
      return;
    }

    // Warm the next image, but don't block the UI on preload completion.
    if (nextQuestion.imageUrl) {
      const image = new window.Image();
      image.src = nextQuestion.imageUrl;
    }

    advanceTimerRef.current = window.setTimeout(() => {
      setFeedback(null);
      setQuestion(nextQuestion);
    }, NEXT_QUESTION_DELAY_MS);
  }

  async function resolveTurn(
    path: "/api/game/answer" | "/api/game/skip",
    body: Record<string, string>,
  ) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "处理当前题目失败，请稍后再试。");
      return;
    }

    setSession(payload.session);
    setFeedback(payload.result);
    setAnswer("");
    queueNextQuestion(
      payload.session.status === "ACTIVE" ? payload.nextQuestion : null,
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !question || !answer.trim()) {
      return;
    }

    setError(null);

    startTransition(async () => {
      await resolveTurn("/api/game/answer", {
        sessionId: session.sessionId,
        questionId: question.id,
        answer,
      });
    });
  }

  function handleSkip() {
    if (!session || !question) {
      return;
    }

    setError(null);

    startTransition(async () => {
      await resolveTurn("/api/game/skip", {
        sessionId: session.sessionId,
        questionId: question.id,
      });
    });
  }

  if (isBooting) {
    return (
      <section className="panel">
        <span className="eyebrow">正在生成挑战</span>
        <h1 className="section-title">正在抽取第一张截图...</h1>
        <p className="muted">如果题库为空，后台需要先录入或导入题目。</p>
      </section>
    );
  }

  if (error && !session) {
    return (
      <section className="panel stack">
        <span className="eyebrow">启动失败</span>
        <h1 className="section-title">当前还不能开始挑战。</h1>
        <div className="message error">{error}</div>
      </section>
    );
  }

  if (!session || !summary) {
    return null;
  }

  if (session.status !== "ACTIVE") {
    return (
      <div className="stack" style={{ gap: 24 }}>
        <section className="panel">
          <span className="eyebrow">挑战结束</span>
          <h1 className="hero-title hero-title-compact">
            本局已结束，看看你能不能冲上榜。
          </h1>
          <p className="hero-copy">
            倒计时归零或题库抽完后会自动结算。你可以填写昵称提交成绩，也可以直接
            再来一局。
          </p>
        </section>
        <SubmitScoreForm
          sessionId={session.sessionId}
          score={summary.score}
          correctCount={summary.correctCount}
          answeredCount={summary.answeredCount}
          accuracy={summary.accuracy}
          onReplay={() => setRoundKey((value) => value + 1)}
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
            <h1 className="section-title play-stage-title">
              看图、输入作品名、继续下一题。
            </h1>
          </div>
          <div className="countdown">
            剩余 {Math.ceil((remainingMs ?? 0) / 1000)} 秒
          </div>
        </div>

        {question ? (
          <>
            <div className="play-image">
              <img
                src={question.imageUrl}
                alt="动漫截图题目"
                loading="eager"
                decoding="async"
              />
            </div>
            <div className="label-row">
              <span className="pill">难度: {difficultyText[question.difficulty]}</span>
              {question.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">正在切换到下一题...</div>
        )}

        {feedback ? (
          <div className={`feedback-card ${feedback.isCorrect ? "ok" : "error"}`}>
            <strong>
              {feedback.skipped
                ? "已跳过本题"
                : feedback.isCorrect
                  ? "回答正确"
                  : "回答错误"}
            </strong>
            <p className="muted">
              正确答案: {feedback.acceptedAnswer}
              {feedback.skipped
                ? "，已为你切到下一题。"
                : feedback.isCorrect
                  ? `，本题 +${feedback.scoreAwarded} 分。`
                  : "，继续冲下一题。"}
            </p>
          </div>
        ) : null}

        {error ? <div className="message error">{error}</div> : null}

        <form className="form-stack" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="answer">输入动漫作品名</label>
            <input
              id="answer"
              autoComplete="off"
              placeholder="例如: 海贼王"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={!question || isPending}
            />
          </div>
          <div className="toolbar">
            <button
              type="submit"
              className="button"
              disabled={!question || isPending || !answer.trim()}
            >
              {isPending ? "判题中..." : "提交答案"}
            </button>
            <button
              type="button"
              className="button-ghost"
              disabled={!question || isPending}
              onClick={handleSkip}
            >
              {isPending ? "处理中..." : "跳过本题"}
            </button>
          </div>
        </form>
      </section>

      <aside className="stack">
        <section className="panel stack">
          <span className="eyebrow">当前战绩</span>
          <div className="stat-grid stat-grid-play" style={{ marginTop: 0 }}>
            <div className="score-card">
              <span className="muted">总分</span>
              <strong>{summary.score}</strong>
            </div>
            <div className="score-card">
              <span className="muted">答题数</span>
              <strong>{summary.answeredCount}</strong>
            </div>
            <div className="score-card">
              <span className="muted">答对数</span>
              <strong>{summary.correctCount}</strong>
            </div>
          </div>
        </section>

        <section className="panel stack">
          <span className="eyebrow">规则提示</span>
          <div className="feature-card">
            <h3>判题方式</h3>
            <p className="muted">
              支持标准名和后台录入别名，空格和大小写差异会自动规整。
            </p>
          </div>
          <div className="feature-card">
            <h3>计分规则</h3>
            <p className="muted">
              简单题 10 分，普通题 20 分，困难题 30 分，不设连击加成。
            </p>
          </div>
          <div className="feature-card">
            <h3>跳过规则</h3>
            <p className="muted">
              遇到不会的题可以直接跳过，本题不加分，也不会重复抽到同一题。
            </p>
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
