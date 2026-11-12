// DELETE /api/devices/:id  端末を失効する。失効した端末の API 呼び出しは 401 になる。
// 失効できるのは、自分の端末と、親なら同じ家族の子供の端末（パソコンをなくしたときなどに、親が止められるように）。
// それ以外と、もう失効した端末は 404。
import { devices } from "@schema";
import { defineHandler } from "void";
import { and, db, eq, isNull } from "void/db";
import { targetAccount } from "../../../src/server/family";
import { requireViewer } from "../../../src/server/viewer";

export const DELETE = defineHandler(async (c) => {
  const viewer = await requireViewer(c);
  const id: string = c.req.param("id") ?? "";
  const [device] = await db
    .select({ accountId: devices.accountId })
    .from(devices)
    .where(and(eq(devices.id, id), isNull(devices.revokedAt)));
  if (!device) return c.json({ error: "not_found" }, 404);
  const allowed =
    device.accountId === viewer.id ||
    (viewer.member.kind === "parent" &&
      (await targetAccount(viewer.id, viewer.member, device.accountId)) !== null);
  if (!allowed) return c.json({ error: "not_found" }, 404);

  const [row] = await db
    .update(devices)
    .set({ revokedAt: Date.now() })
    .where(
      and(eq(devices.id, id), eq(devices.accountId, device.accountId), isNull(devices.revokedAt)),
    )
    .returning({ id: devices.id });
  return row ? null : c.json({ error: "not_found" }, 404);
});
