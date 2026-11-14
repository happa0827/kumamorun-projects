// ショップ: 花で品（チケット）を買う。旧 happa0827/kumamorun の「くまもーるん交換所」を引き継ぐ。
// 品と通知先はアカウントごとに D1 に持つ（旧版はブラウザの localStorage）。
// 大人は全部、子供は買うだけ、親は子供の品と通知先を決める（買わない）。
// 親の画面では、通知先を家族の親からチェックで選べ、親以外の宛先も手で足せる（合わせて上限まで）。
import { useState } from "react";
import { Mail, Plus, RotateCcw, Save, ShoppingBag, Trash2 } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { Card } from "@/components/arc/card/card";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Input } from "@/components/arc/input/input";
import { Link } from "@void/react";
import { ChildTabs } from "../src/components/child-tabs";
import { ConfirmDialog } from "../src/components/confirm-dialog";
import type { Props } from "./shop.server";

type Loaded = NonNullable<Extract<Props, { shop: unknown }>["shop"]>;
type Item = Loaded["items"][number];
type Purchase = Loaded["purchases"][number];
type Message = { ok: boolean; text: string } | null;
type Mode = "adult" | "child" | "parent";
/** 親が子供のショップを見るとき、その子供 */
type Owner = { id: string; name: string };
/** 家族の親。通知先の候補 */
type Parent = { name: string; email: string };

const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const dateTime = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

export default function ShopPage(props: Props) {
  if (!("mode" in props)) return null; // ログインしていなければ loader が移動させる
  if (props.mode !== "parent") return <Shop mode={props.mode} initial={props.shop} />;

  const owner = props.children.find((c) => c.id === props.selected);
  if (!owner || !props.shop) {
    return (
      <section className="panel">
        <EmptyState
          icon={<ShoppingBag size={20} strokeWidth={1.75} aria-hidden="true" />}
          title="まだ子供がいません"
          description="「家族」から子供を追加すると、子供のショップの品と通知先を決められます。"
          action={<Link href="/family">家族へ</Link>}
        />
      </section>
    );
  }
  return (
    <>
      <ChildTabs base="/shop" list={props.children} selected={owner.id} />
      {/* 子供を切り替えたら、編集中の値も作り直す */}
      <Shop
        key={owner.id}
        mode="parent"
        initial={props.shop}
        owner={owner}
        parents={props.parents}
      />
    </>
  );
}

function Shop({
  mode,
  initial,
  owner,
  parents = [],
}: {
  mode: Mode;
  initial: Loaded;
  owner?: Owner;
  /** 通知先の候補にする家族の親（親が子供のショップを見るときだけ） */
  parents?: Parent[];
}) {
  const [items, setItems] = useState(initial.items);
  const [flowers, setFlowers] = useState(initial.flowers);
  const [history, setHistory] = useState(initial.purchases);
  // 親が子供のショップを変えるときは ?account= を付ける
  const query = owner ? `?account=${encodeURIComponent(owner.id)}` : "";

  return (
    <>
      <Storefront
        mode={mode}
        owner={owner}
        items={items}
        flowers={flowers}
        hasNotify={initial.mailEnabled && initial.notifyEmails.length > 0}
        onFlowers={setFlowers}
        onPurchased={(purchase) => setHistory((current) => [purchase, ...current].slice(0, 20))}
      />
      <History list={history} />
      {mode !== "child" && (
        <>
          <ItemEditor
            items={items}
            maxItems={initial.limits.items}
            query={query}
            onSaved={setItems}
          />
          <NotifyEditor
            enabled={initial.mailEnabled}
            initial={initial.notifyEmails}
            max={initial.limits.notifyEmails}
            parents={parents}
            query={query}
          />
        </>
      )}
    </>
  );
}

function FlowerIcon({ size = 28 }: { size?: number }) {
  return <img src="/shop/flower.png" alt="" width={size} height={size} className="flower-icon" />;
}

function Storefront({
  mode,
  owner,
  items,
  flowers,
  hasNotify,
  onFlowers,
  onPurchased,
}: {
  mode: Mode;
  owner?: Owner;
  items: Item[];
  flowers: number;
  hasNotify: boolean;
  onFlowers: (flowers: number) => void;
  onPurchased: (purchase: Purchase) => void;
}) {
  const [message, setMessage] = useState<Message>(null);

  const buy = async (item: Item): Promise<boolean> => {
    const response = await fetch("/api/shop/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: item.id, expectedPrice: item.price }),
    });
    if (response.status === 401) {
      location.reload();
      return false;
    }
    const data = (await response.json().catch(() => null)) as
      | { flowers: number; purchase: Purchase; notified: boolean }
      | { error: string; flowers: number }
      | null;
    if (data && "flowers" in data) onFlowers(data.flowers);
    if (!response.ok || !data || "error" in data) {
      const error = data && "error" in data ? data.error : null;
      setMessage({
        ok: false,
        text:
          error === "insufficient"
            ? "花が足りません"
            : error === "price_changed" || error === "not_found"
              ? "品が変わっています。ページを読み直してください"
              : `購入できませんでした（${response.status}）`,
      });
      return true; // ダイアログは閉じて、上のお知らせで伝える
    }
    onPurchased(data.purchase);
    void new Audio("/shop/buy.mp3").play().catch(() => {});
    setMessage({
      ok: true,
      text: `${item.name}を購入しました${data.notified ? "（通知を送りました）" : hasNotify ? "（通知は送れませんでした）" : ""}`,
    });
    return true;
  };

  return (
    <section className="panel" aria-labelledby="shop-title">
      <div className="shop-head">
        <div className="panel-head">
          <h1 id="shop-title">{owner ? `${owner.name}のショップ` : "ショップ"}</h1>
          <p className="muted">
            {mode === "parent"
              ? "子供が開花で集めた花と、交換できる品です。買うのは子供です。"
              : "開花で集めた花を使って、品と交換できます。"}
          </p>
        </div>
        <p className="flower-count" aria-label={`花 ${flowers}`}>
          <FlowerIcon size={40} />
          <span className="mono">{flowers}</span>
        </p>
      </div>
      <Alert
        tone={message?.ok ? "success" : "danger"}
        title={message?.text ?? ""}
        open={message !== null}
        onDismiss={() => setMessage(null)}
      />
      {items.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag size={20} strokeWidth={1.75} aria-hidden="true" />}
          title="品がありません"
          description={
            mode === "child"
              ? "親に品を追加してもらってください。"
              : "下の「品の設定」から追加してください。"
          }
        />
      ) : (
        <ul className="shop-items">
          {items.map((item) => (
            <li key={item.id}>
              <Card
                title={item.name}
                description={`花 ${item.price}`}
                action={
                  mode !== "parent" && (
                    <ConfirmDialog
                      trigger={
                        <Button type="button" size="sm" disabled={flowers < item.price}>
                          購入する
                        </Button>
                      }
                      title={`${item.name}を購入しますか？`}
                      description={`花を${item.price}つ使います（残り ${flowers - item.price}）。取り消せません。`}
                      confirmLabel="購入する"
                      confirmVariant="primary"
                      onConfirm={() => buy(item)}
                    />
                  )
                }
              >
                <span className="flower-row" aria-hidden="true">
                  {Array.from({ length: Math.min(item.price, 10) }, (_, k) => (
                    <FlowerIcon key={k} />
                  ))}
                  {item.price > 10 && <span className="muted">＋{item.price - 10}</span>}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function History({ list }: { list: Purchase[] }) {
  return (
    <section className="panel" aria-labelledby="history-title">
      <div className="panel-head">
        <h2 id="history-title">購入の記録</h2>
        <p className="muted">新しい順に20件まで出します。</p>
      </div>
      {list.length === 0 ? (
        <EmptyState title="まだ購入していません" description="購入すると、ここに記録が出ます。" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">日時</th>
                <th scope="col">品</th>
                <th scope="col">花</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{dateTime.format(p.purchasedAt)}</td>
                  <td>{p.itemName}</td>
                  <td>{p.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type Draft = { id: string; name: string; price: string };

const toDraft = (items: Item[]): Draft[] =>
  items.map((i) => ({ id: i.id, name: i.name, price: String(i.price) }));

function draftErrors(draft: Draft) {
  const name = draft.name.trim();
  const price = Number(draft.price);
  return {
    name:
      name.length === 0
        ? "名前を入れてください"
        : name.length > 40
          ? "40文字までにしてください"
          : undefined,
    price:
      !/^\d+$/.test(draft.price) || price < 1 || price > 99 ? "1〜99にしてください" : undefined,
  };
}

function ItemEditor({
  items,
  maxItems,
  query,
  onSaved,
}: {
  items: Item[];
  maxItems: number;
  /** 親が子供の品を変えるときの ?account=… */
  query: string;
  onSaved: (items: Item[]) => void;
}) {
  const [drafts, setDrafts] = useState(() => toDraft(items));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const errors = drafts.map(draftErrors);
  const invalid = errors.some((e) => e.name || e.price);
  const dirty = JSON.stringify(drafts) !== JSON.stringify(toDraft(items));

  const update = (index: number, patch: Partial<Draft>) => {
    setDrafts((current) => current.map((d, i) => (i === index ? { ...d, ...patch } : d)));
    setMessage(null);
  };

  const apply = async (response: Response, text: string) => {
    if (!response.ok) {
      setMessage({ ok: false, text: `保存できませんでした（${response.status}）` });
      return false;
    }
    const { items: saved } = (await response.json()) as { items: Item[] };
    onSaved(saved);
    setDrafts(toDraft(saved));
    setMessage({ ok: true, text });
    return true;
  };

  return (
    <section className="panel" aria-labelledby="items-title">
      <div className="panel-head">
        <h2 id="items-title">品の設定</h2>
        <p className="muted">名前と、交換に要る花の数です。{maxItems}つまで置けます。</p>
      </div>
      <Alert
        tone={message?.ok ? "success" : "danger"}
        title={message?.text ?? ""}
        open={message !== null}
        onDismiss={() => setMessage(null)}
      />
      <form
        className="stack"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving || invalid || !dirty) return;
          setSaving(true);
          const response = await fetch(`/api/shop/items${query}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              items: drafts.map((d) => ({ id: d.id, name: d.name.trim(), price: Number(d.price) })),
            }),
          });
          await apply(response, "品を保存しました");
          setSaving(false);
        }}
      >
        {drafts.map((draft, index) => (
          <div key={draft.id} className="item-row">
            <Input
              label="名前"
              value={draft.name}
              maxLength={40}
              error={errors[index]?.name}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <Input
              label="花"
              inputMode="numeric"
              value={draft.price}
              error={errors[index]?.price}
              onChange={(event) => update(index, { price: event.target.value.trim() })}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${draft.name || "この品"}を消す`}
              onClick={() => {
                setDrafts((current) => current.filter((_, i) => i !== index));
                setMessage(null);
              }}
            >
              <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </div>
        ))}
        <div className="row">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={drafts.length >= maxItems}
            onClick={() => {
              setDrafts((current) => [
                ...current,
                { id: crypto.randomUUID(), name: "新しい品", price: "1" },
              ]);
              setMessage(null);
            }}
          >
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            品を追加
          </Button>
        </div>
        <div className="row">
          <Button type="submit" loading={saving} disabled={invalid || !dirty}>
            <Save size={16} strokeWidth={1.75} aria-hidden="true" />
            保存
          </Button>
          <ConfirmDialog
            trigger={
              <Button type="button" variant="ghost">
                <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
                既定に戻す
              </Button>
            }
            title="品を既定に戻しますか？"
            description="チョコパイ、ハイチュウ、コーラ、マックの4つに戻ります。購入の記録は消えません。"
            confirmLabel="既定に戻す"
            onConfirm={async () =>
              apply(
                await fetch(`/api/shop/items${query}`, { method: "DELETE" }),
                "品を既定に戻しました",
              )
            }
          />
        </div>
      </form>
    </section>
  );
}

function NotifyEditor({
  enabled,
  initial,
  max,
  parents,
  query,
}: {
  enabled: boolean;
  initial: string[];
  max: number;
  /** チェックで選べる家族の親。親以外の宛先（祖父母など）は下の欄から手で入れる */
  parents: Parent[];
  /** 親が子供の通知先を変えるときの ?account=… */
  query: string;
}) {
  const [emails, setEmails] = useState(initial);
  const [input, setInput] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);

  const save = async (next: string[], text: string) => {
    setBusy(true);
    const response = await fetch(`/api/shop/notify-emails${query}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emails: next }),
    });
    setBusy(false);
    if (!response.ok) {
      setMessage({ ok: false, text: `保存できませんでした（${response.status}）` });
      return false;
    }
    setEmails(((await response.json()) as { emails: string[] }).emails);
    setMessage({ ok: true, text });
    return true;
  };

  const trimmed = input.trim();
  const inputError =
    trimmed === ""
      ? undefined
      : !/^\S+@\S+\.\S+$/.test(trimmed)
        ? "メールアドレスの形にしてください"
        : emails.some((e) => sameEmail(e, trimmed))
          ? "もう入っています"
          : undefined;
  const isParent = (email: string) => parents.some((p) => sameEmail(p.email, email));
  // 親の宛先はチェックの欄に出すので、カードには親以外の宛先だけを出す
  const others = emails.filter((e) => !isParent(e));
  const full = emails.length >= max;

  return (
    <section className="panel" aria-labelledby="notify-title">
      <div className="panel-head">
        <h2 id="notify-title">購入の通知</h2>
        <p className="muted">
          {enabled
            ? parents.length > 0
              ? `購入したとき、ここの宛先にメールで知らせます。家族の親を選ぶほか、親以外の宛先（祖父母など）も足せます。合わせて${max}件まで。`
              : `購入したとき、ここの宛先にメールで知らせます。${max}件まで。`
            : "いまはメールを送れないため、購入の通知は出ません。購入の記録は、このページで確かめられます。"}
        </p>
      </div>
      {enabled && (
        <>
          <Alert
            tone={message?.ok ? "success" : "danger"}
            title={message?.text ?? ""}
            open={message !== null}
            onDismiss={() => setMessage(null)}
          />
          {parents.length > 0 && (
            <fieldset className="notify-parents">
              <legend>家族の親</legend>
              {parents.map((parent) => {
                const checked = emails.some((e) => sameEmail(e, parent.email));
                return (
                  <label key={parent.email} className="check-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy || (!checked && full)}
                      onChange={() =>
                        save(
                          checked
                            ? emails.filter((e) => !sameEmail(e, parent.email))
                            : [...emails, parent.email],
                          checked ? "宛先を外しました" : "宛先を追加しました",
                        )
                      }
                    />
                    <span>
                      {parent.name || "（名前なし）"}
                      <span className="muted">（{parent.email}）</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
          {others.length > 0 && (
            <ul className="cards">
              {others.map((email) => (
                <li key={email}>
                  <Card
                    title={email}
                    action={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          save(
                            emails.filter((e) => e !== email),
                            "宛先を外しました",
                          )
                        }
                      >
                        外す
                      </Button>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          <form
            className="name-form"
            noValidate
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || !trimmed || inputError || full) return;
              if (await save([...emails, trimmed], "宛先を追加しました")) setInput("");
            }}
          >
            <Input
              label={parents.length > 0 ? "親以外の宛先を追加" : "宛先を追加"}
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={input}
              error={inputError}
              onChange={(event) => {
                setInput(event.target.value);
                setMessage(null);
              }}
            />
            <div className="row">
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                loading={busy}
                disabled={!trimmed || Boolean(inputError) || full}
              >
                <Mail size={16} strokeWidth={1.75} aria-hidden="true" />
                追加
              </Button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
