// 設定: アカウント、端末の一覧と失効、パスキー、ログアウト。
import { useEffect, useState } from "react";
import { KeyRound, LogOut, Monitor } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { Card } from "@/components/arc/card/card";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Input } from "@/components/arc/input/input";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { authClient } from "../src/auth-client";
import { ConfirmDialog } from "../src/components/confirm-dialog";
import { OpenAppButton } from "../src/components/open-app";
import type { Props } from "./settings.server";

const dateTime = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

type Loaded = Extract<Props, { devices: unknown }>;
type Passkey = { id: string; name?: string | null; createdAt?: Date | string | null };

export default function SettingsPage(props: Props) {
  if (!("devices" in props)) return null; // ログインしていなければ loader が移動させる
  return <Settings {...props} />;
}

function Settings({ user, devices }: Loaded) {
  return (
    <>
      <section className="panel" aria-labelledby="account-title">
        <div className="panel-head">
          <h1 id="account-title">設定</h1>
          <p className="lead">{user.email}</p>
        </div>
        <NameForm initial={user.name} />
        <div className="row">
          <OpenAppButton />
          <Button
            type="button"
            variant="ghost"
            onClick={async () => {
              await authClient.signOut();
              location.href = "/";
            }}
          >
            <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
            ログアウト
          </Button>
        </div>
      </section>
      <Devices initial={devices} />
      <Passkeys />
    </>
  );
}

/** メールのコードで登録すると名前は空なので、ここで付けられるようにする */
function NameForm({ initial }: { initial: string }) {
  const [name, setName] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const trimmed = name.trim();
  const tooLong = trimmed.length > 40;

  return (
    <form
      className="name-form"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving || tooLong || trimmed === saved) return;
        setSaving(true);
        const { error } = await authClient.updateUser({ name: trimmed });
        setSaving(false);
        if (error) {
          setMessage({ ok: false, text: "名前を保存できませんでした" });
          return;
        }
        setSaved(trimmed);
        setName(trimmed);
        setMessage({ ok: true, text: "名前を保存しました" });
      }}
    >
      <Input
        label="名前"
        description="サイトの表示に使います。空のままでもかまいません。"
        autoComplete="nickname"
        value={name}
        error={tooLong ? "40文字までにしてください" : undefined}
        onChange={(event) => {
          setName(event.target.value);
          setMessage(null);
        }}
      />
      <div className="row">
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          loading={saving}
          disabled={tooLong || trimmed === saved}
        >
          保存
        </Button>
      </div>
      <Alert
        tone={message?.ok ? "success" : "danger"}
        title={message?.text ?? ""}
        open={message !== null}
        onDismiss={() => setMessage(null)}
      />
    </form>
  );
}

function Devices({ initial }: { initial: Loaded["devices"] }) {
  const [list, setList] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="panel" aria-labelledby="devices-title">
      <div className="panel-head">
        <h2 id="devices-title">端末</h2>
        <p className="muted">
          アプリでログインしている端末です。失効すると、その端末はログインし直すまで同期できなくなります。
        </p>
      </div>
      <Alert
        tone="danger"
        title={error ?? ""}
        open={error !== null}
        onDismiss={() => setError(null)}
      />
      {list.length === 0 ? (
        <EmptyState
          icon={<Monitor size={20} strokeWidth={1.75} aria-hidden="true" />}
          title="まだ端末がありません"
          description="「アプリを開く」から、パソコンのアプリにログインしてください。"
        />
      ) : (
        <ul className="cards">
          {list.map((device) => (
            <li key={device.id} data-device-id={device.id} data-device-name={device.name}>
              <Card
                title={device.name}
                description={`最終利用 ${dateTime.format(device.lastSeenAt)}`}
                meta={`登録 ${dateTime.format(device.createdAt)}`}
                action={
                  <ConfirmDialog
                    trigger={
                      <Button type="button" variant="danger" size="sm">
                        失効
                      </Button>
                    }
                    title={`「${device.name}」を失効しますか？`}
                    description="この端末のアプリは、ログインし直すまで同期できなくなります。"
                    confirmLabel="失効する"
                    onConfirm={async () => {
                      const response = await fetch(
                        `/api/devices/${encodeURIComponent(device.id)}`,
                        { method: "DELETE" },
                      );
                      if (!response.ok && response.status !== 404) {
                        setError(`失効できませんでした（${response.status}）`);
                        return;
                      }
                      setList((current) => current.filter((d) => d.id !== device.id));
                      setError(null);
                    }}
                  />
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Passkeys() {
  const [list, setList] = useState<Passkey[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const { data } = await authClient.passkey.listUserPasskeys();
    setList((data as Passkey[] | null) ?? []);
  };
  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="panel" aria-labelledby="passkey-title">
      <div className="panel-head">
        <h2 id="passkey-title">パスキー</h2>
        <p className="muted">
          登録すると、メールのコードを待たずに、指紋や顔、PIN でログインできます。
        </p>
      </div>
      <Alert
        tone={message?.ok ? "success" : "danger"}
        title={message?.text ?? ""}
        open={message !== null}
        onDismiss={() => setMessage(null)}
      />
      <Skeleton label="パスキーを読み込み中" lines={2} loading={list === null}>
        {list && list.length > 0 && (
          <ul className="cards">
            {list.map((passkey) => (
              <li key={passkey.id}>
                <Card
                  title={passkey.name || "パスキー"}
                  description={
                    passkey.createdAt
                      ? `登録 ${dateTime.format(new Date(passkey.createdAt))}`
                      : undefined
                  }
                  action={
                    <ConfirmDialog
                      trigger={
                        <Button type="button" variant="ghost" size="sm">
                          削除
                        </Button>
                      }
                      title="このパスキーを削除しますか？"
                      description="削除したパスキーでは、ログインできなくなります。"
                      confirmLabel="削除する"
                      onConfirm={async () => {
                        const { error } = await authClient.passkey.deletePasskey({
                          id: passkey.id,
                        });
                        setMessage(error ? { ok: false, text: "削除できませんでした" } : null);
                        await load();
                      }}
                    />
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Skeleton>
      <div className="row">
        <Button
          type="button"
          variant="secondary"
          loading={adding}
          onClick={async () => {
            setAdding(true);
            const response = await authClient.passkey.addPasskey({ name: deviceLabel() });
            setAdding(false);
            if (response?.error) setMessage({ ok: false, text: "パスキーを登録できませんでした" });
            else {
              setMessage({ ok: true, text: "パスキーを登録しました" });
              await load();
            }
          }}
        >
          <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />
          パスキーを登録
        </Button>
      </div>
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
