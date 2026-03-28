import { PlayClient } from "@/components/play-client";

export const dynamic = "force-dynamic";

export default function PlayPage() {
  return (
    <div className="stack" style={{ gap: 24 }}>
      <section className="panel">
        <span className="eyebrow">Play Now</span>
        <h1 className="hero-title" style={{ fontSize: "clamp(2.2rem, 3vw, 3.8rem)" }}>
          60 秒内尽可能认出更多动漫。
        </h1>
        <p className="hero-copy">
          进入页面后会立刻创建一局挑战。系统不会重复出同一题，你只需要专注识别截图、输入作品名、尽量把分数拉高。
        </p>
      </section>
      <PlayClient />
    </div>
  );
}

