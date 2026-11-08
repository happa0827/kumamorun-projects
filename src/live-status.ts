// 状況ページの表示の計算。status-kumamorun の lib/live-status.ts を引き継ぐ。
import type { readLiveStatus } from "./server/account-data";

export type StatusResponse = Awaited<ReturnType<typeof readLiveStatus>>;
export type LiveStatus = NonNullable<StatusResponse["status"]>;

/** 動作中は startedAt + duration から毎秒出す。一時停止は remainingSec をそのまま使う。 */
export function remainingNow(s: LiveStatus | null, now = Date.now()): number | null {
  if (!s) return null;
  if (s.phase === "paused") return s.remainingSec ?? null;
  if (s.startedAt != null && s.duration != null) {
    return Math.max(0, Math.ceil((s.startedAt + s.duration * 1000 - now) / 1000));
  }
  return s.remainingSec ?? null;
}

export function formatRemaining(sec: number | null): string {
  if (sec == null) return "--:--";
  const clamped = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

export function formatAgo(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  return `${Math.floor(hour / 24)}日前`;
}
