import { Link } from "@void/react";
import { Card } from "@/components/arc/card/card";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { OpenAppButton } from "../src/components/open-app";
import type { Props } from "./link.server";

export default function LinkPage(props: Props) {
  if (!("self" in props)) return null; // loader が移動させる
  if (props.self) {
    return (
      <section className="panel" aria-labelledby="link-title">
        <div className="panel-head">
          <h1 id="link-title">アプリでログイン</h1>
          <p className="lead">
            <strong>{props.who}</strong> で、このパソコンのアプリにログインします。
          </p>
        </div>
        <OpenAppButton primary />
        <p className="muted">別のアカウントを使うときは、設定からログアウトしてください。</p>
      </section>
    );
  }

  // 親: 子供を選ぶ。?child= で来たら、その子供を先頭に出す
  const children = [...props.children].sort(
    (a, b) => Number(b.id === props.preselected) - Number(a.id === props.preselected),
  );
  return (
    <section className="panel" aria-labelledby="link-title">
      <div className="panel-head">
        <h1 id="link-title">アプリでログイン</h1>
        <p className="lead">
          親は自分ではアプリを使いません。このパソコンを使う子供を選んで、アプリにログインさせてください。
        </p>
      </div>
      {props.selfSignIn.length > 0 && (
        <p className="muted">
          {props.selfSignIn.join("、")}
          は自分の Google で登録しているので、子供が自分でログインします。このパソコンで子供が
          Google でログインしてから、もう一度アプリの「ログイン」を押してください。
        </p>
      )}
      {children.length === 0 ? (
        <EmptyState
          title="ログインさせられる子供がいません"
          description="「家族」で追加した子供（Google なし）を、ここでログインさせられます。"
          action={<Link href="/family">家族へ</Link>}
        />
      ) : (
        <ul className="cards">
          {children.map((child) => (
            <li key={child.id}>
              <Card title={child.name || "（名前なし）"}>
                <OpenAppButton account={child.id} label={`${child.name}でアプリを開く`} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
