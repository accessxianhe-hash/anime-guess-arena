import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import authConfig from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === "/admin/login";

  if (!request.auth && !isLoginPage) {
    return NextResponse.redirect(new URL("/admin/login", request.nextUrl));
  }

  if (request.auth && isLoginPage) {
    return NextResponse.redirect(new URL("/admin", request.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*"],
};
