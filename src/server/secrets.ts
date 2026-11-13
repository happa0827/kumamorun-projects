// 端末のトークンと、ディープリンクの使い捨てコード。どちらも DB にはハッシュだけを置く。

/** 使い捨てコードの有効時間 */
export const LOGIN_CODE_TTL_MS = 5 * 60 * 1000;

function randomBase64Url(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export const newDeviceToken = () => `kmr_${randomBase64Url(32)}`;
export const newLoginCode = () => randomBase64Url(24);

/** 招待コードの文字。読み違えやすい 0/O、1/I/L は使わない。 */
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const INVITE_LENGTH = 8;

/** 家族への招待コード。人が書き写すので短くし、「ABCD-EFGH」の形で見せる（31^8 ≒ 8.5×10^11 通り）。 */
export function newInviteCode(): string {
  const buf = crypto.getRandomValues(new Uint8Array(INVITE_LENGTH));
  // 256 は 31 で割り切れないが、偏りは 1% 未満で、推測の手間はほぼ変わらない
  const chars = Array.from(buf, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** 入力された招待コードを、ハッシュを取る前の形にそろえる（大文字、記号と空白を除く）。 */
export const normalizeInviteCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
