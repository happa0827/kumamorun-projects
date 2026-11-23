// POST /api/admin/publish-characters  下書きの10枚を新しい版として公開する（/sync の charactersVersion を変える）。
// 完全版のアプリは、次の同期で10枚を取り直す。10枚そろっていなければ 409 と足りない key。
// 管理者だけ（src/server/admin.ts）。
import { defineHandler } from "void";
import { requireAdmin } from "../../../src/server/admin";
import { publishCharacters } from "../../../src/server/edition";

export const POST = defineHandler(async (c) => {
  const admin = requireAdmin(c);
  const result = await publishCharacters(admin.id);
  if (!result.ok) return c.json({ error: "incomplete", missing: result.missing }, 409);
  return { version: result.version };
});
