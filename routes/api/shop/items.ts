// PUT /api/shop/items  { items: [{ id, name, price }] }  ショップの品を保存する（後勝ち）。{ items } を返す。
// DELETE /api/shop/items  既定の品に戻す。{ items } を返す。
import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { z } from "zod";
import { parseBody } from "../../../src/server/body";
import { resetItems, saveConfig, ShopItems } from "../../../src/server/shop";

const Body = z.object({ items: ShopItems });

export const PUT = defineHandler(async (c) => {
  const user = requireAuth(c);
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;
  const { items } = await saveConfig(user.id, { items: body.data.items });
  return { items };
});

export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c);
  const { items } = await resetItems(user.id);
  return { items };
});
