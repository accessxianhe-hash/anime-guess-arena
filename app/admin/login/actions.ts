"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";

type LoginState = {
  error: string | null;
};

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/admin",
    });

    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: "邮箱或密码不正确。",
      };
    }

    throw error;
  }
}

