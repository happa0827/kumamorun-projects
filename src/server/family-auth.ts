// 家族の認証まわりの Better Auth プラグイン。Void はほかのユーザーのセッションを作る API を出していないので、
// ユーザーとセッションを作るところだけ、Better Auth の中（internalAdapter）で行う。
// - POST /api/auth/family/add-child  { name }  親が、Google を持たない子供のユーザーを作る。{ id, name }
// - POST /api/auth/family/child-sign-in  { code }  親が発行したログインリンクのコードで、子供としてログインする。
// - POST /api/auth/family/sign-out-child  { childId }  親が作った子供を、すべての端末からログアウトさせる。
// - パスキーの登録の情報（GET /api/auth/passkey/generate-register-options）の user.name と user.displayName を、
//   OS の選択画面で人を見分けられる名前に書き換える（passkeyUserLabel）。
// auth.ts から読むので、Void の推論した認証の型（getUser など）は使わない（循環する）。
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  formCsrfMiddleware,
  getSessionFromCtx,
  sessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import {
  addCreatedChild,
  consumeChildSignInCode,
  getMember,
  passkeyUserLabel,
  placeholderChildEmail,
  revokeChildAccess,
  signInAsTarget,
} from "./family";

export const familyAuth = () =>
  ({
    id: "family",
    hooks: {
      after: [
        {
          matcher: (context) => context.path === "/passkey/generate-register-options",
          handler: createAuthMiddleware(async (ctx) => {
            const options = ctx.context.returned;
            if (!options || typeof options !== "object" || !("user" in options)) return;
            const session = await getSessionFromCtx(ctx);
            if (!session) return;
            // 書き換えるのは表示の名前だけ。user.id（端末の中の ID）と challenge はそのまま。
            // 登録の確かめ（challenge、origin、rpID）は名前を見ないので、検証には響かない。
            const user = (options as { user: Record<string, unknown> }).user;
            ctx.context.returned = {
              ...options,
              user: { ...user, ...passkeyUserLabel(session.user) },
            };
          }),
        },
      ],
    },
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
        {
          method: "POST",
          body: z.object({ code: z.string().min(1).max(200) }),
          // Cookie のない POST でも、ほかのサイトのフォームから呼ばせない（組み込みのログインと同じ）
          use: [formCsrfMiddleware],
        },
        async (ctx) => {
          const accountId = await consumeChildSignInCode(ctx.body.code);
          const user = accountId ? await ctx.context.internalAdapter.findUserById(accountId) : null;
          if (!user) throw new APIError("UNAUTHORIZED", { message: "invalid_code" });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        },
      ),
      signOutChild: createAuthEndpoint(
        "/family/sign-out-child",
        {
          method: "POST",
          body: z.object({ childId: z.string().min(1).max(200) }),
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const parentId = ctx.context.session.user.id;
          const parent = await getMember(parentId);
          // 親がログインさせられる子供（同じ家族の、親が作った子供）だけ。Google の子供は自分で管理する。
          const childId = parent ? await signInAsTarget(parentId, parent, ctx.body.childId) : null;
          if (!childId) throw new APIError("NOT_FOUND", { message: "not_found" });
          // 先に、またログインできる手段（リンク、コード、端末、パスキー）を消してから、セッションを消す
          await revokeChildAccess(childId);
          // パスキーを残すと、入った人がまたログインできる
          await ctx.context.adapter.deleteMany({
            model: "passkey",
            where: [{ field: "userId", value: childId }],
          });
          await ctx.context.internalAdapter.deleteUserSessions(childId);
          return ctx.json({ ok: true });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
