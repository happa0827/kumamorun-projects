// アプリとサイトの約束（docs/void-migration.md の「スキーマ」）。変えるときは kumamorun-tauri も直す。
// 認証のテーブル（ユーザー、セッション、パスキー、OAuth）は Void が作る。account_id はその user.id を指す。
// 時刻はすべて Unix ミリ秒。
import { sql } from "void/db";
import { check, index, integer, primaryKey, sqliteTable, text } from "void/schema-d1";

/** 端末ごとのトークン。トークンそのものではなく SHA-256 のハッシュを持つ。 */
export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  revokedAt: integer("revoked_at"),
});

/** ディープリンクの使い捨てコード。短時間で失効し、一度しか使えない。 */
export const loginCodes = sqliteTable("login_codes", {
  codeHash: text("code_hash").primaryKey(),
  accountId: text("account_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
});

/** スタート制限。形の検証はアプリ（Rust）が行うので JSON のまま持つ。 */
export const settings = sqliteTable("settings", {
  accountId: text("account_id").primaryKey(),
  restrictionsJson: text("restrictions_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** 当日の記録と直近7日の履歴。日付ごとの行。 */
export const daily = sqliteTable(
  "daily",
  {
    accountId: text("account_id").notNull(),
    date: text("date").notNull(), // "YYYY-MM-DD"
    plays: integer("plays").notNull(),
    failures: integer("failures").notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.date] })],
);

/** 進化段階（0〜5）と花の数。 */
export const progress = sqliteTable(
  "progress",
  {
    accountId: text("account_id").primaryKey(),
    stage: integer("stage").notNull().default(0),
    flowers: integer("flowers").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    check("progress_stage_range", sql`${t.stage} BETWEEN 0 AND 5`),
    check("progress_flowers_nonnegative", sql`${t.flowers} >= 0`),
  ],
);

/**
 * ショップ（旧 happa0827/kumamorun の交換所）の設定。アカウントにつき1行。サイトだけが使い、アプリは読まない。
 * 行がなければ既定の品（src/server/shop.ts の DEFAULT_ITEMS）を使う。
 * items_json は [{ id, name, price }]、notify_emails_json は購入を知らせる宛先の配列。形は src/server/shop.ts が検証する。
 */
export const shop = sqliteTable("shop", {
  accountId: text("account_id").primaryKey(),
  itemsJson: text("items_json").notNull(),
  notifyEmailsJson: text("notify_emails_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** 購入の記録。品の名前と値段は購入したときの写しを持つ（あとで品を変えても記録は変わらない）。 */
export const purchases = sqliteTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    itemName: text("item_name").notNull(),
    price: integer("price").notNull(),
    purchasedAt: integer("purchased_at").notNull(),
  },
  (t) => [
    index("purchases_account_time").on(t.accountId, t.purchasedAt),
    check("purchases_price_positive", sql`${t.price} >= 1`),
  ],
);

/** ライブ状況。アカウントにつき1行。updated_at はサーバーが入れる。 */
export const liveStatus = sqliteTable("live_status", {
  accountId: text("account_id").primaryKey(),
  appRunning: integer("app_running").notNull(),
  bodyJson: text("body_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
