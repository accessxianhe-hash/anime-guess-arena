"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type SubmitScoreFormProps = {
  sessionId: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  accuracy: number;
  onReplay: () => void;
};

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
  const [isPending, startTransition] = useTransition();

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

      setMessage("成绩已提交，正在跳转到排行榜。");
      router.push("/leaderboard");
      router.refresh();
    });
  }

  return (
    <section className="panel stack">
      <span className="eyebrow">本局结算</span>
      <div className="stat-grid">
        <div className="score-card">
          <span className="muted">总分</span>
          <strong>{score}</strong>
        </div>
        <div className="score-card">
          <span className="muted">答对题数</span>
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
            maxLength={20}
            placeholder="例如：雾雨小队长"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
          />
        </div>
        <div className="toolbar">
          <button type="submit" className="button" disabled={isPending}>
            {isPending ? "提交中..." : "提交成绩"}
          </button>
          <button type="button" className="button-ghost" onClick={onReplay}>
            再来一局
          </button>
        </div>
      </form>

      {message ? <div className="message success">{message}</div> : null}
      {error ? <div className="message error">{error}</div> : null}
    </section>
  );
}
