// 家族（親だけ）。子供の一覧と追加、子供のログインリンク、招待コード、親の一覧。
import { useState } from "react";
import { Link } from "@void/react";
import { Copy, Link2, Plus, UserPlus } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { Card } from "@/components/arc/card/card";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Input } from "@/components/arc/input/input";
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
      <Invites />
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
            setMessage({ ok: false, text: `追加できませんでした（${response.status}）` });
            return;
          }
          const child = (await response.json()) as { id: string; name: string };
          setList((current) => [
            ...current,
            { ...child, email: null, flowers: 0, appRunning: false, keeping: false },
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
          <Link href={`/link?${q}`}>このパソコンのアプリでログイン</Link>
        </div>
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
        </div>
        {link && (
          <CopyField
            label="ログインリンク"
            value={link.url}
            note={`${time.format(link.expiresAt)}まで、一度だけ使えます。子供の端末で開くと、${child.name}としてログインします。`}
          />
        )}
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

function Invites() {
  const [invite, setInvite] = useState<{
    code: string;
    kind: "parent" | "child";
    expiresAt: number;
  } | null>(null);
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
    setInvite((await response.json()) as typeof invite);
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
