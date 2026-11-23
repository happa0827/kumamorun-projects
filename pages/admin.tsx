// 管理: 完全版の承認と、キャラクターの画像（docs/demo-edition.md）。管理者（ADMINS）だけが開ける。
import { useEffect, useRef, useState } from "react";
import { ImageUp, Upload } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { ConfirmDialog } from "../src/components/confirm-dialog";
import type { Props } from "./admin.server";

const date = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeZone: "Asia/Tokyo" });
const time = new Intl.DateTimeFormat("ja-JP", { timeStyle: "medium", timeZone: "Asia/Tokyo" });
const dateTime = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

type Loaded = Extract<Props, { accounts: unknown }>;
type Account = Loaded["accounts"][number];
type Character = Loaded["characters"]["images"][number];

export default function AdminPage(props: Props) {
  if (!("accounts" in props)) return null; // loader が移動させる
  return (
    <>
      <Approvals initial={props.accounts} adminId={props.adminId} />
      <Characters initial={props.characters} />
    </>
  );
}

function Approvals({ initial, adminId }: { initial: Account[]; adminId: string }) {
  const [list, setList] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const approvedCount = list.filter((a) => a.approvedAt !== null).length;

  const setApproved = (id: string, approvedAt: number | null) =>
    setList((current) =>
      current.map((a) =>
        a.id === id ? { ...a, approvedAt, note: approvedAt ? a.note : null } : a,
      ),
    );

  const approve = async (account: Account) => {
    setBusy(account.id);
    setError(null);
    try {
      const status = await send(`/api/admin/approvals/${encodeURIComponent(account.id)}`, {
        method: "PUT",
      });
      if (status !== "ok") return setError(`承認できませんでした（${status}）`);
      setApproved(account.id, Date.now());
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel" aria-labelledby="approvals-title">
      <div className="panel-head">
        <h1 id="approvals-title">完全版の承認</h1>
        <p className="muted">
          承認したアカウントだけが完全版になります（{list.length}件中 {approvedCount}
          件）。アプリは次の同期（最大10分後。アカウント画面を開けばすぐ）で切り替わります。
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
          title="アカウントがありません"
          description="サイトに登録した人が、ここに並びます。"
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">名前</th>
                <th scope="col">メール</th>
                <th scope="col">種類</th>
                <th scope="col">登録日</th>
                <th scope="col">版</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((account) => (
                <tr key={account.id} data-account-id={account.id}>
                  <td>{account.name || <span className="muted">（名前なし）</span>}</td>
                  <td>{account.email ?? <span className="muted">親が作った子供</span>}</td>
                  <td>{account.kindLabel ?? <span className="muted">未選択</span>}</td>
                  <td className="mono">{date.format(account.createdAt)}</td>
                  <td>
                    {account.approvedAt !== null ? (
                      <Badge tone="success" size="sm" dot title={approvedTitle(account)}>
                        完全版
                      </Badge>
                    ) : (
                      <Badge tone="neutral" size="sm" dot>
                        デモ版
                      </Badge>
                    )}
                  </td>
                  <td>
                    {account.approvedAt === null ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        loading={busy === account.id}
                        disabled={busy !== null}
                        onClick={() => void approve(account)}
                      >
                        承認する
                      </Button>
                    ) : (
                      <ConfirmDialog
                        trigger={
                          <Button type="button" variant="ghost" size="sm" disabled={busy !== null}>
                            取り消す
                          </Button>
                        }
                        title={`「${account.name || account.email || account.id}」の承認を取り消しますか？`}
                        description={
                          account.id === adminId
                            ? "あなた自身のアカウントです。次の同期で、あなたのアプリもデモ版に戻り、受け取った画像が消えます。"
                            : "次の同期でデモ版に戻り、アプリが受け取った画像を端末から消します。"
                        }
                        confirmLabel="長押しで取り消す"
                        hold={{ confirmedLabel: "取り消しました" }}
                        onConfirm={async () => {
                          // 失敗したら false を返し、ダイアログを開いたままにする（もう一度押せる）
                          const status = await send(
                            `/api/admin/approvals/${encodeURIComponent(account.id)}`,
                            { method: "DELETE" },
                          );
                          if (status !== "ok") {
                            setError(`取り消せませんでした（${status}）`);
                            return false;
                          }
                          setApproved(account.id, null);
                          setError(null);
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * 本文を読まない要求を送る。成功なら "ok"、失敗なら状態の番号。
 * つながらずに fetch が投げたときも、画面が止まらないよう「通信エラー」を返す。
 */
async function send(url: string, init: RequestInit): Promise<string> {
  try {
    const response = await fetch(url, init);
    return response.ok ? "ok" : String(response.status);
  } catch {
    return "通信エラー";
  }
}

function approvedTitle(account: Account) {
  const at = account.approvedAt === null ? "" : `承認 ${dateTime.format(account.approvedAt)}`;
  return account.note ? `${at}（${account.note}）` : at;
}

function Characters({ initial }: { initial: Loaded["characters"] }) {
  const [images, setImages] = useState(initial.images);
  /** 配っている版 */
  const [version, setVersion] = useState(initial.version);
  /** 公開したが、まだ配り始めていない版（公開から1分後に配り始める） */
  const [pending, setPending] = useState(initial.pending);

  // 配り始める時刻（servesAt）が来たら、配信待ちの版を「配っている版」に移す。
  // 時刻はサーバーの時計なので、ずれを見込んで少し遅らせる。
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(
      () => {
        setVersion(pending.version);
        setPending(null);
      },
      Math.max(0, pending.servesAt - Date.now()) + 2000,
    );
    return () => window.clearTimeout(timer);
  }, [pending]);
  /** 公開してから置き直した画像があるか。あれば「公開」を促す。 */
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const missing = images.filter((i) => !i.present);

  const uploaded = (key: string, size: number) => {
    setImages((current) =>
      current.map((i) =>
        i.key === key ? { ...i, present: true, size, updatedAt: Date.now() } : i,
      ),
    );
    setDirty(true);
  };

  const publish = async () => {
    setPublishing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/publish-characters", { method: "POST" });
      if (response.status === 409) {
        const { missing: keys } = (await response.json()) as { missing: string[] };
        setMessage({
          ok: false,
          text: `まだ置いていない画像があります: ${keys.join("、")}`,
        });
        return;
      }
      if (!response.ok) {
        setMessage({ ok: false, text: `公開できませんでした（${response.status}）` });
        return;
      }
      const next = (await response.json()) as { version: string; servesAt: number };
      setPending(next);
      setDirty(false);
      setMessage({
        ok: true,
        text: `公開しました。${time.format(next.servesAt)} から配り始め、完全版のアプリはそのあとの同期で画像を取り直します`,
      });
    } catch {
      setMessage({ ok: false, text: "公開できませんでした（通信エラー）" });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="characters-title">
      <div className="panel-head">
        <h2 id="characters-title">キャラクターの画像</h2>
        <p className="muted">
          完全版のアプリに渡す画像です（PNG、1枚 2MB
          まで）。リポジトリには入れず、ここから置きます。ここに並ぶのは下書きで、置いただけでは配りません。10枚そろえて「公開」すると、その10枚が新しい版としてアプリに渡ります（公開した版は、あとから置き直しても変わりません）。置いた画像が行き渡るまで、1分ほど待ってから公開してください。
        </p>
        <p className="muted">
          配っている版:{" "}
          {version ? (
            <span className="mono">{version}</span>
          ) : (
            "まだ配っていません（完全版のアプリもシルエットのままです）"
          )}
        </p>
        {pending && (
          <p className="muted">
            配信待ちの版: <span className="mono">{pending.version}</span>（
            {time.format(pending.servesAt)} から配ります。画像が行き渡るのを待っています）
          </p>
        )}
      </div>
      <Alert
        tone={message?.ok ? "success" : "danger"}
        title={message?.text ?? ""}
        open={message !== null}
        onDismiss={() => setMessage(null)}
      />
      <ul className="character-grid">
        {images.map((image) => (
          <CharacterSlot
            key={image.key}
            image={image}
            onUploaded={uploaded}
            onError={(text) => setMessage({ ok: false, text })}
          />
        ))}
      </ul>
      <div className="row">
        <Button
          type="button"
          variant={dirty || (!version && !pending) ? "primary" : "secondary"}
          loading={publishing}
          disabled={missing.length > 0}
          onClick={() => void publish()}
        >
          <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
          {version || pending ? "置き直した画像を公開" : "公開"}
        </Button>
        {missing.length > 0 && <p className="muted">あと {missing.length} 枚</p>}
      </div>
    </section>
  );
}

function CharacterSlot({
  image,
  onUploaded,
  onError,
}: {
  image: Character;
  onUploaded: (key: string, size: number) => void;
  onError: (text: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) return onError(`${image.label}: 2MB を超えています`);
    setBusy(true);
    try {
      const status = await send(`/api/admin/characters/${image.key}`, {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: file,
      });
      if (status === "415")
        return onError(`${image.label}: PNG ではないか、途中で切れたファイルです`);
      if (status !== "ok") return onError(`${image.label}: 置けませんでした（${status}）`);
      onUploaded(image.key, file.size);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="character-slot" data-character-key={image.key}>
      <div className="character-thumb">
        {image.present ? (
          <img src={`/api/admin/characters/${image.key}?t=${image.updatedAt ?? 0}`} alt="" />
        ) : (
          <span className="muted">未設定</span>
        )}
      </div>
      <div className="stack">
        <strong>{image.label}</strong>
        <span className="muted mono">
          {image.key}
          {image.size !== null && `・${Math.ceil(image.size / 1024)}KB`}
        </span>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={busy}
        onClick={() => input.current?.click()}
      >
        <ImageUp size={16} strokeWidth={1.75} aria-hidden="true" />
        {image.present ? "置き直す" : "置く"}
      </Button>
    </li>
  );
}
