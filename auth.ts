import { passkey } from "@better-auth/passkey";
import { defineAuth } from "void/auth";
import { socialProviders } from "./src/oauth";

export default defineAuth(({ defaults, env }) => ({
  ...defaults,
  // クライアント ID とシークレットがそろったサービスだけを有効にする
  socialProviders: socialProviders(env as Record<string, unknown>),
  // Workers のログでは、オブジェクトが [object Object] になるので JSON にして出す
  logger: {
    log: (level, message, ...args) => {
      const detail = args.map((arg) => {
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        if (typeof arg !== "object" || arg === null) return String(arg);
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      });
      const line = `[Better Auth] ${message}${detail.length ? ` ${detail.join(" ")}` : ""}`;
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    },
  },
  emailAndPassword: {
    ...defaults.emailAndPassword,
    enabled: true,
    minPasswordLength: 8,
  },
  plugins: [passkey({ rpName: "くまもるん" })],
}));
