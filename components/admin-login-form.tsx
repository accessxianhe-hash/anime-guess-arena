"use client";

import { useActionState } from "react";

import { loginAction } from "@/app/admin/login/actions";

const initialState = {
  error: null,
};

export function AdminLoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="form-stack">
      <div className="field">
        <label htmlFor="email">管理员邮箱</label>
        <input id="email" name="email" type="email" placeholder="admin@example.com" required />
      </div>
      <div className="field">
        <label htmlFor="password">密码</label>
        <input id="password" name="password" type="password" placeholder="请输入密码" required />
      </div>
      <button type="submit" className="button" disabled={isPending}>
        {isPending ? "登录中..." : "进入后台"}
      </button>
      {state.error ? <div className="message error">{state.error}</div> : null}
    </form>
  );
}

