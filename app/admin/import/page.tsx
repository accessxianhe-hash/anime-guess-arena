import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AdminImportForm } from "@/components/admin-import-form";
import { getStorageConfigStatus } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

export default async function AdminImportPage() {
  const session = await auth();
  if (!session) {
    redirect("/admin/login");
  }

  const storage = getStorageConfigStatus();

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section className="panel">
        <span className="eyebrow">Bulk Import</span>
        <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 3vw, 3.4rem)" }}>
          批量导入 ZIP 题包
        </h1>
        <p className="hero-copy">
          适合一次性录入整批截图题目。系统会逐行校验 CSV，能导入的题目直接入库，
          出错的行会在结果里标出来。
        </p>
        <div
          className={storage.isReady ? "message success" : "message error"}
          style={{ marginTop: 16 }}
        >
          {storage.isReady
            ? `当前导入会写入 ${storage.provider}，前缀 ${storage.keyPrefix || "(空)"}`
            : storage.issues.map((issue) => issue.message).join("；")}
        </div>
      </section>
      <AdminImportForm />
    </div>
  );
}
