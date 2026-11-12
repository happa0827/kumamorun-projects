// サイトでログインした人に、アプリへ渡す使い捨てコードを発行する。
// アプリは kumamorun://auth?code=… を受け、POST /api/app/v1/exchange で端末のトークンに換える。
// 親は自分ではアプリを使わないので、?account=<子供の ID> で子供のコードを発行する（子供のパソコンで開く）。
// 親が発行できるのは、親が作った子供（Google なし）だけ。自分の Google で登録した子供は、自分でログインする
// （親がその子供の端末のトークンを持つと、花や制限をその子供として書けてしまう）。
import { loginCodes } from "@schema";
import { defineHandler } from "void";
import { db } from "void/db";
import { signInAsTarget, targetAccount } from "../../src/server/family";
import { LOGIN_CODE_TTL_MS, newLoginCode, sha256Hex } from "../../src/server/secrets";
import { forbidden, requireViewer } from "../../src/server/viewer";

export const POST = defineHandler(async (c) => {
  const viewer = await requireViewer(c);
  const requested = c.req.query("account");
  const accountId =
    viewer.member.kind === "parent"
      ? await signInAsTarget(viewer.id, viewer.member, requested)
      : await targetAccount(viewer.id, viewer.member, requested);
  if (!accountId) return forbidden(c);
  const code = newLoginCode();
  const expiresAt = Date.now() + LOGIN_CODE_TTL_MS;
  await db.insert(loginCodes).values({ codeHash: await sha256Hex(code), accountId, expiresAt });
  return { url: `kumamorun://auth?code=${encodeURIComponent(code)}`, expiresAt };
});
