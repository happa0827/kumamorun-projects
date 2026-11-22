// アプリのアカウント画面に出す、名前と写真。アプリは Cookie を持たないので、
// 写真は /api/avatars/:id の URL ではなく data: URL で渡す（端末の WebView がそのまま出せる）。
import { db, eq } from "void/db";
import { sqliteTable, text } from "void/schema-d1";
import { readAvatar, toBase64 } from "./avatar";

/** Better Auth の user 表のうち、ここで読む列だけ（表は Void が作る。avatar.ts を参照）。 */
const authUser = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  image: text("image"),
});

export type Profile = {
  name: string;
  /** 自分で置いた写真の data: URL か、Google の写真の https: URL。なければ null（頭文字を出す）。 */
  image: string | null;
};

export async function readProfile(accountId: string): Promise<Profile | null> {
  const [user] = await db
    .select({ name: authUser.name, image: authUser.image })
    .from(authUser)
    .where(eq(authUser.id, accountId));
  if (!user) return null;

  // user.image が自分の配信の URL なら、写真そのものを埋め込む。
  const avatar = user.image?.startsWith("/api/avatars/") ? await readAvatar(accountId) : null;
  if (avatar)
    return { name: user.name, image: `data:${avatar.type};base64,${toBase64(avatar.bytes)}` };
  // Google の写真などの外の URL は https: のものだけ渡す。
  const image = user.image?.startsWith("https://") ? user.image : null;
  return { name: user.name, image };
}
