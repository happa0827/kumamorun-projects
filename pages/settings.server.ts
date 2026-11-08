import { devices } from "@schema";
import { defineHandler, defineHead, type InferProps } from "void";
import { getUser } from "void/auth";
import { and, db, desc, eq, isNull } from "void/db";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const user = getUser();
  if (!user) return c.redirect("/?next=/settings");

  const rows = await db
    .select({
      id: devices.id,
      name: devices.name,
      createdAt: devices.createdAt,
      lastSeenAt: devices.lastSeenAt,
    })
    .from(devices)
    .where(and(eq(devices.accountId, user.id), isNull(devices.revokedAt)))
    .orderBy(desc(devices.lastSeenAt));
  return { user: { email: user.email, name: user.name }, devices: rows };
});

export const head = defineHead(() => ({ title: "設定 | くまもーるん" }));
