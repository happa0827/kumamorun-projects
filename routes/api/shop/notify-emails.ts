// PUT /api/shop/notify-emails  { emails: string[] }  購入を知らせる宛先を保存する（後勝ち）。{ emails } を返す。
// 大人は自分の宛先、親は ?account=<子供の ID> で子供の宛先を変える。子供は変えられない（403）。
import { defineHandler } from "void";
import { z } from "zod";
import { parseBody } from "../../../src/server/body";
import { shopEditTarget } from "../../../src/server/family";
import { NotifyEmails, saveConfig } from "../../../src/server/shop";
import { forbidden, requireViewer } from "../../../src/server/viewer";

const Body = z.object({ emails: NotifyEmails });

export const PUT = defineHandler(async (c) => {
  const viewer = await requireViewer(c);
  const accountId = await shopEditTarget(viewer.id, viewer.member, c.req.query("account"));
  if (!accountId) return forbidden(c);
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;
  const { notifyEmails } = await saveConfig(accountId, { notifyEmails: body.data.emails });
  return { emails: notifyEmails };
});
