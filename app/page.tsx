import Link from "next/link";

import { LeaderboardTable } from "@/components/leaderboard-table";
import { HOME_PREVIEW_LIMIT } from "@/lib/constants";
import { getLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

async function getPreviewEntries() {
  try {
    return await getLeaderboard("daily", HOME_PREVIEW_LIMIT);
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const previewEntries = await getPreviewEntries();

  return (
    <div className="stack" style={{ gap: 28 }}>
      <section className="hero-grid">
        <div className="hero-panel">
          <span className="eyebrow">Anime Guess Challenge</span>
          <h1 className="hero-title">看图认番，60 秒冲分上榜。</h1>
          <p className="hero-copy">
            每局 60 秒，系统连续给出动漫截图。你只需要输入作品名，答对立刻加分，
            时间结束后提交昵称，就能冲击今日榜和总榜。
          </p>
          <div className="cta-row">
            <Link href="/play" className="button">
              立即开始挑战
            </Link>
            <Link href="/leaderboard" className="button-secondary">
              先看排行榜
            </Link>
          </div>
          <div className="stat-grid">
            <div className="stat-card">
              <span className="muted">核心模式</span>
              <strong>截图猜作品名</strong>
            </div>
            <div className="stat-card">
              <span className="muted">游戏节奏</span>
              <strong>60 秒整局计时</strong>
            </div>
            <div className="stat-card">
              <span className="muted">成绩提交</span>
              <strong>游客昵称上榜</strong>
            </div>
          </div>
        </div>

        <div className="panel stack">
          <span className="eyebrow">玩法骨架</span>
          <div className="feature-grid">
            <article className="feature-card">
              <h3>1. 看图出题</h3>
              <p className="muted">每次只出现一张截图，保持视觉聚焦。</p>
            </article>
            <article className="feature-card">
              <h3>2. 即时判定</h3>
              <p className="muted">支持标准名与别名匹配，答对立刻给分。</p>
            </article>
            <article className="feature-card">
              <h3>3. 上榜反馈</h3>
              <p className="muted">结算后提交昵称，看看自己能冲到第几。</p>
            </article>
          </div>
        </div>
      </section>

      <section className="cards-grid">
        <article className="question-card stack">
          <div className="spotlight-image">
            <img src="/demo/ocean-dream.svg" alt="玩法示意图" />
          </div>
          <div>
            <span className="eyebrow">站点气质</span>
            <h2 className="section-title">轻竞技，强反馈，专注二次元识别乐趣。</h2>
            <p className="muted">
              这个 MVP 不追求社交系统堆叠，而是把截图、输入、判题、加分、结算五步做得又顺又快。
            </p>
          </div>
          <div className="pill-row">
            <span className="pill">游客直接玩</span>
            <span className="pill">后台可录题</span>
            <span className="pill">支持批量导入</span>
          </div>
        </article>

        <LeaderboardTable
          title="今日榜预览"
          entries={previewEntries}
          emptyLabel="今天还没人上榜，先来成为第一个挑战者。"
        />
      </section>
    </div>
  );
}
