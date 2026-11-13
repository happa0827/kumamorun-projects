// 家族（親だけ）。子供の一覧と追加、子供のログイン、子供の端末の失効、招待コード、親の一覧。
// 親がログインさせられる（ログインリンク、アプリ）のは、親が作った子供だけ。Google の子供は自分でログインする。
// 親が作った子供は、ログインリンクが漏れたときなどに、親がすべての端末からログアウトさせられる。
import { useState } from "react";
import { Link } from "@void/react";
import { Copy, Link2, LogOut, Plus, UserPlus } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { Card } from "@/components/arc/card/card";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Input } from "@/components/arc/input/input";
import { ConfirmDialog } from "../src/components/confirm-dialog";
import type { Props } from "./family.server";

type Loaded = Extract<Props, { children: unknown }>;
type Child = Loaded["children"][number];
type Message = { ok: boolean; text: string } | null;

const time = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

export default function FamilyPage(props: Props) {
  if (!("children" in props)) return null; // loader が移動させる
  return (
    <>
      <Children initial={props.children} />
      <Invites
        initial={props.invites}
        myName={props.parents.find((p) => p.id === props.me)?.name ?? ""}
      />
      <Parents list={props.parents} me={props.me} />
    </>
  );
}

function Children({ initial }: { initial: Child[] }) {
  const [list, setList] = useState(initial);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const trimmed = name.trim();
  const tooLong = trimmed.length > 40;

  return (
    <section className="panel" aria-labelledby="children-title">
      <div className="panel-head">
        <h1 id="children-title">子供</h1>
        <p className="muted">
          Google
          を持たない子供は、ここで追加して、ログインリンクを子供の端末で開いてもらいます。Google
          を持つ子供は、下の招待コードで加われます。
        </p>
      </div>
      <Alert
        tone={message?.ok ? "success" : "danger"}
        title={message?.text ?? ""}
        open={message !== null}
        onDismiss={() => setMessage(null)}
      />
      {list.length === 0 ? (
        <EmptyState
          title="まだ子供がいません"
          description="名前を入れて、子供を追加してください。"
        />
      ) : (
        <ul className="cards">
          {list.map((child) => (
            <li key={child.id}>
              <ChildCard child={child} />
            </li>
          ))}
        </ul>
      )}
      <form
        className="name-form"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (adding || !trimmed || tooLong) return;
          setAdding(true);
          const response = await fetch("/api/auth/family/add-child", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: trimmed }),
          });
          setAdding(false);
          if (!response.ok) {
            setMessage({
              ok: false,
              text:
                response.status === 409
                  ? "子供は1つの家族に20人までです"
                  : `追加できませんでした（${response.status}）`,
            });
            return;
          }
          const child = (await response.json()) as { id: string; name: string };
          setList((current) => [
            ...current,
            {
              ...child,
              email: null,
              createdByParent: true,
              flowers: 0,
              appRunning: false,
              keeping: false,
              devices: [],
            },
          ]);
          setName("");
          setMessage({
            ok: true,
            text: `${child.name}を追加しました。ログインリンクを作って、子供の端末で開いてください`,
          });
        }}
      >
        <Input
          label="子供を追加"
          description="名前（ニックネームでかまいません）"
          autoComplete="off"
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
            loading={adding}
            disabled={!trimmed || tooLong}
          >
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            追加
          </Button>
        </div>
      </form>
    </section>
  );
}

function ChildCard({ child }: { child: Child }) {
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // ログアウトさせると端末も失効するので、端末の一覧はカードで持つ
  const [devices, setDevices] = useState(child.devices);
  const q = `child=${encodeURIComponent(child.id)}`;

  return (
    <Card
      title={child.name || "（名前なし）"}
      description={`花 ${child.flowers}${child.email ? `・${child.email}` : ""}`}
      action={
        child.appRunning ? (
          <Badge tone={child.keeping ? "success" : "danger"} size="sm" dot>
            {child.keeping ? "守れている" : "守れていない"}
          </Badge>
        ) : (
          <Badge size="sm">アプリ停止</Badge>
        )
      }
    >
      <div className="stack">
        <div className="row">
          <Link href={`/?${q}`}>状況</Link>
          <Link href={`/shop?${q}`}>ショップ</Link>
          {child.createdByParent && <Link href={`/link?${q}`}>このパソコンのアプリでログイン</Link>}
        </div>
        {!child.createdByParent && (
          <p className="muted">
            自分の Google で登録した子供です。サイトにもアプリにも、子供が自分でログインします。
          </p>
        )}
        {child.createdByParent && (
          <div className="row">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const response = await fetch(
                  `/api/family/children/${encodeURIComponent(child.id)}/sign-in-link`,
                  { method: "POST" },
                );
                setBusy(false);
                if (!response.ok) {
                  setError(`リンクを作れませんでした（${response.status}）`);
                  return;
                }
                setLink((await response.json()) as { url: string; expiresAt: number });
              }}
            >
              <Link2 size={16} strokeWidth={1.75} aria-hidden="true" />
              サイトのログインリンクを作る
            </Button>
            <ConfirmDialog
              trigger={
                <Button type="button" variant="danger" size="sm">
                  <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
                  すべての端末からログアウト
                </Button>
              }
              title={`${child.name}を、すべての端末からログアウトさせますか？`}
              description="ログインリンクをほかの人に開かれたときなどに使います。サイトのログイン、アプリの端末、パスキー、まだ使われていないログインリンクがすべて使えなくなります。子供には、新しいログインリンクでログインし直してもらってください。"
              confirmLabel="ログアウトさせる"
              onConfirm={async () => {
                setError(null);
                setNotice(null);
                const response = await fetch("/api/auth/family/sign-out-child", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ childId: child.id }),
                });
                if (!response.ok) {
                  setError(`ログアウトさせられませんでした（${response.status}）`);
                  return;
                }
                setLink(null);
                setDevices([]);
                setNotice(
                  `${child.name}を、すべての端末からログアウトさせました。新しいログインリンクを作って、子供の端末で開いてください`,
                );
              }}
            />
          </div>
        )}
        {link && (
          <CopyField
            label="ログインリンク"
            value={link.url}
            note={`${time.format(link.expiresAt)}まで、一度だけ使えます。子供の端末で開くと、${child.name}としてログインします。作り直すと、前のリンクは使えなくなります。ほかの人に開かれたかもしれないときは、作り直すだけでは足りないので「すべての端末からログアウト」を使ってください。`}
          />
        )}
        <ChildDevices childName={child.name} list={devices} setList={setDevices} />
        <Alert
          tone="success"
          title={notice ?? ""}
          open={notice !== null}
          onDismiss={() => setNotice(null)}
        />
        <Alert
          tone="danger"
          title={error ?? ""}
          open={error !== null}
          onDismiss={() => setError(null)}
        />
      </div>
    </Card>
  );
}

/** 子供のアプリの端末。パソコンをなくしたときなどに、親が失効できる。 */
function ChildDevices({
  childName,
  list,
  setList,
}: {
  childName: string;
  list: Child["devices"];
  setList: React.Dispatch<React.SetStateAction<Child["devices"]>>;
}) {
  const [error, setError] = useState<string | null>(null);
  if (list.length === 0) return <p className="muted">アプリでログインしている端末はありません。</p>;
  return (
    <div className="stack">
      <p className="muted">
        アプリでログインしている端末です。なくしたときなどは失効してください。その端末は、ログインし直すまで同期できなくなります。
      </p>
      <ul className="cards">
        {list.map((device) => (
          <li key={device.id} data-device-id={device.id} data-device-name={device.name}>
            <Card
              title={device.name}
              description={`最終利用 ${time.format(device.lastSeenAt)}`}
              action={
                <ConfirmDialog
                  trigger={
                    <Button type="button" variant="danger" size="sm">
                      失効
                    </Button>
                  }
                  title={`${childName}の「${device.name}」を失効しますか？`}
                  description="この端末のアプリは、ログインし直すまで同期できなくなります。"
                  confirmLabel="失効する"
                  onConfirm={async () => {
                    const response = await fetch(`/api/devices/${encodeURIComponent(device.id)}`, {
                      method: "DELETE",
                    });
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
      <Alert
        tone="danger"
        title={error ?? ""}
        open={error !== null}
        onDismiss={() => setError(null)}
      />
    </div>
  );
}

function CopyField({ label, value, note }: { label: string; value: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack">
      <Input label={label} value={value} readOnly onFocus={(event) => event.target.select()} />
      <div className="row">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(value).catch(() => {});
            setCopied(true);
          }}
        >
          <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
          {copied ? "コピーしました" : "コピー"}
        </Button>
      </div>
      <p className="muted">{note}</p>
    </div>
  );
}

function Invites({ initial, myName }: { initial: Loaded["invites"]; myName: string }) {
  const [invite, setInvite] = useState<{
    id: string;
    code: string;
    kind: "parent" | "child";
    expiresAt: number;
  } | null>(null);
  // まだ使われていない招待コード。コードそのものは出せない（サーバーはハッシュしか持たない）
  const [pending, setPending] = useState(initial);
  const [busy, setBusy] = useState<"parent" | "child" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (kind: "parent" | "child") => {
    setBusy(kind);
    setError(null);
    const response = await fetch("/api/family/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    setBusy(null);
    if (!response.ok) {
      setError(`招待コードを作れませんでした（${response.status}）`);
      return;
    }
    const created = (await response.json()) as NonNullable<typeof invite>;
    setInvite(created);
    setPending((current) => [
      { id: created.id, kind: created.kind, createdBy: myName, expiresAt: created.expiresAt },
      ...current,
    ]);
  };

  const revoke = async (id: string) => {
    const response = await fetch(`/api/family/invites/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    // 404 は、もう使われたか、ほかの親が取り消した
    if (!response.ok && response.status !== 404) {
      setError(`取り消せませんでした（${response.status}）`);
      return;
    }
    setPending((current) => current.filter((p) => p.id !== id));
    setInvite((current) => (current?.id === id ? null : current));
    setError(null);
  };

  return (
    <section className="panel" aria-labelledby="invite-title">
      <div className="panel-head">
        <h2 id="invite-title">招待コード</h2>
        <p className="muted">
          Google
          で登録した人が、はじめの画面でこのコードを入れると、この家族に加わります。24時間で失効し、一度しか使えません。
        </p>
      </div>
      <div className="row">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy === "child"}
          disabled={busy !== null}
          onClick={() => create("child")}
        >
          <UserPlus size={16} strokeWidth={1.75} aria-hidden="true" />
          子供を招待
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy === "parent"}
          disabled={busy !== null}
          onClick={() => create("parent")}
        >
          <UserPlus size={16} strokeWidth={1.75} aria-hidden="true" />
          親を招待
        </Button>
      </div>
      {invite && (
        <CopyField
          label={invite.kind === "child" ? "子供の招待コード" : "親の招待コード"}
          value={invite.code}
          note={`${time.format(invite.expiresAt)}まで使えます。`}
        />
      )}
      {pending.length > 0 && (
        <div className="stack">
          <p className="muted">
            まだ使われていない招待コードです。送り間違えたときや、ほかの人に知られたときは取り消してください。
          </p>
          <ul className="cards">
            {pending.map((p) => (
              <li key={p.id} data-invite-id={p.id}>
                <Card
                  title={p.kind === "child" ? "子供の招待コード" : "親の招待コード"}
                  description={`${p.createdBy || "（名前なし）"}が発行・${time.format(p.expiresAt)}まで`}
                  action={
                    <ConfirmDialog
                      trigger={
                        <Button type="button" variant="danger" size="sm">
                          取り消す
                        </Button>
                      }
                      title="この招待コードを取り消しますか？"
                      description="取り消したコードでは、家族に入れなくなります。"
                      confirmLabel="取り消す"
                      onConfirm={() => revoke(p.id)}
                    />
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      <Alert
        tone="danger"
        title={error ?? ""}
        open={error !== null}
        onDismiss={() => setError(null)}
      />
    </section>
  );
}

function Parents({ list, me }: { list: Loaded["parents"]; me: string }) {
  return (
    <section className="panel" aria-labelledby="parents-title">
      <div className="panel-head">
        <h2 id="parents-title">親</h2>
      </div>
      <ul className="cards">
        {list.map((parent) => (
          <li key={parent.id}>
            <Card
              title={`${parent.name || "（名前なし）"}${parent.id === me ? "（自分）" : ""}`}
              description={parent.email ?? undefined}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
