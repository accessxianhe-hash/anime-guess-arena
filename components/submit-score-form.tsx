"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type SubmitScoreFormProps = {
  sessionId: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  accuracy: number;
  onReplay: () => void;
};

const RESULT_RETURN_SECONDS = 25;

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

export function SubmitScoreForm({
  sessionId,
  score,
  correctCount,
  answeredCount,
  accuracy,
  onReplay,
}: SubmitScoreFormProps) {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [returnSeconds, setReturnSeconds] = useState(RESULT_RETURN_SECONDS);
  const [isPending, startTransition] = useTransition();
  const grade = gradeFromAccuracy(accuracy, answeredCount);

  useEffect(() => {
    if (!isSubmitted) {
      return;
    }

    setReturnSeconds(RESULT_RETURN_SECONDS);
    const timer = window.setInterval(() => {
      setReturnSeconds((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(timer);
          router.push("/");
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isSubmitted, router]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const response = await fetch("/api/leaderboard/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          nickname,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "提交成绩失败，请稍后再试。");
        return;
      }

      setIsSubmitted(true);
      setMessage("成绩已提交。可以给本局喜欢的番剧点心心，给最喜欢的截图点星星。");
      setError(null);
    });
  }

  return (
    <section className="panel stack score-submit-panel">
      <div className="split-header split-header-top">
        <div>
          <span className="eyebrow">本局结算</span>
          <h2 className="section-title review-title">提交昵称并上榜</h2>
        </div>
        <div className="score-stamp">
          <strong>{grade}</strong>
          <span>评级</span>
        </div>
      </div>

      <div className="stat-grid result-stat-grid">
        <div className="score-card">
          <span className="muted">总分</span>
          <strong>{score}</strong>
        </div>
        <div className="score-card">
          <span className="muted">答题数</span>
          <strong>
            {correctCount}/{answeredCount}
          </strong>
        </div>
        <div className="score-card">
          <span className="muted">正确率</span>
          <strong>{Math.round(accuracy * 100)}%</strong>
        </div>
      </div>

      <form className="form-stack" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="nickname">提交昵称并上榜</label>
          <input
            id="nickname"
            name="nickname"
            maxLength={30}
            placeholder="想到什么就取什么"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            disabled={isPending || isSubmitted}
          />
          <p className="field-hint">1 到 30 个字符即可，中文、标点、空格和表情都可以。</p>
        </div>
        {!isSubmitted ? (
          <div className="toolbar">
            <button type="submit" className="button" disabled={isPending}>
              {isPending ? "提交中..." : "提交成绩"}
            </button>
            <button type="button" className="button-secondary" onClick={onReplay}>
              再来一局
            </button>
            <Link href="/leaderboard" className="button-ghost">
              查看排行
            </Link>
          </div>
        ) : null}
      </form>

      {message ? <div className="message success">{message}</div> : null}
      {error ? <div className="message error">{error}</div> : null}

      {isSubmitted ? (
        <div className="score-after-submit">
          <div>
            <strong>喜欢这局的题目？</strong>
            <p className="muted">
              下方心心可以标记喜欢的番剧，星星可以标记印象最深的截图。倒计时不会影响你的选择。
            </p>
          </div>
          <div className="result-next-actions">
            <span className="auto-home-countdown">{returnSeconds} 秒后返回首页</span>
            <Link href="/" className="button-secondary">
              返回首页
            </Link>
            <button type="button" className="button" onClick={onReplay}>
              再玩一次
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
