// 毎日 4:00（日本時間 13:00）に、要らなくなった行を消す。
// - ログインコード、家族の招待コード、子供のログインリンクのコード: 期限から1日を過ぎたもの（使用済みも未使用も）
// - 試した回数の記録: 数え直しの時刻を過ぎたもの
// - 端末: 失効から30日を過ぎたもの（一覧には出ないが、しばらくは記録として残す）
// - 認証のセッションと確認用のトークン: 期限を過ぎたもの（Better Auth のテーブル。時刻は Unix ミリ秒）
// ローカルでの試し方は README の「定期処理」。
import { childSignInCodes, devices, familyInvites, loginCodes, rateLimits } from "@schema";
import { defineScheduled } from "void";
import { and, db, isNotNull, lt, sql } from "void/db";

export const cron = "0 4 * * *";

const DAY_MS = 24 * 60 * 60 * 1000;

export default defineScheduled(async (controller) => {
  const now = controller.scheduledTime;
  // 互いに独立した掃除なので、1文ずつ流す（db.run は batch に入れられない）。
  const codes = await db
    .delete(loginCodes)
    .where(lt(loginCodes.expiresAt, now - DAY_MS))
    .returning({ id: loginCodes.codeHash });
  const invites = await db
    .delete(familyInvites)
    .where(lt(familyInvites.expiresAt, now - DAY_MS))
    .returning({ id: familyInvites.codeHash });
  const childCodes = await db
    .delete(childSignInCodes)
    .where(lt(childSignInCodes.expiresAt, now - DAY_MS))
    .returning({ id: childSignInCodes.codeHash });
  const limits = await db
    .delete(rateLimits)
    .where(lt(rateLimits.resetAt, now))
    .returning({ id: rateLimits.key });
  const revoked = await db
    .delete(devices)
    .where(and(isNotNull(devices.revokedAt), lt(devices.revokedAt, now - 30 * DAY_MS)))
    .returning({ id: devices.id });
  const sessions = await db.run(sql`DELETE FROM "session" WHERE "expiresAt" < ${now}`);
  const verifications = await db.run(sql`DELETE FROM "verification" WHERE "expiresAt" < ${now}`);
  console.log(
    `[cleanup] login_codes=${codes.length} family_invites=${invites.length} child_sign_in_codes=${childCodes.length} rate_limits=${limits.length} devices=${revoked.length} sessions=${sessions.meta.changes} verifications=${verifications.meta.changes}`,
  );
});
