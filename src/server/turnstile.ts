// Cloudflare Turnstile（ボット対策）。画面のウィジェットがトークンを出し、サーバーが Cloudflare に正しいか尋ねる。
// トークンは一度しか使えず、5分で切れる。workers.dev でも使える（ウィジェットのホスト名に workers.dev の名前を入れる）。
// 必要なもの（env.ts）: TURNSTILE_SITE_KEY（画面に出す）、TURNSTILE_SECRET_KEY（サーバーだけが持つ）
import { env } from "void/env";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare のテスト用のキー。必ず通る。開発でキーを置いていないときだけ使う */
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

/** ウィジェットの action。ほかの画面のトークンを流用されないよう、検証でも確かめる */
export const TURNSTILE_ACTION = "contact";

function keys(): { siteKey: string; secretKey: string; test: boolean } | null {
  const { TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY } = env;
  if (TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY)
    return { siteKey: TURNSTILE_SITE_KEY, secretKey: TURNSTILE_SECRET_KEY, test: false };
  if (import.meta.env.DEV)
    return { siteKey: TEST_SITE_KEY, secretKey: TEST_SECRET_KEY, test: true };
  return null;
}

/** 画面に渡すサイトキー。本番でキーがそろっていなければ null（お問い合わせを受け付けない） */
export function turnstileSiteKey(): string | null {
  return keys()?.siteKey ?? null;
}

export type TurnstileResult = "ok" | "failed" | "unavailable";

/** トークンを Cloudflare に確かめる。Cloudflare に届かなければ unavailable（通さない） */
export async function verifyTurnstile(
  token: string,
  ip: string | undefined,
): Promise<TurnstileResult> {
  const k = keys();
  if (!k) return "unavailable";
  const body = new URLSearchParams({ secret: k.secretKey, response: token });
  if (ip) body.set("remoteip", ip);
  let json: { success: boolean; action?: string; "error-codes"?: string[] };
  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);
    json = await res.json();
  } catch (error) {
    console.error("[turnstile] 確かめられませんでした", error);
    return "unavailable";
  }
  if (!json.success) {
    console.warn(`[turnstile] 通りませんでした ${(json["error-codes"] ?? []).join(",")}`);
    return "failed";
  }
  // テスト用のキーは action を返さないので、本物のキーのときだけ確かめる
  if (!k.test && json.action !== TURNSTILE_ACTION) return "failed";
  return "ok";
}
