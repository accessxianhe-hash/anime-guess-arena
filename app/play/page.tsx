import { PlayClient } from "@/components/play-client";

export const dynamic = "force-dynamic";

export default function PlayPage() {
  return (
    <div className="stack page-stack">
      <section className="hero-banner hero-banner-compact play-intro-banner">
        <div className="hero-copy-block play-intro-copy">
          <span className="eyebrow">Speed Run</span>
          <h1 className="hero-title hero-title-compact play-intro-title">
            <span>90 秒识别赛</span>
            <span>READY</span>
          </h1>
          <p className="hero-copy">
            进入页面后系统会立刻创建一局挑战。你只需要盯住截图、打出作品名，然后把
            节奏一直压到结算页。
          </p>
        </div>
        <div className="rule-chip-group play-intro-rules">
          <span>倒计时整局推进</span>
          <span>同局不重复出题</span>
          <span>结束后立刻提交榜单</span>
        </div>
      </section>

      <PlayClient />
    </div>
  );
}
