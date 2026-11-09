// ログイン用の6桁のコードをメールで送る。auth.ts から使う。
// 送信元は void.config.ts の email.from（本番）。開発では Void のローカルの受け箱に入る。
import { sendEmail } from "void/email";

export const OTP_EXPIRES_MINUTES = 10;
/** 開発の受け箱は送信元を確かめないので、仮の差出人で足りる。本番は email.from を使う。 */
const DEV_FROM = "くまもーるん <noreply@kumamorun.localhost>";

type OtpType = "sign-in" | "email-verification" | "forget-password" | "change-email";

export async function sendOtpMail({
  email,
  otp,
  type,
}: {
  email: string;
  otp: string;
  type: OtpType;
}) {
  if (type !== "sign-in") return; // ログインのほかは使っていない
  const result = await sendEmail({
    ...(import.meta.env.DEV ? { from: DEV_FROM } : {}),
    to: email,
    subject: `くまもーるんのログインコード: ${otp}`,
    text: [
      "くまもーるんのログインコードです。",
      "",
      `    ${otp}`,
      "",
      `このコードは${OTP_EXPIRES_MINUTES}分で失効し、一度しか使えません。`,
      "心当たりがなければ、このメールは捨ててください。",
    ].join("\n"),
    html: `<p>くまもーるんのログインコードです。</p>
<p style="font-size:28px;font-weight:600;letter-spacing:.2em;font-family:ui-monospace,Consolas,monospace">${otp}</p>
<p>このコードは${OTP_EXPIRES_MINUTES}分で失効し、一度しか使えません。<br>心当たりがなければ、このメールは捨ててください。</p>`,
  });
  if (!result.ok) {
    const detail =
      "error" in result
        ? `${result.error.code}: ${result.error.message}`
        : result.deliveries
            .filter((d) => !d.ok)
            .map((d) => `${d.recipient} ${d.error.code}`)
            .join(", ");
    console.error(`[otp-mail] 送信に失敗しました ${detail}`);
    throw new Error("ログインコードのメールを送れませんでした");
  }
}
