// すべてのページで使う共有データ。レイアウトのメニューの出し分けにだけ使う。
// kind はアカウントの種類。まだ選んでいなければ null（/welcome で選ぶ）。
// 読んだ種類と家族は member にも置き、loadViewer と requireViewer が読み直さずに使う（src/server/viewer.ts）。
import { type CloudContext, defineMiddleware } from "void";
import { getUser } from "void/auth";
import { getMember, type Kind, type Member } from "../src/server/family";

declare module "void" {
  interface CloudContextVariables {
    shared: { signedIn: boolean; kind: Kind | null };
    /** このリクエストの開始時に読んだ、ログイン中の人の種類と家族（画面には渡さない） */
    member: { accountId: string; member: Member | null };
  }
}

/** middleware が読んだ種類。同じ人について読んでいなければ undefined。 */
export function cachedMember(c: CloudContext, accountId: string): Member | null | undefined {
  const cached = c.get("member");
  return cached?.accountId === accountId ? cached.member : undefined;
}

export default defineMiddleware(async (c, next) => {
  const user = getUser();
  // アプリ向け API（端末のトークン）では user がないので、DB は読まない
  const member = user ? await getMember(user.id) : null;
  c.set("shared", { signedIn: user !== null, kind: member?.kind ?? null });
  if (user) c.set("member", { accountId: user.id, member });
  await next();
});
