// POST /api/app/v1/logout  この端末のトークンを失効する。
import { devices } from "@schema";
import { defineHandler } from "void";
import { db, eq } from "void/db";
import { requireDevice } from "../../../../src/server/device-auth";

export const POST = defineHandler(requireDevice, async (c) => {
  const { deviceId } = c.get("device");
  await db.update(devices).set({ revokedAt: Date.now() }).where(eq(devices.id, deviceId));
  return null;
});
