import { OpenAppButton } from "../src/components/open-app";
import type { Props } from "./link.server";

export default function LinkPage(props: Props) {
  if (!("email" in props)) return null;
  return (
    <section className="panel" aria-labelledby="link-title">
      <div className="panel-head">
        <h1 id="link-title">アプリでログイン</h1>
        <p className="lead">
          <strong>{props.email}</strong> で、このパソコンのアプリにログインします。
        </p>
      </div>
      <OpenAppButton primary />
      <p className="muted">別のアカウントを使うときは、設定からログアウトしてください。</p>
    </section>
  );
}
