import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { HOME_PREVIEW_LIMIT } from "@/lib/constants";
import { getLeaderboard } from "@/lib/leaderboard";
import { buildQuestionImageSrc } from "@/lib/question-images";
import { formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function getPreviewEntries() {
  try {
    return await getLeaderboard("daily", "classic", HOME_PREVIEW_LIMIT);
  } catch {
    return [];
  }
}

type HeroQuestion = {
  answer: string;
  imageUrl: string;
  difficulty: string;
  tags: string[];
};

type ClassicHeroQuestionRecord = {
  canonicalTitle: string;
  imageUrl: string;
  imageStorageKey: string | null;
  difficulty: string;
  tags: string[];
};

type YearlyHeroQuestionRecord = {
  imageUrl: string;
  imageStorageKey: string | null;
  series: {
    title: string;
    year: number;
    tags: string[];
    studios: string[];
    authors: string[];
  };
};

function normalizeHeroQuestionFromClassic(
  record: ClassicHeroQuestionRecord | null,
): HeroQuestion | null {
  if (!record) {
    return null;
  }

  const answer = record.canonicalTitle?.trim() || "";
  const imageUrl = record.imageUrl?.trim() || "";
  const imageStorageKey = record.imageStorageKey?.trim() || "";

  if (!answer || (!imageUrl && !imageStorageKey)) {
    return null;
  }

  return {
    answer,
    imageUrl: buildQuestionImageSrc(imageStorageKey, imageUrl),
    difficulty: record.difficulty || "MEDIUM",
    tags: Array.isArray(record.tags) ? record.tags.filter(Boolean) : [],
  };
}

function normalizeHeroQuestionFromYearly(
  record: YearlyHeroQuestionRecord | null,
): HeroQuestion | null {
  if (!record) {
    return null;
  }

  const answer = record.series.title?.trim() || "";
  const imageUrl = record.imageUrl?.trim() || "";
  const imageStorageKey = record.imageStorageKey?.trim() || "";

  if (!answer || (!imageUrl && !imageStorageKey)) {
    return null;
  }

  const rawTags = [
    `year-${record.series.year}`,
    ...record.series.tags,
    ...record.series.studios,
    ...record.series.authors,
  ];
  const tags = Array.from(new Set(rawTags.map((tag) => tag.trim()).filter(Boolean)));

  return {
    answer,
    imageUrl: buildQuestionImageSrc(imageStorageKey, imageUrl),
    difficulty: "YEARLY",
    tags,
  };
}

async function getRandomClassicHero(offset: number) {
  const record = await prisma.question.findFirst({
    where: {
      active: true,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    skip: offset,
    select: {
      canonicalTitle: true,
      imageUrl: true,
      imageStorageKey: true,
      difficulty: true,
      tags: true,
    },
  });

  return normalizeHeroQuestionFromClassic(record);
}

async function getRandomYearlyHero(offset: number) {
  const record = await prisma.yearlySeriesImage.findFirst({
    where: {
      series: {
        active: true,
      },
    },
    orderBy: [{ createdAt: "desc" }],
    skip: offset,
    select: {
      imageUrl: true,
      imageStorageKey: true,
      series: {
        select: {
          title: true,
          year: true,
          tags: true,
          studios: true,
          authors: true,
        },
      },
    },
  });

  return normalizeHeroQuestionFromYearly(record);
}

async function getRandomHeroQuestion() {
  try {
    const [classicTotal, yearlyTotal] = await Promise.all([
      prisma.question.count({
        where: {
          active: true,
        },
      }),
      prisma.yearlySeriesImage.count({
        where: {
          series: {
            active: true,
          },
        },
      }),
    ]);
    const total = classicTotal + yearlyTotal;
    if (total === 0) {
      return null;
    }

    const offset = Math.floor(Math.random() * total);

    if (offset < classicTotal) {
      const classicHero = await getRandomClassicHero(offset);
      if (classicHero) {
        return classicHero;
      }

      if (yearlyTotal > 0) {
        return getRandomYearlyHero(Math.floor(Math.random() * yearlyTotal));
      }

      return null;
    }

    const yearlyOffset = offset - classicTotal;
    const yearlyHero = await getRandomYearlyHero(yearlyOffset);
    if (yearlyHero) {
      return yearlyHero;
    }

    if (classicTotal > 0) {
      return getRandomClassicHero(Math.floor(Math.random() * classicTotal));
    }

    return null;
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
      ? "高难题"
      : heroQuestion?.difficulty === "EASY"
        ? "轻松题"
        : heroQuestion?.difficulty === "YEARLY"
          ? "年份题库"
          : "随机题库";

  return (
    <div className="home-page">
      <section className="landing-hero">
        <div className="landing-copy">
          <p className="landing-kicker">ANIME SCREENSHOT GUESS</p>
          <div className="landing-title-block">
            <span className="landing-accent">60 秒冲榜</span>
            <h1 className="landing-title">
              <span>看一张截图</span>
              <span>立刻说出作品名</span>
            </h1>
          </div>
          <p className="landing-subtitle">从熟悉的画面里认出番剧。答得越快，分数越高。</p>

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
              <img src={visualFrameSource} alt="" className="visual-image" />
              <figcaption className="visual-frame-label">
                {heroQuestion ? "随机题库截图" : "题库待补充"}
              </figcaption>
            </figure>

            <figure className="visual-frame visual-frame-top">
              <img src={visualFrameSource} alt="" className="visual-image visual-image-shifted" />
              <figcaption className="visual-frame-label">{visualDifficulty}</figcaption>
            </figure>

            <figure className="visual-frame visual-frame-bottom">
              <img src={visualFrameSource} alt="" className="visual-image visual-image-soft" />
              <figcaption className="visual-frame-label">{visualTags[0] ?? "截图猜番"}</figcaption>
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
