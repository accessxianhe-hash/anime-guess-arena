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
    <div className="stack page-stack">
      <section className="hero-banner">
        <div className="hero-copy-block">
          <span className="eyebrow">Anime Screenshot Guessing</span>
          <p className="hero-kicker">Simple, fast, and built like an anime special site</p>
          <h1 className="hero-title">看一眼截图，在 60 秒里把作品认出来。</h1>
          <p className="hero-copy">
            番图冲刺把玩法压缩到最核心的一条线里：看图、输入、判题、继续下一题。
            页面不靠夸张动效堆气氛，而是用更干净的版式、更明确的反馈和更直接的
            节奏，让你像在追官方宣传站一样进入状态。
          </p>
          <div className="cta-row">
            <Link href="/play" className="button">
              开始挑战
            </Link>
            <Link href="/leaderboard" className="button-ghost">
              查看排行榜
            </Link>
          </div>
        </div>

        <div className="hero-side-stack">
          <div className="hero-note-card">
            <span className="eyebrow eyebrow-soft">玩法节奏</span>
            <ul className="bullet-list">
              <li>开局即进题，不先做多余引导。</li>
              <li>答对、答错、跳过都立刻给反馈。</li>
              <li>一局不重复出题，结算后直接再来一局。</li>
            </ul>
          </div>

          <div className="poster-strip">
            <div className="poster-swatch poster-swatch-haikyu">
              <span>SPORTS</span>
            </div>
            <div className="poster-swatch poster-swatch-jjk">
              <span>CURSED</span>
            </div>
            <div className="poster-swatch poster-swatch-spy">
              <span>FAMILY</span>
            </div>
            <div className="poster-swatch poster-swatch-csm">
              <span>CHAOS</span>
            </div>
          </div>
        </div>
      </section>

      <section className="two-column feature-columns">
        <div className="panel stack">
          <div className="split-header split-header-top">
            <div>
              <span className="eyebrow">Why It Feels Better</span>
              <h2 className="section-title">不是“AI 浮夸卡片”，而是更像官方专题页。</h2>
            </div>
            <p className="muted compact-copy">
              视觉上借了运动番官网、电影 PV 页面和角色竞猜站的结构感，但刻意不堆
              人物大图，把氛围留给题图本身。
            </p>
          </div>

          <div className="story-grid story-grid-wide">
            <article className="story-card">
              <strong>更少装饰</strong>
              <p className="muted">
                用明确的分区、留白和线条组织页面，而不是大面积玻璃感和发光渐变。
              </p>
            </article>
            <article className="story-card">
              <strong>更强节奏</strong>
              <p className="muted">
                每个模块都围绕“继续答下一题”服务，强调输入反馈与对局推进。
              </p>
            </article>
            <article className="story-card">
              <strong>更轻的二次元气氛</strong>
              <p className="muted">
                用配色、分镜感标题和专题页式排版表达氛围，不靠滥用角色图。
              </p>
            </article>
            <article className="story-card">
              <strong>更适合持续运营</strong>
              <p className="muted">
                首页是入口，后台和导入才是长期运营工具，所以设计也保持干净耐看。
              </p>
            </article>
          </div>
        </div>

        <LeaderboardTable
          title="今日榜预览"
          entries={previewEntries}
          emptyLabel="今天还没有成绩，去成为第一个上榜的人。"
        />
      </section>

      <section className="panel stack">
        <div className="split-header split-header-top">
          <div>
            <span className="eyebrow">Play Loop</span>
            <h2 className="section-title">进入、识别、提交、继续。整局体验只做四件事。</h2>
          </div>
        </div>

        <div className="number-grid">
          <article className="number-card">
            <span className="number-badge">01</span>
            <strong>开局即抽题</strong>
            <p className="muted">
              进入页面就直接创建一局挑战，不让玩家先看一堆无关说明。
            </p>
          </article>
          <article className="number-card">
            <span className="number-badge">02</span>
            <strong>单题高聚焦</strong>
            <p className="muted">
              一次只看一张截图，把判断力集中在画面细节，而不是 UI 噪音。
            </p>
          </article>
          <article className="number-card">
            <span className="number-badge">03</span>
            <strong>反馈很干脆</strong>
            <p className="muted">
              答案对错、得分和跳过结果都会立刻回弹，不让玩家悬着。
            </p>
          </article>
          <article className="number-card">
            <span className="number-badge">04</span>
            <strong>结算继续推动复玩</strong>
            <p className="muted">
              结算页不只是收尾，它必须让“再来一局”这件事足够顺手。
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
