import { PlayClient } from "@/components/play-client";

export const dynamic = "force-dynamic";

export default function PlayPage() {
  return (
    <div className="stack page-stack">
      <section className="hero-banner hero-banner-compact">
        <div className="hero-copy-block">
          <span className="eyebrow">Speed Run</span>
          <h1 className="hero-title hero-title-compact">60 秒识别赛已经准备好。</h1>
          <p className="hero-copy">
            进入页面后系统会立刻创建一局挑战。你只需要盯住截图、打出作品名，然后把
            节奏一直压到结算页。
          </p>
        </div>
        <div className="rule-chip-group">
          <span className="pill">倒计时整局推进</span>
          <span className="pill">同局不重复出题</span>
          <span className="pill">结束后立刻提交榜单</span>
        </div>
      </section>

      <PlayClient />
    </div>
  );
}
