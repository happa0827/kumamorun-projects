// お問い合わせとフィードバック（/contact、/api/contact）。ログインしていなくても送れる。
// D1 に残してから、運営者（GMAIL_SENDER）にメールで知らせる。メールを送れなくても内容は D1 に残る。
// ボット対策は3つ重ねる（routes/api/contact.ts）:
//   1. おとり欄: 人には見えない欄。入っていたらボットとみなし、送れたふりをして捨てる
//   2. 回数の上限: IP ごとと全体で数える（rate-limit.ts）
//   3. Cloudflare Turnstile: 人かどうかを Cloudflare に確かめる（turnstile.ts）
import { contactMessages } from "@schema";
import { db, eq } from "void/db";
import { sendEmail } from "void/email";
import { z } from "zod";
import { gmailConfigured, gmailSender, sendGmail } from "./gmail";
import type { Limit } from "./rate-limit";

export const CATEGORIES = ["question", "bug", "idea", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  question: "質問",
  bug: "不具合の報告",
  idea: "要望・アイデア",
  other: "その他",
};

export const MAX_MESSAGE = 2000;

export const ContactBody = z.object({
  category: z.enum(CATEGORIES),
  message: z.string().trim().min(1).max(MAX_MESSAGE),
  // 返事の宛先。必ず入れてもらう
  email: z.email().max(254),
  /** おとり欄。人は空のまま送る */
  website: z.string().max(500).default(""),
  turnstileToken: z.string().min(1).max(2048),
});

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * 送れる回数。人なら1時間に数回で足りる。全体の上限は、IP を変えて大量に送られたときに
 * Gmail の送信の上限（個人のアカウントで1日500通）を使い切らないためのもの。
 */
export function contactLimits(ip: string | undefined): Limit[] {
  return [
    ...(ip
      ? [
          { key: `contact:ip:${ip}`, max: 5, windowMs: HOUR_MS },
          { key: `contact:ip-day:${ip}`, max: 20, windowMs: DAY_MS },
        ]
      : []),
    { key: "contact:all", max: 200, windowMs: DAY_MS },
  ];
}

export type ContactInput = {
  category: Category;
  message: string;
  email: string;
  userAgent: string | null;
  /** 送ったときにログインしていた人 */
  account: { id: string; name: string; email: string | null } | null;
};

/** D1 に残し、運営者に知らせる。知らせられたら notified が true。 */
export async function saveContact(input: ContactInput): Promise<{ id: string; notified: boolean }> {
  const row = {
    id: crypto.randomUUID(),
    category: input.category,
    message: input.message,
    email: input.email,
    accountId: input.account?.id ?? null,
    userAgent: input.userAgent?.slice(0, 500) ?? null,
    createdAt: Date.now(),
    notifiedAt: null,
  };
  await db.insert(contactMessages).values(row);
  const notified = await notify(row.id, input, row.createdAt);
  if (notified)
    await db
      .update(contactMessages)
      .set({ notifiedAt: Date.now() })
      .where(eq(contactMessages.id, row.id));
  return { id: row.id, notified };
}

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

const DEV_FROM = "くまもーるん <noreply@kumamorun.localhost>";
const DEV_TO = "contact@kumamorun.localhost";

async function notify(id: string, input: ContactInput, createdAt: number): Promise<boolean> {
  const label = CATEGORY_LABELS[input.category];
  // 件名には本文の頭だけを入れる（長い件名や改行を避ける）
  const head = input.message.replace(/\s+/g, " ").slice(0, 30);
  const account = input.account
    ? `${input.account.name || "（名前なし）"}${input.account.email ? ` <${input.account.email}>` : ""}（${input.account.id}）`
    : "ログインしていない";
  const mail = {
    subject: `お問い合わせ（${label}）: ${head}`,
    text: [
      `種類: ${label}`,
      `日時: ${dateFormat.format(createdAt)}`,
      `返事の宛先: ${input.email}`,
      `アカウント: ${account}`,
      `ブラウザ: ${input.userAgent ?? "不明"}`,
      `ID: ${id}`,
      "",
      input.message,
    ].join("\n"),
    replyTo: input.email,
  };
  try {
    const sender = gmailSender();
    if (gmailConfigured() && sender) {
      await sendGmail({ to: [sender], ...mail });
      return true;
    }
    if (!import.meta.env.DEV) return false;
    const result = await sendEmail({ from: DEV_FROM, to: [DEV_TO], ...mail });
    if (result.ok) return true;
    console.error("[contact] 通知を送れませんでした", result);
  } catch (error) {
    console.error("[contact] 通知を送れませんでした", error);
  }
  return false;
}
