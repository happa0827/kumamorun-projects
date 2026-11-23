// 管理者（/admin）。完全版の承認と、キャラクターの画像を置くのは管理者だけ（docs/demo-edition.md）。
// 管理者は環境変数 ADMINS で決める。account_id（user.id）か、確認済みのメールアドレスをカンマで区切って並べる。
import { approvals } from "@schema";
import type { CloudContext } from "void";
import { requireAuth } from "void/auth";
import { db, eq, sql } from "void/db";
import { env } from "void/env";
import { HTTPException } from "hono/http-exception";
import { type Kind, visibleEmail } from "./family";

type UserLike = { id: string; email: string; emailVerified?: boolean | null };

function adminList(): string[] {
  return (env.ADMINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(user: UserLike | null | undefined): boolean {
  if (!user) return false;
  const list = adminList();
  if (list.includes(user.id.toLowerCase())) return true;
  // メールアドレスは、持ち主だと確かめたもの（Google）だけを信じる
  return user.emailVerified === true && list.includes(user.email.toLowerCase());
}

/** API 用。ログインしていなければ 401、管理者でなければ 404（管理の経路があることも見せない）。 */
export function requireAdmin(c: CloudContext) {
  const user = requireAuth(c);
  if (!isAdmin(user))
    throw new HTTPException(404, {
      res: Response.json({ error: "not_found" }, { status: 404 }),
    });
  return user;
}

export type AccountRow = {
  id: string;
  name: string;
  /** 親が作った子供（仮のメールアドレス）は null */
  email: string | null;
  createdAt: number;
  kind: Kind | null;
  approvedAt: number | null;
  note: string | null;
};

/** 管理の画面のアカウントの一覧。新しい順。 */
export async function listAccounts(): Promise<AccountRow[]> {
  const rows = await db.all<Omit<AccountRow, "email"> & { email: string }>(sql`
    SELECT u.id AS id, u.name AS name, u.email AS email, u.createdAt AS createdAt,
           m.kind AS kind, a.approved_at AS approvedAt, a.note AS note
    FROM "user" u
    LEFT JOIN members m ON m.account_id = u.id
    LEFT JOIN approvals a ON a.account_id = u.id
    ORDER BY u.createdAt DESC`);
  return rows.map((r) => ({ ...r, email: visibleEmail(r.email) }));
}

/** 承認する。もう承認していれば何もしない。アカウントがなければ false。 */
export async function approve(accountId: string, adminId: string): Promise<boolean> {
  const [user] = await db.all<{ id: string }>(sql`SELECT id FROM "user" WHERE id = ${accountId}`);
  if (!user) return false;
  await db
    .insert(approvals)
    .values({ accountId, approvedAt: Date.now(), approvedBy: adminId, note: null })
    .onConflictDoNothing();
  return true;
}

/** 承認を取り消す。アプリは次の同期でデモ版に戻り、受け取った画像を消す。 */
export async function revoke(accountId: string): Promise<void> {
  await db.delete(approvals).where(eq(approvals.accountId, accountId));
}
