// GET /api/app/v1/characters/:key  完全版のキャラクターの画像を1枚返す（PNG、2MB 以下）。
// 知らない key は 404、デモ版のアカウントは 403。key は src/server/edition.ts の CHARACTER_KEYS。
// 画像は端末のアプリだけに渡す。キャッシュさせない（承認を取り消したら、もう渡さない）。
import { defineHandler } from "void";
import { requireDevice } from "../../../../../src/server/device-auth";
import { isApproved, isCharacterKey, readCharacter } from "../../../../../src/server/edition";

export const GET = defineHandler(requireDevice, async (c) => {
  const key: string = c.req.param("key") ?? "";
  if (!isCharacterKey(key)) return c.json({ error: "not_found" }, 404);
  if (!(await isApproved(c.get("device").accountId))) return c.json({ error: "demo_edition" }, 403);

  // 管理者がまだ置いていなければ 404（アプリは1枚でも取れなければ、どれも置かない）
  const bytes = await readCharacter(key);
  if (!bytes) return c.json({ error: "not_found" }, 404);
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
