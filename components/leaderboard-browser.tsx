"use client";

import { useEffect, useMemo, useState } from "react";

import { LeaderboardTable } from "@/components/leaderboard-table";
import type { ReactionLeaderboardEntry } from "@/lib/challenge-reactions";

type ScoreEntry = {
  id: string;
  nickname: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  accuracy: number;
  durationMs: number;
};

type ReactionBoard = {
  scope: "daily" | "weekly";
  hearts: ReactionLeaderboardEntry[];
  stars: ReactionLeaderboardEntry[];
};

type LeaderboardBrowserProps = {
  classicDaily: ScoreEntry[];
  classicAllTime: ScoreEntry[];
  yearlyDaily: ScoreEntry[];
  yearlyAllTime: ScoreEntry[];
  reactionDaily: ReactionBoard;
  reactionWeekly: ReactionBoard;
};

type BoardCategoryId = "yearly" | "classic" | "hearts" | "stars";
type ScoreScope = "daily" | "allTime";
type ReactionScope = "daily" | "weekly";

type BoardCategory = {
  id: BoardCategoryId;
  label: string;
  meta: string;
  description: string;
  kind: "score" | "reaction";
};

type ImagePreview = {
  src: string;
  title: string;
};

const LEADERBOARD_PAGE_SIZE = 20;

function scopeLabel(scope: ScoreScope | ReactionScope) {
  if (scope === "daily") return "今日榜";
  if (scope === "weekly") return "本周榜";
  return "总榜";
}

function ReactionLeaderboardDetail({
  title,
  entries,
  showImages = false,
  emptyLabel,
  startRank = 1,
  onPreviewImage,
}: {
  title: string;
  entries: ReactionLeaderboardEntry[];
  showImages?: boolean;
  emptyLabel: string;
  startRank?: number;
  onPreviewImage?: (preview: ImagePreview) => void;
}) {
  return (
    <section className="table-card reaction-detail-card">
      <div className="split-header split-header-top">
        <div>
          <div className="eyebrow">{title}</div>
          <h2 className="section-title">互动投票榜</h2>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden="true">NO DATA</div>
          <span>{emptyLabel}</span>
        </div>
      ) : (
        <ol className={showImages ? "reaction-detail-list with-images" : "reaction-detail-list"}>
          {entries.map((entry, index) => (
            <li key={entry.id}>
              <span className={`rank-badge rank-${Math.min(startRank + index, 4)}`}>
                #{startRank + index}
              </span>
              {showImages && entry.imageUrl ? (
                <button
                  type="button"
                  className="reaction-preview-button"
                  onClick={() => onPreviewImage?.({ src: entry.imageUrl!, title: entry.title })}
                  aria-label={`放大查看 ${entry.title} 截图`}
                >
                  <img src={entry.imageUrl} alt={`${entry.title} 截图`} loading="lazy" />
                </button>
              ) : null}
              <div className="reaction-detail-main">
                <strong>{entry.title}</strong>
                <span>{entry.year ?? "经典题库"}</span>
              </div>
              <div className="reaction-detail-score">
                <strong>{entry.count}</strong>
                <span>{showImages ? "星星" : "爱心"}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  totalCount,
  pageSize,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) {
    return (
      <div className="leaderboard-page-summary">
        共 {totalCount} 名，显示前 {Math.min(totalCount, pageSize)} 名
      </div>
    );
  }

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);
  return (
    <div className="leaderboard-pagination" aria-label="排行榜分页">
      <span>
        共 {totalCount} 名 · 每页 {pageSize} 名
      </span>
      <div>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
        >
          上一页
        </button>
        {pages.map((page) => (
          <button
            key={page}
            type="button"
            className={page === currentPage ? "active" : ""}
            onClick={() => onPageChange(page)}
            aria-current={page === currentPage ? "page" : undefined}
          >
            {page}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export function LeaderboardBrowser({
  classicDaily,
  classicAllTime,
  yearlyDaily,
  yearlyAllTime,
  reactionDaily,
  reactionWeekly,
}: LeaderboardBrowserProps) {
  const categories = useMemo<BoardCategory[]>(
    () => [
      {
        id: "yearly",
        label: "年份模式",
        meta: `${yearlyDaily.length} 今日 / ${yearlyAllTime.length} 总榜`,
        description: "年份题挑战成绩",
        kind: "score",
      },
      {
        id: "classic",
        label: "经典模式",
        meta: `${classicDaily.length} 今日 / ${classicAllTime.length} 总榜`,
        description: "经典题库挑战成绩",
        kind: "score",
      },
      {
        id: "hearts",
        label: "小红心",
        meta: `${reactionDaily.hearts.length} 今日 / ${reactionWeekly.hearts.length} 本周`,
        description: "玩家喜欢的番剧",
        kind: "reaction",
      },
      {
        id: "stars",
        label: "小星星",
        meta: `${reactionDaily.stars.length} 今日 / ${reactionWeekly.stars.length} 本周`,
        description: "玩家喜欢的截图",
        kind: "reaction",
      },
    ],
    [classicAllTime, classicDaily, reactionDaily, reactionWeekly, yearlyAllTime, yearlyDaily],
  );
  const [activeCategoryId, setActiveCategoryId] = useState<BoardCategoryId>("yearly");
  const [scoreScope, setScoreScope] = useState<ScoreScope>("daily");
  const [reactionScope, setReactionScope] = useState<ReactionScope>("daily");
  const [currentPage, setCurrentPage] = useState(1);
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);

  const activeCategory =
    categories.find((category) => category.id === activeCategoryId) ?? categories[0]!;

  const isScoreBoard = activeCategory.kind === "score";
  const activeScope = isScoreBoard ? scoreScope : reactionScope;
  const activeTitle = `${activeCategory.label} · ${scopeLabel(activeScope)}`;

  const scoreEntries =
    activeCategory.id === "yearly"
      ? scoreScope === "daily"
        ? yearlyDaily
        : yearlyAllTime
      : scoreScope === "daily"
        ? classicDaily
        : classicAllTime;

  const reactionEntries =
    activeCategory.id === "hearts"
      ? reactionScope === "daily"
        ? reactionDaily.hearts
        : reactionWeekly.hearts
      : reactionScope === "daily"
        ? reactionDaily.stars
        : reactionWeekly.stars;

  const activeEntriesCount = isScoreBoard ? scoreEntries.length : reactionEntries.length;
  const totalPages = Math.max(1, Math.ceil(activeEntriesCount / LEADERBOARD_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = (safeCurrentPage - 1) * LEADERBOARD_PAGE_SIZE;
  const pageStartRank = pageStartIndex + 1;
  const pagedScoreEntries = scoreEntries.slice(
    pageStartIndex,
    pageStartIndex + LEADERBOARD_PAGE_SIZE,
  );
  const pagedReactionEntries = reactionEntries.slice(
    pageStartIndex,
    pageStartIndex + LEADERBOARD_PAGE_SIZE,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategoryId, scoreScope, reactionScope]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const emptyLabel = isScoreBoard
    ? scoreScope === "daily"
      ? `今天${activeCategory.label}还没有成绩。`
      : `${activeCategory.label}总榜暂时为空。`
    : activeCategory.id === "hearts"
      ? reactionScope === "daily"
        ? "今天还没有番剧收到小红心。"
        : "本周还没有番剧收到小红心。"
      : reactionScope === "daily"
        ? "今天还没有截图收到小星星。"
        : "本周还没有截图收到小星星。";

  return (
    <section className="leaderboard-browser">
      <aside className="leaderboard-sidebar" aria-label="排行榜类型切换">
        <div className="leaderboard-sidebar-head">
          <span className="eyebrow">Boards</span>
          <h2>选择排行榜</h2>
        </div>
        <div className="leaderboard-nav">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={
                activeCategory.id === category.id
                  ? "leaderboard-nav-button active"
                  : "leaderboard-nav-button"
              }
              onClick={() => setActiveCategoryId(category.id)}
            >
              <span>{category.label}</span>
              <small>{category.description}</small>
              <em>{category.meta}</em>
            </button>
          ))}
        </div>
      </aside>

      <div className="leaderboard-content">
        <div className="leaderboard-scope-switch" aria-label="排行榜范围切换">
          <div>
            <span className="eyebrow">{activeCategory.label}</span>
            <strong>{activeTitle}</strong>
          </div>
          <div className="leaderboard-scope-tabs">
            {isScoreBoard ? (
              <>
                <button
                  type="button"
                  className={scoreScope === "daily" ? "active" : ""}
                  onClick={() => setScoreScope("daily")}
                >
                  今日榜
                </button>
                <button
                  type="button"
                  className={scoreScope === "allTime" ? "active" : ""}
                  onClick={() => setScoreScope("allTime")}
                >
                  总榜
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={reactionScope === "daily" ? "active" : ""}
                  onClick={() => setReactionScope("daily")}
                >
                  今日榜
                </button>
                <button
                  type="button"
                  className={reactionScope === "weekly" ? "active" : ""}
                  onClick={() => setReactionScope("weekly")}
                >
                  本周榜
                </button>
              </>
            )}
          </div>
        </div>

        {isScoreBoard ? (
          <LeaderboardTable
            title={activeTitle}
            entries={pagedScoreEntries}
            emptyLabel={emptyLabel}
            startRank={pageStartRank}
          />
        ) : (
          <ReactionLeaderboardDetail
            title={activeTitle}
            entries={pagedReactionEntries}
            showImages={activeCategory.id === "stars"}
            emptyLabel={emptyLabel}
            startRank={pageStartRank}
            onPreviewImage={setPreviewImage}
          />
        )}

        <PaginationControls
          currentPage={safeCurrentPage}
          totalPages={totalPages}
          totalCount={activeEntriesCount}
          pageSize={LEADERBOARD_PAGE_SIZE}
          onPageChange={setCurrentPage}
        />

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
      </div>
    </section>
  );
}
