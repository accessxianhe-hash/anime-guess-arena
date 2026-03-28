import { AdminLoginForm } from "@/components/admin-login-form";

export default function AdminLoginPage() {
  return (
    <div className="panel" style={{ maxWidth: 560, margin: "56px auto 0" }}>
      <span className="eyebrow">Admin Access</span>
      <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 3vw, 3.2rem)" }}>
        登录后台，开始维护题库。
      </h1>
      <p className="hero-copy">
        这里只开放给管理员。登录后可以手动录题、导入 ZIP 题包、查看题库和站点数据。
      </p>
      <AdminLoginForm />
    </div>
  );
}

