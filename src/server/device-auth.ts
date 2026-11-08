// アプリ向け API の認証。Authorization: Bearer <端末のトークン> を確かめ、
// アカウントと端末を c.get("device") に置く。無効または失効なら 401。
import { devices } from "@schema";
import { defineMiddleware } from "void";
import { and, db, eq, isNull } from "void/db";
import { sha256Hex } from "./secrets";

export interface DeviceContext {
  deviceId: string;
  accountId: string;
}

declare module "void" {
  interface CloudContextVariables {
    device: DeviceContext;
  }
}

export const requireDevice = defineMiddleware(async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return c.json({ error: "unauthorized" }, 401);

  const tokenHash = await sha256Hex(match[1]);
  // 失効と最終利用の記録を1文で行う。失効した端末は行が返らない。
  const [row] = await db
    .update(devices)
    .set({ lastSeenAt: Date.now() })
    .where(and(eq(devices.tokenHash, tokenHash), isNull(devices.revokedAt)))
    .returning({ deviceId: devices.id, accountId: devices.accountId });
  if (!row) return c.json({ error: "unauthorized" }, 401);

  c.set("device", row);
  await next();
});
