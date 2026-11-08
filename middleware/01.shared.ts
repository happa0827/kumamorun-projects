// すべてのページで使う共有データ。レイアウトのメニューの出し分けにだけ使う。
import { defineMiddleware } from "void";
import { getUser } from "void/auth";

declare module "void" {
  interface CloudContextVariables {
    shared: { signedIn: boolean };
  }
}

export default defineMiddleware(async (c, next) => {
  c.set("shared", { signedIn: getUser() !== null });
  await next();
});
