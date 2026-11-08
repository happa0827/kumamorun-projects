// アカウントのデータの読み書き。アプリ向け API とサイトの両方から使う。
import { daily, liveStatus, progress, settings } from "@schema";
import { and, db, desc, eq, notInArray } from "void/db";
import { HISTORY_DAYS, LIVE_STALE_MS, type LiveStatusBody } from "./shapes";

type DayRow = { date: string; plays: number; failures: number };

/** GET /sync の中身。daily は最新の日付の記録、history は直近7日。 */
export async function readSync(accountId: string) {
  const [settingsRows, dayRows, progressRows] = await db.batch([
    db.select({ json: settings.restrictionsJson }).from(settings).where(eq(settings.accountId, accountId)),
    db
      .select({ date: daily.date, plays: daily.plays, failures: daily.failures })
      .from(daily)
      .where(eq(daily.accountId, accountId))
      .orderBy(desc(daily.date))
      .limit(HISTORY_DAYS),
    db.select({ stage: progress.stage, flowers: progress.flowers }).from(progress).where(eq(progress.accountId, accountId)),
  ]);

  const history: Record<string, { plays: number; failures: number }> = {};
  for (const row of dayRows as DayRow[]) history[row.date] = { plays: row.plays, failures: row.failures };

  return {
    restrictions: settingsRows[0] ? (JSON.parse(settingsRows[0].json) as Record<string, unknown>) : null,
    daily: (dayRows[0] as DayRow | undefined) ?? null,
    history,
    stage: progressRows[0]?.stage ?? 0,
    flowers: progressRows[0]?.flowers ?? 0,
    serverTime: Date.now(),
  };
}

/** daily と history をまとめ、日付ごとの行に直す。同じ日付は daily を優先する。 */
export function toDayRows(
  accountId: string,
  input: { daily?: DayRow | null; history?: Record<string, { plays: number; failures: number }> },
) {
  const byDate = new Map<string, DayRow>();
  for (const [date, v] of Object.entries(input.history ?? {})) byDate.set(date, { date, ...v });
  if (input.daily) byDate.set(input.daily.date, input.daily);
  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, HISTORY_DAYS)
    .map((row) => ({ accountId, ...row }));
}

/** 新しい7日より古い行を消す文。 */
export function pruneDays(accountId: string) {
  const keep = db
    .select({ date: daily.date })
    .from(daily)
    .where(eq(daily.accountId, accountId))
    .orderBy(desc(daily.date))
    .limit(HISTORY_DAYS);
  return db.delete(daily).where(and(eq(daily.accountId, accountId), notInArray(daily.date, keep)));
}

/** サイトの状況ページに返す形。停止の判定はサーバーが行う。 */
export async function readLiveStatus(accountId: string) {
  const [row] = await db.select().from(liveStatus).where(eq(liveStatus.accountId, accountId));
  const now = Date.now();
  if (!row) return { appRunning: false, updatedAt: null, serverTime: now, status: null };
  const fresh = now - row.updatedAt <= LIVE_STALE_MS;
  return {
    appRunning: row.appRunning === 1 && fresh,
    updatedAt: row.updatedAt,
    serverTime: now,
    status: JSON.parse(row.bodyJson) as LiveStatusBody,
  };
}
