// PATCH /api/shop/purchases/:id  { handed: boolean }  購入した品を本人に渡したかの印を付けるか外す。
// { handedAt, handedByName } を返す（付けた人として、呼んだ人を残す）。
// 付けられるのは品を決める人。大人は自分の購入、親は ?account=<子供の ID> で子供の購入。子供は付けられない（403）。
// ほかのアカウントの購入の ID なら 404。
import { defineHandler } from "void";
import { z } from "zod";
import { parseBody } from "../../../../src/server/body";
import { shopEditTarget } from "../../../../src/server/family";
import { setHanded } from "../../../../src/server/shop";
import { forbidden, requireViewer } from "../../../../src/server/viewer";

const Body = z.object({ handed: z.boolean() });

export const PATCH = defineHandler(async (c) => {
  const viewer = await requireViewer(c);
  const accountId = await shopEditTarget(viewer.id, viewer.member, c.req.query("account"));
  if (!accountId) return forbidden(c);
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;
  const id: string = c.req.param("id") ?? "";
  const result = await setHanded(accountId, id, body.data.handed, viewer);
  if (!result) return c.json({ error: "not_found" }, 404);
  return result;
});
