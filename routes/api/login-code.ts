// サイトでログインした人に、アプリへ渡す使い捨てコードを発行する。
// アプリは kumamorun://auth?code=… を受け、POST /api/app/v1/exchange で端末のトークンに換える。
import { loginCodes } from "@schema";
import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { db } from "void/db";
import { LOGIN_CODE_TTL_MS, newLoginCode, sha256Hex } from "../../src/server/secrets";

export const POST = defineHandler(async (c) => {
  const user = requireAuth(c);
  const code = newLoginCode();
  const expiresAt = Date.now() + LOGIN_CODE_TTL_MS;
  await db
    .insert(loginCodes)
    .values({ codeHash: await sha256Hex(code), accountId: user.id, expiresAt });
  return { url: `kumamorun://auth?code=${encodeURIComponent(code)}`, expiresAt };
});
