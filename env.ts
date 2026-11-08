import { defineEnv, string } from "void/env";

export default defineEnv({
  // Google でのログイン。両方そろったときだけ有効になる（src/oauth.ts）。
  AUTH_GOOGLE_CLIENT_ID: string().optional(),
  AUTH_GOOGLE_CLIENT_SECRET: string().optional(),
});
