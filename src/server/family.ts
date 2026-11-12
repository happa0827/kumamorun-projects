// アカウントの種類（大人、親、子供）と家族。サイトだけが使い、アプリ向け API は種類を見ない。
// 親は同じ家族の子供のデータ（状況、ショップ）を見て、ショップの品と通知先を決める。
import { childSignInCodes, familyInvites, members } from "@schema";
import { and, db, eq, gt, isNull, sql } from "void/db";
import { newInviteCode, newLoginCode, normalizeInviteCode, sha256Hex } from "./secrets";
import { saveConfig } from "./shop";

export type Kind = "adult" | "parent" | "child";
export type Member = { kind: Kind; familyId: string | null };
export type FamilyPerson = { id: string; name: string; email: string | null; kind: Kind };

/** 招待コードの有効時間 */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
/** 子供のログインリンクの有効時間。親が LINE などで送って、子供が開くまでの余裕を見る。 */
export const CHILD_SIGN_IN_TTL_MS = 30 * 60 * 1000;
/** 親が作った子供（Google なし）のメールアドレスの domain。届かない domain（RFC 2606 の .invalid）を使う。 */
const CHILD_EMAIL_DOMAIN = "children.kumamorun.invalid";

export const KIND_LABEL: Record<Kind, string> = { adult: "大人", parent: "親", child: "子供" };

/** 親が作った子供の、仮のメールアドレス。user.email は一意で必須なので入れておく。 */
export const placeholderChildEmail = () => `child-${crypto.randomUUID()}@${CHILD_EMAIL_DOMAIN}`;

/** 画面に出せるメールアドレスか（仮のものは出さない） */
export const visibleEmail = (email: string) =>
  email.endsWith(`@${CHILD_EMAIL_DOMAIN}`) ? null : email;

/**
 * パスキーの登録で、OS の選択画面に出すアカウントの名前。
 * - name（userName）: 見分けるための名前。Google の人はメールアドレス、親が作った子供は名前（仮のアドレスは出さない）
 * - displayName: 人の名前。なければ name と同じ
 * Better Auth の passkey は、name に画面から渡した端末の目安（「Windows」など）を、displayName にメールアドレスを使う。
 */
export function passkeyUserLabel(user: { email: string; name: string }) {
  const name = visibleEmail(user.email) ?? (user.name.trim() || "くまもーるん");
  return { name, displayName: user.name.trim() || name };
}

export async function getMember(accountId: string): Promise<Member | null> {
  const [row] = await db
    .select({ kind: members.kind, familyId: members.familyId })
    .from(members)
    .where(eq(members.accountId, accountId));
  return row ?? null;
}

/** 家族の全員。親が先、同じ種類は加わった順。 */
export async function listFamily(familyId: string): Promise<FamilyPerson[]> {
  const rows = await db.all<{ id: string; name: string; email: string; kind: Kind }>(sql`
    SELECT m.account_id AS id, u.name AS name, u.email AS email, m.kind AS kind
    FROM members m JOIN "user" u ON u.id = m.account_id
    WHERE m.family_id = ${familyId}
    ORDER BY CASE m.kind WHEN 'parent' THEN 0 ELSE 1 END, m.created_at`);
  return rows.map((r) => ({ ...r, email: visibleEmail(r.email) }));
}

export async function listChildren(familyId: string) {
  return (await listFamily(familyId)).filter((p) => p.kind === "child");
}

/**
 * 画面や API が扱うアカウントを決める。
 * - 大人と子供は自分だけ。ほかのアカウントを求めたら null。
 * - 親は、同じ家族の子供だけ。子供を指定しなければ null。
 */
export async function targetAccount(
  viewerId: string,
  viewer: Member,
  requested: string | null | undefined,
): Promise<string | null> {
  if (viewer.kind !== "parent") return !requested || requested === viewerId ? viewerId : null;
  if (!requested || !viewer.familyId) return null;
  const target = await getMember(requested);
  return target?.kind === "child" && target.familyId === viewer.familyId ? requested : null;
}

/** ショップの品と通知先を変えられるアカウント。大人は自分、親は家族の子供。子供は変えられない（null）。 */
export async function shopEditTarget(
  viewerId: string,
  viewer: Member,
  requested: string | null | undefined,
): Promise<string | null> {
  if (viewer.kind === "child") return null;
  return targetAccount(viewerId, viewer, requested);
}

/** ショップで買えるのは、大人と子供が自分の花で買うときだけ。親は子供の代わりに買わない。 */
export const canPurchase = (viewer: Member) => viewer.kind !== "parent";

/**
 * 種類を決めて members に書く。すでに行があれば false（種類はあとから変えない）。
 * 子供が家族に入るとき、ショップの通知先がまだなければ、招いた親のメールアドレスを入れる。
 */
async function insertMember(
  accountId: string,
  kind: Kind,
  familyId: string | null,
): Promise<boolean> {
  const inserted = await db
    .insert(members)
    .values({ accountId, kind, familyId, createdAt: Date.now() })
    .onConflictDoNothing()
    .returning({ id: members.accountId });
  return inserted.length > 0;
}

async function notifyParentByDefault(childId: string, parentId: string) {
  const [parent] = await db.all<{ email: string }>(
    sql`SELECT email FROM "user" WHERE id = ${parentId}`,
  );
  const email = parent && visibleEmail(parent.email);
  if (email) await saveConfig(childId, { notifyEmails: [email] });
}

export type ChooseResult =
  | { ok: true; kind: Kind }
  | { ok: false; error: "already_chosen" | "invalid_code" };

/** 大人になるか、新しい家族を作って親になる。 */
export async function chooseKind(
  accountId: string,
  kind: "adult" | "parent",
): Promise<ChooseResult> {
  const familyId = kind === "parent" ? crypto.randomUUID() : null;
  if (!(await insertMember(accountId, kind, familyId)))
    return { ok: false, error: "already_chosen" };
  return { ok: true, kind };
}

/** 招待コードで家族に入る。種類（親か子供か）はコードが決める。 */
export async function joinWithInvite(accountId: string, code: string): Promise<ChooseResult> {
  if (await getMember(accountId)) return { ok: false, error: "already_chosen" };
  const now = Date.now();
  // 未使用で期限内のときだけ使用済みにする。並んだ2回のうち、行が返るのは1回だけ。
  const [invite] = await db
    .update(familyInvites)
    .set({ usedAt: now })
    .where(
      and(
        eq(familyInvites.codeHash, await sha256Hex(normalizeInviteCode(code))),
        isNull(familyInvites.usedAt),
        gt(familyInvites.expiresAt, now),
      ),
    )
    .returning({
      familyId: familyInvites.familyId,
      kind: familyInvites.kind,
      createdBy: familyInvites.createdBy,
    });
  if (!invite) return { ok: false, error: "invalid_code" };
  if (!(await insertMember(accountId, invite.kind, invite.familyId)))
    return { ok: false, error: "already_chosen" };
  if (invite.kind === "child") await notifyParentByDefault(accountId, invite.createdBy);
  return { ok: true, kind: invite.kind };
}

/** 親が招待コードを発行する。 */
export async function createInvite(parentId: string, familyId: string, kind: "parent" | "child") {
  const code = newInviteCode();
  const expiresAt = Date.now() + INVITE_TTL_MS;
  await db.insert(familyInvites).values({
    codeHash: await sha256Hex(normalizeInviteCode(code)),
    familyId,
    kind,
    createdBy: parentId,
    expiresAt,
  });
  return { code, kind, expiresAt };
}

/** 親が作った子供のユーザーを、家族に入れる（ユーザーそのものは Better Auth が作る。family-auth.ts）。 */
export async function addCreatedChild(childId: string, parentId: string, familyId: string) {
  if (!(await insertMember(childId, "child", familyId))) throw new Error("member already exists");
  await notifyParentByDefault(childId, parentId);
}

/** 子供のログインリンクのコードを発行する。リンクは /child-login#code=…（フラグメントはサーバーに届かない）。 */
export async function createChildSignInCode(parentId: string, childId: string) {
  const code = newLoginCode();
  const expiresAt = Date.now() + CHILD_SIGN_IN_TTL_MS;
  // 使えるリンクは子供ごとに1本だけ。前に発行してまだ使われていないものを消してから入れる（1つの batch）。
  // 親が2人いても同じ（どちらが発行しても、その子供の古いリンクは使えなくなる）。
  await db.batch([
    db
      .delete(childSignInCodes)
      .where(and(eq(childSignInCodes.accountId, childId), isNull(childSignInCodes.usedAt))),
    db.insert(childSignInCodes).values({
      codeHash: await sha256Hex(code),
      accountId: childId,
      createdBy: parentId,
      expiresAt,
    }),
  ]);
  return { code, expiresAt };
}

/** 子供のログインのコードを使う。使えれば子供のアカウント ID。 */
export async function consumeChildSignInCode(code: string): Promise<string | null> {
  const now = Date.now();
  const [row] = await db
    .update(childSignInCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(childSignInCodes.codeHash, await sha256Hex(code)),
        isNull(childSignInCodes.usedAt),
        gt(childSignInCodes.expiresAt, now),
      ),
    )
    .returning({ accountId: childSignInCodes.accountId });
  if (!row) return null;
  // コードの発行後に家族から外れていたら使わせない
  const member = await getMember(row.accountId);
  return member?.kind === "child" ? row.accountId : null;
}
