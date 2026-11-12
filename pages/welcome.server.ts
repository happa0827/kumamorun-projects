// アカウントの種類を選ぶ。種類のないアカウント（新しく登録した人と、種類ができる前からの人）は、ここへ移される。
import { defineHandler, defineHead, type InferProps } from "void";
import { getUser } from "void/auth";
import { safeNext } from "../src/safe-next";
import { getMember } from "../src/server/family";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const user = getUser();
  const next = safeNext(c.req.query("next") ?? "/");
  // ログインのあとも、/welcome から元の移動先へ進めるように、next を付けたまま戻す
  if (!user)
    return c.redirect(`/?next=${encodeURIComponent(`/welcome?next=${encodeURIComponent(next)}`)}`);
  if (await getMember(user.id)) return c.redirect(next);
  return { name: user.name, next };
});

export const head = defineHead(() => ({ title: "はじめに | くまもーるん" }));
