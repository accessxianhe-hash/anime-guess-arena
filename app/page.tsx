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
      <section className="hero-grid hero-grid-landing">
        <div className="hero-panel hero-panel-spotlight">
          <span className="eyebrow">Anime Guess Arena</span>
          <p className="hero-kicker">Speed quiz for screenshot hunters</p>
          <h1 className="hero-title">看一眼截图，抢在倒计时前认出作品。</h1>
          <p className="hero-copy">
            番图冲刺把“识图”“输入”“判题”“冲榜”压缩进一局 60 秒里。页面一打开就能直接玩，
            你只需要盯住截图、打出作品名，然后看分数和排名一路往上跳。
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
              <span className="muted">节奏模式</span>
              <strong>60 秒极速连答</strong>
            </div>
            <div className="stat-card">
              <span className="muted">判题逻辑</span>
              <strong>标准名与别名兼容</strong>
            </div>
            <div className="stat-card">
              <span className="muted">上手门槛</span>
              <strong>游客直接上榜</strong>
            </div>
          </div>
          <div className="pill-row">
            <span className="pill">前台无登录门槛</span>
            <span className="pill">后台可手动录题</span>
            <span className="pill">支持 ZIP 整包导入</span>
          </div>
        </div>

        <div className="hero-stage panel stack">
          <div className="split-header">
            <div>
              <span className="eyebrow">Live Arena Feed</span>
              <h2 className="section-title">一眼就知道这个站点怎么玩。</h2>
            </div>
            <span className="signal-badge">实时竞技感</span>
          </div>

          <div className="signal-list">
            <article className="signal-card">
              <strong>识图即开答</strong>
              <p className="muted">每次只展示一张截图，把注意力全部锁定在画面细节上。</p>
            </article>
            <article className="signal-card">
              <strong>即时反馈</strong>
              <p className="muted">输入提交后立刻知道对错，正确答案和分数变化同步反馈。</p>
            </article>
            <article className="signal-card">
              <strong>复玩驱动</strong>
              <p className="muted">结算后一步上榜，再来一局的心理成本足够低。</p>
            </article>
          </div>

          <div className="ring-card">
            <div className="ring-visual">
              <span>60s</span>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <strong>竞速场骨架已经成型</strong>
              <p className="muted" style={{ margin: 0 }}>
                当前版本优先把核心循环打磨顺滑，后续可以继续叠加房间赛、主题赛季和玩家档案。
              </p>
            </div>
          </div>

          <div className="inline-list">
            <span className="tag">截图识别</span>
            <span className="tag">即时判题</span>
            <span className="tag">冲榜反馈</span>
            <span className="tag">后台运营</span>
          </div>
        </div>
      </section>

      <section className="cards-grid cards-grid-balanced">
        <article className="question-card stack">
          <div className="spotlight-image">
            <img src="/demo/ocean-dream.svg" alt="玩法示意图" />
          </div>
          <div>
            <span className="eyebrow">站点气质</span>
            <h2 className="section-title">轻竞技、强反馈、没有废动作的截图竞猜体验。</h2>
            <p className="muted">
              这个 MVP 不急着堆社交层，而是先把截图、输入、判题、加分、结算五步做得又快又准。每个界面都应该围绕“马上进入下一次判断”服务。
            </p>
          </div>
          <div className="pill-row">
            <span className="pill">游客直接玩</span>
            <span className="pill">后台可录题</span>
            <span className="pill">支持批量导入</span>
          </div>
        </article>

        <div className="stack" style={{ gap: 18 }}>
          <section className="panel stack">
            <span className="eyebrow">运营视角</span>
            <div className="story-grid">
              <article className="story-card">
                <strong>题库维护</strong>
                <p className="muted">可手动录题，也能用 ZIP + CSV 一次性导入整批截图。</p>
              </article>
              <article className="story-card">
                <strong>本地联调</strong>
                <p className="muted">仓库内已整理好本地 Node、PostgreSQL 和一键启动流程。</p>
              </article>
              <article className="story-card">
                <strong>上线预备</strong>
                <p className="muted">Auth、对象存储和部署预检链路已经开始收口。</p>
              </article>
            </div>
          </section>

          <LeaderboardTable
            title="今日榜预览"
            entries={previewEntries}
            emptyLabel="今天还没人上榜，先来成为第一个挑战者。"
          />
        </div>
      </section>

      <section className="panel stack">
        <div className="split-header">
          <div>
            <span className="eyebrow">Challenge Loop</span>
            <h2 className="section-title">一局体验只有四步，但每一步都必须有反馈。</h2>
          </div>
          <p className="muted">这也是后续做视觉强化和社交扩展的基础骨架。</p>
        </div>

        <div className="story-grid story-grid-wide">
          <article className="story-card">
            <strong>01. 抽题开局</strong>
            <p className="muted">进入页面即生成一局，不让用户先读规则再开始。</p>
          </article>
          <article className="story-card">
            <strong>02. 单题聚焦</strong>
            <p className="muted">每次只做一个判断，让截图本身成为舞台中心。</p>
          </article>
          <article className="story-card">
            <strong>03. 判题回弹</strong>
            <p className="muted">答对或答错都要立刻给出明确反馈和下一步动作。</p>
          </article>
          <article className="story-card">
            <strong>04. 结算冲榜</strong>
            <p className="muted">结算页不只是收尾，它还应该推动玩家马上复玩。</p>
          </article>
        </div>
      </section>
    </div>
  );
}
