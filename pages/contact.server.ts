// お問い合わせとフィードバック。ログインしていなくても開ける。
// ログインしていれば、返事の宛先にそのメールアドレスを先に入れておく（親が作った子供は仮のアドレスなので入れない）。
import { defineHandler, defineHead, type InferProps } from "void";
import { getUser } from "void/auth";
import { CATEGORIES, CATEGORY_LABELS, MAX_MESSAGE } from "../src/server/contact";
import { visibleEmail } from "../src/server/family";
import { TURNSTILE_ACTION, turnstileSiteKey } from "../src/server/turnstile";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(() => {
  const user = getUser();
  return {
    siteKey: turnstileSiteKey(),
    turnstileAction: TURNSTILE_ACTION,
    email: user ? (visibleEmail(user.email) ?? "") : "",
    categories: CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] })),
    maxMessage: MAX_MESSAGE,
  };
});

export const head = defineHead(() => ({ title: "お問い合わせ | くまもーるん" }));
