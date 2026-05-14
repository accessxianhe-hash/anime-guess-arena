import Link from "next/link";

import { LeaderboardBrowser } from "@/components/leaderboard-browser";
import { getReactionLeaderboards } from "@/lib/challenge-reactions";
import { getLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

async function loadBoards() {
  try {
    const [
      classicDaily,
      classicAllTime,
      yearlyDaily,
      yearlyAllTime,
      reactionDaily,
      reactionWeekly,
    ] = await Promise.all([
      getLeaderboard("daily", "classic"),
      getLeaderboard("all_time", "classic"),
      getLeaderboard("daily", "yearly"),
      getLeaderboard("all_time", "yearly"),
      getReactionLeaderboards("daily"),
      getReactionLeaderboards("weekly"),
    ]);

    return {
      classicDaily: classicDaily.map(toScoreEntry),
      classicAllTime: classicAllTime.map(toScoreEntry),
      yearlyDaily: yearlyDaily.map(toScoreEntry),
      yearlyAllTime: yearlyAllTime.map(toScoreEntry),
      reactionDaily,
      reactionWeekly,
    };
  } catch {
    return {
      classicDaily: [],
      classicAllTime: [],
      yearlyDaily: [],
      yearlyAllTime: [],
      reactionDaily: { scope: "daily" as const, hearts: [], stars: [] },
      reactionWeekly: { scope: "weekly" as const, hearts: [], stars: [] },
    };
  }
}

function toScoreEntry(entry: {
  id: string;
  nickname: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  accuracy: number;
  durationMs: number;
}) {
  return {
    id: entry.id,
    nickname: entry.nickname,
    score: entry.score,
    correctCount: entry.correctCount,
    answeredCount: entry.answeredCount,
    accuracy: entry.accuracy,
    durationMs: entry.durationMs,
  };
}

export default async function LeaderboardPage() {
  const {
    classicDaily,
    classicAllTime,
    yearlyDaily,
    yearlyAllTime,
    reactionDaily,
    reactionWeekly,
  } = await loadBoards();

  return (
    <div className="stack page-stack">
      <section className="hero-banner hero-banner-compact">
        <div className="hero-copy-block">
          <span className="eyebrow">Leaderboard</span>
          <h1 className="hero-title hero-title-compact">今日榜与总榜都在这里。</h1>
          <p className="hero-copy">
            排行按分数优先，同分时按更快完成时间。经典模式和年份模式分别统计。
          </p>
        </div>
        <div className="cta-row">
          <Link href="/play" className="button">
            去挑战一局
          </Link>
          <Link href="/" className="button-ghost">
            返回首页
          </Link>
        </div>
      </section>

      <LeaderboardBrowser
        classicDaily={classicDaily}
        classicAllTime={classicAllTime}
        yearlyDaily={yearlyDaily}
        yearlyAllTime={yearlyAllTime}
        reactionDaily={reactionDaily}
        reactionWeekly={reactionWeekly}
      />
    </div>
  );
}
