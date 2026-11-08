// アプリ向け API の本文の形（docs/void-migration.md の「API」）。変えるときは kumamorun-tauri も直す。
import { z } from "zod";

export const DateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const Count = z.number().int().min(0).max(100_000);

/** 1日分の記録。daily は { date, plays, failures }、history は { "YYYY-MM-DD": { plays, failures } }。 */
export const Daily = z.object({ date: DateKey, plays: Count, failures: Count });
export const History = z
  .record(DateKey, z.object({ plays: Count, failures: Count }))
  .refine((h) => Object.keys(h).length <= 31, "too many days");

/** 保つ日数。新しい日付から7日分だけを残す。 */
export const HISTORY_DAYS = 7;

/** スタート制限。形の検証はアプリ（Rust）が行う。ここではオブジェクトであることと大きさだけを見る。 */
export const Restrictions = z
  .record(z.string(), z.unknown())
  .refine((r) => JSON.stringify(r).length <= 8_192, "restrictions too large");

export const Stage = z.number().int().min(0).max(5);
export const Flowers = z.number().int().min(0).max(1_000_000);

/** 開花で増える花。夜桜（'11'）だけ 2、ほかは 1。どの花が咲くかはアプリが決める。 */
export const BLOOM_FLOWERS = [1, 2] as const;

export const PHASES = ["lunch", "play", "break", "paused", "reward", "finished", "ended", "idle", "offline"] as const;

const WeekDay = z.object({ date: DateKey, plays: Count, failures: Count, success: z.boolean() });
const NullableInt = z.number().int().nullable();

/** ライブ状況。appRunning と updatedAt はサーバーが決めるので、本文には含めない（来ても捨てる）。 */
export const LiveStatusBody = z.object({
  keeping: z.boolean(),
  phase: z.enum(PHASES),
  label: z.string().max(200),
  remainingSec: NullableInt,
  startedAt: NullableInt,
  duration: NullableInt,
  running: z.boolean(),
  startBlocked: z.boolean(),
  blockReason: z.string().max(200).nullable(),
  daily: Daily.nullable(),
  week: z.array(WeekDay).max(HISTORY_DAYS).nullable(),
});
export type LiveStatusBody = z.infer<typeof LiveStatusBody>;

/** 最後の書き込みからこれを超えたら、アプリは停止とみなす */
export const LIVE_STALE_MS = 60_000;
