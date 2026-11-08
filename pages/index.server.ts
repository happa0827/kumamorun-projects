import { devices } from "@schema";
import { defineHandler, type InferProps } from "void";
import { getUser } from "void/auth";
import { and, db, desc, eq, isNull } from "void/db";
import { env } from "void/env";
import { configuredProviders } from "../src/oauth";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async () => {
  const user = getUser();
  const providers = configuredProviders(env as Record<string, unknown>);
  if (!user) return { user: null, providers, devices: [] };

  const rows = await db
    .select({ id: devices.id, name: devices.name, createdAt: devices.createdAt, lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .where(and(eq(devices.accountId, user.id), isNull(devices.revokedAt)))
    .orderBy(desc(devices.lastSeenAt));
  return { user: { id: user.id, email: user.email, name: user.name }, providers, devices: rows };
});
