// 段階 0 の検証（開発だけ）: batch() の途中の文が失敗したら、前の文も取り消されるか。
// 花を +1 する文のあとに、CHECK に反する段階 6 を書く文を置き、花が 0 のままなら原子的。
import { progress } from "@schema";
import { defineHandler } from "void";
import { db, eq, sql } from "void/db";

const ACCOUNT = "__batch_check__";

export const GET = defineHandler(async () => {
  const now = Date.now();
  await db.delete(progress).where(eq(progress.accountId, ACCOUNT));
  await db.insert(progress).values({ accountId: ACCOUNT, stage: 0, flowers: 0, updatedAt: now });

  let failed: string | null = null;
  try {
    await db.batch([
      db.update(progress).set({ flowers: sql`${progress.flowers} + 1` }).where(eq(progress.accountId, ACCOUNT)),
      db.update(progress).set({ stage: 6 }).where(eq(progress.accountId, ACCOUNT)),
    ]);
  } catch (error) {
    failed = error instanceof Error ? error.message : String(error);
  }

  const [after] = await db.select().from(progress).where(eq(progress.accountId, ACCOUNT));
  await db.delete(progress).where(eq(progress.accountId, ACCOUNT));
  return { batchFailed: failed !== null, error: failed, flowersAfter: after?.flowers, atomic: failed !== null && after?.flowers === 0 };
});
