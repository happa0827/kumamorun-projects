// 家族の認証まわりの Better Auth プラグイン。Void はほかのユーザーのセッションを作る API を出していないので、
// ユーザーとセッションを作るところだけ、Better Auth の中（internalAdapter）で行う。
// - POST /api/auth/family/add-child  { name }  親が、Google を持たない子供のユーザーを作る。{ id, name }
// - POST /api/auth/family/child-sign-in  { code }  親が発行したログインリンクのコードで、子供としてログインする。
// auth.ts から読むので、Void の推論した認証の型（getUser など）は使わない（循環する）。
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import {
  addCreatedChild,
  consumeChildSignInCode,
  getMember,
  placeholderChildEmail,
} from "./family";

export const familyAuth = () =>
  ({
    id: "family",
    endpoints: {
      addFamilyChild: createAuthEndpoint(
        "/family/add-child",
        {
          method: "POST",
          body: z.object({ name: z.string().trim().min(1).max(40) }),
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const parentId = ctx.context.session.user.id;
          const parent = await getMember(parentId);
          if (parent?.kind !== "parent" || !parent.familyId)
            throw new APIError("FORBIDDEN", { message: "parent_only" });

          const child = await ctx.context.internalAdapter.createUser(
            { name: ctx.body.name, email: placeholderChildEmail(), emailVerified: false },
            { method: "family-child" },
          );
          try {
            await addCreatedChild(child.id, parentId, parent.familyId);
          } catch (error) {
            // 家族に入れられなければ、ユーザーだけが残らないように消す
            await ctx.context.internalAdapter.deleteUser(child.id);
            throw error;
          }
          return ctx.json({ id: child.id, name: child.name });
        },
      ),
      childSignIn: createAuthEndpoint(
        "/family/child-sign-in",
        { method: "POST", body: z.object({ code: z.string().min(1).max(200) }) },
        async (ctx) => {
          const accountId = await consumeChildSignInCode(ctx.body.code);
          const user = accountId ? await ctx.context.internalAdapter.findUserById(accountId) : null;
          if (!user) throw new APIError("UNAUTHORIZED", { message: "invalid_code" });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
