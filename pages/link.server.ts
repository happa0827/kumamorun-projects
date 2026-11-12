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
  const children = (await listChildren(familyId)).map((p) => ({ id: p.id, name: p.name }));
  return { self: false as const, children, preselected: c.req.query("child") ?? null };
});

export const head = defineHead(() => ({ title: "アプリでログイン | くまもーるん" }));
