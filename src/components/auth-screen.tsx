// 登録とログインの画面。Arc UI のブロック「Login and sign up」（@uiarc/sign-in）を元にしている。
// 見た目と動きはブロックの CSS（arc/blocks/sign-in/sign-in.module.css）と段階の切り替えをそのまま使い、
// 中身をくまもーるんの認証（メールとパスワード、パスキー、Google）に置き換えた。
//   段階: メール → パスワード（登録では名前も） → 完了。完了したら next（同じサイトの経路だけ）へ移る。
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
import { PasswordField } from "@/components/arc/password-field/password-field";
import styles from "@/components/arc/blocks/sign-in/sign-in.module.css";
import { authClient } from "../auth-client";
import type { OAuthProvider } from "../oauth";

type Step = "email" | "password" | "done";
type Mode = "signIn" | "signUp";
type Method = "password" | "passkey" | "google";
type Account = { name: string; email: string };
type AuthError = { code?: string; message?: string } | null | undefined;
type StepCustom = { direction: number; reduce: boolean; still?: boolean };

/** 完了の画面を見せてから移るまでの時間 */
const REDIRECT_MS = 1200;

const METHOD_LABELS: Record<Method, string> = {
  password: "メールとパスワード",
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
/** 名前がまだ分からないうちは、メールアドレスの @ の前を名前の代わりにする */
const nameFromEmail = (email: string) => email.trim().split("@")[0] || "くまもーるん";

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

// ここから下の stepMotion と useStepHeight は、ブロックの sign-in.tsx と同じ。
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

export function AuthScreen({ providers, next }: { providers: OAuthProvider[]; next: string }) {
  const id = useId();
  const reduce = !!useReducedMotion();
  const [mode, setMode] = useState<Mode>("signIn");
  const [step, setStep] = useState<Step>("email");
  const [direction, setDirection] = useState(1);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | Method>(null);
  const [account, setAccount] = useState<Account>({ name: "", email: "" });
  const [method, setMethod] = useState<Method>("password");
  const [status, setStatus] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef<"email" | "password" | "done" | null>(null);
  const { track, height } = useStepHeight(step, reduce);

  const signUp = mode === "signUp";
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
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "email") {
      emailRef.current?.focus();
      emailRef.current?.select();
    }
    if (target === "password") passwordRef.current?.focus();
    if (target === "done") doneRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (step !== "done") return;
    const timer = window.setTimeout(() => location.assign(next), REDIRECT_MS);
    return () => window.clearTimeout(timer);
  }, [step, next]);

  function go(to: Step, towards: number, focus: "email" | "password" | "done" | null = null) {
    focusNext.current = focus;
    setDirection(towards);
    setStep(to);
  }

  function fail(err: AuthError, fallback: string) {
    setBusy(null);
    setError(errorText(err, fallback));
    setStatus("うまくいきませんでした");
  }

  function complete(next: Account, how: Method) {
    setBusy(null);
    setError(null);
    setAccount(next);
    setMethod(how);
    go("done", 1, "done");
    setStatus(signUp ? "登録しました" : `${METHOD_LABELS[how]}でログインしました`);
  }

  /** パスキーや Google では名前を入れないので、ログインできた後にセッションから読む */
  async function completeFromSession(how: Method) {
    const { data } = await authClient.getSession();
    const user = data?.user;
    complete(
      { name: user?.name || nameFromEmail(user?.email ?? ""), email: user?.email ?? "" },
      how,
    );
  }

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setAttempted(true);
    if (!isEmail(email)) {
      emailRef.current?.focus();
      return;
    }
    setError(null);
    setPassword("");
    go("password", 1, "password");
    setStatus(signUp ? "名前とパスワードを決めてください" : "パスワードを入れてください");
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (password.length < 8) {
      setError("パスワードは8文字以上です");
      passwordRef.current?.focus();
      return;
    }
    setBusy("password");
    setError(null);
    setStatus(signUp ? "登録しています" : "確かめています");
    const trimmed = email.trim();
    if (signUp) {
      const displayName = name.trim() || nameFromEmail(trimmed);
      const { error } = await authClient.signUp.email({
        email: trimmed,
        password,
        name: displayName,
      });
      if (error) return fail(error, "登録できませんでした");
      complete({ name: displayName, email: trimmed }, "password");
    } else {
      const { data, error } = await authClient.signIn.email({ email: trimmed, password });
      if (error) return fail(error, "ログインできませんでした");
      complete({ name: data?.user.name || nameFromEmail(trimmed), email: trimmed }, "password");
    }
  }

  async function signInWithPasskey() {
    if (busy) return;
    setBusy("passkey");
    setError(null);
    setStatus("パスキーを待っています");
    const response = await authClient.signIn.passkey();
    if (response?.error) return fail(response.error, "パスキーでログインできませんでした");
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
    if (error) fail(error, "Google でログインできませんでした");
  }

  function changeEmail() {
    if (busy) return;
    setAttempted(false);
    setError(null);
    go("email", -1, "email");
    setStatus("メールアドレスを直せます");
  }

  function switchMode() {
    if (busy) return;
    setMode(signUp ? "signIn" : "signUp");
    setError(null);
    setAttempted(false);
    if (step !== "email") go("email", -1, "email");
    setStatus(signUp ? "ログインに切り替えました" : "新しい登録に切り替えました");
  }

  const displayName = account.name || nameFromEmail(account.email);

  return (
    <section className={styles.signIn} aria-label={signUp ? "新しく登録" : "ログイン"}>
      <LayoutGroup id={id}>
        <motion.div className={styles.viewport} style={{ height }}>
          <div ref={track} className={styles.track}>
            <AnimatePresence mode="popLayout" initial={false} custom={custom}>
              {step === "email" && (
                <motion.div
                  key={`email-${mode}`}
                  className={styles.step}
                  custom={custom}
                  variants={stepMotion}
                  initial="enter"
                  animate="center"
                  exit="exit"
                >
                  <div className={styles.heading}>
                    <h2>{signUp ? "新しく登録" : "くまもーるんにログイン"}</h2>
                    <p>
                      {signUp
                        ? "アプリと同じアカウントで、守り状態を見られるようになります。"
                        : "今の守り状態を見るには、ログインしてください。"}
                    </p>
                  </div>
                  <form className={styles.form} onSubmit={submitEmail} noValidate>
                    <div className={styles.fieldGroup}>
                      <Input
                        ref={emailRef}
                        label="メールアドレス"
                        type="email"
                        inputMode="email"
                        autoComplete="username webauthn"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="name@example.com"
                        value={email}
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
                    <Button type="submit" className={styles.wide}>
                      次へ
                    </Button>
                  </form>
                  {(!signUp || providers.length > 0) && (
                    <>
                      <div className={styles.divider}>または</div>
                      <div className={styles.alternatives}>
                        {!signUp && (
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
                        )}
                        {providers.includes("google") && (
                          <Button
                            type="button"
                            variant="secondary"
                            className={styles.wide}
                            loading={busy === "google"}
                            onClick={signInWithGoogle}
                          >
                            <GoogleLogo />
                            Google で続ける
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                  <Alert
                    tone="danger"
                    title={error ?? ""}
                    open={error !== null}
                    onDismiss={() => setError(null)}
                  />
                </motion.div>
              )}

              {step === "password" && (
                <motion.div
                  key="password"
                  className={styles.step}
                  custom={custom}
                  variants={stepMotion}
                  initial="enter"
                  animate="center"
                  exit="exit"
                >
                  <div className={styles.heading}>
                    <h2>{signUp ? "パスワードを決める" : "パスワードを入力"}</h2>
                    <p>
                      {signUp
                        ? "8文字以上のパスワードを決めてください。名前はサイトの表示にだけ使います。"
                        : "このアカウントのパスワードを入れてください。"}
                    </p>
                  </div>
                  <div className={styles.identity}>
                    <motion.span
                      layoutId="account-avatar"
                      className={`${styles.avatarMover} ${styles.avatarSmall}`}
                      transition={avatarTransition}
                    >
                      <Avatar
                        name={(signUp && name.trim()) || nameFromEmail(email)}
                        size="xl"
                        className={styles.avatarFill}
                      />
                    </motion.span>
                    <span className={styles.identityEmail}>{email.trim()}</span>
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
                  <form className={styles.form} onSubmit={submitPassword} noValidate>
                    {signUp && (
                      <Input
                        label="名前"
                        description="空なら、メールアドレスの @ の前を使います。"
                        autoComplete="nickname"
                        maxLength={50}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    )}
                    <PasswordField
                      ref={passwordRef}
                      label="パスワード"
                      description={signUp ? "8文字以上" : undefined}
                      autoComplete={signUp ? "new-password" : "current-password"}
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    {/* パスワードの管理アプリが、どのアカウントか分かるようにする */}
                    <input
                      type="email"
                      name="email"
                      autoComplete="username"
                      value={email.trim()}
                      readOnly
                      hidden
                    />
                    <Button type="submit" className={styles.wide} loading={busy === "password"}>
                      {signUp ? "登録" : "ログイン"}
                    </Button>
                  </form>
                  <Alert
                    tone="danger"
                    title={error ?? ""}
                    open={error !== null}
                    onDismiss={() => setError(null)}
                  />
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
                      initial={method === "password" || reduce ? false : { opacity: 0, scale: 0.7 }}
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
                      {signUp
                        ? `ようこそ、${displayName}さん`
                        : `おかえりなさい、${displayName}さん`}
                    </h2>
                    <p className={styles.email}>{account.email}</p>
                  </motion.div>
                  <motion.dl className={styles.details} {...rise(1)}>
                    <div>
                      <dt>{signUp ? "登録の方法" : "ログインの方法"}</dt>
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
            {signUp ? "登録済みの方は " : "アカウントがない方は "}
            <button type="button" className={styles.textButton} onClick={switchMode}>
              {signUp ? "ログイン" : "新しく登録"}
            </button>
          </span>
        )}
      </footer>
    </section>
  );
}
