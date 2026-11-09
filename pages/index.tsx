// ログインしていれば状況ページ、していなければログインの画面。
import { AuthScreen, safeNext } from "../src/components/auth-screen";
import { StatusView } from "../src/components/status-view";
import type { Props } from "./index.server";

export default function HomePage({ signedIn, providers, next, emailCode, status }: Props) {
  if (!signedIn || !status) {
    return (
      <div className="auth-wrap">
        <AuthScreen providers={providers} next={safeNext(next)} emailCode={emailCode} />
      </div>
    );
  }
  return <StatusView initial={status} />;
}
