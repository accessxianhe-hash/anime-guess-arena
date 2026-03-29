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

export function AdminQuestionManager({
  questions,
}: {
  questions: AdminQuestion[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [image, setImage] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const editingQuestion = useMemo(
    () => questions.find((question) => question.id === form.id) ?? null,
    [form.id, questions],
  );

  function resetForm() {
    setForm(initialForm);
    setImage(null);
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

    const response = await fetch(`/api/admin/questions/${question.id}`, {
      method: "PATCH",
      body: formData,
    });

    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "切换题目状态失败。");
      return;
    }

    router.refresh();
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
      </section>

      <section className="panel stack">
        <div className="split-header">
          <div>
            <span className="eyebrow">当前题库</span>
            <h2 className="section-title">最近维护的题目</h2>
          </div>
          <span className="muted">共 {questions.length} 题</span>
        </div>

        {questions.length === 0 ? (
          <div className="empty-state">题库还是空的，先创建第一道题吧。</div>
        ) : (
          <div className="question-list">
            {questions.map((question) => (
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
                <div className="toolbar">
                  <button type="button" className="button-secondary" onClick={() => loadQuestion(question)}>
                    编辑这道题
                  </button>
                  <button
                    type="button"
                    className="button-ghost"
                    onClick={() => void toggleActive(question)}
                  >
                    {question.active ? "下架题目" : "重新上架"}
                  </button>
                  <button
                    type="button"
                    className="button-danger"
                    onClick={() => handleDelete(question)}
                    disabled={isPending}
                  >
                    删除题目
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
