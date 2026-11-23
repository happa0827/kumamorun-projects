# デモ版と完全版

オリジナルのキャラクターを守るため、アプリをデモ版と完全版に分ける。サイトで承認したアカウントだけが完全版になる。
判断の理由は kumamorun-tauri の ADR 0003、用語は同じリポジトリの GLOSSARY.md（デモ版、完全版、承認）に従う。

アプリとサイトの約束は、この文書の「スキーマ」「API」「画像」。変えるときは、両方のリポジトリで同時に直す
（[void-migration.md](void-migration.md) と同じ扱い）。kumamorun-tauri の `docs/plans/demo-edition.md` と同じ内容を保つ。

## 分担

| 担当 | 範囲 |
|---|---|
| kumamorun-tauri | アプリ側。実装済み |
| このリポジトリ（サイト） | スキーマ、API、承認の画面、画像の置き場所、既存アカウントの移行。**実装済み**（下の「サイトの動き」） |
| 共同 | 公開の順番（下の「公開の手順」） |

## デモ版と完全版の違い

| | デモ版 | 完全版 |
|---|---|---|
| キャラクター | 成長段階のシルエット（アプリに同梱） | 本来の画像（サーバーから受け取る） |
| 進化と開花 | 反映しない。成功日の進化は保留のまま残り、完全版になったら反映する | 使える |
| スタート制限 | 効かず、変えられない。設定済みの内容は残り、完全版になると戻る | 使える |
| タイマー、休憩の猶予、失敗、記録、読み上げ、音、集中、ミニ、ライブ状況 | 使える | 使える |

ログインしていない端末は、デモ版。

## スキーマ（D1）

`approvals` を足す（`db/schema.ts`）。アカウントにつき0か1行。行があれば完全版。

```sql
CREATE TABLE approvals (
  account_id  TEXT PRIMARY KEY,
  approved_at INTEGER NOT NULL,
  approved_by TEXT,                    -- 承認した管理者の account_id。移行で入れた行は NULL
  note        TEXT                     -- 例: "既存の利用者"
);
```

### 既存アカウントの移行

**今使っている人は完全版のまま**にする。`approvals` を作るマイグレーション（`db/migrations/20261123024629_rich_jocasta.sql`）の中で、
その時点の `user` のすべてに行を入れる。マイグレーションはデプロイのときに1回だけ流れるので、公開の時点のアカウントが対象になる。

```sql
INSERT INTO approvals (account_id, approved_at, approved_by, note)
SELECT id, unixepoch() * 1000, NULL, '既存の利用者'
FROM user
WHERE id NOT IN (SELECT account_id FROM approvals);
```

2026-11-15 の切り替えで、利用者は全員サイトに登録し直している。そのため、アカウントを対象にすれば漏れはない。

## API

すべて `/api/app/v1/…`。認証は今までと同じ（`Authorization: Bearer <端末のトークン>`）。

### `GET /sync` と `POST /import` の応答に足すキー

| キー | 型 | 内容 |
|---|---|---|
| `edition` | `"full"` か `"demo"` | `approvals` に行があれば `"full"`。アプリは、`"full"` 以外（欠けている場合を含む）をすべてデモ版として扱う。 |
| `charactersVersion` | 文字列か `null` | 完全版の画像の版。画像を差し替えたら変える。アプリは、この値が変わったときだけ画像を取り直す。`[A-Za-z0-9._-]` で1〜64文字。デモ版には `null` を返す。完全版でも、まだ一度も公開していなければ `null`。 |

例: `{ "restrictions": …, "daily": …, "history": …, "stage": 3, "flowers": 2, "edition": "full", "charactersVersion": "2026-11-23T06.30.12.345Z" }`

### `GET /characters/{key}`（新規）

完全版の画像を1枚返す。

- 完全版のアカウント: `200`、`Content-Type: image/png`、本文は PNG。2MB 以下。`Cache-Control: private, no-store`。
- デモ版のアカウント: `403`（`{ "error": "demo_edition" }`）。
- 知らない `key`: `404`。画像がまだ置かれていないときも `404`。

`key` は次の10個。アプリの `src-tauri/src/characters.rs` の `KEYS`、このリポジトリの `src/server/edition.ts` の `CHARACTER_KEYS` と同じ。

| key | 中身 | 元のファイル（kumamorun-tauri の履歴） |
|---|---|---|
| `stage0` 〜 `stage5` | 成長段階 0〜5 | `src/assets/evo/01.png` 〜 `06.png` |
| `dandelion` | 開花: たんぽぽ | `src/assets/evo/07.png` |
| `peony` | 開花: ぼたん | `src/assets/evo/08.png` |
| `blueSpiderLily` | 開花: 青い彼岸花 | `src/assets/evo/09.png` |
| `nightCherry` | 開花: 夜桜 | `src/assets/evo/11.png` |

元のファイルは kumamorun-tauri から消した。取り出すときは、そのリポジトリで `git show 6416af5:src/assets/evo/01.png > 01.png` のように、消す前のコミットから出す。

### `POST /evolve` の変更

デモ版のアカウントには `403`（`{ "error": "demo_edition" }`）を返し、段階と花を変えない。アプリはデモ版では呼ばないが、サーバーでも止める。

### 変えないもの

`PUT /settings`（スタート制限の保存）は、デモ版でも受け付ける。アプリはデモ版では送らない。完全版に戻ったときに、設定が残っているようにするため。

## 画像の置き場所

**このリポジトリは PUBLIC なので、画像をリポジトリに入れない。**

Workers KV に置く（R2 は Cloudflare のアカウントに支払い情報が要るため、無料のままの KV にした）。
KV のキーは `characters:<key>`（PNG の base64）と、公開中の版の `characters-version`。公開の URL は持たず、Worker の `GET /characters/{key}` だけが読み出す。

置くのは管理者が `/admin` から行う（下の「承認の画面」）。置いただけでは配らず、10枚そろえて「公開」したときに `characters-version` が変わる。取りかけの組を配らないため。

KV は書いてから世界中に届くまで最大60秒ほどかかる。公開の直後に同期した端末が、まだ届いていない画像を取りに行くと `404` になることがある。置いてから1分ほど待って公開すれば当たらない。

## 承認の画面（サイト、`/admin`）

- 管理者だけが開ける。管理者は環境変数 `ADMINS`（`env.ts`）に、account_id か確認済みのメールアドレスをカンマで区切って並べる。管理者でなければ `404`。メニューに「管理」が出る。
- アカウントの一覧（名前、メール、種類、登録日、版）。「承認する」で `approvals` に行を足し、「取り消す」で消す。
- キャラクターの画像: 10枚の置き場所。PNG を選んで置き、そろったら「公開」する。
- 利用者向けの状況ページ（`/`）には、完全版か、デモ版なら「承認を待っています」を出す。親が子供の状況を見るときは、その子供の版を出す。申し込みは「お問い合わせ」（`/contact`）から受ける。

承認すると、アプリは次の同期（最大10分後。アカウント画面を開けばすぐ）で完全版になり、画像を受け取る。
取り消すと、次の同期でデモ版に戻り、受け取った画像を端末から消す。

### 管理の API

サイトのセッション（Cookie）で、管理者だけ。

| メソッドと経路 | 内容 |
|---|---|
| `PUT /api/admin/approvals/:id` | 承認する。`204`。アカウントがなければ `404` |
| `DELETE /api/admin/approvals/:id` | 承認を取り消す。`204` |
| `PUT /api/admin/characters/:key` | 画像を置く。本文は PNG のバイト列。PNG でなければ `415`、2MB を超えると `413` |
| `GET /api/admin/characters/:key` | 置いた画像を返す（確かめ用） |
| `POST /api/admin/publish-characters` | 公開する（版を変える）。`{ version }`。10枚そろっていなければ `409`（`{ error: "incomplete", missing }`） |

## サイトの動き（実装済み）

- 版の判定とKV の読み書き: `src/server/edition.ts`。管理者の判定と一覧: `src/server/admin.ts`。
- `/sync` と `/import` の応答: `src/server/account-data.ts` の `readSync`。
- 試験: `scripts/smoke-api.sh`（「デモ版と完全版」と「管理」。管理は `ADMINS=… vp dev` と `ADMIN_EMAIL=…` を渡したときだけ流れる）。

## 公開の手順

**サイトを先に出す。** アプリは `edition` が欠けているとデモ版として扱うので、アプリを先に出すと、既存の利用者が一時的にデモ版になる。

1. サイト: Worker の設定に `ADMINS` を入れてから、main に出す（デプロイで `approvals` のマイグレーションと既存アカウントの移行が流れ、KV が作られる）。
2. `/admin` で10枚の画像を置き、1分ほど待ってから「公開」する。
3. 確かめる: 既存のアカウントで `GET /sync` が `"edition": "full"` と版を返し、`GET /characters/stage0` が PNG を返す。新しいアカウントでは `"demo"` と `403`。
4. アプリ: 新しい版を出す。
5. 既存の利用者が更新すると、最初の同期まではシルエットで、同期の後に画像が出る。

## 守れないもの

- 2.6.5 までのインストーラーと、kumamorun-tauri の git の履歴には、完全版の画像が入っている。消せないので、これまでに配った分は守れない。守れるのは、これから先に広がる分。
- 旧 Electron 版のリポジトリ（同じ `kumamorun-app` の `electron` ブランチ）にも画像が入っている。
- アプリのアイコン（`src-tauri/icons/`）はキャラクターの小さな絵。インストーラーとタスクバーに出るので、外せない。
- 承認された端末には画像が置かれる。承認した人が取り出すことは防げない。
