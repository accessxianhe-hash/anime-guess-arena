import Link from "next/link";

import { LeaderboardTable } from "@/components/leaderboard-table";
import { getLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

async function loadBoards() {
  try {
    const [classicDaily, classicAllTime, yearlyDaily, yearlyAllTime] = await Promise.all([
      getLeaderboard("daily", "classic"),
      getLeaderboard("all_time", "classic"),
      getLeaderboard("daily", "yearly"),
      getLeaderboard("all_time", "yearly"),
    ]);

    return { classicDaily, classicAllTime, yearlyDaily, yearlyAllTime };
  } catch {
    return { classicDaily: [], classicAllTime: [], yearlyDaily: [], yearlyAllTime: [] };
  }
}

export default async function LeaderboardPage() {
  const { classicDaily, classicAllTime, yearlyDaily, yearlyAllTime } = await loadBoards();

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

      <div className="two-column">
        <LeaderboardTable
          title="经典模式 · 今日榜"
          entries={classicDaily}
          emptyLabel="今天经典模式还没有成绩，等你来拿下第一名。"
        />
        <LeaderboardTable
          title="经典模式 · 总榜"
          entries={classicAllTime}
          emptyLabel="经典模式总榜暂时为空，完成一局后就会留下记录。"
        />
      </div>

      <div className="two-column">
        <LeaderboardTable
          title="年份模式 · 今日榜"
          entries={yearlyDaily}
          emptyLabel="今天年份模式还没有成绩，快来冲榜。"
        />
        <LeaderboardTable
          title="年份模式 · 总榜"
          entries={yearlyAllTime}
          emptyLabel="年份模式总榜暂时为空，完成一局后就会出现成绩。"
        />
      </div>
    </div>
  );
}

