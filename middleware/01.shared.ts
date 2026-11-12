// すべてのページで使う共有データ。レイアウトのメニューの出し分けにだけ使う。
// kind はアカウントの種類。まだ選んでいなければ null（/welcome で選ぶ）。
import { defineMiddleware } from "void";
import { getUser } from "void/auth";
import { getMember, type Kind } from "../src/server/family";

declare module "void" {
  interface CloudContextVariables {
    shared: { signedIn: boolean; kind: Kind | null };
  }
}

export default defineMiddleware(async (c, next) => {
  const user = getUser();
  // アプリ向け API（端末のトークン）では user がないので、DB は読まない
  const member = user ? await getMember(user.id) : null;
  c.set("shared", { signedIn: user !== null, kind: member?.kind ?? null });
  await next();
});
