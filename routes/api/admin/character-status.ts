// GET /api/admin/character-status  配っている版と、配信待ちの版（{ version, pending }）を返す。
// 管理の画面が、配信待ちの版がある間だけ読み直す（画面の時計に頼らず、サーバーの状態を出す）。
// 管理者だけ（src/server/admin.ts）。
import { defineHandler } from "void";
import { requireAdmin } from "../../../src/server/admin";
import { characterStatus } from "../../../src/server/edition";

export const GET = defineHandler(async (c) => {
  requireAdmin(c);
  const { version, pending } = await characterStatus();
  return { version, pending };
});
