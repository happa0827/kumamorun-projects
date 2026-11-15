import { useId, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Turnstile, type TurnstileHandle } from "../src/components/turnstile";
import type { Props } from "./contact.server";

type Category = Props["categories"][number]["value"];

export default function ContactPage({
  siteKey,
  turnstileAction,
  email: initialEmail,
  categories,
  maxMessage,
}: Props) {
  const [category, setCategory] = useState<Category>("question");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(initialEmail);
  // おとり欄。人には見えないので、ふつうは空のまま
  const [website, setWebsite] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [widgetBroken, setWidgetBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);
  const messageId = useId();
  const categoryId = useId();

  const trimmedEmail = email.trim();
  const emailError =
    trimmedEmail !== "" && !/^\S+@\S+\.\S+$/.test(trimmedEmail)
      ? "メールアドレスの形にしてください"
      : undefined;
  const tooLong = message.length > maxMessage;
  const canSend = message.trim() !== "" && !tooLong && !emailError && token !== null && !busy;

  if (!siteKey) {
    return (
      <section className="panel" aria-labelledby="contact-title">
        <div className="panel-head">
          <h1 id="contact-title">お問い合わせ</h1>
          <p className="lead">
            いまはフォームを使えません。お手数ですが、
            <a href="https://github.com/happa0827">GitHub</a> からご連絡ください。
          </p>
        </div>
      </section>
    );
  }

  if (sent) {
    return (
      <section className="panel" aria-labelledby="contact-title">
        <div className="panel-head">
          <h1 id="contact-title">送りました</h1>
          <p className="lead">
            ありがとうございます。
            {trimmedEmail
              ? `返事が必要なときは ${trimmedEmail} にお送りします。`
              : "いただいた内容は、すべて目を通します。"}
          </p>
        </div>
        <div className="row">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setMessage("");
              setSent(false);
            }}
          >
            もう1件送る
          </Button>
        </div>
      </section>
    );
  }

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    let response: Response | null = null;
    try {
      response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          message,
          email: trimmedEmail,
          website,
          turnstileToken: token,
        }),
      });
    } catch {
      // 通信できなかった
    }
    setBusy(false);
    // トークンは一度しか使えないので、成功でも失敗でも取り直す
    turnstile.current?.reset();
    if (response?.ok) {
      setSent(true);
      return;
    }
    setError(
      response === null
        ? "送れませんでした。通信を確かめて、もう一度送ってください。"
        : response.status === 429
          ? "短い間に何度も送られています。1時間ほどおいてから送ってください。"
          : response.status === 403
            ? "確認が通りませんでした。もう一度、下の確認を済ませてから送ってください。"
            : `送れませんでした（${response.status}）。少しおいてから、もう一度送ってください。`,
    );
  };

  return (
    <section className="panel" aria-labelledby="contact-title">
      <div className="panel-head">
        <h1 id="contact-title">お問い合わせ</h1>
        <p className="lead">
          質問、不具合の報告、要望などを送れます。ログインしていなくても送れます。
        </p>
      </div>
      <Alert
        tone="danger"
        title={error ?? ""}
        open={error !== null}
        onDismiss={() => setError(null)}
      />
      <form
        className="contact-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor={categoryId}>
            種類
          </label>
          <select
            id={categoryId}
            className="field-control"
            value={category}
            onChange={(event) => setCategory(event.target.value as Category)}
          >
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={messageId}>
            内容
          </label>
          <textarea
            id={messageId}
            className="field-control"
            rows={7}
            required
            value={message}
            aria-invalid={tooLong || undefined}
            aria-describedby={`${messageId}-count`}
            placeholder={
              category === "bug"
                ? "何をしたときに、どうなったか（アプリかサイトか、出たメッセージなど）"
                : undefined
            }
            onChange={(event) => setMessage(event.target.value)}
          />
          <span
            id={`${messageId}-count`}
            className={tooLong ? "field-hint field-hint-error" : "field-hint"}
          >
            {message.length} / {maxMessage}文字
          </span>
        </div>

        <Input
          label="返事の宛先（任意）"
          description="返事が要らなければ空のままで構いません。"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          value={email}
          error={emailError}
          onChange={(event) => setEmail(event.target.value)}
        />

        {/* おとり欄。画面にもスクリーンリーダーにも出さず、Tab でも止まらない。ボットは埋めてしまう */}
        <div className="honeypot" aria-hidden="true">
          <label>
            ウェブサイト
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </label>
        </div>

        <Turnstile
          ref={turnstile}
          siteKey={siteKey}
          action={turnstileAction}
          onToken={(t) => {
            setToken(t);
            if (t) setWidgetBroken(false);
          }}
          onError={() => setWidgetBroken(true)}
        />
        {widgetBroken && (
          <p className="muted">
            確認を読み込めませんでした。広告ブロックなどを切るか、ページを開き直してください。
          </p>
        )}

        <div className="row">
          <Button type="submit" loading={busy} disabled={!canSend}>
            <Send size={16} strokeWidth={1.75} aria-hidden="true" />
            送る
          </Button>
          {token === null && !widgetBroken && (
            <span className="muted">上の確認が済むと送れます</span>
          )}
        </div>
      </form>
    </section>
  );
}
