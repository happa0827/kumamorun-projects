import { defineHandler, type InferProps } from "void";
import { getUser } from "void/auth";
import { env } from "void/env";
import { readLiveStatus } from "../src/server/account-data";
import { getMember, listChildren, targetAccount } from "../src/server/family";
import { configuredProviders } from "../src/oauth";
import { safeNext } from "../src/safe-next";
import { EMAIL_CODE_ENABLED } from "../src/server/otp-mail";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const user = getUser();
  const providers = configuredProviders(env as Record<string, unknown>);
  // 移動先は同じサイトの経路だけ（/welcome へ渡すときも、ログイン画面へ渡すときも）
  const next = safeNext(c.req.query("next"));
  // メールのコードは開発のときだけ（auth.ts の EMAIL_CODE_ENABLED と同じ）
  const emailCode = EMAIL_CODE_ENABLED;
  if (!user) return { signedIn: false as const, providers, next, emailCode, status: null };

  const member = await getMember(user.id);
  if (!member) return c.redirect(`/welcome?next=${encodeURIComponent(next)}`);
  if (member.kind !== "parent" || !member.familyId)
    return {
      signedIn: true as const,
      view: "self" as const,
      status: await readLiveStatus(user.id),
    };

  // 親は子供の状況を見る。?child= がなければ最初の子供。
  const children = (await listChildren(member.familyId)).map((p) => ({ id: p.id, name: p.name }));
  const selected =
    (await targetAccount(user.id, member, c.req.query("child"))) ?? children[0]?.id ?? null;
  return {
    signedIn: true as const,
    view: "family" as const,
    children,
    selected,
    status: selected ? await readLiveStatus(selected) : null,
  };
});
