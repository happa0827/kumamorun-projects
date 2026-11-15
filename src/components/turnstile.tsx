// Cloudflare Turnstile のウィジェット。人と確かめられたらトークンを onToken に渡す。切れたら null を渡す。
// トークンは一度しか使えないので、送ったあとは ref の reset() で新しいトークンを取り直す。
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type RenderOptions = {
  sitekey: string;
  action?: string;
  theme?: "auto" | "light" | "dark";
  language?: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => boolean | void;
  "timeout-callback": () => void;
};

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: RenderOptions) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

// スクリプトはページに1つだけ読み込む（画面を行き来しても読み直さない）
let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("Turnstile を読み込めませんでした"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export type TurnstileHandle = { reset: () => void };

export const Turnstile = forwardRef<
  TurnstileHandle,
  {
    siteKey: string;
    action: string;
    onToken: (token: string | null) => void;
    /** スクリプトを読み込めない、またはウィジェットが動かないとき */
    onError: () => void;
  }
>(function Turnstile({ siteKey, action, onToken, onError }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // 毎回の描画で関数が変わってもウィジェットを作り直さないよう、最新のものを ref に置く
  const handlers = useRef({ onToken, onError });
  handlers.current = { onToken, onError };

  useImperativeHandle(ref, () => ({
    reset: () => {
      handlers.current.onToken(null);
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          action,
          theme: "auto",
          language: "ja",
          callback: (token) => handlers.current.onToken(token),
          "expired-callback": () => handlers.current.onToken(null),
          "timeout-callback": () => handlers.current.onToken(null),
          "error-callback": () => {
            handlers.current.onToken(null);
            handlers.current.onError();
            // true を返すと、Turnstile が自分でコンソールに投げない
            return true;
          },
        });
      })
      .catch(() => {
        if (!cancelled) handlers.current.onError();
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action]);

  return <div ref={container} className="turnstile" />;
});
