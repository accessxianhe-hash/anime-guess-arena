"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ImportResponse = {
  imported: number;
  errors: Array<{
    row: number;
    message: string;
  }>;
};

export function AdminImportForm() {
  const router = useRouter();
  const [archive, setArchive] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!archive) {
      setError("请先选择包含 questions.csv 和图片的 ZIP 包。");
      return;
    }

    const formData = new FormData();
    formData.append("archive", archive);

    startTransition(async () => {
      const response = await fetch("/api/admin/import", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "导入失败，请稍后再试。");
        return;
      }

      setResult(payload);
      router.refresh();
    });
  }

  return (
    <div className="panel stack">
      <span className="eyebrow">ZIP 批量导入</span>
      <h1 className="section-title">一口气导入整批截图题目</h1>
      <p className="muted">
        ZIP 包内必须有 `questions.csv`，并保证 CSV 里的 `image_filename` 能在压缩包里找到同名图片。
      </p>
      <form className="form-stack" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="archive">ZIP 文件</label>
          <input
            id="archive"
            type="file"
            accept=".zip"
            onChange={(event) => setArchive(event.target.files?.[0] ?? null)}
          />
        </div>
        <button className="button" type="submit" disabled={isPending}>
          {isPending ? "导入中..." : "开始导入"}
        </button>
      </form>

      {error ? <div className="message error">{error}</div> : null}

      {result ? (
        <div className="stack">
          <div className="message success">成功导入 {result.imported} 道题目。</div>
          {result.errors.length > 0 ? (
            <div className="panel-soft stack">
              <h3 style={{ margin: 0 }}>导入错误</h3>
              {result.errors.map((item) => (
                <div key={`${item.row}-${item.message}`} className="message error">
                  第 {item.row} 行：{item.message}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

