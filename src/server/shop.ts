// ショップ（旧 happa0827/kumamorun の「くまもーるん交換所」）。花を使って品（チケット）を買う。
// 旧版は品と通知先をブラウザの localStorage に持ち、花を Firebase に上書きしていた。
// ここでは品と通知先を D1 に持ち、花の減算と購入の記録を1つのトランザクションで書く。
import { progress, purchases, shop } from "@schema";
import { and, db, desc, eq, sql } from "void/db";
import { sendEmail } from "void/email";
import { z } from "zod";
import { gmailConfigured, sendGmail } from "./gmail";

/** 品の数の上限。旧版と同じ。 */
export const MAX_ITEMS = 5;
/** 通知先の数の上限 */
export const MAX_NOTIFY_EMAILS = 5;
/** 購入の記録を画面に出す件数 */
export const RECENT_PURCHASES = 20;

/** 旧版の既定の品 */
export const DEFAULT_ITEMS: ShopItem[] = [
  { id: "default-1", name: "チョコパイ", price: 2 },
  { id: "default-2", name: "ハイチュウ", price: 1 },
  { id: "default-3", name: "コーラ", price: 1 },
  { id: "default-4", name: "マック", price: 3 },
];

/**
 * 購入の通知メールを送るか。本番には送信元のドメインがないので、Gmail API で送る（gmail.ts）。
 * Gmail の設定がそろっていれば、開発でも本番でも Gmail で送る。
 * そろっていなければ、開発のときだけ Void のローカルの受け箱に送る。
 */
export function purchaseMailEnabled(): boolean {
  return gmailConfigured() || import.meta.env.DEV;
}
const DEV_FROM = "くまもーるん <noreply@kumamorun.localhost>";

export const ShopItem = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(40),
  price: z.number().int().min(1).max(99),
});
export type ShopItem = z.infer<typeof ShopItem>;

export const ShopItems = z
  .array(ShopItem)
  .max(MAX_ITEMS)
  .refine((items) => new Set(items.map((i) => i.id)).size === items.length, "duplicate id");

export const NotifyEmails = z
  .array(z.email().max(254))
  .max(MAX_NOTIFY_EMAILS)
  .refine(
    (emails) => new Set(emails.map((e) => e.toLowerCase())).size === emails.length,
    "duplicate email",
  );

type ShopConfig = { items: ShopItem[]; notifyEmails: string[] };

async function readConfig(accountId: string): Promise<ShopConfig> {
  const [row] = await db.select().from(shop).where(eq(shop.accountId, accountId));
  if (!row) return { items: DEFAULT_ITEMS, notifyEmails: [] };
  return {
    items: JSON.parse(row.itemsJson) as ShopItem[],
    notifyEmails: JSON.parse(row.notifyEmailsJson) as string[],
  };
}

/** 品か通知先のどちらかを保存する（後勝ち）。もう片方は今の値を保つ。 */
export async function saveConfig(accountId: string, patch: Partial<ShopConfig>) {
  const current = await readConfig(accountId);
  const next = { ...current, ...patch };
  const values = {
    itemsJson: JSON.stringify(next.items),
    notifyEmailsJson: JSON.stringify(next.notifyEmails),
    updatedAt: Date.now(),
  };
  await db
    .insert(shop)
    .values({ accountId, ...values })
    .onConflictDoUpdate({ target: shop.accountId, set: values });
  return next;
}

/** 通知先が1つもないときだけ、入れる。前から決めてある通知先は変えない。 */
export async function setNotifyEmailsIfEmpty(accountId: string, notifyEmails: string[]) {
  const current = await readConfig(accountId);
  if (current.notifyEmails.length > 0) return current;
  return saveConfig(accountId, { notifyEmails });
}

/** 既定の品に戻す。通知先は残す。 */
export async function resetItems(accountId: string) {
  return saveConfig(accountId, { items: DEFAULT_ITEMS });
}

/** ショップの画面に出すもの一式 */
export async function readShop(accountId: string) {
  const [config, [p], recent] = await Promise.all([
    readConfig(accountId),
    db
      .select({ flowers: progress.flowers })
      .from(progress)
      .where(eq(progress.accountId, accountId)),
    readRecentPurchases(accountId),
  ]);
  return {
    ...config,
    flowers: p?.flowers ?? 0,
    purchases: recent,
    mailEnabled: purchaseMailEnabled(),
    limits: { items: MAX_ITEMS, notifyEmails: MAX_NOTIFY_EMAILS },
  };
}

function readRecentPurchases(accountId: string) {
  return db
    .select({
      id: purchases.id,
      itemName: purchases.itemName,
      price: purchases.price,
      purchasedAt: purchases.purchasedAt,
      handedAt: purchases.handedAt,
      // 渡した人の名前。アカウントが消えていれば null
      handedByName: sql<
        string | null
      >`(SELECT "name" FROM "user" WHERE "id" = ${purchases.handedBy})`,
    })
    .from(purchases)
    .where(eq(purchases.accountId, accountId))
    .orderBy(desc(purchases.purchasedAt))
    .limit(RECENT_PURCHASES);
}

export type Handed = { handedAt: number | null; handedByName: string | null };

/**
 * 購入した品を本人に渡したか、の印を付けるか外す。付けたら、時刻と付けた人（by）を残す。外したら両方 null。
 * accountId の購入でなければ（ほかの人の記録の ID なら）、何も変えずに undefined。
 */
export async function setHanded(
  accountId: string,
  purchaseId: string,
  handed: boolean,
  by: { id: string; name: string },
): Promise<Handed | undefined> {
  const [row] = await db
    .update(purchases)
    .set(handed ? { handedAt: Date.now(), handedBy: by.id } : { handedAt: null, handedBy: null })
    .where(and(eq(purchases.id, purchaseId), eq(purchases.accountId, accountId)))
    .returning({ handedAt: purchases.handedAt });
  if (!row) return undefined;
  return { handedAt: row.handedAt, handedByName: handed ? by.name : null };
}

export type PurchaseResult =
  | {
      ok: true;
      flowers: number;
      purchase: {
        id: string;
        itemName: string;
        price: number;
        purchasedAt: number;
        handedAt: number | null;
        handedByName: string | null;
      };
      notified: boolean;
    }
  | { ok: false; error: "not_found" | "price_changed" | "insufficient"; flowers: number };

/**
 * 品を1つ買う。画面で見ていた値段（expectedPrice）と今の値段が違えば買わない。
 * 花の減算と記録の追加は1つの batch（1つのトランザクション）。花が足りなければ、
 * progress の CHECK (flowers >= 0) で batch ごと取り消される（別のタブで同時に買っても二重に減らない）。
 */
export async function purchase(
  accountId: string,
  { itemId, expectedPrice }: { itemId: string; expectedPrice: number },
): Promise<PurchaseResult> {
  const [config, [p]] = await Promise.all([
    readConfig(accountId),
    db
      .select({ flowers: progress.flowers })
      .from(progress)
      .where(eq(progress.accountId, accountId)),
  ]);
  const flowers = p?.flowers ?? 0;
  const item = config.items.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: "not_found", flowers };
  if (item.price !== expectedPrice) return { ok: false, error: "price_changed", flowers };
  // progress の行がない（花 0）なら買えない。行は消さないので、ここで見えた行は batch のときもある。
  if (!p || flowers < item.price) return { ok: false, error: "insufficient", flowers };

  const record = {
    id: crypto.randomUUID(),
    accountId,
    itemName: item.name,
    price: item.price,
    purchasedAt: Date.now(),
    handedAt: null,
    handedBy: null,
  };
  let updated: { flowers: number }[];
  try {
    [updated] = await db.batch([
      db
        .update(progress)
        .set({ flowers: sql`${progress.flowers} - ${item.price}`, updatedAt: record.purchasedAt })
        .where(eq(progress.accountId, accountId))
        .returning({ flowers: progress.flowers }),
      db.insert(purchases).values(record),
    ]);
  } catch (error) {
    // Drizzle は D1 のエラーを cause に包む。CHECK の違反なら、そのあいだに花が減っていた。
    const messages = [error, error instanceof Error ? error.cause : null]
      .map((e) => (e instanceof Error ? e.message : ""))
      .join(" ");
    if (!/CHECK|constraint/i.test(messages)) throw error;
    const [now] = await db
      .select({ flowers: progress.flowers })
      .from(progress)
      .where(eq(progress.accountId, accountId));
    return { ok: false, error: "insufficient", flowers: now?.flowers ?? 0 };
  }

  const { accountId: _, handedBy: __, ...rest } = record;
  const purchaseOut = { ...rest, handedByName: null };
  const notified = await notifyPurchase(config.notifyEmails, purchaseOut);
  return { ok: true, flowers: updated[0]?.flowers ?? 0, purchase: purchaseOut, notified };
}

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

/** 購入を通知先に知らせる。送れなくても購入は取り消さない。送れたら true。 */
async function notifyPurchase(
  emails: string[],
  { itemName, price, purchasedAt }: { itemName: string; price: number; purchasedAt: number },
): Promise<boolean> {
  if (!purchaseMailEnabled() || emails.length === 0) return false;
  const mail = {
    to: emails,
    subject: `購入通知: ${itemName}`,
    text: `${dateFormat.format(purchasedAt)}に${itemName}（花 ${price}）を購入しました。`,
  };
  try {
    if (gmailConfigured()) {
      await sendGmail(mail);
      return true;
    }
    const result = await sendEmail({ from: DEV_FROM, ...mail });
    if (result.ok) return true;
    const detail =
      "error" in result
        ? `${result.error.code}: ${result.error.message}`
        : result.deliveries
            .filter((d) => !d.ok)
            .map((d) => `${d.recipient} ${d.error.code}`)
            .join(", ");
    console.error(`[shop] 購入通知を送れませんでした ${detail}`);
  } catch (error) {
    console.error("[shop] 購入通知を送れませんでした", error);
  }
  return false;
}
