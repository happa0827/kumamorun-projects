// GET /api/app/v1/sync  設定、直近7日の記録、進化段階、花の数をまとめて返す。
// { restrictions, daily, history, stage, flowers, serverTime }
import { defineHandler } from "void";
import { readSync } from "../../../../src/server/account-data";
import { requireDevice } from "../../../../src/server/device-auth";

export const GET = defineHandler(requireDevice, async (c) => readSync(c.get("device").accountId));
