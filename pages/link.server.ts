// アプリの「ログイン」から開く経路。ログインしていなければ、ログインしてからここへ戻る。
// 親は自分ではアプリを使わないので、子供を選んで、その子供としてこのパソコンのアプリにログインさせる。
import { defineHandler, defineHead, type InferProps } from "void";
import { listChildren, visibleEmail } from "../src/server/family";
import { loadViewer } from "../src/server/viewer";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const viewer = await loadViewer(c, "/link");
  if (viewer instanceof Response) return viewer;
  const { kind, familyId } = viewer.member;
  if (kind !== "parent" || !familyId)
    // 親が作った子供は仮のメールアドレスなので、名前で出す
    return { self: true as const, who: visibleEmail(viewer.email) ?? viewer.name };
  // 親がログインさせられるのは、親が作った子供（メールアドレスを出さない人）だけ。Google の子供は自分でログインする
  const all = await listChildren(familyId);
  const children = all.filter((p) => p.email === null).map((p) => ({ id: p.id, name: p.name }));
  const selfSignIn = all.filter((p) => p.email !== null).map((p) => p.name);
  return {
    self: false as const,
    children,
    selfSignIn,
    preselected: c.req.query("child") ?? null,
  };
});

export const head = defineHead(() => ({ title: "アプリでログイン | くまもーるん" }));
