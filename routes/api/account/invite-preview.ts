// POST /api/account/invite-preview  { inviteCode }  招待コードを使う前に、どの家族に何として入るかを見る。
// コードは使わない。/welcome は、これを見せて確かめてから /api/account/kind で入る。
// 成功: { kind, inviter: { name, email }, parents: [{ name, email }] }
// 失敗: 409 already_chosen、400 invalid_code、429 too_many_attempts（入るときと同じ数え）。
import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { z } from "zod";
import { parseBody } from "../../../src/server/body";
import { getMember, previewInvite } from "../../../src/server/family";
import { limitInviteAttempt } from "../../../src/server/invite-limit";

const Body = z.object({ inviteCode: z.string().trim().min(1).max(40) });

export const POST = defineHandler(async (c) => {
  const user = requireAuth(c);
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;
  if (await getMember(user.id)) return c.json({ error: "already_chosen" }, 409);
  const limited = await limitInviteAttempt(c, user.id);
  if (limited) return limited;
  const preview = await previewInvite(body.data.inviteCode);
  return preview ?? c.json({ error: "invalid_code" }, 400);
});
