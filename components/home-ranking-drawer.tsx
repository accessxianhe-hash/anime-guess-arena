"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import type { ReactionLeaderboardEntry } from "@/lib/challenge-reactions";
import { formatPercent } from "@/lib/utils";

type ScoreEntry = {
  id: string;
  nickname: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  accuracy: number;
  durationMs: number;
};

type DailyBoardId = "classic" | "yearly" | "hearts" | "stars";

type DailyBoard = {
  id: DailyBoardId;
  label: string;
  description: string;
  kind: "score" | "reaction";
  count: number;
};

type ImagePreview = {
  src: string;
  title: string;
};

type HomeRankingDrawerProps = {
  classicDaily: ScoreEntry[];
  yearlyDaily: ScoreEntry[];
  heartDaily: ReactionLeaderboardEntry[];
  starDaily: ReactionLeaderboardEntry[];
};

function getInitialBoard(boards: DailyBoard[]) {
  return boards.find((board) => board.count > 0)?.id ?? boards[0]?.id ?? "classic";
}

function ScoreDailyList({ entries }: { entries: ScoreEntry[] }) {
  return (
    <ol className="home-rank-drawer-list">
      {entries.map((entry, index) => (
        <li key={entry.id}>
          <span className="home-rank-drawer-index">#{index + 1}</span>
          <div>
            <strong>{entry.nickname}</strong>
            <small>
              {entry.correctCount}/{entry.answeredCount} · {formatPercent(entry.accuracy)}
            </small>
          </div>
          <div className="home-rank-drawer-score">
            <strong>{entry.score}</strong>
            <small>{(entry.durationMs / 1000).toFixed(1)}s</small>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ReactionDailyList({
  entries,
  showImages,
  onPreviewImage,
}: {
  entries: ReactionLeaderboardEntry[];
  showImages?: boolean;
  onPreviewImage?: (preview: ImagePreview) => void;
}) {
  return (
    <ol className={showImages ? "home-rank-drawer-list reaction with-images" : "home-rank-drawer-list reaction"}>
      {entries.map((entry, index) => (
        <li key={entry.id}>
          <span className="home-rank-drawer-index">#{index + 1}</span>
          {showImages && entry.imageUrl ? (
            <button
              type="button"
              className="home-rank-drawer-thumb-button"
              onClick={() => onPreviewImage?.({ src: entry.imageUrl!, title: entry.title })}
              aria-label={`放大查看 ${entry.title} 截图`}
            >
              <img
                className="home-rank-drawer-thumb"
                src={entry.imageUrl}
                alt={`${entry.title} 截图`}
                loading="lazy"
              />
            </button>
          ) : null}
          <div>
            <strong>{entry.title}</strong>
            <small>{entry.year ?? "经典题库"}</small>
          </div>
          <div className="home-rank-drawer-score">
            <strong>{entry.count}</strong>
            <small>{showImages ? "星星" : "爱心"}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function HomeRankingDrawer({
  classicDaily,
  yearlyDaily,
  heartDaily,
  starDaily,
}: HomeRankingDrawerProps) {
  const [open, setOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);

  const boards = useMemo<DailyBoard[]>(
    () => [
      {
        id: "classic",
        label: "经典",
        description: "经典题库今日成绩",
        kind: "score",
        count: classicDaily.length,
      },
      {
        id: "yearly",
        label: "年份",
        description: "年份模式今日成绩",
        kind: "score",
        count: yearlyDaily.length,
      },
      {
        id: "hearts",
        label: "爱心",
        description: "今天被喜欢的番剧",
        kind: "reaction",
        count: heartDaily.length,
      },
      {
        id: "stars",
        label: "星星",
        description: "今天被喜欢的截图",
        kind: "reaction",
        count: starDaily.length,
      },
    ],
    [classicDaily.length, heartDaily.length, starDaily.length, yearlyDaily.length],
  );

  const [activeBoardId, setActiveBoardId] = useState<DailyBoardId>(() => getInitialBoard(boards));

  useEffect(() => {
    setActiveBoardId((current) => {
      if (boards.some((board) => board.id === current && board.count > 0)) {
        return current;
      }
      return getInitialBoard(boards);
    });
  }, [boards]);

  const activeBoard = boards.find((board) => board.id === activeBoardId) ?? boards[0];
  const scoreEntries = activeBoard?.id === "yearly" ? yearlyDaily : classicDaily;
  const reactionEntries = activeBoard?.id === "stars" ? starDaily : heartDaily;
  const entriesCount = activeBoard?.kind === "score" ? scoreEntries.length : reactionEntries.length;
  const emptyLabel =
    activeBoard?.id === "classic"
      ? "今天经典模式还没有成绩。"
      : activeBoard?.id === "yearly"
        ? "今天年份模式还没有成绩。"
        : activeBoard?.id === "hearts"
          ? "今天还没有番剧收到小红心。"
          : "今天还没有截图收到小星星。";

  const toggleButton = (
    <button
      type="button"
      className={open ? "home-rank-toggle active" : "home-rank-toggle"}
      onClick={() => setOpen((current) => !current)}
      aria-expanded={open}
      aria-controls="home-ranking-drawer"
    >
      <span className="home-rank-toggle-lines" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <strong>{open ? "Close" : "今日排行"}</strong>
    </button>
  );

  return (
    <>
      {toggleButton}

      {open ? (
        <div className="home-rank-overlay">
          <button
            type="button"
            className="home-rank-backdrop"
            onClick={() => setOpen(false)}
            aria-label="关闭今日排行"
          />
          <aside id="home-ranking-drawer" className="home-rank-drawer">
            <div className="home-rank-drawer-head">
              <span className="eyebrow">Today</span>
              <h2>今日排行</h2>
              <p>{activeBoard?.description ?? "今日挑战排行"}</p>
            </div>

            <div className="home-rank-tabs" aria-label="今日排行榜类型切换">
              {boards.map((board) => (
                <button
                  key={board.id}
                  type="button"
                  className={activeBoardId === board.id ? "active" : ""}
                  onClick={() => setActiveBoardId(board.id)}
                >
                  <span>{board.label}</span>
                  <small>{board.count}</small>
                </button>
              ))}
            </div>

            {entriesCount === 0 ? (
              <div className="home-rank-drawer-empty">
                <span>NO DATA</span>
                <p>{emptyLabel}</p>
              </div>
            ) : activeBoard?.kind === "score" ? (
              <ScoreDailyList entries={scoreEntries} />
            ) : (
              <ReactionDailyList
                entries={reactionEntries}
                showImages={activeBoard?.id === "stars"}
                onPreviewImage={setPreviewImage}
              />
            )}

            <Link href="/leaderboard" className="home-rank-drawer-link">
              查看完整排行榜
            </Link>
          </aside>
        </div>
      ) : null}

      {previewImage ? (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${previewImage.title} 截图预览`}
        >
          <button
            type="button"
            className="image-lightbox-backdrop"
            onClick={() => setPreviewImage(null)}
            aria-label="关闭图片预览"
          />
          <div className="image-lightbox-panel">
            <button
              type="button"
              className="image-lightbox-close"
              onClick={() => setPreviewImage(null)}
            >
              关闭
            </button>
            <img src={previewImage.src} alt={`${previewImage.title} 截图`} />
            <strong>{previewImage.title}</strong>
          </div>
        </div>
      ) : null}
    </>
  );
}
