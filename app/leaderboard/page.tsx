import Link from "next/link";

import { LeaderboardTable } from "@/components/leaderboard-table";
import { getLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

async function loadBoards() {
  try {
    const [daily, allTime] = await Promise.all([
      getLeaderboard("daily"),
      getLeaderboard("all_time"),
    ]);

    return { daily, allTime };
  } catch {
    return { daily: [], allTime: [] };
  }
}

export default async function LeaderboardPage() {
  const { daily, allTime } = await loadBoards();

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section className="panel">
        <span className="eyebrow">Leaderboard</span>
        <h1 className="hero-title" style={{ fontSize: "clamp(2.1rem, 3vw, 3.6rem)" }}>
          今日榜和总榜都在这里。
        </h1>
        <p className="hero-copy">
          今日榜只展示当天最佳表现，总榜记录所有有效成绩。分数越高越靠前，分数相同时用时更短者领先。
        </p>
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
          title="今日榜"
          entries={daily}
          emptyLabel="今天还没有成绩，等你来点亮第一条记录。"
        />
        <LeaderboardTable
          title="总榜"
          entries={allTime}
          emptyLabel="总榜暂时为空，完成一局后就能留下自己的成绩。"
        />
      </div>
    </div>
  );
}
