// POST /api/family/children/:id/sign-in-link  親が、子供のサイトのログインリンクを発行する。
// 子供の端末でリンクを開くと、その子供としてログインする（そのあと設定でパスキーを足せる）。
// 30分で失効し、一度しか使えない。{ url, expiresAt } を返す。同じ家族の子供でなければ 404。
import { defineHandler } from "void";
import { createChildSignInCode, targetAccount } from "../../../../../src/server/family";
import { requireParent } from "../../../../../src/server/viewer";

export const POST = defineHandler(async (c) => {
  const parent = await requireParent(c);
  const childId = await targetAccount(parent.id, parent.member, c.req.param("id"));
  if (!childId) return c.json({ error: "not_found" }, 404);
  const { code, expiresAt } = await createChildSignInCode(parent.id, childId);
  const url = new URL(`/child-login#code=${encodeURIComponent(code)}`, c.req.url).toString();
  return { url, expiresAt };
});
