// 認証は Google（OAuth）とパスキーだけ。パスワードは使わない。
// 登録は Google で行い、パスキーはログインした後に設定から足す（パスキーだけでは登録できない）。
// メールの6桁のコード（OTP）は、開発のときだけ有効にする。Google の設定がなくても、
// ローカルでログインと通しの試験（scripts/smoke-api.sh）ができるようにするため。
import { passkey } from "@better-auth/passkey";
import { emailOTP } from "better-auth/plugins";
import { defineAuth } from "void/auth";
import { socialProviders } from "./src/oauth";
import { EMAIL_CODE_ENABLED, OTP_EXPIRES_MINUTES, sendOtpMail } from "./src/server/otp-mail";

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
  emailAndPassword: { ...defaults.emailAndPassword, enabled: false },
  account: {
    // Google のメールアドレスが、OTP で作ったアカウントと同じなら、同じアカウントにつなぐ
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
  plugins: [
    ...(EMAIL_CODE_ENABLED
      ? [
          emailOTP({
            otpLength: 6,
            expiresIn: OTP_EXPIRES_MINUTES * 60,
            allowedAttempts: 3,
            storeOTP: "hashed",
            sendVerificationOTP: sendOtpMail,
          }),
        ]
      : []),
    passkey({ rpName: "くまもーるん" }),
  ],
}));
