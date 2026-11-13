// GET /api/status  サイトの状況ページが10秒ごとに読む。停止の判定はサーバーが行う。
// 親は ?account=<子供の ID> で、同じ家族の子供の状況を読む。
import { defineHandler } from "void";
import { readLiveStatus } from "../../src/server/account-data";
import { targetAccount } from "../../src/server/family";
import { forbidden, requireViewer } from "../../src/server/viewer";

export const GET = defineHandler(async (c) => {
  const viewer = await requireViewer(c);
  const accountId = await targetAccount(viewer.id, viewer.member, c.req.query("account"));
  if (!accountId) return forbidden(c);
  return readLiveStatus(accountId);
});
