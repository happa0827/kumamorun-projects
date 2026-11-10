// PUT /api/shop/notify-emails  { emails: string[] }  購入を知らせる宛先を保存する（後勝ち）。{ emails } を返す。
import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { z } from "zod";
import { parseBody } from "../../../src/server/body";
import { NotifyEmails, saveConfig } from "../../../src/server/shop";

const Body = z.object({ emails: NotifyEmails });

export const PUT = defineHandler(async (c) => {
  const user = requireAuth(c);
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;
  const { notifyEmails } = await saveConfig(user.id, { notifyEmails: body.data.emails });
  return { emails: notifyEmails };
});
