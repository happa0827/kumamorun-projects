// アプリの「ログイン」から開く経路。ログインしていなければ、ログインしてからここへ戻る。
import { defineHandler, defineHead, type InferProps } from "void";
import { getUser } from "void/auth";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler((c) => {
  const user = getUser();
  if (!user) return c.redirect("/?next=/link");
  return { email: user.email };
});

export const head = defineHead(() => ({ title: "アプリでログイン | くまもーるん" }));
