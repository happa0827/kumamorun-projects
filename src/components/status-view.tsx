// 状況ページ。/api/status を10秒ごとに読み、残り時間は毎秒数え直す。
import { useEffect, useState } from "react";
import { formatAgo, formatRemaining, remainingNow, type StatusResponse } from "../live-status";

const POLL_MS = 10_000;

export function StatusView({ initial }: { initial: StatusResponse }) {
  const [data, setData] = useState(initial);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // サーバーとブラウザの時計の差。最終更新の「何秒前」はサーバーの時刻で出す。
  const [skew, setSkew] = useState(() => initial.serverTime - Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/status", { headers: { accept: "application/json" } });
        if (response.status === 401) return location.reload();
        if (!response.ok) throw new Error(`状況を読めませんでした（${response.status}）`);
        const next = (await response.json()) as StatusResponse;
        if (!alive) return;
        setData(next);
        setSkew(next.serverTime - Date.now());
        setFetchError(null);
      } catch (error) {
        if (alive) setFetchError(error instanceof Error ? error.message : "状況を読めませんでした");
      }
    };
    const poll = window.setInterval(load, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, []);

  const status = data.status;
  const stopped = !data.appRunning;
  const keeping = !stopped && status?.keeping === true;
  const tone = stopped ? "stopped" : keeping ? "keeping" : "breaking";
  const week = status?.week ?? null;

  return (
    <section className="card" aria-labelledby="status-title">
      <h2 id="status-title">ライブ状況</h2>
      {fetchError && (
        <p className="error" role="alert">
          {fetchError}
        </p>
      )}

      <p className={`banner ${tone}`} aria-live="polite">
        {stopped ? "アプリ停止" : keeping ? "守れている" : "守れていない"}
      </p>

      <dl className="facts">
        <dt>残り</dt>
        <dd className="mono">{formatRemaining(stopped ? null : remainingNow(status, now))}</dd>
        <dt>状態</dt>
        <dd>{stopped ? "—" : status?.label || status?.phase || "—"}</dd>
        <dt>失敗数（当日）</dt>
        <dd>{status?.daily?.failures ?? "—"}</dd>
        <dt>最終更新</dt>
        <dd>{data.updatedAt == null ? "まだありません" : formatAgo(now + skew - data.updatedAt)}</dd>
      </dl>

      <h3>直近1週間</h3>
      {week && week.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th>遊び</th>
                <th>失敗</th>
                <th>成功</th>
              </tr>
            </thead>
            <tbody>
              {week.map((day) => (
                <tr key={day.date}>
                  <td className="mono">{day.date}</td>
                  <td>{day.plays}</td>
                  <td>{day.failures}</td>
                  <td>{day.success ? "○" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">—</p>
      )}
    </section>
  );
}
