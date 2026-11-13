// 子供のログインリンク（/child-login#code=…）。親が「家族」で発行し、子供の端末で開く。
// コードは URL のフラグメントに載せる（サーバーのログに残らない）。
// 開いただけではコードを使わない。誰としてログインするか（ログイン中なら、今のアカウントから切り替わること）を
// 見せて、押してもらってから使う。リンクを別の人に開かせて、知らないうちに攻撃者側の子供へ入れ替える形を防ぐ。
import { useEffect, useState } from "react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { Skeleton } from "@/components/arc/skeleton/skeleton";

type Person = { name: string; email: string | null };
type Preview = {
  child: { name: string };
  issuer: Person;
  current: (Person & { same: boolean }) | null;
};

const person = (p: Person) =>
  p.email ? `${p.name || "（名前なし）"}（${p.email}）` : p.name || "（名前なし）";

const EXPIRED =
  "リンクの期限が切れているか、もう使われています。親に新しいリンクをもらってください。";
const FAILED = "ログインできませんでした。時間をおいて、もう一度開いてください。";

export default function ChildLoginPage() {
  const [code, setCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    const found = new URLSearchParams(location.hash.slice(1)).get("code");
    // 履歴にコードを残さない（コードは画面の状態に持つ）
    history.replaceState(null, "", location.pathname);
    if (!found) {
      setError("リンクが正しくありません。親に新しいリンクをもらってください。");
      return;
    }
    setCode(found);
    void (async () => {
      const response = await fetch("/api/child-login/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: found }),
      }).catch(() => null);
      if (response?.ok) setPreview((await response.json()) as Preview);
      else setError(response?.status === 400 ? EXPIRED : FAILED);
    })();
  }, []);

  const signIn = async () => {
    if (!code) return;
    setSigningIn(true);
    const response = await fetch("/api/auth/family/child-sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }).catch(() => null);
    if (response?.ok) {
      location.href = "/";
      return;
    }
    setSigningIn(false);
    setPreview(null);
    setError(response?.status === 401 ? EXPIRED : FAILED);
  };

  const childName = preview?.child.name || "（名前なし）";

  return (
    <section className="panel" aria-labelledby="child-login-title">
      <div className="panel-head">
        <h1 id="child-login-title">ログイン</h1>
      </div>
      {error !== null ? (
        <Alert tone="danger" title={error} open />
      ) : preview === null ? (
        <Skeleton label="リンクを確かめています" lines={2} loading>
          {null}
        </Skeleton>
      ) : preview.current?.same ? (
        <div className="stack">
          <p>すでに{childName}としてログインしています。</p>
          <div className="row">
            <Button type="button" onClick={() => (location.href = "/")}>
              はじめの画面へ
            </Button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <Alert
            tone="warning"
            title={
              preview.current
                ? `今は ${person(preview.current)} でログインしています。${childName}に切り替えますか？`
                : `${childName}としてログインします`
            }
            open
          >
            {person(preview.issuer)}が、子供の{childName}のために作ったリンクです。
            {preview.current
              ? "切り替えると、今のアカウントからはログアウトします。自分のアカウントを使っているなら、切り替えないでください。"
              : "自分のアカウントがあるなら、ログインしないでください。"}
            知らない人から届いたリンクなら、開かずに閉じてください。
          </Alert>
          <div className="row">
            <Button type="button" loading={signingIn} onClick={signIn}>
              {preview.current ? `${childName}に切り替える` : `${childName}としてログイン`}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={signingIn}
              onClick={() => (location.href = "/")}
            >
              やめる
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
