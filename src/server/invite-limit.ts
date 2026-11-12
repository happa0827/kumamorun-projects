// 招待コードを試せる回数。/api/account/kind（入る）と /api/account/invite-preview（入る前に見る）で同じ数えを使う。
// どちらもコードが正しいかを答えるので、片方だけ数えると、もう片方で総当たりできてしまう。
// この経路は /api/auth の外なので、Better Auth の上限がかからない。
import type { CloudContext } from "void";
import { consume } from "./rate-limit";

/**
 * コードは約 8.5×10^11 通りで24時間で失効するので、1時間に10回（アカウント）、150回（IP）なら当てられない。
 * ふつうは「見る」と「入る」で2回。打ち間違いを何度か直しても、上限には届かない。
 * IP の上限は、学校や家族で同じ IP を使う人どうしで分け合う。誰かがわざと使い切ると、その IP の全員が1時間待つので、
 * 総当たりを止めるのはアカウントの上限に任せ、IP の上限はアカウントを作り直して試す形を抑えるだけの緩さにする。
 */
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_ACCOUNT = 10;
const MAX_PER_IP = 150;

/** 1回数える。上限を超えていれば 429 の Response、超えていなければ null。 */
export async function limitInviteAttempt(c: CloudContext, accountId: string) {
  // Cloudflare が付ける接続元の IP（ローカルの void dev では 127.0.0.1）。なければアカウントだけで数える
  const ip = c.req.header("cf-connecting-ip");
  const allowed = await consume([
    { key: `invite:account:${accountId}`, max: MAX_PER_ACCOUNT, windowMs: WINDOW_MS },
    ...(ip ? [{ key: `invite:ip:${ip}`, max: MAX_PER_IP, windowMs: WINDOW_MS }] : []),
  ]);
  if (allowed) return null;
  c.header("Retry-After", String(WINDOW_MS / 1000));
  return c.json({ error: "too_many_attempts" }, 429);
}
