// 設定: アカウント、端末の一覧と失効、パスキー、ログアウト。
import { useEffect, useState } from "react";
import { authClient } from "../src/auth-client";
import { OpenAppButton } from "../src/components/open-app";
import type { Props } from "./settings.server";

const dateTime = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

type Passkey = { id: string; name?: string | null; createdAt?: Date | string | null };

type Loaded = Extract<Props, { devices: unknown }>;

export default function SettingsPage(props: Props) {
  if (!("devices" in props)) return null; // ログインしていなければ loader が移動させる
  return <Settings {...props} />;
}

function Settings({ user, devices }: Loaded) {
  const [list, setList] = useState(devices);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <section className="card" aria-labelledby="account-title">
        <h2 id="account-title">アカウント</h2>
        <p>
          {user.name}
          <br />
          <span className="muted">{user.email}</span>
        </p>
        <div className="row">
          <OpenAppButton />
          <button
            type="button"
            onClick={async () => {
              await authClient.signOut();
              location.href = "/";
            }}
          >
            ログアウト
          </button>
        </div>
      </section>

      <section className="card" aria-labelledby="devices-title">
        <h2 id="devices-title">端末</h2>
        <p className="muted">アプリでログインしている端末です。失効すると、その端末ではログインし直すまで同期が止まります。</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {list.length === 0 ? (
          <p className="muted">まだ端末がありません。「アプリを開く」からログインしてください。</p>
        ) : (
          <ul className="list">
            {list.map((device) => (
              <li key={device.id} data-device-id={device.id}>
                <div>
                  <strong>{device.name}</strong>
                  <br />
                  <span className="muted">
                    最終利用 {dateTime.format(device.lastSeenAt)}・登録 {dateTime.format(device.createdAt)}
                  </span>
                </div>
                <button
                  type="button"
                  className="danger"
                  onClick={async () => {
                    if (!confirm(`「${device.name}」を失効しますか？`)) return;
                    const response = await fetch(`/api/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
                    if (response.ok || response.status === 404) {
                      setList((current) => current.filter((d) => d.id !== device.id));
                      setError(null);
                    } else {
                      setError(`失効できませんでした（${response.status}）`);
                    }
                  }}
                >
                  失効
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Passkeys />
    </>
  );
}

function Passkeys() {
  const [list, setList] = useState<Passkey[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const { data } = await authClient.passkey.listUserPasskeys();
    setList((data as Passkey[] | null) ?? []);
  };
  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="card" aria-labelledby="passkey-title">
      <h2 id="passkey-title">パスキー</h2>
      <p className="muted">登録すると、パスワードの代わりに指紋や顔、PIN でログインできます。</p>
      {list && list.length > 0 && (
        <ul className="list">
          {list.map((passkey) => (
            <li key={passkey.id}>
              <div>
                <strong>{passkey.name || "パスキー"}</strong>
                {passkey.createdAt && (
                  <>
                    <br />
                    <span className="muted">登録 {dateTime.format(new Date(passkey.createdAt))}</span>
                  </>
                )}
              </div>
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  if (!confirm("このパスキーを削除しますか？")) return;
                  const { error } = await authClient.passkey.deletePasskey({ id: passkey.id });
                  setMessage(error ? { ok: false, text: "削除できませんでした" } : null);
                  await load();
                }}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={async () => {
          const response = await authClient.passkey.addPasskey({ name: deviceLabel() });
          if (response?.error) setMessage({ ok: false, text: "パスキーを登録できませんでした" });
          else {
            setMessage({ ok: true, text: "パスキーを登録しました" });
            await load();
          }
        }}
      >
        パスキーを登録
      </button>
      {message && (
        <p className={message.ok ? "ok" : "error"} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}

/** パスキーの名前の既定値。どの端末で作ったかの目安にする。 */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iPhone / iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "パスキー";
}
