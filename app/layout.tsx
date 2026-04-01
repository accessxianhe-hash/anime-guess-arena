import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "番图冲刺",
  description: "面向动漫爱好者的截图竞猜网站",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="site-shell">
          <header className="site-header">
            <Link href="/" className="brand-mark">
              番图冲刺
            </Link>
            <nav className="site-nav">
              <Link href="/play">开始挑战</Link>
              <Link href="/leaderboard">排行榜</Link>
              <Link href="/admin">后台</Link>
            </nav>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
