// OAuth（Google など）の設定。auth.ts からも読み込むので、ほかのファイルを import しないこと。

export const OAUTH_PROVIDERS = ["google"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

const envNames = (provider: OAuthProvider) => {
  const key = provider.toUpperCase();
  return { clientId: `AUTH_${key}_CLIENT_ID`, clientSecret: `AUTH_${key}_CLIENT_SECRET` };
};

const filled = (value: unknown): value is string => typeof value === "string" && value !== "";

/** クライアント ID とシークレットがそろったサービスだけを返す。そろわないものは有効にしない。 */
export function configuredProviders(env: Record<string, unknown>): OAuthProvider[] {
  return OAUTH_PROVIDERS.filter((provider) => {
    const names = envNames(provider);
    return filled(env[names.clientId]) && filled(env[names.clientSecret]);
  });
}

/** Better Auth の socialProviders の設定を作る */
export function socialProviders(env: Record<string, unknown>) {
  return Object.fromEntries(
    configuredProviders(env).map((provider) => {
      const names = envNames(provider);
      return [provider, { clientId: env[names.clientId] as string, clientSecret: env[names.clientSecret] as string }];
    }),
  ) as Partial<Record<OAuthProvider, { clientId: string; clientSecret: string }>>;
}
