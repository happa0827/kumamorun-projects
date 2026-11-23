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
//   公開中の版: D1 の character_releases のいちばん新しい行。/sync と画像の配信は、どちらもここから版を決める。
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

/** 公開した組を KV に残す数。今の版と、1つ前の版（公開の直前に同期した端末が、取り終えられるように）。 */
const KEEP_RELEASES = 2;

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
    .orderBy(desc(characterReleases.publishedAt))
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

/** 端末に渡す画像。公開中の版の組から読む。まだ公開していなければ null。 */
export async function readPublishedCharacter(
  key: CharacterKey,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const version = await readCharactersVersion();
  if (!version) return null;
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
 * 版は時刻から作る。アプリとの約束で [A-Za-z0-9._-] の1〜64文字（例 "2026-11-23T06.30.12.345Z"）。
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

  const version = new Date().toISOString().replaceAll(":", ".");
  for (const { key, data } of images) await kv.put(releaseKey(version, key), data);
  await db
    .insert(characterReleases)
    .values({ version, publishedAt: Date.now(), publishedBy: adminId });
  await pruneReleases();
  return { ok: true, version };
}

/** 残す数を超えた古い版の画像を KV から消す（記録の行は残す）。超えたばかりの1つだけを消す。 */
async function pruneReleases() {
  const [old] = await db
    .select({ version: characterReleases.version })
    .from(characterReleases)
    .orderBy(desc(characterReleases.publishedAt))
    .limit(1)
    .offset(KEEP_RELEASES);
  if (!old) return;
  await Promise.all(CHARACTER_KEYS.map((key) => kv.delete(releaseKey(old.version, key))));
}
