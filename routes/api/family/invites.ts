// POST /api/family/invites  { kind: "parent" | "child" }  親が、家族への招待コードを発行する。
// Google で登録した人が /welcome でこのコードを入れると、その種類で家族に入る。24時間で失効し、一度しか使えない。
// { code, kind, expiresAt } を返す。
import { defineHandler } from "void";
import { z } from "zod";
import { parseBody } from "../../../src/server/body";
import { createInvite } from "../../../src/server/family";
import { requireParent } from "../../../src/server/viewer";

const Body = z.object({ kind: z.enum(["parent", "child"]) });

export const POST = defineHandler(async (c) => {
  const parent = await requireParent(c);
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;
  return createInvite(parent.id, parent.familyId, body.data.kind);
});
