// PUT /api/account/avatar     自分の写真を置く。本文は画像のバイト列そのもの（WebP、JPEG、PNG）。{ image } を返す。
// DELETE /api/account/avatar  自分の写真を消す。204。
// 画面（pages/settings.tsx）が正方形に縮めてから送る。置けるのは自分の写真だけ。
import { defineHandler } from "void";
import { AVATAR_MAX_BYTES, deleteAvatar, saveAvatar, sniffImage } from "../../../src/server/avatar";
import { requireViewer } from "../../../src/server/viewer";

export const PUT = defineHandler(async (c) => {
  const viewer = await requireViewer(c);
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > AVATAR_MAX_BYTES) return c.json({ error: "too_large" }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length > AVATAR_MAX_BYTES) return c.json({ error: "too_large" }, 413);
  const type = sniffImage(bytes);
  if (!type) return c.json({ error: "unsupported_type" }, 415);
  return { image: await saveAvatar(viewer.id, type, bytes) };
});

export const DELETE = defineHandler(async (c) => {
  const viewer = await requireViewer(c);
  await deleteAvatar(viewer.id);
  return null;
});
