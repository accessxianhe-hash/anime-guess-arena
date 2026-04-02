import Image from "next/image";
import Link from "next/link";

import { prisma } from "@/lib/prisma";
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

type HeroQuestionRecord = {
  canonicalTitle?: string | null;
  title?: string | null;
  animeTitle?: string | null;
  correctAnswer?: string | null;
  answer?: string | null;
  imageUrl?: string | null;
  image?: string | null;
  screenshot?: string | null;
  difficulty?: string | null;
  tags?: string[] | null;
};

type HeroQuestion = {
  answer: string;
  imageUrl: string;
  difficulty: string;
  tags: string[];
};

function normalizeHeroQuestion(record: HeroQuestionRecord | null): HeroQuestion | null {
  if (!record) {
    return null;
  }

  const answer =
    record.canonicalTitle?.trim() ||
    record.correctAnswer?.trim() ||
    record.answer?.trim() ||
    record.title?.trim() ||
    record.animeTitle?.trim() ||
    "";

  const imageUrl =
    record.imageUrl?.trim() ||
    record.screenshot?.trim() ||
    record.image?.trim() ||
    "";

  if (!answer || !imageUrl) {
    return null;
  }

  return {
    answer,
    imageUrl,
    difficulty: record.difficulty?.trim() || "MEDIUM",
    tags: Array.isArray(record.tags) ? record.tags.filter(Boolean) : [],
  };
}

async function getRandomHeroQuestion() {
  try {
    const total = await prisma.question.count({
      where: {
        active: true,
      },
    });

    if (total === 0) {
      return null;
    }

    const offset = Math.floor(Math.random() * total);
    const question = await prisma.question.findFirst({
      where: {
        active: true,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: offset,
      select: {
        canonicalTitle: true,
        imageUrl: true,
        difficulty: true,
        tags: true,
      },
    });

    return normalizeHeroQuestion(question);
  } catch {
    return null;
  }
}

const quickSteps = [
  {
    number: "01",
    title: "开局即出图",
    copy: "不用读规则，画面出现就能直接作答。",
  },
  {
    number: "02",
    title: "不会就跳过",
    copy: "卡住时立刻切下一题，把时间留给熟悉的作品。",
  },
  {
    number: "03",
    title: "60 秒冲榜",
    copy: "一局结束马上结算，分数当天上榜。",
  },
];

export default async function HomePage() {
  const [previewEntries, heroQuestion] = await Promise.all([
    getPreviewEntries(),
    getRandomHeroQuestion(),
  ]);

  const visualFrameSource = heroQuestion?.imageUrl ?? "/home/scene-golden-court.svg";
  const visualAnswer = heroQuestion?.answer ?? "等待题库导入";
  const visualTags = heroQuestion?.tags.slice(0, 2) ?? [];
  const visualDifficulty =
    heroQuestion?.difficulty === "HARD"
      ? "高难度"
      : heroQuestion?.difficulty === "EASY"
        ? "轻松题"
        : "随机题库";

  return (
    <div className="home-page">
      <section className="landing-hero">
        <div className="landing-copy">
          <p className="landing-kicker">Anime Screenshot Guess</p>
          <div className="landing-title-block">
            <span className="landing-accent">60 秒冲榜</span>
            <h1 className="landing-title">
              <span>看一张截图</span>
              <span>立刻说出作品名</span>
            </h1>
          </div>
          <p className="landing-subtitle">
            从熟悉的画面里认出番剧。答得越快，分数越高。
          </p>

          <div className="landing-actions">
            <Link href="/play" className="landing-button landing-button-primary">
              开始挑战
            </Link>
            <Link href="/leaderboard" className="landing-button landing-button-secondary">
              查看排行榜
            </Link>
          </div>

          <ul className="landing-steps" aria-label="玩法说明">
            {quickSteps.map((step) => (
              <li key={step.number} className="landing-step">
                <span className="landing-step-number">{step.number}</span>
                <div className="landing-step-copy">
                  <strong>{step.title}</strong>
                  <p>{step.copy}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="landing-visual" aria-hidden="true">
          <div className="visual-poster">
            <figure className="visual-frame visual-frame-main">
              <Image
                src={visualFrameSource}
                alt=""
                width={1280}
                height={720}
                className="visual-image"
                priority
              />
              <figcaption className="visual-frame-label">
                {heroQuestion ? "随机题库截图" : "题库待补充"}
              </figcaption>
            </figure>

            <figure className="visual-frame visual-frame-top">
              <Image
                src={visualFrameSource}
                alt=""
                width={1280}
                height={720}
                className="visual-image visual-image-shifted"
              />
              <figcaption className="visual-frame-label">{visualDifficulty}</figcaption>
            </figure>

            <figure className="visual-frame visual-frame-bottom">
              <Image
                src={visualFrameSource}
                alt=""
                width={1280}
                height={720}
                className="visual-image visual-image-soft"
              />
              <figcaption className="visual-frame-label">
                {visualTags[0] ?? "截图猜番"}
              </figcaption>
            </figure>

            <div className="visual-quiz-card">
              <div className="visual-quiz-top">
                <span>Round 07</span>
                <span>00:43</span>
              </div>
              <p className="visual-quiz-prompt">这一幕出自哪部作品？</p>
              <div className="visual-quiz-input">
                <span>输入作品名</span>
                <strong>{visualAnswer}</strong>
              </div>
              <div className="visual-quiz-meta">
                <span>{visualTags[1] ?? "答对加分"}</span>
                <span>{heroQuestion ? "刷新会换题" : "等待入库"}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-ranking">
        <div className="landing-section-head">
          <div>
            <p className="landing-section-label">今日排行榜</p>
            <h2>今天谁冲得最快</h2>
          </div>
          <Link href="/leaderboard" className="landing-inline-link">
            查看全部
          </Link>
        </div>

        {previewEntries.length === 0 ? (
          <p className="landing-empty">今天还没有成绩，先来拿下第一个上榜位。</p>
        ) : (
          <ol className="landing-ranking-list">
            {previewEntries.map((entry, index) => (
              <li key={entry.id} className="landing-ranking-item">
                <span className="landing-rank-index">#{index + 1}</span>
                <div className="landing-ranking-main">
                  <strong>{entry.nickname}</strong>
                  <span>
                    {entry.correctCount}/{entry.answeredCount} · {formatPercent(entry.accuracy)}
                  </span>
                </div>
                <div className="landing-ranking-score">
                  <strong>{entry.score}</strong>
                  <span>{(entry.durationMs / 1000).toFixed(1)}s</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className="landing-footer">
        <p>一局结束，马上再来。</p>
      </footer>
    </div>
  );
}
