// PUT /api/admin/approvals/:id     アカウントを承認する（完全版にする）。204。アカウントがなければ 404。
// DELETE /api/admin/approvals/:id  承認を取り消す（デモ版に戻す）。204。
// 管理者だけ（src/server/admin.ts）。アプリは次の同期（最大10分後）で版が変わる。
import { defineHandler } from "void";
import { approve, requireAdmin, revoke } from "../../../../src/server/admin";

export const PUT = defineHandler(async (c) => {
  const admin = requireAdmin(c);
  const id: string = c.req.param("id") ?? "";
  if (!(await approve(id, admin.id))) return c.json({ error: "not_found" }, 404);
  return null;
});

export const DELETE = defineHandler(async (c) => {
  requireAdmin(c);
  await revoke(c.req.param("id") ?? "");
  return null;
});
