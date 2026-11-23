// デモ版と完全版（docs/demo-edition.md）。承認（approvals の行）があるアカウントだけが完全版。
// 完全版の画像は KV に置き、GET /api/app/v1/characters/:key で完全版の端末にだけ渡す。
// サイトのリポジトリも公開なので、画像はリポジトリに入れない。管理者が /admin から置く。
//
// KV を使うのは、R2 を使うには Cloudflare のアカウントに支払い情報が要るため（KV は Workers Free のまま使える）。
// 値は JSON で保存されるので、PNG は base64 の文字列で持つ（2MB の画像で約 2.7MB。KV の上限は 25MB）。
//
// 置いた画像と配る画像は分ける。
//   下書き: "characters-draft:<key>"。管理者が置き直すのはここだけ。管理の画面の確かめもここを読む。
//   公開: "characters-release:<version>:<key>"。公開のときに下書きの10枚を写し、そのあとは変えない。
//   公開中の版: D1 の character_releases のいちばん新しい行。/sync はここから版を返す。
//   画像の配信は、端末が ?v= で渡した版（/sync で受け取ったもの）を使う。なければ公開中の版。
// こうすると、公開する前の画像や、置き直しの途中の組が端末に渡ることはない。
// 新しい版のキーは初めて読まれるので、KV の古い値（届くまでの時間差）が出ることもない。
import { approvals, characterReleases } from "@schema";
import { db, desc, eq } from "void/db";
import { kv } from "void/kv";
import { fromBase64, toBase64 } from "./avatar";

export type Edition = "full" | "demo";

/** アプリの src-tauri/src/characters.rs の KEYS と同じ。 */
export const CHARACTER_KEYS = [
  "stage0",
  "stage1",
  "stage2",
  "stage3",
  "stage4",
  "stage5",
  "dandelion",
  "peony",
  "blueSpiderLily",
  "nightCherry",
] as const;
export type CharacterKey = (typeof CHARACTER_KEYS)[number];

export const CHARACTER_LABELS: Record<CharacterKey, string> = {
  stage0: "成長段階 0",
  stage1: "成長段階 1",
  stage2: "成長段階 2",
  stage3: "成長段階 3",
  stage4: "成長段階 4",
  stage5: "成長段階 5",
  dandelion: "開花: たんぽぽ",
  peony: "開花: ぼたん",
  blueSpiderLily: "開花: 青い彼岸花",
  nightCherry: "開花: 夜桜",
};

/** 1枚の上限（バイト）。アプリとの約束。 */
export const CHARACTER_MAX_BYTES = 2 * 1024 * 1024;

/**
 * 古い版の画像を KV に残す時間。次の版が出てから、この時間を過ぎたら消す（今の版は消さない）。
 * 端末は ?v= で /sync の版を指定して10枚を取るので、取っている途中に公開されても、同じ版の組を取り終えられる。
 * 同期と画像の取得は続けて行うので、1日あれば足りる。
 */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

/** 版の形。アプリとの約束で [A-Za-z0-9._-] の1〜64文字。 */
export const isVersion = (v: string) => /^[A-Za-z0-9._-]{1,64}$/.test(v);

export const isCharacterKey = (key: string): key is CharacterKey =>
  (CHARACTER_KEYS as readonly string[]).includes(key);

/**
 * 最後まである PNG か。先頭の署名、最初のチャンクが IHDR、最後のチャンクが IEND であることを見る。
 * 全体を読み解くのは Workers では重いので、途中で切れたファイルや、署名だけのものを止める程度にする。
 */
export function isCompletePng(bytes: Uint8Array): boolean {
  const at = (i: number, ...want: number[]) => want.every((b, j) => bytes[i + j] === b);
  // チャンクの種類は ASCII の4文字
  const ascii = (i: number, s: string) =>
    at(i, ...Array.from({ length: s.length }, (_, j) => s.charCodeAt(j)));
  // 署名 8 + IHDR（長さ 4、種類 4、中身 13、CRC 4）+ IEND（長さ 4、種類 4、CRC 4）
  if (bytes.length < 8 + 25 + 12) return false;
  if (!at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return false;
  if (!at(8, 0, 0, 0, 13) || !ascii(12, "IHDR")) return false;
  const end = bytes.length - 12;
  return at(end, 0, 0, 0, 0) && ascii(end + 4, "IEND") && at(end + 8, 0xae, 0x42, 0x60, 0x82);
}

/** KV の画像の metadata。一覧で大きさと置いた時刻を読む。 */
type CharacterMeta = { size: number; updatedAt: number };
const drafts = kv.map<string>("characters-draft");
const releaseKey = (version: string, key: CharacterKey) => `characters-release:${version}:${key}`;

export async function isApproved(accountId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: approvals.accountId })
    .from(approvals)
    .where(eq(approvals.accountId, accountId));
  return row !== undefined;
}

/** 公開中の版。まだ一度も公開していなければ null。 */
export async function readCharactersVersion(): Promise<string | null> {
  const [row] = await db
    .select({ version: characterReleases.version })
    .from(characterReleases)
    .orderBy(desc(characterReleases.publishedAt), desc(characterReleases.version))
    .limit(1);
  return row?.version ?? null;
}

/** /sync と /import の応答に足すキー。デモ版の charactersVersion は null。 */
export async function readEdition(accountId: string) {
  const full = await isApproved(accountId);
  return {
    edition: (full ? "full" : "demo") as Edition,
    charactersVersion: full ? await readCharactersVersion() : null,
  };
}

/**
 * 端末に渡す画像。
 * - pinned（?v= の版）があれば、その版の組から読む。その版がない、または消したあとなら null（今の版には切り替えない）。
 * - なければ、公開中の版の組から読む（?v= を付けない古いアプリ）。まだ公開していなければ null。
 */
export async function readPublishedCharacter(
  key: CharacterKey,
  pinned: string | null,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const version = pinned ?? (await readCharactersVersion());
  if (!version || !isVersion(version)) return null;
  const data = await kv.get<string>(releaseKey(version, key));
  return data ? fromBase64(data) : null;
}

/** 管理の画面の確かめ用。下書きを読む。 */
export async function readDraftCharacter(
  key: CharacterKey,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const data = await drafts.get(key);
  return data ? fromBase64(data) : null;
}

/** 下書きに置く。公開するまで端末には渡らない。 */
export async function saveDraftCharacter(key: CharacterKey, bytes: Uint8Array) {
  const metadata: CharacterMeta = { size: bytes.length, updatedAt: Date.now() };
  await drafts.put(key, toBase64(bytes), { metadata });
}

/** 管理の画面に出す、下書きの画像と公開中の版。 */
export async function characterStatus() {
  const [listed, version] = await Promise.all([
    drafts.list<CharacterMeta>(),
    readCharactersVersion(),
  ]);
  const byKey = new Map(listed.keys.map((k) => [k.name, k.metadata ?? null]));
  return {
    version,
    images: CHARACTER_KEYS.map((key) => {
      const meta = byKey.get(key);
      return {
        key,
        label: CHARACTER_LABELS[key],
        present: byKey.has(key),
        size: meta?.size ?? null,
        updatedAt: meta?.updatedAt ?? null,
      };
    }),
  };
}

/**
 * 下書きの10枚を新しい版として公開する。10枚そろっていなければ公開せず、足りないキーを返す。
 * 先に10枚を新しい版のキーに写し、最後に D1 に版を書く。途中で失敗しても、端末は前の版のまま。
 * 版は時刻に乱数を足して作り、ほかの公開と重ならないようにする（同じミリ秒に2回公開しても、別の組になる）。
 * アプリとの約束で [A-Za-z0-9._-] の1〜64文字（例 "2026-11-23T06.30.12.345Z-1a2b3c4d5e6f"、37文字）。
 */
export async function publishCharacters(
  adminId: string,
): Promise<{ ok: true; version: string } | { ok: false; missing: CharacterKey[] }> {
  // 一覧（list）は書いてから載るまでに時間がかかるので、1枚ずつ読んで確かめる
  const images = await Promise.all(
    CHARACTER_KEYS.map(async (key) => ({ key, data: await drafts.get(key) })),
  );
  const missing = images.filter((i) => !i.data).map((i) => i.key);
  if (missing.length) return { ok: false, missing };

  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const version = `${new Date().toISOString().replaceAll(":", ".")}-${suffix}`;
  if (!isVersion(version)) throw new Error(`bad version: ${version}`);
  for (const { key, data } of images) await kv.put(releaseKey(version, key), data);
  await db
    .insert(characterReleases)
    .values({ version, publishedAt: Date.now(), publishedBy: adminId });
  await pruneReleases();
  return { ok: true, version };
}

/**
 * 古い版の画像を KV から消す（記録の行は残し、pruned_at を入れる）。
 * 消すのは、次の版が出てから PRUNE_AFTER_MS を過ぎた版だけ。今の版は消さない。
 */
async function pruneReleases() {
  const rows = await db
    .select({
      version: characterReleases.version,
      publishedAt: characterReleases.publishedAt,
      prunedAt: characterReleases.prunedAt,
    })
    .from(characterReleases)
    .orderBy(desc(characterReleases.publishedAt), desc(characterReleases.version));
  const now = Date.now();
  // rows[i] の次の版は rows[i - 1]。その版が出た時刻から数える
  const stale = rows.filter(
    (row, i) => i > 0 && row.prunedAt === null && now - rows[i - 1].publishedAt > PRUNE_AFTER_MS,
  );
  for (const { version } of stale) {
    await Promise.all(CHARACTER_KEYS.map((key) => kv.delete(releaseKey(version, key))));
    await db
      .update(characterReleases)
      .set({ prunedAt: now })
      .where(eq(characterReleases.version, version));
  }
}
