// ページと API で、ログインしている人とその種類（大人、親、子供）を確かめる。
import type { CloudContext } from "void";
import { getUser, requireAuth } from "void/auth";
import { HTTPException } from "hono/http-exception";
import { getMember, type Member } from "./family";
import { cachedMember } from "../../middleware/01.shared";

export type Viewer = { id: string; email: string; name: string; member: Member };

/** middleware（01.shared.ts）がこのリクエストで読んだ種類。読んでいなければ、ここで読む。 */
async function memberOf(c: CloudContext, accountId: string): Promise<Member | null> {
  const cached = cachedMember(c, accountId);
  return cached !== undefined ? cached : getMember(accountId);
}

/**
 * ページの loader 用。ログインしていなければログインへ、種類を選んでいなければ /welcome へ移す。
 * 移すときは Response を返すので、loader はそのまま返す。
 * 移動先には今の経路をクエリごと渡す（/shop?child=… の子供の選択を、ログインのあとも保つ）。
 */
export async function loadViewer(c: CloudContext): Promise<Viewer | Response> {
  const user = getUser();
  const url = new URL(c.req.url);
  const next = encodeURIComponent(`${url.pathname}${url.search}`);
  if (!user) return c.redirect(`/?next=${next}`);
  const member = await memberOf(c, user.id);
  if (!member) return c.redirect(`/welcome?next=${next}`);
  return { id: user.id, email: user.email, name: user.name, member };
}

/** API 用。ログインしていなければ 401、種類を選んでいなければ 403（kind_required）。 */
export async function requireViewer(c: CloudContext): Promise<Viewer> {
  const user = requireAuth(c);
  const member = await memberOf(c, user.id);
  if (!member)
    throw new HTTPException(403, {
      res: Response.json({ error: "kind_required" }, { status: 403 }),
    });
  return { id: user.id, email: user.email, name: user.name, member };
}

/** API 用。親でなければ 403（parent_only）。 */
export async function requireParent(c: CloudContext) {
  const viewer = await requireViewer(c);
  if (viewer.member.kind !== "parent" || !viewer.member.familyId)
    throw new HTTPException(403, {
      res: Response.json({ error: "parent_only" }, { status: 403 }),
    });
  return { ...viewer, familyId: viewer.member.familyId };
}

export const forbidden = (c: CloudContext) => c.json({ error: "forbidden" }, 403);
