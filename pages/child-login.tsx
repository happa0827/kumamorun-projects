// 子供のログインリンク（/child-login#code=…）。親が「家族」で発行し、子供の端末で開く。
// コードは URL のフラグメントに載せる（サーバーのログに残らない）。開くとすぐに使い、子供としてログインする。
import { useEffect, useState } from "react";
import { Alert } from "@/components/arc/alert/alert";
import { Skeleton } from "@/components/arc/skeleton/skeleton";

export default function ChildLoginPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(location.hash.slice(1)).get("code");
    // 履歴にコードを残さない
    history.replaceState(null, "", location.pathname);
    if (!code) {
      setError("リンクが正しくありません。親に新しいリンクをもらってください。");
      return;
    }
    void (async () => {
      const response = await fetch("/api/auth/family/child-sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }).catch(() => null);
      if (response?.ok) {
        location.href = "/";
        return;
      }
      setError(
        response?.status === 401
          ? "リンクの期限が切れているか、もう使われています。親に新しいリンクをもらってください。"
          : "ログインできませんでした。時間をおいて、もう一度開いてください。",
      );
    })();
  }, []);

  return (
    <section className="panel" aria-labelledby="child-login-title">
      <div className="panel-head">
        <h1 id="child-login-title">ログイン</h1>
      </div>
      {error === null ? (
        <Skeleton label="ログインしています" lines={2} loading>
          {null}
        </Skeleton>
      ) : (
        <Alert tone="danger" title={error} open />
      )}
    </section>
  );
}
