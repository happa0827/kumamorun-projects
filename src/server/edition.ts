// デモ版と完全版（docs/demo-edition.md）。承認（approvals の行）があるアカウントだけが完全版。
// 完全版の画像は KV に置き、GET /api/app/v1/characters/:key で完全版の端末にだけ渡す。
// サイトのリポジトリも公開なので、画像はリポジトリに入れない。管理者が /admin から置く。
//
// KV を使うのは、R2 を使うには Cloudflare のアカウントに支払い情報が要るため（KV は Workers Free のまま使える）。
// 値は JSON で保存されるので、PNG は base64 の文字列で持つ（2MB の画像で約 2.7MB。KV の上限は 25MB）。
import { approvals } from "@schema";
import { db, eq } from "void/db";
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

export const isCharacterKey = (key: string): key is CharacterKey =>
  (CHARACTER_KEYS as readonly string[]).includes(key);

/** 画像。KV のキーは "characters:<key>"。metadata に大きさと置いた時刻を持ち、一覧で読む。 */
type CharacterMeta = { size: number; updatedAt: number };
const images = kv.map<string>("characters");
/**
 * 公開している画像の版。/sync の charactersVersion。アプリはこれが変わったときだけ画像を取り直す。
 * 画像を置いただけでは変えない。管理者が10枚そろえてから「公開」すると変わる（取りかけの組を配らない）。
 */
const VERSION_KEY = "characters-version";

export async function isApproved(accountId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: approvals.accountId })
    .from(approvals)
    .where(eq(approvals.accountId, accountId));
  return row !== undefined;
}

export async function readCharactersVersion(): Promise<string | null> {
  return (await kv.get<string>(VERSION_KEY)) ?? null;
}

/** /sync と /import の応答に足すキー。デモ版の charactersVersion は null。 */
export async function readEdition(accountId: string) {
  const full = await isApproved(accountId);
  return {
    edition: (full ? "full" : "demo") as Edition,
    charactersVersion: full ? await readCharactersVersion() : null,
  };
}

export async function readCharacter(key: CharacterKey): Promise<Uint8Array<ArrayBuffer> | null> {
  const data = await images.get(key);
  return data ? fromBase64(data) : null;
}

export async function saveCharacter(key: CharacterKey, bytes: Uint8Array) {
  const metadata: CharacterMeta = { size: bytes.length, updatedAt: Date.now() };
  await images.put(key, toBase64(bytes), { metadata });
}

/** 管理の画面に出す、置いてある画像と公開中の版。 */
export async function characterStatus() {
  const listed = await images.list<CharacterMeta>();
  const byKey = new Map(listed.keys.map((k) => [k.name, k.metadata ?? null]));
  return {
    version: await readCharactersVersion(),
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
 * 今の画像を公開する（版を変える）。10枚そろっていなければ公開せず、足りないキーを返す。
 * 版は時刻から作る。アプリとの約束で [A-Za-z0-9._-] の1〜64文字（例 "2026-11-23T06.30.12.345Z"）。
 */
export async function publishCharacters(): Promise<
  { ok: true; version: string } | { ok: false; missing: CharacterKey[] }
> {
  const { images: list } = await characterStatus();
  const missing = list.filter((i) => !i.present).map((i) => i.key);
  if (missing.length) return { ok: false, missing };
  const version = new Date().toISOString().replaceAll(":", ".");
  await kv.put(VERSION_KEY, version);
  return { ok: true, version };
}
