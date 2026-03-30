"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

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
};

const difficultyText = {
  EASY: "简单",
  MEDIUM: "普通",
  HARD: "困难",
} as const;

export function PlayClient() {
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [question, setQuestion] = useState<CurrentQuestion>(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [roundKey, setRoundKey] = useState(0);
  const [isPending, startTransition] = useTransition();
  const finishTriggeredRef = useRef(false);
  const serverOffsetMsRef = useRef(0);

  const remainingMs = useCountdown(
    session?.expiresAt ?? null,
    session?.status ?? "ACTIVE",
    serverOffsetMsRef.current,
  );

  const syncServerClock = useCallback((nextSession: SessionSummary) => {
    serverOffsetMsRef.current = new Date(nextSession.serverNow).getTime() - Date.now();
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
        syncServerClock(payload.session);
        setSession(payload.session);
        setQuestion(payload.question);
        setIsBooting(false);
      }
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, [roundKey, syncServerClock]);

  useEffect(() => {
    if (!session || session.status !== "ACTIVE") {
      return;
    }

    if (remainingMs > 0 || finishTriggeredRef.current) {
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
        syncServerClock(payload.session);
        setSession(payload.session);
        setQuestion(null);
      } else {
        setError(payload.error ?? "结束本局时出现问题。");
      }
    });
  }, [remainingMs, session, startTransition, syncServerClock]);

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

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !question || !answer.trim()) {
      return;
    }

    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/game/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: session.sessionId,
          questionId: question.id,
          answer,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "提交答案失败，请稍后再试。");
        return;
      }

      syncServerClock(payload.session);
      setSession(payload.session);
      setFeedback(payload.result);
      setAnswer("");

      window.setTimeout(() => {
        setFeedback(null);
        setQuestion(payload.nextQuestion);
      }, 850);

      if (!payload.nextQuestion || payload.session.status !== "ACTIVE") {
        setQuestion(null);
      }
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
          <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 3vw, 3.4rem)" }}>
            本局已结束，看看你能不能冲上榜。
          </h1>
          <p className="hero-copy">
            倒计时归零或题库抽完后会自动结算。你可以填写昵称提交成绩，也可以直接再来一局。
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
      <section className="panel stack">
        <div className="split-header">
          <div>
            <span className="eyebrow">进行中</span>
            <h1 className="section-title" style={{ fontSize: "clamp(1.9rem, 2.5vw, 3rem)" }}>
              看图输入作品名，答对就加分。
            </h1>
          </div>
          <div className="countdown">剩余 {Math.ceil(remainingMs / 1000)} 秒</div>
        </div>

        {question ? (
          <>
            <div className="play-image">
              <img src={question.imageUrl} alt="动漫截图题目" />
            </div>
            <div className="label-row">
              <span className="pill">难度：{difficultyText[question.difficulty]}</span>
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
            <strong>{feedback.isCorrect ? "回答正确" : "回答错误"}</strong>
            <p className="muted">
              正确答案：{feedback.acceptedAnswer}
              {feedback.isCorrect
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
              placeholder="例如：海贼王"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={!question || isPending}
            />
          </div>
          <button
            type="submit"
            className="button"
            disabled={!question || isPending || !answer.trim()}
          >
            {isPending ? "判题中..." : "提交答案"}
          </button>
        </form>
      </section>

      <aside className="stack">
        <section className="panel stack">
          <span className="eyebrow">当前战绩</span>
          <div className="stat-grid" style={{ marginTop: 0 }}>
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
            <h3>上榜方式</h3>
            <p className="muted">
              时间结束后填写昵称提交成绩，今日榜只保留同昵称当天最佳成绩。
            </p>
          </div>
        </section>
      </aside>
    </div>
  );
}

function useCountdown(
  expiresAt: string | null,
  status: SessionSummary["status"],
  serverOffsetMs: number,
) {
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    if (!expiresAt) {
      setRemainingMs(0);
      return;
    }

    const update = () => {
      const next = Math.max(
        0,
        new Date(expiresAt).getTime() - (Date.now() + serverOffsetMs),
      );
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
  }, [expiresAt, status, serverOffsetMs]);

  return remainingMs;
}
