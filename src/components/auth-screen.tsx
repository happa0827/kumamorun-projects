// ログイン（と登録）の画面。Arc UI のブロック「Login and sign up」（@uiarc/sign-in）を元にしている。
// 見た目と動きはブロックの CSS（arc/blocks/sign-in/sign-in.module.css）と段階の切り替えをそのまま使い、
// デモの部分を本物の認証に置き換えた。
//   本番: Google（登録もここ）とパスキー。完了の段階を見せてから next（同じサイトの経路だけ）へ移る。
//   開発のときだけ、メール → 6桁のコード → 完了の段階も出す（emailCode。auth.ts と揃える）。
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AnimatePresence,
  LayoutGroup,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  type Transition,
  type Variants,
} from "motion/react";
import { Check, KeyRound } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Avatar } from "@/components/arc/avatar/avatar";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { OtpInput } from "@/components/arc/otp-input/otp-input";
import styles from "@/components/arc/blocks/sign-in/sign-in.module.css";
import { authClient } from "../auth-client";
import type { OAuthProvider } from "../oauth";

type Step = "email" | "code" | "done";
type Method = "code" | "passkey" | "google";
type Account = { name: string; email: string };
type AuthError = { code?: string; message?: string; status?: number } | null | undefined;
type StepCustom = { direction: number; reduce: boolean; still?: boolean };

/** コードの再送を待つ秒数。サーバーの送信の制限（60秒に3回）より控えめにする。 */
const RESEND_SECONDS = 30;
/** コードの有効時間（auth.ts の expiresIn と揃える） */
const CODE_MINUTES = 10;
/** 完了の画面を見せてから移るまでの時間 */
const REDIRECT_MS = 1200;

const METHOD_LABELS: Record<Method, string> = {
  code: "メールのコード",
  passkey: "パスキー",
  google: "Google",
};

const domainFixes: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmail.co": "gmail.com",
  "hotmial.com": "hotmail.com",
  "outlok.com": "outlook.com",
  "outlook.co": "outlook.com",
  "iclod.com": "icloud.com",
  "icoud.com": "icloud.com",
  "yaho.com": "yahoo.com",
  "yahoo.co.j": "yahoo.co.jp",
  "docomo.ne.j": "docomo.ne.jp",
};

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
function suggestionFor(value: string) {
  const [local, domain, extra] = value.trim().toLowerCase().split("@");
  return local && domain && extra === undefined && domainFixes[domain]
    ? `${local}@${domainFixes[domain]}`
    : "";
}
/** 名前がまだないうちは、メールアドレスの @ の前を名前の代わりにする */
const nameFromEmail = (email: string) => email.trim().split("@")[0] || "くまもーるん";

function errorText(error: AuthError, fallback: string): string {
  switch (error?.code) {
    case "INVALID_OTP":
      return "コードが違います。最新のメールのコードを確かめてください";
    case "OTP_EXPIRED":
      return "コードの期限が切れました。新しいコードを送ってください";
    case "TOO_MANY_ATTEMPTS":
      return "間違いが多すぎました。新しいコードを送ってください";
    case "INVALID_EMAIL":
      return "メールアドレスの形が正しくありません";
    default:
      if (error?.status === 429) return "試行が多すぎます。少し待ってからもう一度お試しください";
      return fallback;
  }
}

/** 外のサイトへ飛ばされないよう、"/" で始まり "//" で始まらない経路だけを許す */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

// ここから下の stepMotion、roll、RollingTime、useStepHeight は、ブロックの sign-in.tsx と同じ。
const stepMotion: Variants = {
  enter: ({ direction, reduce, still }: StepCustom) =>
    still
      ? { opacity: 1, x: 0, filter: "blur(0px)" }
      : reduce
        ? { opacity: 0 }
        : { opacity: 0, x: direction * 28, filter: `blur(${motionTokens.blur.soft}px)` },
  center: ({ reduce }: StepCustom) => ({
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transition: reduce
      ? { duration: motionTokens.duration.instant }
      : {
          x: motionTokens.spring.smooth,
          opacity: {
            duration: motionTokens.duration.standard,
            ease: motionTokens.ease.enter,
            delay: 0.05,
          },
          filter: { duration: motionTokens.duration.standard, ease: motionTokens.ease.enter },
        },
  }),
  exit: ({ direction, reduce }: StepCustom) =>
    reduce
      ? { opacity: 0, transition: { duration: 0 } }
      : {
          opacity: 0,
          x: direction * -20,
          filter: `blur(${motionTokens.blur.soft}px)`,
          transition: {
            x: motionTokens.spring.smooth,
            opacity: { duration: motionTokens.duration.exit, ease: motionTokens.ease.standard },
            filter: { duration: motionTokens.duration.exit },
          },
        },
};

/** 秒は、数えている間は下へ、新しいコードで数え直すと上へ転がる */
const roll: Variants = {
  enter: (direction: number) => ({
    opacity: 0,
    y: `${-0.7 * direction}em`,
    filter: `blur(${motionTokens.blur.subtle}px)`,
  }),
  center: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: (direction: number) => ({
    opacity: 0,
    y: `${0.7 * direction}em`,
    filter: `blur(${motionTokens.blur.subtle}px)`,
  }),
};

function RollingTime({ seconds, reduce }: { seconds: number; reduce: boolean }) {
  const [shown, setShown] = useState({ seconds, direction: 1 });
  if (shown.seconds !== seconds) setShown({ seconds, direction: seconds < shown.seconds ? 1 : -1 });
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const transition: Transition = reduce
    ? { duration: 0 }
    : {
        y: motionTokens.spring.snappy,
        opacity: { duration: motionTokens.duration.fast },
        filter: { duration: motionTokens.duration.fast },
      };
  return (
    <span className={styles.time}>
      {text.split("").map((character, index) => (
        <span key={index} className={styles.timeColumn}>
          <AnimatePresence initial={false} mode="popLayout" custom={shown.direction}>
            <motion.span
              key={character}
              custom={shown.direction}
              variants={roll}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
            >
              {character}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}

/** 段階が変わる間だけ、カードの高さをばねで追わせる。それ以外は auto のままにする。 */
function useStepHeight(step: Step, reduce: boolean) {
  const track = useRef<HTMLDivElement>(null);
  const height = useMotionValue<number | "auto">("auto");
  const measured = useRef(0);
  const gliding = useRef(false);
  const lastStep = useRef(step);
  const glide = useCallback(
    (to: number) => {
      gliding.current = true;
      animate(height, to, {
        ...motionTokens.spring.smooth,
        onComplete: () => {
          gliding.current = false;
          height.jump("auto");
        },
      });
    },
    [height],
  );
  useEffect(() => {
    const node = track.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      measured.current = entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight;
      if (gliding.current) glide(measured.current);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [glide]);
  useLayoutEffect(() => {
    if (lastStep.current === step) return;
    lastStep.current = step;
    const current = height.get();
    const from = typeof current === "number" ? current : measured.current;
    const to = track.current?.offsetHeight ?? 0;
    if (reduce || !from || !to) {
      gliding.current = false;
      height.jump("auto");
      return;
    }
    if (current === "auto") height.jump(from);
    glide(to);
  }, [step, reduce, height, glide]);
  return { track, height };
}

function GoogleLogo() {
  return (
    <svg
      className={styles.providerMark}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export function AuthScreen({
  providers,
  next,
  emailCode,
}: {
  providers: OAuthProvider[];
  next: string;
  /** メールのコードでのログインを出すか。開発のときだけ true（auth.ts と揃える）。 */
  emailCode: boolean;
}) {
  const hasGoogle = providers.includes("google");
  const id = useId();
  const reduce = !!useReducedMotion();
  const [step, setStep] = useState<Step>("email");
  const [direction, setDirection] = useState(1);
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const [busy, setBusy] = useState<null | "send" | Method>(null);
  const [account, setAccount] = useState<Account>({ name: "", email: "" });
  const [method, setMethod] = useState<Method>("code");
  const [status, setStatus] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef<"email" | "done" | null>(null);
  const { track, height } = useStepHeight(step, reduce);

  const emailError =
    (touched || attempted) && !isEmail(email)
      ? email.trim()
        ? "name@example.com のような形で入れてください"
        : "メールアドレスを入れてください"
      : "";
  const suggestion = touched || attempted ? suggestionFor(email) : "";
  const custom: StepCustom = { direction, reduce };
  const avatarTransition: Transition = reduce ? { duration: 0 } : motionTokens.spring.morph;
  const rise = (index: number) => {
    const delay = 0.14 + index * motionTokens.stagger.line;
    return {
      initial: reduce
        ? { opacity: 0 }
        : { opacity: 0, y: 10, filter: `blur(${motionTokens.blur.soft}px)` },
      animate: { opacity: 1, y: 0, filter: "blur(0px)" },
      transition: (reduce
        ? { duration: motionTokens.duration.instant }
        : {
            y: { ...motionTokens.spring.smooth, delay },
            opacity: {
              duration: motionTokens.duration.standard,
              ease: motionTokens.ease.enter,
              delay,
            },
            filter: { duration: motionTokens.duration.standard, delay },
          }) as Transition,
    };
  };

  useEffect(() => {
    if (step !== "code" || resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [step, resendIn]);

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "email") {
      emailRef.current?.focus();
      emailRef.current?.select();
    }
    if (target === "done") doneRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (step !== "done") return;
    const timer = window.setTimeout(() => location.assign(next), REDIRECT_MS);
    return () => window.clearTimeout(timer);
  }, [step, next]);

  function go(to: Step, towards: number, focus: "email" | "done" | null = null) {
    focusNext.current = focus;
    setDirection(towards);
    setStep(to);
  }
  const focusCode = () => codeRef.current?.querySelector("input")?.focus();

  function complete(next: Account, how: Method) {
    setBusy(null);
    setError(null);
    setAccount(next);
    setMethod(how);
    go("done", 1, "done");
    setStatus(`${METHOD_LABELS[how]}でログインしました`);
  }

  /** パスキーではメールアドレスを入れないので、ログインできた後にセッションから読む */
  async function completeFromSession(how: Method) {
    const { data } = await authClient.getSession();
    const user = data?.user;
    complete({ name: user?.name ?? "", email: user?.email ?? "" }, how);
  }

  async function sendCode() {
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email: email.trim(),
      type: "sign-in",
    });
    return error;
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setAttempted(true);
    if (!isEmail(email)) {
      emailRef.current?.focus();
      return;
    }
    setBusy("send");
    setError(null);
    setStatus("コードを送っています");
    const failed = await sendCode();
    setBusy(null);
    if (failed) {
      setError(errorText(failed, "コードを送れませんでした。少し待ってからお試しください"));
      setStatus("送れませんでした");
      return;
    }
    setAccount({ name: "", email: email.trim() });
    setCode("");
    setCodeError("");
    setResendIn(RESEND_SECONDS);
    go("code", 1);
    setStatus("コードを送りました");
  }

  async function verify(value: string) {
    if (busy) return;
    if (value.length < 6) {
      setCodeError("6桁すべてを入れてください");
      focusCode();
      return;
    }
    setBusy("code");
    setStatus("コードを確かめています");
    const { data, error } = await authClient.signIn.emailOtp({ email: account.email, otp: value });
    if (error) {
      setBusy(null);
      setCode("");
      setCodeError(errorText(error, "コードを確かめられませんでした"));
      setStatus("コードが合いませんでした");
      focusCode();
      return;
    }
    complete({ name: data?.user.name ?? "", email: account.email }, "code");
  }

  function changeCode(value: string) {
    if (busy) return;
    setCode(value);
    if (codeError && value) setCodeError("");
    if (value.length === 6) void verify(value);
  }

  async function resend() {
    if (busy || resendIn > 0) return;
    setBusy("send");
    setCode("");
    setCodeError("");
    const failed = await sendCode();
    setBusy(null);
    if (failed) {
      setCodeError(errorText(failed, "コードを送れませんでした。少し待ってからお試しください"));
      return;
    }
    setResendIn(RESEND_SECONDS);
    setStatus("新しいコードを送りました");
    focusCode();
  }

  function changeEmail() {
    if (busy) return;
    setAttempted(false);
    setError(null);
    go("email", -1, "email");
    setStatus("メールアドレスを直せます");
  }

  async function signInWithPasskey() {
    if (busy) return;
    setBusy("passkey");
    setError(null);
    setStatus("パスキーを待っています");
    const response = await authClient.signIn.passkey();
    if (response?.error) {
      setBusy(null);
      setError(errorText(response.error, "パスキーでログインできませんでした"));
      setStatus("うまくいきませんでした");
      return;
    }
    await completeFromSession("passkey");
  }

  async function signInWithGoogle() {
    if (busy) return;
    setBusy("google");
    setError(null);
    setStatus("Google を開いています");
    // 成功すると Google へ移り、戻ってくると callbackURL（next）が開く
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: next,
      errorCallbackURL: "/",
    });
    if (error) {
      setBusy(null);
      setError(errorText(error, "Google でログインできませんでした"));
      setStatus("うまくいきませんでした");
    }
  }

  const displayName = account.name || nameFromEmail(account.email);

  return (
    <section className={styles.signIn} aria-label="ログイン">
      <LayoutGroup id={id}>
        <motion.div className={styles.viewport} style={{ height }}>
          <div ref={track} className={styles.track}>
            <AnimatePresence mode="popLayout" initial={false} custom={custom}>
              {step === "email" && (
                <motion.div
                  key="email"
                  className={styles.step}
                  custom={custom}
                  variants={stepMotion}
                  initial="enter"
                  animate="center"
                  exit="exit"
                >
                  <div className={styles.heading}>
                    <h2>くまもーるんにログイン</h2>
                    <p>
                      {emailCode
                        ? "開発用: メールアドレスに、6桁のコードを送ります（開発サーバーの受け箱に届きます）。"
                        : "Google か、登録したパスキーでログインします。"}
                    </p>
                  </div>
                  {!emailCode && !hasGoogle && (
                    <Alert tone="warning" title="Google でのログインがまだ設定されていません">
                      設定が済むまで、新しく登録できません。
                    </Alert>
                  )}
                  {emailCode && (
                    <form className={styles.form} onSubmit={submitEmail} noValidate>
                      <div className={styles.fieldGroup}>
                        <Input
                          ref={emailRef}
                          label="メールアドレス"
                          type="email"
                          inputMode="email"
                          autoComplete="email webauthn"
                          autoCapitalize="none"
                          spellCheck={false}
                          placeholder="name@example.com"
                          value={email}
                          readOnly={busy === "send"}
                          error={emailError}
                          onChange={(event) => setEmail(event.target.value)}
                          onBlur={() => {
                            if (email.trim()) setTouched(true);
                          }}
                        />
                        <AnimatePresence initial={false}>
                          {suggestion && (
                            <motion.div
                              key="suggestion"
                              className={styles.suggestion}
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={
                                reduce
                                  ? { duration: 0 }
                                  : {
                                      height: motionTokens.spring.smooth,
                                      opacity: { duration: motionTokens.duration.fast },
                                    }
                              }
                            >
                              <p>
                                <button
                                  type="button"
                                  className={styles.textButton}
                                  aria-label={`${suggestion} にする`}
                                  onClick={() => {
                                    setEmail(suggestion);
                                    setStatus(`メールアドレスを ${suggestion} にしました`);
                                    emailRef.current?.focus();
                                  }}
                                >
                                  {suggestion}
                                </button>
                                ではありませんか？
                              </p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      <Button type="submit" className={styles.wide} loading={busy === "send"}>
                        コードを送る
                      </Button>
                    </form>
                  )}
                  {emailCode && <div className={styles.divider}>または</div>}
                  <div className={styles.alternatives}>
                    {hasGoogle && (
                      <Button
                        type="button"
                        variant={emailCode ? "secondary" : "primary"}
                        className={styles.wide}
                        loading={busy === "google"}
                        onClick={signInWithGoogle}
                      >
                        <GoogleLogo />
                        Google で続ける
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      className={styles.wide}
                      loading={busy === "passkey"}
                      onClick={signInWithPasskey}
                    >
                      <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />
                      パスキーでログイン
                    </Button>
                  </div>
                  <Alert
                    tone="danger"
                    title={error ?? ""}
                    open={error !== null}
                    onDismiss={() => setError(null)}
                  />
                </motion.div>
              )}

              {step === "code" && (
                <motion.div
                  key="code"
                  className={styles.step}
                  custom={custom}
                  variants={stepMotion}
                  initial="enter"
                  animate="center"
                  exit="exit"
                >
                  <div className={styles.heading}>
                    <h2>メールを確かめてください</h2>
                    <p>届いた6桁のコードを入れてください。{CODE_MINUTES}分で失効します。</p>
                  </div>
                  <div className={styles.identity}>
                    <motion.span
                      layoutId="account-avatar"
                      className={`${styles.avatarMover} ${styles.avatarSmall}`}
                      transition={avatarTransition}
                    >
                      <Avatar
                        name={nameFromEmail(account.email)}
                        size="xl"
                        className={styles.avatarFill}
                      />
                    </motion.span>
                    <span className={styles.identityEmail}>{account.email}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="メールアドレスを変える"
                      onClick={changeEmail}
                    >
                      変更
                    </Button>
                  </div>
                  <form
                    className={styles.form}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void verify(code);
                    }}
                    noValidate
                  >
                    <div ref={codeRef}>
                      <OtpInput
                        label="ログインコード"
                        description="届かないときは、迷惑メールのフォルダも見てください。"
                        value={code}
                        onChange={changeCode}
                        error={codeError}
                        autoFocus
                      />
                    </div>
                    <Button type="submit" className={styles.wide} loading={busy === "code"}>
                      ログイン
                    </Button>
                  </form>
                  <button
                    type="button"
                    className={styles.resend}
                    aria-disabled={resendIn > 0 || busy !== null || undefined}
                    aria-label={
                      resendIn > 0 ? `コードの再送は${resendIn}秒後にできます` : "コードを再送する"
                    }
                    onClick={resend}
                  >
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={resendIn > 0 ? "wait" : "ready"}
                        className={styles.resendLabel}
                        initial={
                          reduce
                            ? { opacity: 0 }
                            : { opacity: 0, y: 6, filter: `blur(${motionTokens.blur.soft}px)` }
                        }
                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                        exit={
                          reduce
                            ? { opacity: 0, transition: { duration: 0 } }
                            : {
                                opacity: 0,
                                y: -4,
                                filter: `blur(${motionTokens.blur.subtle}px)`,
                                transition: { duration: motionTokens.duration.fast },
                              }
                        }
                        transition={
                          reduce
                            ? { duration: motionTokens.duration.instant }
                            : {
                                duration: motionTokens.duration.standard,
                                ease: motionTokens.ease.enter,
                              }
                        }
                      >
                        {resendIn > 0 ? (
                          <>
                            コードの再送まで <RollingTime seconds={resendIn} reduce={reduce} />
                          </>
                        ) : (
                          "コードを再送する"
                        )}
                      </motion.span>
                    </AnimatePresence>
                  </button>
                </motion.div>
              )}

              {step === "done" && (
                <motion.div
                  key="done"
                  className={styles.step}
                  custom={{ ...custom, still: true }}
                  variants={stepMotion}
                  initial="enter"
                  animate="center"
                  exit="exit"
                >
                  <div className={styles.avatarStage}>
                    <svg className={styles.ring} viewBox="0 0 96 96" aria-hidden="true">
                      <motion.circle
                        cx="48"
                        cy="48"
                        r="47"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        initial={reduce ? false : { pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{
                          pathLength: {
                            duration: motionTokens.duration.considered * 1.25,
                            ease: motionTokens.ease.inOut,
                            delay: 0.22,
                          },
                          opacity: { duration: motionTokens.duration.instant, delay: 0.22 },
                        }}
                      />
                    </svg>
                    <motion.span
                      layoutId="account-avatar"
                      className={`${styles.avatarMover} ${styles.avatarLarge}`}
                      initial={method === "code" || reduce ? false : { opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={avatarTransition}
                    >
                      <Avatar name={displayName} size="xl" className={styles.avatarFill} />
                    </motion.span>
                    <motion.span
                      className={styles.badge}
                      aria-hidden="true"
                      initial={reduce ? false : { opacity: 0, scale: 0.4 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ ...motionTokens.spring.snappy, delay: 0.78 }}
                    >
                      <Check size={14} strokeWidth={2.25} />
                    </motion.span>
                  </div>
                  <motion.div className={styles.heading} {...rise(0)}>
                    <h2 ref={doneRef} tabIndex={-1}>
                      ようこそ、{displayName}さん
                    </h2>
                    <p className={styles.email}>{account.email}</p>
                  </motion.div>
                  <motion.dl className={styles.details} {...rise(1)}>
                    <div>
                      <dt>ログインの方法</dt>
                      <dd>{METHOD_LABELS[method]}</dd>
                    </div>
                    <div>
                      <dt>次の画面</dt>
                      <dd>すぐに移ります</dd>
                    </div>
                  </motion.dl>
                  <motion.div {...rise(2)}>
                    <Button
                      type="button"
                      variant="secondary"
                      className={styles.wide}
                      onClick={() => location.assign(next)}
                    >
                      続ける
                    </Button>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </LayoutGroup>

      <footer className={styles.footer}>
        <p className={styles.srOnly} role="status" aria-live="polite">
          {status}
        </p>
        <span className={styles.status} aria-hidden="true">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={status}
              initial={
                reduce
                  ? { opacity: 0 }
                  : { opacity: 0, y: 6, filter: `blur(${motionTokens.blur.soft}px)` }
              }
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={
                reduce
                  ? { opacity: 0, transition: { duration: 0 } }
                  : {
                      opacity: 0,
                      y: -4,
                      filter: `blur(${motionTokens.blur.subtle}px)`,
                      transition: { duration: motionTokens.duration.fast },
                    }
              }
              transition={
                reduce
                  ? { duration: motionTokens.duration.instant }
                  : { duration: motionTokens.duration.standard, ease: motionTokens.ease.enter }
              }
            >
              {status}
            </motion.span>
          </AnimatePresence>
        </span>
        {step !== "done" && (
          <span className={styles.switch}>
            {emailCode
              ? "はじめてのメールアドレスは、そのまま登録になります"
              : "はじめての方は Google で登録し、設定からパスキーを足せます"}
          </span>
        )}
      </footer>
    </section>
  );
}
