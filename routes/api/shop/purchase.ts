// POST /api/shop/purchase  { itemId, expectedPrice }  サイトのショップで品を1つ買う。
// 成功: { flowers, purchase, notified }
// 大人と子供が、自分の花で買う。親は買えない（403）。
// 失敗: 404 not_found（品がない）、409 price_changed（値段が変わった）、409 insufficient（花が足りない）。どれも今の flowers を返す。
import { defineHandler } from "void";
import { z } from "zod";
import { parseBody } from "../../../src/server/body";
import { canPurchase } from "../../../src/server/family";
import { purchase } from "../../../src/server/shop";
import { forbidden, requireViewer } from "../../../src/server/viewer";

const Body = z.object({ itemId: z.string().min(1).max(64), expectedPrice: z.number().int() });

export const POST = defineHandler(async (c) => {
  const viewer = await requireViewer(c);
  if (!canPurchase(viewer.member)) return forbidden(c);
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;
  const result = await purchase(viewer.id, body.data);
  if (result.ok) {
    const { ok: _, ...out } = result;
    return out;
  }
  return c.json(
    { error: result.error, flowers: result.flowers },
    result.error === "not_found" ? 404 : 409,
  );
});
