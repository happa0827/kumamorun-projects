// GET /api/app/v1/sync  設定、直近7日の記録、進化段階、花の数をまとめて返す。
// { restrictions, daily, history, stage, flowers, edition, charactersVersion, serverTime }
// edition は "full" か "demo"、charactersVersion は完全版の画像の版（デモ版は null）。docs/demo-edition.md
import { defineHandler } from "void";
import { readSync } from "../../../../src/server/account-data";
import { requireDevice } from "../../../../src/server/device-auth";

export const GET = defineHandler(requireDevice, async (c) => readSync(c.get("device").accountId));
