// POST /api/account/kind  アカウントの種類を選ぶ（一度だけ。あとから変えない）。
//   { kind: "adult" }   大人になる
//   { kind: "parent" }  新しい家族を作って親になる
//   { inviteCode }      招待コードで家族に入る（親か子供かはコードが決める）
// 成功: { kind }。失敗: 409 already_chosen、400 invalid_code（不明、使用済み、期限切れ）、
// 429 too_many_attempts（招待コードを試しすぎた。Retry-After 秒のあとに試せる）。
import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { z } from "zod";
import { parseBody } from "../../../src/server/body";
import { chooseKind, joinWithInvite } from "../../../src/server/family";
import { consume } from "../../../src/server/rate-limit";

const Body = z.union([
  z.object({ kind: z.enum(["adult", "parent"]) }),
  z.object({ inviteCode: z.string().trim().min(1).max(40) }),
]);

/**
 * 招待コードを試せる回数。この経路は /api/auth の外なので、Better Auth の上限がかからない。
 * コードは約 8.5×10^11 通りで24時間で失効するので、1時間に10回（アカウント）、30回（IP）なら当てられない。
 * 打ち間違いを何度か直すくらいなら、ふつうの人は上限に届かない。
 */
const INVITE_WINDOW_MS = 60 * 60 * 1000;
const INVITE_MAX_PER_ACCOUNT = 10;
const INVITE_MAX_PER_IP = 30;

export const POST = defineHandler(async (c) => {
  const user = requireAuth(c);
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;
  if ("kind" in body.data) return respond(c, await chooseKind(user.id, body.data.kind));

  const ip = c.req.header("cf-connecting-ip"); // ローカルの void dev ではないので、アカウントだけで数える
  const allowed = await consume([
    { key: `invite:account:${user.id}`, max: INVITE_MAX_PER_ACCOUNT, windowMs: INVITE_WINDOW_MS },
    ...(ip ? [{ key: `invite:ip:${ip}`, max: INVITE_MAX_PER_IP, windowMs: INVITE_WINDOW_MS }] : []),
  ]);
  if (!allowed) {
    c.header("Retry-After", String(INVITE_WINDOW_MS / 1000));
    return c.json({ error: "too_many_attempts" }, 429);
  }
  return respond(c, await joinWithInvite(user.id, body.data.inviteCode));
});

function respond(
  c: Parameters<Parameters<typeof defineHandler>[0]>[0],
  result: Awaited<ReturnType<typeof chooseKind>>,
) {
  if (result.ok) return { kind: result.kind };
  return c.json({ error: result.error }, result.error === "already_chosen" ? 409 : 400);
}
