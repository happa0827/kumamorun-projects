// POST /api/app/v1/exchange  { code, deviceName } → { token }
// コードは一度しか使えない。使用済み、期限切れ、不明なコードは 401。
import { devices, loginCodes } from "@schema";
import { defineHandler } from "void";
import { and, db, eq, gt, isNull } from "void/db";
import { z } from "zod";
import { parseBody } from "../../../../src/server/body";
import { newDeviceToken, sha256Hex } from "../../../../src/server/secrets";

const Body = z.object({
  code: z.string().min(1).max(200),
  deviceName: z.string().trim().min(1).max(100),
});

export const POST = defineHandler(async (c) => {
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;

  const now = Date.now();
  // 未使用で期限内のときだけ、使用済みにする。並んだ2回の交換のうち、行が返るのは1回だけ。
  const [consumed] = await db
    .update(loginCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(loginCodes.codeHash, await sha256Hex(body.data.code)),
        isNull(loginCodes.usedAt),
        gt(loginCodes.expiresAt, now),
      ),
    )
    .returning({ accountId: loginCodes.accountId });
  if (!consumed) return c.json({ error: "invalid_code" }, 401);

  const token = newDeviceToken();
  await db.insert(devices).values({
    id: crypto.randomUUID(),
    accountId: consumed.accountId,
    name: body.data.deviceName,
    tokenHash: await sha256Hex(token),
    createdAt: now,
    lastSeenAt: now,
  });
  return { token };
});
