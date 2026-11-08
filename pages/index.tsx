// ログインしていれば状況ページ、していなければ登録とログインの画面。
import { AuthScreen, safeNext } from "../src/components/auth-screen";
import { StatusView } from "../src/components/status-view";
import type { Props } from "./index.server";

export default function HomePage({ signedIn, providers, next, status }: Props) {
  if (!signedIn || !status) {
    return (
      <>
        <p className="lead">今の守り状態を見るには、ログインしてください。</p>
        <AuthScreen providers={providers} next={safeNext(next)} />
      </>
    );
  }
  return <StatusView initial={status} />;
}
