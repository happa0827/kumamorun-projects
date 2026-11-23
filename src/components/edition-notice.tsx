// 状況ページの、デモ版か完全版かの表示（docs/demo-edition.md）。
// デモ版なら「承認を待っています」と、申し込み先（お問い合わせ）を出す。
import { Link } from "@void/react";
import { Alert } from "@/components/arc/alert/alert";
import { Badge } from "@/components/arc/badge/badge";

/** name は、親が子供の状況を見るとき。自分なら渡さない。 */
export function EditionNotice({ edition, name }: { edition: "full" | "demo"; name?: string }) {
  if (edition === "full")
    return (
      <p className="muted edition-line">
        <Badge tone="success" size="sm" dot>
          完全版
        </Badge>{" "}
        {name ? `${name}のアカウントは承認されています` : "このアカウントは承認されています"}
      </p>
    );
  return (
    <Alert
      tone="info"
      title={`${name ? `${name}のアカウントは` : ""}デモ版です。承認を待っています`}
    >
      デモ版では、キャラクターがシルエットで出て、進化と開花、スタート制限は使えません（タイマーや記録はそのまま使えます）。承認されると、アプリは次の同期で完全版になり、途中の進化と設定も戻ります。承認の申し込みは
      <Link href="/contact">お問い合わせ</Link>
      から、「完全版の申し込み」とアカウントのメールアドレスを書いて送ってください。
    </Alert>
  );
}
