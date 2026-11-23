import { defineHandler, defineHead, type InferProps } from "void";
import { getUser } from "void/auth";
import { isAdmin, listAccounts } from "../src/server/admin";
import { characterStatus } from "../src/server/edition";
import { KIND_LABEL } from "../src/server/family";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const user = getUser();
  if (!user) return c.redirect(`/?next=${encodeURIComponent("/admin")}`);
  // 管理者でなければ、ページがあることも見せない
  if (!isAdmin(user)) return c.notFound();

  const [accounts, characters] = await Promise.all([listAccounts(), characterStatus()]);
  return {
    adminId: user.id,
    accounts: accounts.map((a) => ({ ...a, kindLabel: a.kind ? KIND_LABEL[a.kind] : null })),
    characters,
  };
});

export const head = defineHead(() => ({
  title: "管理 | くまもーるん",
  meta: [{ name: "robots", content: "noindex" }],
}));
