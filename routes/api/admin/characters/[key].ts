// GET /api/admin/characters/:key  置いてある画像を返す（管理の画面の確かめ用）。
// PUT /api/admin/characters/:key  画像を置く。本文は PNG のバイト列そのもの（2MB 以下）。204。
// 置いただけではアプリに配らない。10枚そろえて POST /api/admin/publish-characters で公開する。
// 管理者だけ（src/server/admin.ts）。
import { defineHandler } from "void";
import { requireAdmin } from "../../../../src/server/admin";
import { sniffImage } from "../../../../src/server/avatar";
import {
  CHARACTER_MAX_BYTES,
  isCharacterKey,
  readCharacter,
  saveCharacter,
} from "../../../../src/server/edition";

export const GET = defineHandler(async (c) => {
  requireAdmin(c);
  const key: string = c.req.param("key") ?? "";
  const bytes = isCharacterKey(key) ? await readCharacter(key) : null;
  if (!bytes) return c.json({ error: "not_found" }, 404);
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

export const PUT = defineHandler(async (c) => {
  requireAdmin(c);
  const key: string = c.req.param("key") ?? "";
  if (!isCharacterKey(key)) return c.json({ error: "not_found" }, 404);
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > CHARACTER_MAX_BYTES) return c.json({ error: "too_large" }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length > CHARACTER_MAX_BYTES) return c.json({ error: "too_large" }, 413);
  // アプリとの約束は PNG だけ
  if (sniffImage(bytes) !== "image/png") return c.json({ error: "unsupported_type" }, 415);
  await saveCharacter(key, bytes);
  return null;
});
