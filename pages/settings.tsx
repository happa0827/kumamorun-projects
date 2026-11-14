// 設定: アカウント（写真、名前）、端末の一覧と失効、パスキー、ログアウト。
import { useEffect, useRef, useState } from "react";
import { useRouter } from "@void/react";
import { Ban, ImageUp, KeyRound, LogOut, Monitor } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Avatar } from "@/components/arc/avatar/avatar";
import { Button } from "@/components/arc/button/button";
import { Card } from "@/components/arc/card/card";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Input } from "@/components/arc/input/input";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { authClient } from "../src/auth-client";
import { ConfirmDialog } from "../src/components/confirm-dialog";
import { HoldAction } from "../src/components/hold-action";
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
          <p className="lead">{user.email ?? "親が作ったアカウント"}</p>
          <p className="muted">アカウントの種類: {user.kindLabel}</p>
        </div>
        <AvatarForm initial={user.image} name={user.name} />
        <NameForm initial={user.name} />
        <div className="row">
          {user.kind !== "parent" && <OpenAppButton />}
          <HoldAction
            label="長押しでログアウト"
            confirmedLabel="ログアウトしました"
            tone="neutral"
            icon={<LogOut strokeWidth={1.75} />}
            onConfirm={async () => {
              const { error } = await authClient.signOut();
              if (error) return false;
              location.href = "/";
            }}
          />
        </div>
      </section>
      {/* 親は端末を持たないが、親を選ぶ前からの端末が残っていれば出す */}
      {(user.kind !== "parent" || devices.length > 0) && (
        <Devices initial={devices} parent={user.kind === "parent"} />
      )}
      <Passkeys />
    </>
  );
}

/** 画面で縮める大きさ（src/server/avatar.ts の AVATAR_SIZE と同じ） */
const AVATAR_SIZE = 256;

/**
 * 写真。選んだ画像を真ん中で正方形に切り、AVATAR_SIZE に縮めてから送る（元の大きな画像は送らない）。
 * Google で登録した人は、置くまでは Google の写真が出る。
 */
function AvatarForm({ initial, name }: { initial: string | null; name: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState(initial);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const upload = async (file: File) => {
    setBusy("save");
    setMessage(null);
    try {
      const blob = await shrinkImage(file);
      const response = await fetch("/api/account/avatar", {
        method: "PUT",
        headers: { "content-type": blob.type },
        body: blob,
      });
      if (!response.ok) throw new Error(String(response.status));
      const { image: url } = (await response.json()) as { image: string };
      setImage(url);
      setMessage({ ok: true, text: "写真を保存しました" });
      void router.refresh(); // ヘッダーの写真も変える
    } catch {
      setMessage({ ok: false, text: "写真を保存できませんでした。別の画像で試してください" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="avatar-form">
      <Avatar name={name || "?"} src={image ?? undefined} size="xl" />
      <div className="stack">
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = ""; // 同じ画像を選び直せるようにする
            if (file) void upload(file);
          }}
        />
        <div className="row">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={busy === "save"}
            disabled={busy !== null}
            onClick={() => input.current?.click()}
          >
            <ImageUp size={16} strokeWidth={1.75} aria-hidden="true" />
            {image ? "写真を変える" : "写真を選ぶ"}
          </Button>
          {image && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={busy === "delete"}
              disabled={busy !== null}
              onClick={async () => {
                setBusy("delete");
                const response = await fetch("/api/account/avatar", { method: "DELETE" });
                setBusy(null);
                if (!response.ok) {
                  setMessage({ ok: false, text: "写真を消せませんでした" });
                  return;
                }
                setImage(null);
                setMessage({ ok: true, text: "写真を消しました" });
                void router.refresh();
              }}
            >
              写真を消す
            </Button>
          )}
        </div>
        <p className="muted">家族の画面とメニューに出ます。真ん中を正方形に切り取ります。</p>
      </div>
      <Alert
        tone={message?.ok ? "success" : "danger"}
        title={message?.text ?? ""}
        open={message !== null}
        onDismiss={() => setMessage(null)}
      />
    </div>
  );
}

/** 真ん中を正方形に切り、AVATAR_SIZE に縮める。WebP にできない端末では JPEG にする。 */
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file); // 写真の向き（EXIF）は既定で直る
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");
  context.imageSmoothingQuality = "high";
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();
  const encode = (target: HTMLCanvasElement, type: string) =>
    new Promise<Blob | null>((resolve) => target.toBlob(resolve, type, 0.85));
  const webp = await encode(canvas, "image/webp");
  if (webp?.type === "image/webp") return webp;
  // JPEG は透明を黒にするので、白に重ねる
  const flat = document.createElement("canvas");
  flat.width = flat.height = AVATAR_SIZE;
  const flatContext = flat.getContext("2d");
  if (!flatContext) throw new Error("no canvas");
  flatContext.fillStyle = "#fff";
  flatContext.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  flatContext.drawImage(canvas, 0, 0);
  const jpeg = await encode(flat, "image/jpeg");
  if (!jpeg) throw new Error("encode failed");
  return jpeg;
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

function Devices({ initial, parent }: { initial: Loaded["devices"]; parent: boolean }) {
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
        tone="warning"
        title="親のアカウントのまま、アプリにログインしている端末があります"
        open={parent}
      >
        親は自分ではアプリを使いません。子供が使うパソコンなら、ここで失効してから、「家族」で子供を選んでアプリにログインし直してください。この端末の記録と花は、このアカウントに残ります。
      </Alert>
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
                    confirmLabel="長押しで失効"
                    hold={{ confirmedLabel: "失効しました", icon: <Ban strokeWidth={1.75} /> }}
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
          登録すると、指紋や顔、PIN でログインできます。Google
          を持たない子供は、親のログインリンクで入ったあと、ここで登録すると次から自分でログインできます。
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
                      confirmLabel="長押しで削除"
                      hold={{ confirmedLabel: "削除しました" }}
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
