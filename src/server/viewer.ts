// ページと API で、ログインしている人とその種類（大人、親、子供）を確かめる。
import type { CloudContext } from "void";
import { getUser, requireAuth } from "void/auth";
import { HTTPException } from "hono/http-exception";
import { getMember, type Member } from "./family";

export type Viewer = { id: string; email: string; name: string; member: Member };

/**
 * ページの loader 用。ログインしていなければログインへ、種類を選んでいなければ /welcome へ移す。
 * 移すときは Response を返すので、loader はそのまま返す。
 */
export async function loadViewer(c: CloudContext, path: string): Promise<Viewer | Response> {
  const user = getUser();
  const next = encodeURIComponent(path);
  if (!user) return c.redirect(`/?next=${next}`);
  const member = await getMember(user.id);
  if (!member) return c.redirect(`/welcome?next=${next}`);
  return { id: user.id, email: user.email, name: user.name, member };
}

/** API 用。ログインしていなければ 401、種類を選んでいなければ 403（kind_required）。 */
export async function requireViewer(c: CloudContext): Promise<Viewer> {
  const user = requireAuth(c);
  const member = await getMember(user.id);
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
