import Image from "next/image";
import Link from "next/link";

import { HOME_PREVIEW_LIMIT } from "@/lib/constants";
import { getLeaderboard } from "@/lib/leaderboard";
import { formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function getPreviewEntries() {
  try {
    return await getLeaderboard("daily", HOME_PREVIEW_LIMIT);
  } catch {
    return [];
  }
}

const playNotes = [
  {
    title: "看图",
    copy: "题图出现后，直接输入作品名。",
  },
  {
    title: "作答",
    copy: "答不上就跳过，下一题立刻接上。",
  },
  {
    title: "冲榜",
    copy: "60 秒结算一局，分数当天上榜。",
  },
];

const heroShots = [
  {
    src: "/demo/wall-breaker.svg",
    alt: "动画截图示意一",
    className: "hero-shot-main",
  },
  {
    src: "/demo/ninja-dawn.svg",
    alt: "动画截图示意二",
    className: "hero-shot-small hero-shot-top",
  },
  {
    src: "/demo/ocean-dream.svg",
    alt: "动画截图示意三",
    className: "hero-shot-small hero-shot-bottom",
  },
];

export default async function HomePage() {
  const previewEntries = await getPreviewEntries();

  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-copy">
          <p className="home-kicker">截图猜番</p>
          <h1 className="home-title">看一张图，立刻说出作品名。</h1>
          <p className="home-subtitle">60 秒一局，答对加分，答不上就跳过。</p>

          <div className="home-actions">
            <Link href="/play" className="home-button home-button-primary">
              开始挑战
            </Link>
            <Link href="/leaderboard" className="home-button home-button-secondary">
              查看排行榜
            </Link>
          </div>

          <div className="home-note-list" aria-label="玩法摘要">
            {playNotes.map((note) => (
              <article key={note.title} className="home-note-item">
                <strong>{note.title}</strong>
                <p>{note.copy}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="home-visual" aria-hidden="true">
          <div className="hero-board">
            <div className="hero-board-stage">
              <div className="hero-board-screen">
                <span className="hero-board-timer">00:43</span>
                <Image
                  src={heroShots[0].src}
                  alt={heroShots[0].alt}
                  width={1280}
                  height={720}
                  className={heroShots[0].className}
                />
                <div className="hero-answer-bar">
                  <span>输入作品名</span>
                  <strong>进击的巨人？</strong>
                </div>
              </div>

              <Image
                src={heroShots[1].src}
                alt={heroShots[1].alt}
                width={1280}
                height={720}
                className={heroShots[1].className}
              />
              <Image
                src={heroShots[2].src}
                alt={heroShots[2].alt}
                width={1280}
                height={720}
                className={heroShots[2].className}
              />
            </div>

            <div className="hero-board-meta">
              <span>截图识别</span>
              <span>60 秒冲榜</span>
              <span>同局不重复</span>
            </div>
          </div>
        </div>
      </section>

      <section className="home-board">
        <div className="home-section-head">
          <div>
            <p className="home-section-label">今日榜单</p>
            <h2>现在谁排在前面</h2>
          </div>
          <Link href="/leaderboard" className="home-inline-link">
            全部排名
          </Link>
        </div>

        {previewEntries.length === 0 ? (
          <p className="home-empty">今天还没有成绩，去拿下第一个上榜位。</p>
        ) : (
          <ol className="home-ranking-list">
            {previewEntries.map((entry, index) => (
              <li key={entry.id} className="home-ranking-item">
                <span className="home-rank-number">#{index + 1}</span>
                <div className="home-rank-main">
                  <strong>{entry.nickname}</strong>
                  <span>
                    {entry.correctCount}/{entry.answeredCount} · {formatPercent(entry.accuracy)}
                  </span>
                </div>
                <div className="home-rank-score">
                  <strong>{entry.score}</strong>
                  <span>{(entry.durationMs / 1000).toFixed(1)}s</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className="home-footer">
        <p>一局结束，马上再来。</p>
      </footer>
    </div>
  );
}
