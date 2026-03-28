import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getQuestionsForAdmin } from "@/lib/admin";
import { AdminQuestionManager } from "@/components/admin-question-manager";
import { getStorageConfigStatus } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

export default async function AdminQuestionsPage() {
  const session = await auth();
  if (!session) {
    redirect("/admin/login");
  }

  const questions = await getQuestionsForAdmin();
  const storage = getStorageConfigStatus();

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section className="panel">
        <span className="eyebrow">Question Manager</span>
        <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 3vw, 3.4rem)" }}>
          手动录题与编辑题库
        </h1>
        <p className="hero-copy">
          每道题至少要有截图和标准作品名。别名、难度、标签和上架状态都可以在这里维护。
        </p>
        <div
          className={storage.isReady ? "message success" : "message error"}
          style={{ marginTop: 16 }}
        >
          {storage.isReady
            ? `当前上传目标：${storage.provider}，前缀 ${storage.keyPrefix || "(空)"}`
            : storage.issues.map((issue) => issue.message).join("；")}
        </div>
      </section>

      <AdminQuestionManager questions={questions} />
    </div>
  );
}
