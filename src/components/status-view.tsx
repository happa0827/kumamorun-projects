// 状況ページ。/api/status を10秒ごとに読み、残り時間は毎秒数え直す。
// 表示は status-kumamorun の components/live-status-view.tsx を引き継ぐ。
import { useEffect, useState } from "react";
import { CircleCheck, CirclePause, CircleAlert, Clock } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Badge } from "@/components/arc/badge/badge";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
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
  const BannerIcon = stopped ? CirclePause : keeping ? CircleCheck : CircleAlert;
  const week = status?.week ?? null;

  return (
    <>
      <section className="panel" aria-labelledby="status-title">
        <div className="panel-head">
          <h1 id="status-title">ライブ状況</h1>
          <p className="muted">
            <Clock size={13} strokeWidth={1.75} aria-hidden="true" />{" "}
            {data.updatedAt == null
              ? "アプリからの記録はまだありません"
              : `最終更新 ${formatAgo(now + skew - data.updatedAt)}・10秒ごとに更新`}
          </p>
        </div>

        <Alert
          tone="warning"
          title={fetchError ?? ""}
          open={fetchError !== null}
          onDismiss={() => setFetchError(null)}
        />

        <p className={`banner ${tone}`} aria-live="polite">
          <BannerIcon size={24} strokeWidth={1.75} aria-hidden="true" />
          {stopped ? "アプリ停止" : keeping ? "守れている" : "守れていない"}
        </p>

        <dl className="facts">
          <div className="fact">
            <dt>残り</dt>
            <dd className="mono remaining">
              {formatRemaining(stopped ? null : remainingNow(status, now))}
            </dd>
          </div>
          <div className="fact">
            <dt>状態</dt>
            <dd>{stopped ? "—" : status?.label || status?.phase || "—"}</dd>
          </div>
          <div className="fact">
            <dt>失敗数（当日）</dt>
            <dd>{status?.daily?.failures ?? "—"}</dd>
          </div>
          <div className="fact">
            <dt>遊び（当日）</dt>
            <dd>{status?.daily?.plays ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="panel" aria-labelledby="week-title">
        <h2 id="week-title">直近1週間</h2>
        {week && week.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">日付</th>
                  <th scope="col">遊び</th>
                  <th scope="col">失敗</th>
                  <th scope="col">成功</th>
                </tr>
              </thead>
              <tbody>
                {week.map((day) => (
                  <tr key={day.date}>
                    <td className="mono">{day.date}</td>
                    <td>{day.plays}</td>
                    <td>{day.failures}</td>
                    <td>
                      {day.success ? (
                        <Badge tone="success" size="sm" dot>
                          成功
                        </Badge>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="記録がまだありません"
            description="アプリでログインすると、ここに1週間分の記録が出ます。"
          />
        )}
      </section>
    </>
  );
}
