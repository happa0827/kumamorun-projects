// POST /api/child-login/preview  { code }  子供のログインリンクを使う前に、誰としてログインするかを見る。
// コードは使わない。/child-login は、これを見せて押してもらってから /api/auth/family/child-sign-in で使う。
// リンクを別の人に開かせて、その人のブラウザを知らないうちに攻撃者側の子供へ入れ替える形を防ぐため。
// ログインしていなくても呼べる。コードは 24 バイトの乱数なので、総当たりの上限は付けない。
// 成功: { child: { name }, issuer: { name, email }, current: { name, email, same } | null }
// 失敗: 400 invalid_code
import { defineHandler } from "void";
import { getUser } from "void/auth";
import { z } from "zod";
import { parseBody } from "../../../src/server/body";
import { previewChildSignInCode, visibleEmail } from "../../../src/server/family";

const Body = z.object({ code: z.string().min(1).max(200) });

export const POST = defineHandler(async (c) => {
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;
  const preview = await previewChildSignInCode(body.data.code);
  if (!preview) return c.json({ error: "invalid_code" }, 400);
  const user = getUser();
  return {
    child: { name: preview.childName },
    issuer: preview.issuer,
    current: user
      ? { name: user.name, email: visibleEmail(user.email), same: user.id === preview.childId }
      : null,
  };
});
