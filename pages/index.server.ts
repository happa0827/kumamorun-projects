import { defineHandler, type InferProps } from "void";
import { getUser } from "void/auth";
import { env } from "void/env";
import { readLiveStatus } from "../src/server/account-data";
import { configuredProviders } from "../src/oauth";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const user = getUser();
  const providers = configuredProviders(env as Record<string, unknown>);
  const next = c.req.query("next") ?? "/";
  if (!user) return { signedIn: false as const, providers, next, status: null };
  return { signedIn: true as const, providers, next, status: await readLiveStatus(user.id) };
});
