import type { NextAuthConfig } from "next-auth";

import { assertAuthRuntimeReady } from "@/lib/runtime-config";

const authRuntime = assertAuthRuntimeReady();

const authConfig: NextAuthConfig = {
  secret: authRuntime.secret,
  trustHost: authRuntime.trustHost,
  providers: [],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/admin/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = String(token.id);
      }

      return session;
    },
  },
};

export default authConfig;
