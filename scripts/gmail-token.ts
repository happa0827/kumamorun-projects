// 購入通知を Gmail で送るためのリフレッシュトークンを取り、.env に書く（src/server/gmail.ts が使う）。
// OAuth Playground の代わり。一度だけ動かせばよい。
//
//   node scripts/gmail-token.ts
//
// 前もって、.env の AUTH_GOOGLE_CLIENT_ID のクライアントの「承認済みのリダイレクト URI」に
// http://localhost:8765/callback を足しておく。
// 表示された URL をブラウザで開き、送信元にしたい Gmail アカウントで許可すると、
// .env の GMAIL_REFRESH_TOKEN と GMAIL_SENDER を書き換える。トークンは画面に出さない。
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const ENV_PATH = new URL("../.env", import.meta.url);
const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.send"];

function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) map.set(m[1], m[2].replace(/^["']|["']$/g, ""));
  }
  return map;
}

/** .env の key の行を置き換える。なければ末尾に足す。ほかの行はそのまま。 */
function writeEnv(values: Record<string, string>) {
  let text = readFileSync(ENV_PATH, "utf8");
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, line);
    else text = `${text.replace(/\n?$/, "\n")}${line}\n`;
  }
  writeFileSync(ENV_PATH, text);
}

const env = readEnv();
const clientId = env.get("AUTH_GOOGLE_CLIENT_ID");
const clientSecret = env.get("AUTH_GOOGLE_CLIENT_SECRET");
if (!clientId || !clientSecret) {
  console.error(".env に AUTH_GOOGLE_CLIENT_ID と AUTH_GOOGLE_CLIENT_SECRET がありません");
  process.exit(1);
}

const state = randomBytes(16).toString("hex");
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  scope: SCOPES.join(" "),
  access_type: "offline", // リフレッシュトークンをもらう
  prompt: "consent", // 前に許可していても、もう一度リフレッシュトークンを出させる
  state,
}).toString();

async function exchange(code: string): Promise<{ refreshToken: string; email: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as {
    refresh_token?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok) throw new Error(`${json.error}: ${json.error_description}`);
  if (!json.refresh_token) throw new Error("リフレッシュトークンが返ってきませんでした");
  // id_token は Google から直接受け取ったので、署名は確かめずに中のメールアドレスだけ読む
  const payload = JSON.parse(
    Buffer.from(json.id_token!.split(".")[1], "base64url").toString("utf8"),
  ) as { email: string };
  return { refreshToken: json.refresh_token, email: payload.email };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", REDIRECT_URI);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  const reply = (message: string) => {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(message);
  };
  // 前に実行したときの URL から戻ってきたもの。止めずに、今の URL で許可し直してもらう。
  if (url.searchParams.get("state") !== state) {
    console.error("前の実行の URL から戻ってきました。下の URL を開き直してください:\n");
    console.error(authUrl.toString());
    reply(
      "前に実行したときの URL です。ターミナルに今出ている URL を開き直してください（スクリプトは待ち続けています）。",
    );
    return;
  }
  try {
    const error = url.searchParams.get("error");
    if (error) throw new Error(`許可されませんでした（${error}）`);
    const { refreshToken, email } = await exchange(url.searchParams.get("code") ?? "");
    writeEnv({ GMAIL_REFRESH_TOKEN: refreshToken, GMAIL_SENDER: email });
    console.log(`.env に GMAIL_REFRESH_TOKEN と GMAIL_SENDER（${email}）を書きました`);
    reply(`完了しました。${email} から送ります。このタブは閉じてかまいません。`);
    server.close();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`失敗しました: ${message}`);
    reply(`失敗しました: ${message}`);
    server.close();
    process.exitCode = 1;
  }
});

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code !== "EADDRINUSE") throw e;
  console.error(
    `ポート ${PORT} が使われています。前に動かしたこのスクリプトが残っていないか確かめてください（ss -ltnp | grep ${PORT}）`,
  );
  process.exit(1);
});

server.listen(PORT, "localhost", () => {
  console.log("次の URL をブラウザで開き、送信元にしたい Gmail アカウントで許可してください:\n");
  console.log(authUrl.toString());
  console.log(`\n（${REDIRECT_URI} で待っています。Ctrl+C でやめられます）`);
});
