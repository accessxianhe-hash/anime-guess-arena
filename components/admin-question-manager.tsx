"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type AdminQuestion = {
  id: string;
  canonicalTitle: string;
  imageUrl: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  tags: string[];
  active: boolean;
  updatedAt: string;
  attemptCount: number;
  aliases: Array<{
    id: string;
    alias: string;
  }>;
};

const difficultyText = {
  EASY: "简单",
  MEDIUM: "普通",
  HARD: "困难",
} as const;

const initialForm = {
  id: "",
  canonicalTitle: "",
  aliases: "",
  tags: "",
  difficulty: "MEDIUM",
  active: true,
};

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";
type UsageFilter = "ALL" | "USED" | "UNUSED";
type DifficultyFilter = "ALL" | AdminQuestion["difficulty"];

export function AdminQuestionManager({
  questions,
}: {
  questions: AdminQuestion[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [image, setImage] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>("ALL");
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("ALL");
  const [tagFilter, setTagFilter] = useState("ALL");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const editingQuestion = useMemo(
    () => questions.find((question) => question.id === form.id) ?? null,
    [form.id, questions],
  );

  const availableTags = useMemo(
    () =>
      Array.from(new Set(questions.flatMap((question) => question.tags))).sort((left, right) =>
        left.localeCompare(right, "zh-CN"),
      ),
    [questions],
  );

  const catalogStats = useMemo(() => {
    const activeCount = questions.filter((question) => question.active).length;
    const usedCount = questions.filter((question) => question.attemptCount > 0).length;

    return {
      total: questions.length,
      active: activeCount,
      inactive: questions.length - activeCount,
      used: usedCount,
      unused: questions.length - usedCount,
    };
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();

    return questions.filter((question) => {
      if (statusFilter === "ACTIVE" && !question.active) {
        return false;
      }

      if (statusFilter === "INACTIVE" && question.active) {
        return false;
      }

      if (difficultyFilter !== "ALL" && question.difficulty !== difficultyFilter) {
        return false;
      }

      if (usageFilter === "USED" && question.attemptCount === 0) {
        return false;
      }

      if (usageFilter === "UNUSED" && question.attemptCount > 0) {
        return false;
      }

      if (tagFilter !== "ALL" && !question.tags.includes(tagFilter)) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      const haystack = [
        question.canonicalTitle,
        ...question.aliases.map((item) => item.alias),
        ...question.tags,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(keyword);
    });
  }, [difficultyFilter, questions, searchQuery, statusFilter, tagFilter, usageFilter]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    statusFilter !== "ALL" ||
    difficultyFilter !== "ALL" ||
    usageFilter !== "ALL" ||
    tagFilter !== "ALL";

  function resetForm() {
    setForm(initialForm);
    setImage(null);
  }

  function resetFilters() {
    setSearchQuery("");
    setStatusFilter("ALL");
    setDifficultyFilter("ALL");
    setUsageFilter("ALL");
    setTagFilter("ALL");
  }

  function loadQuestion(question: AdminQuestion) {
    setForm({
      id: question.id,
      canonicalTitle: question.canonicalTitle,
      aliases: question.aliases.map((item) => item.alias).join(", "),
      tags: question.tags.join(", "),
      difficulty: question.difficulty,
      active: question.active,
    });
    setImage(null);
    setMessage(null);
    setError(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const formData = new FormData();
    formData.append("canonicalTitle", form.canonicalTitle);
    formData.append("aliases", form.aliases);
    formData.append("tags", form.tags);
    formData.append("difficulty", form.difficulty);
    formData.append("active", String(form.active));
    if (image) {
      formData.append("image", image);
    }

    startTransition(async () => {
      const response = await fetch(
        form.id ? `/api/admin/questions/${form.id}` : "/api/admin/questions",
        {
          method: form.id ? "PATCH" : "POST",
          body: formData,
        },
      );

      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "保存题目失败。");
        return;
      }

      setMessage(form.id ? "题目已更新。" : "题目已创建。");
      resetForm();
      router.refresh();
    });
  }

  async function toggleActive(question: AdminQuestion) {
    const formData = new FormData();
    formData.append("canonicalTitle", question.canonicalTitle);
    formData.append("aliases", question.aliases.map((item) => item.alias).join(", "));
    formData.append("tags", question.tags.join(", "));
    formData.append("difficulty", question.difficulty);
    formData.append("active", String(!question.active));

    startTransition(async () => {
      const response = await fetch(`/api/admin/questions/${question.id}`, {
        method: "PATCH",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "切换题目状态失败。");
        return;
      }

      setMessage(question.active ? "题目已下架。" : "题目已重新上架。");
      router.refresh();
    });
  }

  function handleDelete(question: AdminQuestion) {
    setError(null);
    setMessage(null);

    const confirmed = window.confirm(
      `确认删除《${question.canonicalTitle}》吗？如果它已经被对局使用，系统会阻止删除。`,
    );

    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      const response = await fetch(`/api/admin/questions/${question.id}`, {
        method: "DELETE",
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "删除题目失败。");
        return;
      }

      if (form.id === question.id) {
        resetForm();
      }

      setMessage("题目已删除。");
      router.refresh();
    });
  }

  return (
    <div className="admin-grid">
      <section className="panel stack">
        <div className="split-header">
          <div>
            <span className="eyebrow">手动录题</span>
            <h1 className="section-title">
              {editingQuestion ? "编辑当前题目" : "创建新题目"}
            </h1>
          </div>
          {editingQuestion ? (
            <button type="button" className="button-ghost" onClick={resetForm}>
              取消编辑
            </button>
          ) : null}
        </div>

        <form className="form-stack" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="canonicalTitle">标准作品名</label>
            <input
              id="canonicalTitle"
              value={form.canonicalTitle}
              onChange={(event) =>
                setForm((current) => ({ ...current, canonicalTitle: event.target.value }))
              }
              placeholder="例如：进击的巨人"
            />
          </div>

          <div className="field">
            <label htmlFor="aliases">别名</label>
            <textarea
              id="aliases"
              value={form.aliases}
              onChange={(event) =>
                setForm((current) => ({ ...current, aliases: event.target.value }))
              }
              placeholder="多个别名可用逗号、换行或竖线分隔"
            />
          </div>

          <div className="field">
            <label htmlFor="tags">标签</label>
            <input
              id="tags"
              value={form.tags}
              onChange={(event) =>
                setForm((current) => ({ ...current, tags: event.target.value }))
              }
              placeholder="例如：热血, 校园, 冒险"
            />
          </div>

          <div className="form-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <div className="field">
              <label htmlFor="difficulty">难度</label>
              <select
                id="difficulty"
                value={form.difficulty}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    difficulty: event.target.value as typeof current.difficulty,
                  }))
                }
              >
                <option value="EASY">简单</option>
                <option value="MEDIUM">普通</option>
                <option value="HARD">困难</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="image">截图文件</label>
              <input
                id="image"
                type="file"
                accept="image/*"
                onChange={(event) => setImage(event.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          <label className="pill" style={{ width: "fit-content" }}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) =>
                setForm((current) => ({ ...current, active: event.target.checked }))
              }
              style={{ marginRight: 8 }}
            />
            上架此题
          </label>

          <button className="button" type="submit" disabled={isPending}>
            {isPending ? "保存中..." : editingQuestion ? "保存修改" : "创建题目"}
          </button>
        </form>

        {message ? <div className="message success">{message}</div> : null}
        {error ? <div className="message error">{error}</div> : null}
        {editingQuestion?.attemptCount ? (
          <div className="message">
            当前正在编辑的题目已被对局使用 {editingQuestion.attemptCount} 次。可以继续改图、改别名或下架，但不能直接删除。
          </div>
        ) : null}
      </section>

      <section className="panel stack">
        <div className="split-header">
          <div>
            <span className="eyebrow">当前题库</span>
            <h2 className="section-title">最近维护的题目</h2>
          </div>
          <span className="muted">
            显示 {filteredQuestions.length} / {questions.length} 题
          </span>
        </div>

        <div className="admin-summary-grid">
          <div className="mini-card">
            <span className="muted">题库总量</span>
            <strong>{catalogStats.total}</strong>
          </div>
          <div className="mini-card">
            <span className="muted">已上架</span>
            <strong>{catalogStats.active}</strong>
          </div>
          <div className="mini-card">
            <span className="muted">有作答记录</span>
            <strong>{catalogStats.used}</strong>
          </div>
          <div className="mini-card">
            <span className="muted">当前筛选结果</span>
            <strong>{filteredQuestions.length}</strong>
          </div>
        </div>

        <div className="panel-soft">
          <div className="toolbar">
            <div>
              <strong>搜索与筛选</strong>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                可按作品名、别名、标签、难度、上架状态和使用情况快速定位题目。
              </p>
            </div>
            {hasActiveFilters ? (
              <button type="button" className="button-ghost" onClick={resetFilters}>
                清空筛选
              </button>
            ) : null}
          </div>

          <div className="admin-filter-grid">
            <div className="field">
              <label htmlFor="question-search">关键词搜索</label>
              <input
                id="question-search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜作品名、别名或标签"
              />
            </div>

            <div className="field">
              <label htmlFor="status-filter">上架状态</label>
              <select
                id="status-filter"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="ALL">全部</option>
                <option value="ACTIVE">仅已上架</option>
                <option value="INACTIVE">仅已下架</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="difficulty-filter">难度</label>
              <select
                id="difficulty-filter"
                value={difficultyFilter}
                onChange={(event) =>
                  setDifficultyFilter(event.target.value as DifficultyFilter)
                }
              >
                <option value="ALL">全部</option>
                <option value="EASY">简单</option>
                <option value="MEDIUM">普通</option>
                <option value="HARD">困难</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="usage-filter">使用情况</label>
              <select
                id="usage-filter"
                value={usageFilter}
                onChange={(event) => setUsageFilter(event.target.value as UsageFilter)}
              >
                <option value="ALL">全部</option>
                <option value="USED">已有作答记录</option>
                <option value="UNUSED">未被使用</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="tag-filter">标签</label>
              <select
                id="tag-filter"
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
              >
                <option value="ALL">全部标签</option>
                {availableTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {questions.length === 0 ? (
          <div className="empty-state">题库还是空的，先创建第一道题吧。</div>
        ) : filteredQuestions.length === 0 ? (
          <div className="empty-state">当前筛选条件下没有匹配题目，试试清空筛选或换个关键词。</div>
        ) : (
          <div className="question-list">
            {filteredQuestions.map((question) => (
              <article key={question.id} className="question-row">
                <header>
                  <div>
                    <div className={`status ${question.active ? "active" : "inactive"}`}>
                      {question.active ? "已上架" : "已下架"}
                    </div>
                    <h3 style={{ marginTop: 10 }}>{question.canonicalTitle}</h3>
                  </div>
                  <div className="label-row">
                    <span className="tag">{difficultyText[question.difficulty]}</span>
                    {question.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                    {question.attemptCount > 0 ? <span className="tag">已使用</span> : null}
                  </div>
                </header>
                <div className="spotlight-image" style={{ aspectRatio: "16 / 8.5" }}>
                  <img src={question.imageUrl} alt={question.canonicalTitle} />
                </div>
                <div className="muted">
                  别名：
                  {question.aliases.length > 0
                    ? question.aliases.map((item) => item.alias).join(" / ")
                    : "无"}
                </div>
                <div className="inline-list">
                  <span className="pill">作答记录 {question.attemptCount} 次</span>
                  <span className="pill">更新时间 {formatDateTime(question.updatedAt)}</span>
                </div>
                {question.attemptCount > 0 ? (
                  <div className="message">
                    这道题已经进入过真实对局。为了保留历史成绩，请优先使用“下架题目”，不要直接删除。
                  </div>
                ) : null}
                <div className="toolbar">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => loadQuestion(question)}
                    disabled={isPending}
                  >
                    编辑这道题
                  </button>
                  <button
                    type="button"
                    className="button-ghost"
                    onClick={() => void toggleActive(question)}
                    disabled={isPending}
                  >
                    {question.active ? "下架题目" : "重新上架"}
                  </button>
                  <button
                    type="button"
                    className="button-danger"
                    onClick={() => handleDelete(question)}
                    disabled={isPending || question.attemptCount > 0}
                  >
                    {question.attemptCount > 0 ? "已有作答记录" : "删除题目"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
