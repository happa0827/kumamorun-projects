// ログインしていれば状況ページ、していなければ登録とログインの画面。
import { AuthScreen, safeNext } from "../src/components/auth-screen";
import { StatusView } from "../src/components/status-view";
import type { Props } from "./index.server";

export default function HomePage({ signedIn, providers, next, status }: Props) {
  if (!signedIn || !status) {
    return (
      <div className="auth-wrap">
        <AuthScreen providers={providers} next={safeNext(next)} />
      </div>
    );
  }
  return <StatusView initial={status} />;
}
