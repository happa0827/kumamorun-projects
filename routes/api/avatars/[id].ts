// GET /api/avatars/:id?v=<更新時刻>  アカウントの写真を返す。
// 見られるのは、自分と同じ家族の人（親は子供とほかの親、子供は家族の人）。それ以外と、写真がなければ 404。
// URL の v が今の写真と同じなら、長くキャッシュさせる（置き直すと v が変わる）。
import { defineHandler } from "void";
import { readAvatar } from "../../../src/server/avatar";
import { getMember } from "../../../src/server/family";
import { requireViewer } from "../../../src/server/viewer";

export const GET = defineHandler(async (c) => {
  const viewer = await requireViewer(c);
  const id: string = c.req.param("id") ?? "";
  if (id !== viewer.id) {
    const familyId = viewer.member.familyId;
    const target = familyId ? await getMember(id) : null;
    if (!target || target.familyId !== familyId) return c.json({ error: "not_found" }, 404);
  }
  const avatar = await readAvatar(id);
  if (!avatar) return c.json({ error: "not_found" }, 404);

  const current = c.req.query("v") === String(avatar.updatedAt);
  return new Response(avatar.bytes, {
    headers: {
      "content-type": avatar.type,
      // 人の写真なので、共有のキャッシュには置かせない
      "cache-control": current ? "private, max-age=31536000, immutable" : "private, no-cache",
      // 受け取ったバイト列は先頭で種類を確かめているが、念のためページとして開かせない
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});
