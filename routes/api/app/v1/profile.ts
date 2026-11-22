// GET /api/app/v1/profile  アカウントの名前と写真を返す。{ name, image }
// image は data: URL（自分で置いた写真）か https: URL（Google の写真）か null。
import { defineHandler } from "void";
import { requireDevice } from "../../../../src/server/device-auth";
import { readProfile } from "../../../../src/server/profile";

export const GET = defineHandler(requireDevice, async (c) => {
  const profile = await readProfile(c.get("device").accountId);
  if (!profile) return c.json({ error: "not_found" }, 404);
  return profile;
});
