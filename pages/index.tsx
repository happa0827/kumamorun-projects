// ログインしていれば状況ページ、していなければログインの画面。
// 親は、家族の子供の状況を見る（子供を切り替える）。
import { Link } from "@void/react";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { AuthScreen, safeNext } from "../src/components/auth-screen";
import { ChildTabs } from "../src/components/child-tabs";
import { EditionNotice } from "../src/components/edition-notice";
import { StatusView } from "../src/components/status-view";
import type { Props } from "./index.server";

export default function HomePage(props: Props) {
  if (!("signedIn" in props)) return null; // loader が移動させる
  if (!props.signedIn) {
    return (
      <div className="auth-wrap">
        <AuthScreen
          providers={props.providers}
          next={safeNext(props.next)}
          emailCode={props.emailCode}
        />
      </div>
    );
  }
  if (props.view === "self")
    return (
      <>
        <EditionNotice edition={props.edition} />
        <StatusView initial={props.status} />
      </>
    );

  const { children, selected, status, edition } = props;
  const child = children.find((c) => c.id === selected);
  if (!child || !status) {
    return (
      <section className="panel">
        <EmptyState
          title="まだ子供がいません"
          description="「家族」から子供を追加すると、ここに子供の状況が出ます。"
          action={<Link href="/family">家族へ</Link>}
        />
      </section>
    );
  }
  return (
    <>
      <ChildTabs base="/" list={children} selected={child.id} />
      <EditionNotice edition={edition} name={child.name} />
      {/* 子供を切り替えたら、取り直しの間隔も作り直す */}
      <StatusView key={child.id} initial={status} account={child.id} name={child.name} />
    </>
  );
}
