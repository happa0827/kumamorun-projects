import { defineEnv, email, string } from "void/env";

export default defineEnv({
  // Google でのログイン。両方そろったときだけ有効になる（src/oauth.ts）。
  AUTH_GOOGLE_CLIENT_ID: string().optional(),
  AUTH_GOOGLE_CLIENT_SECRET: string().optional(),
  // ショップの購入通知を Gmail API で送る（src/server/gmail.ts）。上の OAuth クライアントと合わせて、そろったときだけ送る。
  GMAIL_REFRESH_TOKEN: string().optional(),
  GMAIL_SENDER: email().optional(),
});
