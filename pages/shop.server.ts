import { defineHandler, defineHead, type InferProps } from "void";
import { getUser } from "void/auth";
import { readShop } from "../src/server/shop";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const user = getUser();
  if (!user) return c.redirect("/?next=/shop");
  return { shop: await readShop(user.id) };
});

export const head = defineHead(() => ({ title: "ショップ | くまもーるん" }));
