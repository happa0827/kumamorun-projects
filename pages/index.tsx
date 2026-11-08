// 段階 0 の検証用の画面。登録、ログイン、パスキー、Google、アプリへのコードの発行を1か所で試す。
// 本番の画面は段階 1 で作り直す。
import { useState } from "react";
import { authClient } from "../src/auth-client";
import type { Props } from "./index.server";
import "./style.css";

type Result = { ok: boolean; text: string } | null;

const message = (error: { message?: string; code?: string } | null | undefined, fallback: string) =>
  error?.message ?? error?.code ?? fallback;

export default function HomePage({ user, providers, devices }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [result, setResult] = useState<Result>(null);
  const [link, setLink] = useState<string | null>(null);

  const done = (error: Parameters<typeof message>[0], fallback: string) => {
    if (error) setResult({ ok: false, text: message(error, fallback) });
    else location.reload();
  };

  if (!user) {
    return (
      <main>
        <h1>くまもるん</h1>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const { error } = await authClient.signIn.email({ email, password });
            done(error, "ログインできませんでした");
          }}
        >
          <label>
            メールアドレス
            <input type="email" autoComplete="username webauthn" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            パスワード
            <input type="password" autoComplete="current-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <label>
            名前（登録のときだけ）
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="row">
            <button type="submit">ログイン</button>
            <button
              type="button"
              onClick={async () => {
                const { error } = await authClient.signUp.email({ email, password, name: name || email });
                done(error, "登録できませんでした");
              }}
            >
              登録
            </button>
          </div>
        </form>
        <div className="row">
          <button
            type="button"
            onClick={async () => {
              const response = await authClient.signIn.passkey();
              done(response?.error, "パスキーでログインできませんでした");
            }}
          >
            パスキーでログイン
          </button>
          {providers.includes("google") && (
            <button
              type="button"
              onClick={async () => {
                const { error } = await authClient.signIn.social({ provider: "google", callbackURL: "/" });
                if (error) setResult({ ok: false, text: message(error, "Google でログインできませんでした") });
              }}
            >
              Google でログイン
            </button>
          )}
        </div>
        {result && <p className={result.ok ? "ok" : "error"} role="status">{result.text}</p>}
      </main>
    );
  }

  return (
    <main>
      <h1>くまもるん</h1>
      <p>
        {user.name}（{user.email}）でログイン中
      </p>
      <div className="row">
        <button
          type="button"
          onClick={async () => {
            const response = await fetch("/api/login-code", { method: "POST" });
            if (!response.ok) return setResult({ ok: false, text: `コードを発行できませんでした（${response.status}）` });
            const { url } = (await response.json()) as { url: string };
            setLink(url);
            location.href = url;
          }}
        >
          アプリを開く
        </button>
        <button
          type="button"
          onClick={async () => {
            const response = await authClient.passkey.addPasskey({ name: "パスキー" });
            if (response?.error) setResult({ ok: false, text: message(response.error, "パスキーを登録できませんでした") });
            else setResult({ ok: true, text: "パスキーを登録しました" });
          }}
        >
          パスキーを登録
        </button>
        <button type="button" onClick={async () => done((await authClient.signOut()).error, "ログアウトできませんでした")}>
          ログアウト
        </button>
      </div>
      {link && (
        <p>
          アプリが開かないときは、このリンクを使ってください（5分で失効）: <code>{link}</code>
        </p>
      )}
      {result && <p className={result.ok ? "ok" : "error"} role="status">{result.text}</p>}
      <h2>端末</h2>
      {devices.length === 0 ? (
        <p>まだ端末がありません。</p>
      ) : (
        <ul>
          {devices.map((device) => (
            <li key={device.id}>
              {device.name}（最終利用 {new Date(device.lastSeenAt).toLocaleString("ja-JP")}）
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
