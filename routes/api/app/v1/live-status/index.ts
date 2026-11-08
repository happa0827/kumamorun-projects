// PUT /api/app/v1/live-status  ライブ状況を書く。アプリは20秒ごとに呼ぶ（ハートビート）。
// updated_at はサーバーが入れる。appRunning と updatedAt は本文に含めない（来ても捨てる）。
import { liveStatus } from "@schema";
import { defineHandler } from "void";
import { db } from "void/db";
import { parseBody } from "../../../../../src/server/body";
import { requireDevice } from "../../../../../src/server/device-auth";
import { LiveStatusBody } from "../../../../../src/server/shapes";

export const PUT = defineHandler(requireDevice, async (c) => {
  const body = await parseBody(c, LiveStatusBody);
  if (!body.ok) return body.response;

  const { accountId } = c.get("device");
  const now = Date.now();
  const row = { appRunning: body.data.phase === "offline" ? 0 : 1, bodyJson: JSON.stringify(body.data), updatedAt: now };
  await db
    .insert(liveStatus)
    .values({ accountId, ...row })
    .onConflictDoUpdate({ target: liveStatus.accountId, set: row });
  return { serverTime: now };
});
