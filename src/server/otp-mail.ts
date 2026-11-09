// ログイン用の6桁のコードをメールで送る。auth.ts から使う。
// 本番には送信元のドメインがないので、メールのコードは開発のときだけ使う（Void のローカルの受け箱に届く）。
// 本番でも使うなら、void.config.ts に email.from を書いて、EMAIL_CODE_ENABLED を本番でも true にする。
import { sendEmail } from "void/email";

/** メールのコードでのログインを有効にするか。auth.ts とログイン画面がこれに従う。 */
export const EMAIL_CODE_ENABLED: boolean = import.meta.env.DEV;
export const OTP_EXPIRES_MINUTES = 10;
/** 開発の受け箱は送信元を確かめないので、仮の差出人で足りる。 */
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
    from: DEV_FROM,
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
