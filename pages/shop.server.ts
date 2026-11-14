// ショップ。種類で見え方が変わる。
// - 大人: 自分の花で買い、品と通知先も自分で決める（今までどおり）
// - 子供: 自分の花で買うだけ。品と通知先は親が決める
// - 親: 子供（?child=）の品と通知先を決め、購入の記録を見る。買わない。通知先は家族の親から選ぶか、手で入れる
import { defineHandler, defineHead, type InferProps } from "void";
import { listFamily, targetAccount } from "../src/server/family";
import { readShop } from "../src/server/shop";
import { loadViewer } from "../src/server/viewer";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const viewer = await loadViewer(c);
  if (viewer instanceof Response) return viewer;
  const { kind, familyId } = viewer.member;
  if (kind === "adult" || kind === "child") return { mode: kind, shop: await readShop(viewer.id) };
  if (!familyId) return c.redirect("/"); // 親には必ず家族がある（members の CHECK）

  const family = await listFamily(familyId);
  const children = family
    .filter((p) => p.kind === "child")
    .map((p) => ({ id: p.id, name: p.name }));
  // 通知先の候補にする家族の親（メールアドレスのある人だけ）。親以外の宛先は手で入れる
  const parents = family.flatMap((p) =>
    p.kind === "parent" && p.email ? [{ name: p.name, email: p.email }] : [],
  );
  const selected =
    (await targetAccount(viewer.id, viewer.member, c.req.query("child"))) ??
    children[0]?.id ??
    null;
  return {
    mode: "parent" as const,
    children,
    parents,
    selected,
    shop: selected ? await readShop(selected) : null,
  };
});

export const head = defineHead(() => ({ title: "ショップ | くまもーるん" }));
