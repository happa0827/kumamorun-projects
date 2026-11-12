// アカウントの種類（大人、親、子供）と家族。サイトだけが使い、アプリ向け API は種類を見ない。
// 親は同じ家族の子供のデータ（状況、ショップ）を見て、ショップの品と通知先を決める。
import { childSignInCodes, devices, familyInvites, loginCodes, members } from "@schema";
import { and, db, eq, exists, gt, isNull, sql } from "void/db";
import { newInviteCode, newLoginCode, normalizeInviteCode, sha256Hex } from "./secrets";
import { setNotifyEmailsIfEmpty } from "./shop";

export type Kind = "adult" | "parent" | "child";
export type Member = { kind: Kind; familyId: string | null };
export type FamilyPerson = { id: string; name: string; email: string | null; kind: Kind };

/** 招待コードの有効時間 */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
/** 1つの家族の子供の上限（親が作る子供と、招待で入る子供を合わせて）。行が増え続けないようにする。 */
export const MAX_CHILDREN = 20;
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

/** 家族の子供の数 */
export async function countChildren(familyId: string): Promise<number> {
  const [row] = await db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM members WHERE family_id = ${familyId} AND kind = 'child'`,
  );
  return row?.n ?? 0;
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

/** 種類を決めて members に書く。すでに行があれば false（種類はあとから変えない）。 */
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

/**
 * 子供が家族に入るとき、ショップの通知先がまだなければ、招いた親（作った親）のメールアドレスを入れる。
 * 前から使っていた人が招待で子供になったときは、その人が決めていた通知先を残す（親があとで変えられる）。
 */
async function notifyParentByDefault(childId: string, parentId: string) {
  const [parent] = await db.all<{ email: string }>(
    sql`SELECT email FROM "user" WHERE id = ${parentId}`,
  );
  const email = parent && visibleEmail(parent.email);
  if (email) await setNotifyEmailsIfEmpty(childId, [email]);
}

export type ChooseResult =
  | { ok: true; kind: Kind }
  | { ok: false; error: "already_chosen" | "invalid_code" | "family_full" };

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

/**
 * 招待コードで家族に入る。種類（親か子供か）はコードが決める。
 * members に書くことと、コードを使用済みにすることを、1つの batch（トランザクション）で行う。
 * 先にコードだけ使用済みにすると、そのあいだにほかのタブで種類を選ばれたとき、コードが誰にも使えないまま残る。
 */
export async function joinWithInvite(accountId: string, code: string): Promise<ChooseResult> {
  if (await getMember(accountId)) return { ok: false, error: "already_chosen" };
  const now = Date.now();
  const valid = and(
    eq(familyInvites.codeHash, await sha256Hex(normalizeInviteCode(code))),
    isNull(familyInvites.usedAt),
    gt(familyInvites.expiresAt, now),
  );
  const childSlotLeft = sql`(${familyInvites.kind} <> 'child' OR (
    SELECT count(*) FROM members m WHERE m.family_id = ${familyInvites.familyId} AND m.kind = 'child'
  ) < ${MAX_CHILDREN})`;
  const [, used] = await db.batch([
    // コードが使えるときだけ、コードの種類と家族で members に書く。もう行があれば何もしない。
    // 子供のコードは、家族の子供が上限（MAX_CHILDREN）に届いていれば書かない（コードも使わない）。
    db
      .insert(members)
      .select(
        db
          .select({
            accountId: sql<string>`${accountId}`.as("account_id"),
            kind: familyInvites.kind,
            familyId: familyInvites.familyId,
            createdAt: sql<number>`${now}`.as("created_at"),
          })
          .from(familyInvites)
          .where(and(valid, childSlotLeft)),
      )
      .onConflictDoNothing(),
    // いま書いた行（同じ家族、同じ時刻）があるときだけ、コードを使用済みにする。
    db
      .update(familyInvites)
      .set({ usedAt: now })
      .where(
        and(
          valid,
          exists(
            db
              .select({ one: sql`1` })
              .from(members)
              .where(
                and(
                  eq(members.accountId, accountId),
                  eq(members.familyId, familyInvites.familyId),
                  eq(members.createdAt, now),
                ),
              ),
          ),
        ),
      )
      .returning({ kind: familyInvites.kind, createdBy: familyInvites.createdBy }),
  ]);
  const [invite] = used;
  if (!invite) {
    // そのあいだに種類が決まっていたか、子供が上限か、コードが使えなかった
    if (await getMember(accountId)) return { ok: false, error: "already_chosen" };
    const [full] = await db
      .select({ one: sql`1` })
      .from(familyInvites)
      .where(and(valid, sql`NOT ${childSlotLeft}`));
    return { ok: false, error: full ? "family_full" : "invalid_code" };
  }
  if (invite.kind === "child") await notifyParentByDefault(accountId, invite.createdBy);
  return { ok: true, kind: invite.kind };
}

/** 親が招待コードを発行する。id は一覧と取り消しに使う。 */
export async function createInvite(parentId: string, familyId: string, kind: "parent" | "child") {
  const code = newInviteCode();
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + INVITE_TTL_MS;
  await db.insert(familyInvites).values({
    codeHash: await sha256Hex(normalizeInviteCode(code)),
    id,
    familyId,
    kind,
    createdBy: parentId,
    expiresAt,
  });
  return { id, code, kind, expiresAt };
}

export type PendingInvite = {
  id: string;
  kind: "parent" | "child";
  createdBy: string;
  expiresAt: number;
};

/** 家族の、まだ使われていない期限内の招待コード（コードそのものは持っていないので出さない）。新しい順。 */
export async function listPendingInvites(familyId: string): Promise<PendingInvite[]> {
  const rows = await db.all<PendingInvite>(sql`
    SELECT i.id AS id, i.kind AS kind, COALESCE(u.name, '') AS createdBy, i.expires_at AS expiresAt
    FROM family_invites i LEFT JOIN "user" u ON u.id = i.created_by
    WHERE i.family_id = ${familyId} AND i.used_at IS NULL AND i.expires_at > ${Date.now()}
      AND i.id IS NOT NULL
    ORDER BY i.expires_at DESC`);
  return rows;
}

/** 招待コードを取り消す（同じ家族の、まだ使われていないものだけ）。取り消せたら true。 */
export async function revokeInvite(familyId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(familyInvites)
    .where(
      and(
        eq(familyInvites.id, id),
        eq(familyInvites.familyId, familyId),
        isNull(familyInvites.usedAt),
      ),
    )
    .returning({ id: familyInvites.id });
  return deleted.length > 0;
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
  // コードの発行後に家族から外れていたら使わせない。親が作った子供でなければ使わせない（発行のときにも確かめている）
  const member = await getMember(row.accountId);
  if (member?.kind !== "child" || !(await isCreatedChild(row.accountId))) return null;
  return row.accountId;
}

export type ChildSignInPreview = {
  childId: string;
  childName: string;
  issuer: { name: string; email: string | null };
};

/**
 * 子供のログインリンクのコードを使う前に、誰としてログインするか、誰が発行したかを見る（コードは使わない）。
 * 使えないコード（期限切れ、使用済み、家族から外れた、親が作った子供でない）なら null。
 */
export async function previewChildSignInCode(code: string): Promise<ChildSignInPreview | null> {
  const [row] = await db
    .select({ accountId: childSignInCodes.accountId, createdBy: childSignInCodes.createdBy })
    .from(childSignInCodes)
    .where(
      and(
        eq(childSignInCodes.codeHash, await sha256Hex(code)),
        isNull(childSignInCodes.usedAt),
        gt(childSignInCodes.expiresAt, Date.now()),
      ),
    );
  if (!row) return null;
  const member = await getMember(row.accountId);
  if (member?.kind !== "child" || !member.familyId || !(await isCreatedChild(row.accountId)))
    return null;
  const family = await listFamily(member.familyId);
  const child = family.find((p) => p.id === row.accountId);
  const issuer = family.find((p) => p.id === row.createdBy);
  return {
    childId: row.accountId,
    childName: child?.name ?? "",
    issuer: { name: issuer?.name ?? "", email: issuer?.email ?? null },
  };
}

/**
 * 親が作った子供（Google を持たず、仮のメールアドレスの人）か。
 * 親が子供として「ログインさせる」（サイトのログインリンク、アプリのログインコード）のは、この子供だけ。
 * 自分の Google で登録した子供は自分でログインするので、親がなりすませないようにする。
 */
export async function isCreatedChild(accountId: string): Promise<boolean> {
  const [row] = await db.all<{ email: string }>(
    sql`SELECT email FROM "user" WHERE id = ${accountId}`,
  );
  return row !== undefined && visibleEmail(row.email) === null;
}

/** 親が、子供として「ログインさせて」よいアカウント。同じ家族の、親が作った子供だけ。 */
export async function signInAsTarget(
  viewerId: string,
  viewer: Member,
  requested: string | null | undefined,
): Promise<string | null> {
  if (viewer.kind !== "parent") return null;
  const childId = await targetAccount(viewerId, viewer, requested);
  return childId && (await isCreatedChild(childId)) ? childId : null;
}

/**
 * 親が作った子供を、すべての端末からログアウトさせる（ログインリンクが漏れて、ほかの人が入ったときなど）。
 * ここでは、まだ使われていないログインリンクとアプリのログインコードを消し、アプリの端末を失効する。
 * パスキーとサイトのセッションは Better Auth のテーブルなので、family-auth.ts が Better Auth の adapter で消す。
 * 子供は、親が新しいログインリンクを作り直して、もう一度ログインする。
 */
export async function revokeChildAccess(childId: string) {
  const now = Date.now();
  await db.batch([
    db
      .delete(childSignInCodes)
      .where(and(eq(childSignInCodes.accountId, childId), isNull(childSignInCodes.usedAt))),
    db.delete(loginCodes).where(and(eq(loginCodes.accountId, childId), isNull(loginCodes.usedAt))),
    db
      .update(devices)
      .set({ revokedAt: now })
      .where(and(eq(devices.accountId, childId), isNull(devices.revokedAt))),
  ]);
}

export type InvitePreview = {
  kind: "parent" | "child";
  inviter: { name: string; email: string | null };
  parents: { name: string; email: string | null }[];
};

/** 招待コードを使う前に、どの家族に何として入るかを見る（コードは使わない）。使えないコードなら null。 */
export async function previewInvite(code: string): Promise<InvitePreview | null> {
  const now = Date.now();
  const [invite] = await db
    .select({
      familyId: familyInvites.familyId,
      kind: familyInvites.kind,
      createdBy: familyInvites.createdBy,
    })
    .from(familyInvites)
    .where(
      and(
        eq(familyInvites.codeHash, await sha256Hex(normalizeInviteCode(code))),
        isNull(familyInvites.usedAt),
        gt(familyInvites.expiresAt, now),
      ),
    );
  if (!invite) return null;
  const parents = (await listFamily(invite.familyId)).filter((p) => p.kind === "parent");
  const inviter = parents.find((p) => p.id === invite.createdBy);
  return {
    kind: invite.kind,
    // 招いた親が家族から外れていても、コードは使える（外す機能はまだない）
    inviter: { name: inviter?.name ?? "", email: inviter?.email ?? null },
    parents: parents.map((p) => ({ name: p.name, email: p.email })),
  };
}
