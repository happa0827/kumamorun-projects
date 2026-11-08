import { Link, useShared } from "@void/react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import "@/components/arc/foundation.css";
import "./app.css";

export default function Layout({ children }: { children: ReactNode }) {
  const { signedIn } = useShared();
  return (
    <div className="shell">
      <header className="site-header">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            🧸
          </span>
          くまもーるん
        </Link>
        <div className="header-actions">
          {signedIn && (
            <nav aria-label="メニュー" className="nav">
              <Link href="/">状況</Link>
              <Link href="/settings" activeMatch="prefix">
                設定
              </Link>
            </nav>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main className="page">{children}</main>
    </div>
  );
}
