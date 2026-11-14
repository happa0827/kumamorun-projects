// アカウントの写真（avatars テーブル）。画面（pages/settings.tsx）が正方形に縮めてから送る。
// 置くと user.image を自分の配信の URL にする。Google で登録した人の user.image は Google の写真の URL で、
// 写真を置くまではそれが出る。消すと user.image は NULL（頭文字が出る）。
import { avatars } from "@schema";
import { db, eq } from "void/db";
import { sqliteTable, text } from "void/schema-d1";

/**
 * Better Auth の user 表のうち、ここで書く列だけ。表は Void が作るので db/schema.ts には置かない
 * （置くとマイグレーションが表を作ろうとする）。batch に入れるために、生の SQL ではなくこれで書く。
 */
const authUser = sqliteTable("user", { id: text("id").primaryKey(), image: text("image") });

/** 画面が縮める大きさ（px、正方形） */
export const AVATAR_SIZE = 256;
/** 受け取る画像の上限（バイト）。256px の WebP なら数十 KB。PNG になる端末（古い Safari）でも収まる大きさ。 */
export const AVATAR_MAX_BYTES = 300 * 1024;

export type AvatarType = "image/webp" | "image/jpeg" | "image/png";

/** 先頭のバイトから画像の種類を決める。Content-Type は信じない。 */
export function sniffImage(bytes: Uint8Array): AvatarType | null {
  const at = (i: number, ...want: number[]) => want.every((b, j) => bytes[i + j] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  // "RIFF" ???? "WEBP"
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** 画面に渡す写真の URL。v を変えて、置き直した写真をキャッシュから出さない。 */
export const avatarUrl = (accountId: string, updatedAt: number) =>
  `/api/avatars/${encodeURIComponent(accountId)}?v=${updatedAt}`;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 写真を置き、user.image を差し替える。新しい URL を返す。 */
export async function saveAvatar(accountId: string, type: AvatarType, bytes: Uint8Array) {
  const updatedAt = Date.now();
  const url = avatarUrl(accountId, updatedAt);
  const row = { contentType: type, data: toBase64(bytes), updatedAt };
  await db.batch([
    db
      .insert(avatars)
      .values({ accountId, ...row })
      .onConflictDoUpdate({ target: avatars.accountId, set: row }),
    db.update(authUser).set({ image: url }).where(eq(authUser.id, accountId)),
  ]);
  return url;
}

/** 写真を消し、user.image も消す（Google の写真にも戻さない。頭文字が出る）。 */
export async function deleteAvatar(accountId: string) {
  await db.batch([
    db.delete(avatars).where(eq(avatars.accountId, accountId)),
    db.update(authUser).set({ image: null }).where(eq(authUser.id, accountId)),
  ]);
}

export async function readAvatar(accountId: string) {
  const [row] = await db.select().from(avatars).where(eq(avatars.accountId, accountId));
  return row
    ? { type: row.contentType, bytes: fromBase64(row.data), updatedAt: row.updatedAt }
    : null;
}
