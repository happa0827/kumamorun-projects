// POST /api/account/kind  アカウントの種類を選ぶ（一度だけ。あとから変えない）。
//   { kind: "adult" }   大人になる
//   { kind: "parent" }  新しい家族を作って親になる
//   { inviteCode }      招待コードで家族に入る（親か子供かはコードが決める。画面は先に invite-preview で見せる）
// 成功: { kind }。失敗: 409 already_chosen、400 invalid_code（不明、使用済み、期限切れ）、
// 429 too_many_attempts（招待コードを試しすぎた。Retry-After 秒のあとに試せる）。
import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { z } from "zod";
import { parseBody } from "../../../src/server/body";
import { chooseKind, type ChooseResult, joinWithInvite } from "../../../src/server/family";
import { limitInviteAttempt } from "../../../src/server/invite-limit";

const Body = z.union([
  z.object({ kind: z.enum(["adult", "parent"]) }),
  z.object({ inviteCode: z.string().trim().min(1).max(40) }),
]);

export const POST = defineHandler(async (c) => {
  const user = requireAuth(c);
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;

  let result: ChooseResult;
  if ("kind" in body.data) {
    result = await chooseKind(user.id, body.data.kind);
  } else {
    const limited = await limitInviteAttempt(c, user.id);
    if (limited) return limited;
    result = await joinWithInvite(user.id, body.data.inviteCode);
  }
  if (result.ok) return { kind: result.kind };
  return c.json({ error: result.error }, result.error === "already_chosen" ? 409 : 400);
});
