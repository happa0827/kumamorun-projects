// POST /api/family/invites  { kind: "parent" | "child" }  親が、家族への招待コードを発行する。
// Google で登録した人が /welcome でこのコードを入れると、その種類で家族に入る。24時間で失効し、一度しか使えない。
// { id, code, kind, expiresAt } を返す。
// GET /api/family/invites  まだ使われていない招待コードの一覧 { invites: [{ id, kind, createdBy, expiresAt }] }。
// コードそのものはハッシュしか持たないので出さない。取り消しは DELETE /api/family/invites/:id。
import { defineHandler } from "void";
import { z } from "zod";
import { parseBody } from "../../../src/server/body";
import { createInvite, listPendingInvites } from "../../../src/server/family";
import { requireParent } from "../../../src/server/viewer";

const Body = z.object({ kind: z.enum(["parent", "child"]) });

export const GET = defineHandler(async (c) => {
  const parent = await requireParent(c);
  return { invites: await listPendingInvites(parent.familyId) };
});

export const POST = defineHandler(async (c) => {
  const parent = await requireParent(c);
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;
  return createInvite(parent.id, parent.familyId, body.data.kind);
});
