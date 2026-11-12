// Gmail API でメールを送る。本番には送信元のドメインがないので、Gmail のアカウントから送る。
// 必要なもの（env.ts）:
//   AUTH_GOOGLE_CLIENT_ID / AUTH_GOOGLE_CLIENT_SECRET  Google ログインと同じ OAuth クライアント
//   GMAIL_REFRESH_TOKEN  そのクライアントで、送信元のアカウントから gmail.send のスコープで取ったもの
//   GMAIL_SENDER         送信元のアドレス（リフレッシュトークンを取ったアカウント）
import { env } from "void/env";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const SENDER_NAME = "くまもーるん";

type GmailConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  sender: string;
};

function config(): GmailConfig | null {
  const { AUTH_GOOGLE_CLIENT_ID, AUTH_GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER } =
    env;
  if (!AUTH_GOOGLE_CLIENT_ID || !AUTH_GOOGLE_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !GMAIL_SENDER)
    return null;
  return {
    clientId: AUTH_GOOGLE_CLIENT_ID,
    clientSecret: AUTH_GOOGLE_CLIENT_SECRET,
    refreshToken: GMAIL_REFRESH_TOKEN,
    sender: GMAIL_SENDER,
  };
}

/** Gmail で送るための設定がそろっているか */
export function gmailConfigured(): boolean {
  return config() !== null;
}

// アクセストークンは1時間もつので、同じ isolate のうちは使い回す。
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(c: GmailConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** ヘッダーに日本語を入れるための RFC 2047 の形 */
const encodeWord = (s: string) => `=?UTF-8?B?${base64(utf8(s))}?=`;

/** 本文を76文字ごとに折った base64 にする */
function encodeBody(s: string): string {
  return (base64(utf8(s)).match(/.{1,76}/g) ?? []).join("\r\n");
}

function buildMessage(from: string, to: string[], subject: string, text: string): string {
  return [
    `From: ${encodeWord(SENDER_NAME)} <${from}>`,
    `To: ${to.join(", ")}`,
    `Subject: ${encodeWord(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeBody(text),
  ].join("\r\n");
}

const base64url = (s: string) =>
  base64(utf8(s)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Gmail でテキストのメールを送る。設定がそろっていなければ投げる。 */
export async function sendGmail({
  to,
  subject,
  text,
}: {
  to: string[];
  subject: string;
  text: string;
}): Promise<void> {
  const c = config();
  if (!c) throw new Error("Gmail の設定がそろっていません");
  const token = await accessToken(c);
  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: base64url(buildMessage(c.sender, to, subject, text)) }),
  });
  if (!res.ok) {
    if (res.status === 401) cachedToken = null;
    throw new Error(`send ${res.status}: ${await res.text()}`);
  }
}
