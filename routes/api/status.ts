// GET /api/status  サイトの状況ページが10秒ごとに読む。停止の判定はサーバーが行う。
import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { readLiveStatus } from "../../src/server/account-data";

export const GET = defineHandler(async (c) => readLiveStatus(requireAuth(c).id));
