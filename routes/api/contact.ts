// POST /api/contact  { category, message, email, website, turnstileToken }  お問い合わせを送る。ログインは要らない。
// 成功: { ok: true }
// 失敗: 422 invalid_body、429 too_many_attempts、403 turnstile_failed（もう一度ウィジェットを通す）、
//       503 unavailable（本番で Turnstile のキーがない、または Cloudflare に届かない）
// おとり欄（website）が入っていたら、ボットに気づかれないよう成功と同じ答えを返し、何も残さない。
import { defineHandler } from "void";
import { getUser } from "void/auth";
import { parseBody } from "../../src/server/body";
import { ContactBody, contactLimits, saveContact } from "../../src/server/contact";
import { visibleEmail } from "../../src/server/family";
import { consume } from "../../src/server/rate-limit";
import { verifyTurnstile } from "../../src/server/turnstile";

export const POST = defineHandler(async (c) => {
  const body = await parseBody(c, ContactBody);
  if (!body.ok) return body.response;
  const { website, turnstileToken, ...input } = body.data;
  if (website.trim() !== "") {
    console.warn("[contact] おとり欄が入っていたので捨てました");
    return { ok: true as const };
  }

  // Cloudflare が付ける接続元の IP（ローカルの void dev では 127.0.0.1）
  const ip = c.req.header("cf-connecting-ip");
  if (!(await consume(contactLimits(ip)))) {
    c.header("Retry-After", String(60 * 60));
    return c.json({ error: "too_many_attempts" }, 429);
  }

  const verified = await verifyTurnstile(turnstileToken, ip);
  if (verified === "unavailable") return c.json({ error: "unavailable" }, 503);
  if (verified === "failed") return c.json({ error: "turnstile_failed" }, 403);

  const user = getUser();
  await saveContact({
    ...input,
    userAgent: c.req.header("user-agent") ?? null,
    account: user ? { id: user.id, name: user.name, email: visibleEmail(user.email) } : null,
  });
  return { ok: true as const };
});
