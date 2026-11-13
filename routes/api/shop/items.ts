// PUT /api/shop/items  { items: [{ id, name, price }] }  ショップの品を保存する（後勝ち）。{ items } を返す。
// DELETE /api/shop/items  既定の品に戻す。{ items } を返す。
// 大人は自分の品、親は ?account=<子供の ID> で子供の品を変える。子供は変えられない（403）。
import { defineHandler } from "void";
import { z } from "zod";
import { parseBody } from "../../../src/server/body";
import { shopEditTarget } from "../../../src/server/family";
import { resetItems, saveConfig, ShopItems } from "../../../src/server/shop";
import { forbidden, requireViewer } from "../../../src/server/viewer";

const Body = z.object({ items: ShopItems });

export const PUT = defineHandler(async (c) => {
  const viewer = await requireViewer(c);
  const accountId = await shopEditTarget(viewer.id, viewer.member, c.req.query("account"));
  if (!accountId) return forbidden(c);
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;
  const { items } = await saveConfig(accountId, { items: body.data.items });
  return { items };
});

export const DELETE = defineHandler(async (c) => {
  const viewer = await requireViewer(c);
  const accountId = await shopEditTarget(viewer.id, viewer.member, c.req.query("account"));
  if (!accountId) return forbidden(c);
  const { items } = await resetItems(accountId);
  return { items };
});
