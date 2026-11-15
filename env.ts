import { defineEnv, email, string } from "void/env";

export default defineEnv({
  // Google でのログイン。両方そろったときだけ有効になる（src/oauth.ts）。
  AUTH_GOOGLE_CLIENT_ID: string().optional(),
  AUTH_GOOGLE_CLIENT_SECRET: string().optional(),
  // ショップの購入通知を Gmail API で送る（src/server/gmail.ts）。上の OAuth クライアントと合わせて、そろったときだけ送る。
  GMAIL_REFRESH_TOKEN: string().optional(),
  GMAIL_SENDER: email().optional(),
  // お問い合わせ（/contact）のボット対策の Cloudflare Turnstile（src/server/turnstile.ts）。
  // 開発では、なければ Cloudflare のテスト用のキー（必ず通る）を使う。本番では両方そろうまでお問い合わせを受け付けない。
  TURNSTILE_SITE_KEY: string().optional(),
  TURNSTILE_SECRET_KEY: string().optional(),
});
