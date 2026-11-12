// DELETE /api/family/invites/:id  親が、まだ使われていない招待コードを取り消す（送り間違えたとき、漏れたときなど）。
// 取り消せたら 204。ほかの家族のもの、使用済み、ないものは 404。
import { defineHandler } from "void";
import { revokeInvite } from "../../../../src/server/family";
import { requireParent } from "../../../../src/server/viewer";

export const DELETE = defineHandler(async (c) => {
  const parent = await requireParent(c);
  const id: string = c.req.param("id") ?? "";
  return (await revokeInvite(parent.familyId, id)) ? null : c.json({ error: "not_found" }, 404);
});
