// 試した回数の上限。D1 に数える（Workers のメモリは isolate ごとに分かれ、すぐ消えるので数えられない）。
// 結果を待たずに並べて送られても抜けられないよう、確かめる前に数える（成功も失敗も1回）。
import { rateLimits } from "@schema";
import { db, sql } from "void/db";

export type Limit = { key: string; max: number; windowMs: number };

/** 1回数える。どれかの上限を超えたら false（その試しは行わない）。 */
export async function consume(limits: Limit[]): Promise<boolean> {
  if (limits.length === 0) return true;
  const now = Date.now();
  const statements = limits.map(({ key, windowMs }) =>
    db
      .insert(rateLimits)
      .values({ key, count: 1, resetAt: now + windowMs })
      .onConflictDoUpdate({
        target: rateLimits.key,
        // 期限を過ぎていれば数え直す。そうでなければ1つ足す（1文なので、並んだ試しも抜けない）。
        set: {
          count: sql`CASE WHEN ${rateLimits.resetAt} <= ${now} THEN 1 ELSE ${rateLimits.count} + 1 END`,
          resetAt: sql`CASE WHEN ${rateLimits.resetAt} <= ${now} THEN ${now + windowMs} ELSE ${rateLimits.resetAt} END`,
        },
      })
      .returning({ count: rateLimits.count }),
  );
  const results = (await db.batch(statements as [(typeof statements)[0]])) as {
    count: number;
  }[][];
  return results.every((rows, i) => (rows[0]?.count ?? 0) <= limits[i]!.max);
}
