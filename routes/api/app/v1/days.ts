// PUT /api/app/v1/days  { daily, history } を保存する。
// 日付ごとに後勝ちで書き、新しい7日より古い行は消す。
import { daily } from "@schema";
import { defineHandler } from "void";
import { db, sql } from "void/db";
import { z } from "zod";
import { pruneDays, toDayRows } from "../../../../src/server/account-data";
import { parseBody } from "../../../../src/server/body";
import { requireDevice } from "../../../../src/server/device-auth";
import { Daily, History } from "../../../../src/server/shapes";

const Body = z.object({ daily: Daily.nullable(), history: History });

export const PUT = defineHandler(requireDevice, async (c) => {
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;

  const { accountId } = c.get("device");
  const rows = toDayRows(accountId, body.data);
  if (rows.length === 0) return null;

  await db.batch([
    db
      .insert(daily)
      .values(rows)
      .onConflictDoUpdate({
        target: [daily.accountId, daily.date],
        set: { plays: sql`excluded.plays`, failures: sql`excluded.failures` },
      }),
    pruneDays(accountId),
  ]);
  return null;
});
