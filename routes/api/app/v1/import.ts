// POST /api/app/v1/import  初回ログインで、端末のローカルのデータを取り込む。
// { daily, history, stage, flowers, restrictions }
// 空のアカウント（進化、設定、記録のどれもない）にだけ書く。空でなければ 409。
// 旧版の evolution=6 は、アプリが 5 に丸めてから送る（ここでは 0〜5 以外は 422）。
import { daily, progress, settings } from "@schema";
import { defineHandler } from "void";
import { db, eq } from "void/db";
import { z } from "zod";
import { readSync, toDayRows } from "../../../../src/server/account-data";
import { parseBody } from "../../../../src/server/body";
import { requireDevice } from "../../../../src/server/device-auth";
import { Daily, Flowers, History, Restrictions, Stage } from "../../../../src/server/shapes";

const Body = z.object({
  daily: Daily.nullable(),
  history: History,
  stage: Stage,
  flowers: Flowers,
  restrictions: Restrictions.nullable(),
});

export const POST = defineHandler(requireDevice, async (c) => {
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;

  const { accountId } = c.get("device");
  const notEmpty = () => c.json({ error: "not_empty" }, 409);

  const [p, s, d] = await db.batch([
    db.select({ id: progress.accountId }).from(progress).where(eq(progress.accountId, accountId)).limit(1),
    db.select({ id: settings.accountId }).from(settings).where(eq(settings.accountId, accountId)).limit(1),
    db.select({ id: daily.accountId }).from(daily).where(eq(daily.accountId, accountId)).limit(1),
  ]);
  if (p.length || s.length || d.length) return notEmpty();

  const now = Date.now();
  const { stage, flowers, restrictions } = body.data;
  const rows = toDayRows(accountId, body.data);
  // progress は素の INSERT。同時に2回取り込んでも、2回目は主キーの衝突で batch ごと取り消される。
  const statements = [
    db.insert(progress).values({ accountId, stage, flowers, updatedAt: now }),
    ...(restrictions ? [db.insert(settings).values({ accountId, restrictionsJson: JSON.stringify(restrictions), updatedAt: now })] : []),
    ...(rows.length ? [db.insert(daily).values(rows)] : []),
  ] as const;
  try {
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|PRIMARY KEY|constraint/i.test(error.message + String(error.cause ?? ""))) return notEmpty();
    throw error;
  }
  return readSync(accountId);
});
