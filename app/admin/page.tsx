import Link from "next/link";
import { redirect } from "next/navigation";

import { logoutAction } from "@/app/admin/actions";
import { auth } from "@/auth";
import { getAdminDashboardStats } from "@/lib/admin";
import { getDeploymentReadiness } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const session = await auth();
  if (!session) {
    redirect("/admin/login");
  }

  const stats = await getAdminDashboardStats();
  const readiness = getDeploymentReadiness();

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section className="panel">
        <div className="split-header">
          <div>
            <span className="eyebrow">Admin Dashboard</span>
            <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 3vw, 3.6rem)" }}>
              题库运营控制台
            </h1>
            <p className="hero-copy">
              你好，{session.user.name ?? session.user.email}。这里负责题目管理、批量导入和站点概况查看。
            </p>
          </div>
          <form action={logoutAction}>
            <button className="button-danger" type="submit">
              退出登录
            </button>
          </form>
        </div>

        <div className="stat-grid">
          <div className="stat-card">
            <span className="muted">题目总数</span>
            <strong>{stats.questionCount}</strong>
          </div>
          <div className="stat-card">
            <span className="muted">已上架题目</span>
            <strong>{stats.activeQuestionCount}</strong>
          </div>
          <div className="stat-card">
            <span className="muted">累计对局</span>
            <strong>{stats.sessionCount}</strong>
          </div>
        </div>

        <div className="stack" style={{ marginTop: 20 }}>
          <div className={readiness.issues.length === 0 ? "message success" : "message error"}>
            当前运行环境：{readiness.stage}
            {readiness.issues.length === 0
              ? "，部署关键配置已就绪。"
              : `，还有 ${readiness.issues.length} 项配置需要补齐。`}
          </div>
          {readiness.issues.length > 0
            ? readiness.issues.map((issue) => (
                <div key={`${issue.key}-${issue.message}`} className="message error">
                  {issue.message}
                </div>
              ))
            : null}
        </div>
      </section>

      <div className="two-column">
        <section className="panel stack">
          <span className="eyebrow">管理入口</span>
          <Link className="button" href="/admin/questions">
            进入题库管理
          </Link>
          <Link className="button-secondary" href="/admin/import">
            打开批量导入
          </Link>
          <a className="button-ghost" href="/api/health" target="_blank" rel="noreferrer">
            打开健康检查 JSON
          </a>
          <div className="message">
            生产部署前建议运行 <code>npm run deploy:check</code>，上线后再访问
            <code>/api/health</code> 复核数据库、认证地址和对象存储状态。
          </div>
        </section>

        <section className="panel stack">
          <span className="eyebrow">站点提示</span>
          <div className="feature-card">
            <h3>游客模式</h3>
            <p className="muted">前台无需登录，只有结算后提交昵称时才会写入排行榜。</p>
          </div>
          <div className="feature-card">
            <h3>题目规则</h3>
            <p className="muted">同一局内不会重复出题，判题按标准名和别名做规范化匹配。</p>
          </div>
          <div className="feature-card">
            <h3>排行榜</h3>
            <p className="muted">当前共有 {stats.leaderboardCount} 条有效榜单记录。</p>
          </div>
          <div className="feature-card">
            <h3>对象存储</h3>
            <p className="muted">
              当前使用 {readiness.storage.provider}，上传前缀为
              <code>{readiness.storage.keyPrefix || "(空)"}</code>。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
