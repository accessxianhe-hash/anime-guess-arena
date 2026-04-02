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
    index: "01",
    title: "看图",
    copy: "题图一出现，直接输入作品名。",
  },
  {
    index: "02",
    title: "作答",
    copy: "答不上就跳过，节奏不会停下来。",
  },
  {
    index: "03",
    title: "冲榜",
    copy: "60 秒结算一次，打完马上再来。",
  },
];

export default async function HomePage() {
  const previewEntries = await getPreviewEntries();

  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="home-overline">ANIME SCREENSHOT GUESS</p>
          <h1 className="home-title">看一眼截图，立刻回答作品名。</h1>
          <p className="home-subtitle">60 秒一局。认出来就得分，答不上就跳过继续。</p>

          <div className="home-actions">
            <Link href="/play" className="home-button home-button-primary">
              开始挑战
            </Link>
            <Link href="/leaderboard" className="home-button home-button-secondary">
              查看排行榜
            </Link>
          </div>

          <ul className="home-highlights" aria-label="玩法摘要">
            <li>60 秒冲榜</li>
            <li>同局不重复出题</li>
            <li>一局结束马上再来</li>
          </ul>
        </div>

        <div className="home-hero-visual" aria-hidden="true">
          <div className="home-stage">
            <div className="home-stage-ribbon">SPECIAL</div>
            <div className="home-stage-screen">
              <div className="home-stage-copy">
                <span className="home-stage-label">SCREENSHOT FILE</span>
                <strong>60 SEC</strong>
              </div>
              <div className="home-stage-shot home-stage-shot-main">
                <span>TV ANIME</span>
              </div>
              <div className="home-stage-shot home-stage-shot-top">
                <span>DAILY RANK</span>
              </div>
              <div className="home-stage-shot home-stage-shot-bottom">
                <span>REPLAY</span>
              </div>
            </div>
            <div className="home-stage-meta">
              <div>
                <dt>Play</dt>
                <dd>60 sec</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>Speed Run</dd>
              </div>
              <div>
                <dt>Loop</dt>
                <dd>Guess / Skip / Next</dd>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="home-flow">
        <div className="home-section-head">
          <p className="home-section-label">HOW TO PLAY</p>
          <h2>玩法很短，节奏很快。</h2>
        </div>

        <div className="home-flow-list">
          {playNotes.map((note) => (
            <article key={note.index} className="home-flow-item">
              <span className="home-flow-index">{note.index}</span>
              <div>
                <h3>{note.title}</h3>
                <p>{note.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="home-board">
        <div className="home-section-head home-board-head">
          <div>
            <p className="home-section-label">DAILY RANK</p>
            <h2>今天的榜单</h2>
          </div>
          <Link href="/leaderboard" className="home-inline-link">
            查看完整榜单
          </Link>
        </div>

        {previewEntries.length === 0 ? (
          <p className="home-empty">今天还没有成绩，去抢第一个上榜位。</p>
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
        <p>准备好了就开一局，结束以后直接再来。</p>
      </footer>
    </div>
  );
}
