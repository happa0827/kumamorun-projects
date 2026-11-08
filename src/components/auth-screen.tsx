// 登録とログインの画面。メールとパスワード、パスキー、Google。
// ログインできたら next（同じサイトの経路だけ）へ移る。
import { useState } from "react";
import { authClient } from "../auth-client";
import type { OAuthProvider } from "../oauth";

type AuthError = { code?: string; message?: string } | null | undefined;

function errorText(error: AuthError, fallback: string): string {
  switch (error?.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "メールアドレスまたはパスワードが正しくありません";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "このメールアドレスは登録済みです。ログインしてください";
    case "PASSWORD_TOO_SHORT":
      return "パスワードは8文字以上にしてください";
    case "INVALID_EMAIL":
      return "メールアドレスの形が正しくありません";
    case "TOO_MANY_REQUESTS":
      return "試行が多すぎます。少し待ってからもう一度お試しください";
    default:
      return fallback;
  }
}

/** 外のサイトへ飛ばされないよう、"/" で始まり "//" で始まらない経路だけを許す */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function AuthScreen({ providers, next }: { providers: OAuthProvider[]; next: string }) {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = (err: AuthError, fallback: string) => {
    if (err) {
      setError(errorText(err, fallback));
      setBusy(null);
    } else {
      location.href = next;
    }
  };

  return (
    <section className="card" aria-labelledby="auth-title">
      <h2 id="auth-title">{mode === "signIn" ? "ログイン" : "新しく登録"}</h2>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setBusy("password");
          if (mode === "signIn") {
            const { error } = await authClient.signIn.email({ email, password });
            finish(error, "ログインできませんでした");
          } else {
            const { error } = await authClient.signUp.email({ email, password, name: name.trim() || email });
            finish(error, "登録できませんでした");
          }
        }}
      >
        {mode === "signUp" && (
          <label>
            名前
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" maxLength={50} />
          </label>
        )}
        <label>
          メールアドレス
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username webauthn" />
        </label>
        <label>
          パスワード（8文字以上）
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signIn" ? "current-password" : "new-password"}
          />
        </label>
        <button type="submit" className="primary" disabled={busy !== null}>
          {busy === "password" ? "確認中…" : mode === "signIn" ? "ログイン" : "登録"}
        </button>
      </form>

      {mode === "signIn" && (
        <div className="stack">
          <p className="divider">または</p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={async () => {
              setError(null);
              setBusy("passkey");
              const response = await authClient.signIn.passkey();
              finish(response?.error, "パスキーでログインできませんでした");
            }}
          >
            {busy === "passkey" ? "パスキーを確認中…" : "パスキーでログイン"}
          </button>
          {providers.includes("google") && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                setError(null);
                setBusy("google");
                const { error } = await authClient.signIn.social({ provider: "google", callbackURL: next, errorCallbackURL: "/" });
                if (error) finish(error, "Google でログインできませんでした");
              }}
            >
              Google でログイン
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <p className="muted">
        {mode === "signIn" ? "はじめての方は " : "登録済みの方は "}
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === "signIn" ? "signUp" : "signIn");
            setError(null);
          }}
        >
          {mode === "signIn" ? "新しく登録" : "ログイン"}
        </button>
      </p>
    </section>
  );
}
