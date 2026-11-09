// 認証は3つだけ: Google（OAuth）、メールの6桁のコード（OTP）、パスキー。パスワードは使わない。
// 初めてのメールアドレスは、OTP でのログインがそのまま登録になる。
// パスキーはログインした後に設定から足す（パスキーだけでは登録できない）。
import { passkey } from "@better-auth/passkey";
import { emailOTP } from "better-auth/plugins";
import { defineAuth } from "void/auth";
import { socialProviders } from "./src/oauth";
import { OTP_EXPIRES_MINUTES, sendOtpMail } from "./src/server/otp-mail";

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
    emailOTP({
      otpLength: 6,
      expiresIn: OTP_EXPIRES_MINUTES * 60,
      allowedAttempts: 3,
      storeOTP: "hashed",
      sendVerificationOTP: sendOtpMail,
    }),
    passkey({ rpName: "くまもーるん" }),
  ],
}));
