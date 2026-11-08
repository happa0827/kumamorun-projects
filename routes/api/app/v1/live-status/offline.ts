// POST /api/app/v1/live-status/offline  正常終了とログアウトで、オフラインを明示する。
// 最後の本文は残し、phase だけ offline にする。本文がなければ最小の形で作る。
import { liveStatus } from "@schema";
import { defineHandler } from "void";
import { db, sql } from "void/db";
import { requireDevice } from "../../../../../src/server/device-auth";

const EMPTY = JSON.stringify({ phase: "offline" });

export const POST = defineHandler(requireDevice, async (c) => {
  const { accountId } = c.get("device");
  const now = Date.now();
  await db
    .insert(liveStatus)
    .values({ accountId, appRunning: 0, bodyJson: EMPTY, updatedAt: now })
    .onConflictDoUpdate({
      target: liveStatus.accountId,
      set: { appRunning: 0, bodyJson: sql`json_set(${liveStatus.bodyJson}, '$.phase', 'offline')`, updatedAt: now },
    });
  return null;
});
