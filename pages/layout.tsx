import { Link, useShared } from "@void/react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import "@/components/arc/foundation.css";
import "./app.css";

export default function Layout({ children }: { children: ReactNode }) {
  const { signedIn, kind } = useShared();
  return (
    <div className="shell">
      <header className="site-header">
        <Link href="/" className="brand">
          <img src="/icon.png" alt="" width={32} height={32} className="brand-mark" />
          くまもーるん
        </Link>
        <div className="header-actions">
          {signedIn && kind && (
            <nav aria-label="メニュー" className="nav">
              <Link href="/">状況</Link>
              <Link href="/shop">ショップ</Link>
              {kind === "parent" && <Link href="/family">家族</Link>}
              <Link href="/settings" activeMatch="prefix">
                設定
              </Link>
            </nav>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main className="page">{children}</main>
      <footer className="site-footer">
        <Link href="/privacy">プライバシーポリシー</Link>
      </footer>
    </div>
  );
}
