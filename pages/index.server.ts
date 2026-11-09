import { defineHandler, type InferProps } from "void";
import { getUser } from "void/auth";
import { env } from "void/env";
import { readLiveStatus } from "../src/server/account-data";
import { configuredProviders } from "../src/oauth";
import { EMAIL_CODE_ENABLED } from "../src/server/otp-mail";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const user = getUser();
  const providers = configuredProviders(env as Record<string, unknown>);
  const next = c.req.query("next") ?? "/";
  // メールのコードは開発のときだけ（auth.ts の EMAIL_CODE_ENABLED と同じ）
  const emailCode = EMAIL_CODE_ENABLED;
  if (!user) return { signedIn: false as const, providers, next, emailCode, status: null };
  return {
    signedIn: true as const,
    providers,
    next,
    emailCode,
    status: await readLiveStatus(user.id),
  };
});
