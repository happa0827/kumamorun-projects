// GET /api/app/v1/characters/:key  完全版のキャラクターの画像を1枚返す（PNG、2MB 以下）。
// 知らない key は 404、デモ版のアカウントは 403。key は src/server/edition.ts の CHARACTER_KEYS。
// 返すのは公開した組だけ。管理者が置いただけの下書きは返さない。
// ?v=<版> を付けると、その版の組から返す（/sync の charactersVersion を渡す）。10枚を取っている途中に
// 公開されても、同じ版の組を取り終えられる。その版がない、または消したあとなら 404（今の版には切り替えない）。
// ?v= がなければ、公開中の版の組から返す（?v= を付けない古いアプリのため）。
// 画像は端末のアプリだけに渡す。キャッシュさせない（承認を取り消したら、もう渡さない）。
import { defineHandler } from "void";
import { requireDevice } from "../../../../../src/server/device-auth";
import {
  isApproved,
  isCharacterKey,
  readPublishedCharacter,
} from "../../../../../src/server/edition";

export const GET = defineHandler(requireDevice, async (c) => {
  const key: string = c.req.param("key") ?? "";
  if (!isCharacterKey(key)) return c.json({ error: "not_found" }, 404);
  if (!(await isApproved(c.get("device").accountId))) return c.json({ error: "demo_edition" }, 403);

  // まだ一度も公開していなければ 404（アプリは1枚でも取れなければ、どれも置かない）
  const bytes = await readPublishedCharacter(key, c.req.query("v") ?? null);
  if (!bytes) return c.json({ error: "not_found" }, 404);
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
