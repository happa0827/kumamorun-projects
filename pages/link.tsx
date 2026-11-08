import { OpenAppButton } from "../src/components/open-app";
import type { Props } from "./link.server";

export default function LinkPage(props: Props) {
  if (!("email" in props)) return null;
  return (
    <section className="card" aria-labelledby="link-title">
      <h2 id="link-title">アプリでログイン</h2>
      <p>
        <strong>{props.email}</strong> で、このパソコンのアプリにログインします。
      </p>
      <OpenAppButton primary />
      <p className="muted">別のアカウントを使うときは、設定からログアウトしてください。</p>
    </section>
  );
}
