// DELETE /api/devices/:id  自分の端末を失効する。失効した端末の API 呼び出しは 401 になる。
import { devices } from "@schema";
import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { and, db, eq, isNull } from "void/db";

export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c);
  const id: string = c.req.param("id") ?? "";
  const [row] = await db
    .update(devices)
    .set({ revokedAt: Date.now() })
    .where(and(eq(devices.id, id), eq(devices.accountId, user.id), isNull(devices.revokedAt)))
    .returning({ id: devices.id });
  return row ? null : c.json({ error: "not_found" }, 404);
});
