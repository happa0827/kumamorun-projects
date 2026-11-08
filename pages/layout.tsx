import { Link, useShared } from "@void/react";
import type { ReactNode } from "react";
import "./style.css";

export default function Layout({ children }: { children: ReactNode }) {
  const { signedIn } = useShared();
  return (
    <>
      <header className="site-header">
        <Link href="/" className="brand">
          くまもーるん
        </Link>
        {signedIn && (
          <nav aria-label="メニュー">
            <Link href="/">状況</Link>
            <Link href="/settings">設定</Link>
          </nav>
        )}
      </header>
      <main>{children}</main>
    </>
  );
}
