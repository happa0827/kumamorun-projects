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

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
