// PUT /api/app/v1/settings  { restrictions } を保存する（後勝ち）。
import { settings } from "@schema";
import { defineHandler } from "void";
import { db } from "void/db";
import { z } from "zod";
import { parseBody } from "../../../../src/server/body";
import { requireDevice } from "../../../../src/server/device-auth";
import { Restrictions } from "../../../../src/server/shapes";

const Body = z.object({ restrictions: Restrictions });

export const PUT = defineHandler(requireDevice, async (c) => {
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;

  const { accountId } = c.get("device");
  const row = { restrictionsJson: JSON.stringify(body.data.restrictions), updatedAt: Date.now() };
  await db
    .insert(settings)
    .values({ accountId, ...row })
    .onConflictDoUpdate({ target: settings.accountId, set: row });
  return null;
});
