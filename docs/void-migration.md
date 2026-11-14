# Void + Cloudflare + D1 への移行計画

別エージェントが Void のプロジェクト（サイトと API）を作るための計画書。判断の理由は [ADR 0002](../adr/0002-void-d1-replaces-firebase.md)、用語は [GLOSSARY.md](../../GLOSSARY.md)（アカウント、端末、ライブ状況）に従う。

## 分担

| 担当 | 範囲 |
|---|---|
| 別エージェント（新しいリポジトリ） | 段階 0、1、状況ページ |
| このリポジトリ（kumamorun-tauri） | 段階 2、3、5 |
| 共同 | 段階 4（切り替え日） |

アプリとサイトの約束は、この文書の「API」と「スキーマ」。変えるときは、両方のリポジトリで同時に直す。

## 決定の一覧

- 構成: Void（Cloudflare Workers）+ D1。サイト、認証、アプリ向け API、状況ページを1つのプロジェクトに置く。
- 認証: Google（OAuth）とパスキーだけ。パスワードは使わない。Void の Better Auth を使う。登録は Google で行い、パスキーはログインした後に設定から足す。メールの6桁のコード（`emailOTP`）は開発のときだけ有効で、Google の設定がなくてもローカルでログインと試験ができるようにしている。本番でメールのコードを使うには独自のドメインと送信元（`email.from`）が要るので、無料で済むよう見送った（`src/server/otp-mail.ts` の `EMAIL_CODE_ENABLED` で戻せる）。
- ディープリンク: サイトが短時間だけ有効な使い捨てコードを `kumamorun://auth?code=…` で渡す。アプリが API で端末のトークンに交換する。トークンは URL に載せない。
- 端末のトークン: 端末ごとに発行し、サイトの画面から失効できる。アプリは Rust 側で OS の資格情報ストアに保管し、WebView には渡さない。
- 切断の検知: ハートビート。アプリは20秒ごとにライブ状況を書く。サイトは最後の書き込みから60秒を超えたら停止とみなす。正常終了とログアウトでは、アプリが明示的にオフラインを書く。必要になれば後から Durable Objects で1秒級にする。
- 表示: 状況ページは10秒ポーリング。
- 進化: ルール（成長か開花か）は Rust が決める。サーバーは不変条件の検査と、段階と花の原子的な書き込みだけを行う。
- 同期: WebView ではなく Rust の HTTP クライアントが行う。
- オフライン: 記録、進化の保留、設定は Rust 側のキューにため、つながったら順に送る。ライブ状況は最新の1件だけを送る。進化はキューにためず、つながってから判定し直す。
- 環境: 開発はローカルの `void dev`（ローカルの D1）だけ。デプロイするのは本番の1つ。アプリの開発ビルドは `http://localhost` の API につなぐ。OAuth の戻り先には、本番とローカルの両方を登録する。
- アカウントの種類: 大人、親、子供の3つ（`members`）。大人は今までどおり全部を自分で持つ。子供はアプリを使い、花でショップの品を買う。スタート制限は子供（アプリ）が自分で変える。親は自分ではアプリを使わず、家族の子供の状況を見て、ショップの品と購入の通知先を決める。親も子供も複数でよく、`family_id` でまとめる。種類は最初のログインで `/welcome` から選び、あとから変えない（種類ができる前からのアカウントも、次のログインで選ぶ）。アプリ向け API は種類を見ない（端末のアカウントのデータを読み書きするだけ）。
- 子供のログイン: Google を持つ子供は、親の招待コードで家族に入る。持たない子供は、親が「家族」で作り（`/api/auth/family/add-child`、仮のメールアドレス `…@children.kumamorun.invalid`）、親が発行したログインリンク（`/child-login#code=…`、30分、一度だけ）でサイトに入る。そのあとパスキーを足せば、自分でログインできる。アプリには、親が子供のパソコンで `/link` から子供を選んでログインさせる。親が子供として「ログインさせる」（サイトのログインリンク、アプリのログインコード）のは、親が作った子供だけ。自分の Google で登録した子供は自分でログインし、親はなりすませない。どちらも Void が出していない「ほかのユーザーのセッションを作る」処理なので、Better Auth の自作プラグイン（`src/server/family-auth.ts`）で行う。
- 移行: 二重書き込みなし。利用者は数人。新しい版の初回ログインで、端末のローカルデータを自動で取り込む。最後の Firebase 版には書き出し機能（保険）を足す。

## スキーマ（D1）

認証のテーブル（ユーザー、セッション、パスキー、OAuth など）は Void が作る。以下は私たちが足す分。`account_id` は Void が持つユーザーの ID を指す。

```sql
-- 端末ごとのトークン。トークンそのものではなくハッシュを保存する。
CREATE TABLE devices (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  name        TEXT NOT NULL,            -- 例: "DESKTOP-ABC"
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at  INTEGER                   -- 失効したら入る
);

-- ディープリンクの使い捨てコード。短時間で失効し、一度しか使えない。
CREATE TABLE login_codes (
  code_hash   TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);

-- スタート制限。形の検証はアプリ（Rust）が行うので JSON のまま持つ。
CREATE TABLE settings (
  account_id        TEXT PRIMARY KEY,
  restrictions_json TEXT NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- 当日の記録と直近7日の履歴。日付ごとの行。
CREATE TABLE daily (
  account_id TEXT NOT NULL,
  date       TEXT NOT NULL,             -- "YYYY-MM-DD"
  plays      INTEGER NOT NULL,
  failures   INTEGER NOT NULL,
  PRIMARY KEY (account_id, date)
);

-- 進化段階（0〜5）と花の数。
CREATE TABLE progress (
  account_id TEXT PRIMARY KEY,
  stage      INTEGER NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 5),
  flowers    INTEGER NOT NULL DEFAULT 0 CHECK (flowers >= 0),
  updated_at INTEGER NOT NULL
);

-- ライブ状況。アカウントにつき1行。
CREATE TABLE live_status (
  account_id TEXT PRIMARY KEY,
  app_running INTEGER NOT NULL,
  body_json   TEXT NOT NULL,            -- 下の「ライブ状況の形」
  updated_at  INTEGER NOT NULL          -- サーバーが入れる時刻
);

-- ショップ（サイトだけが使う）。品 [{ id, name, price }] と通知先の宛先。行がなければ既定の品。
CREATE TABLE shop (
  account_id         TEXT PRIMARY KEY,
  items_json         TEXT NOT NULL,
  notify_emails_json TEXT NOT NULL,
  updated_at         INTEGER NOT NULL
);

-- アカウントの種類（サイトだけが使う）。行がなければ、まだ選んでいない。大人だけが家族を持たない。
CREATE TABLE members (
  account_id TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('adult', 'parent', 'child')),
  family_id  TEXT,                       -- 親と子供は必ず持つ
  created_at INTEGER NOT NULL,
  CHECK ((kind = 'adult') = (family_id IS NULL))
);

-- 家族への招待コード（「ABCD-EFGH」）。親が発行し、24時間で失効し、一度しか使えない。
CREATE TABLE family_invites (
  code_hash  TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('parent', 'child')),
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

-- 親が作った子供のログインリンクのコード。30分で失効し、一度しか使えない。
CREATE TABLE child_sign_in_codes (
  code_hash  TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

-- 試した回数の上限。Better Auth の外の経路（招待コードの入力）に使う。reset_at を過ぎたら数え直す。
CREATE TABLE rate_limits (
  key      TEXT PRIMARY KEY,             -- 例: "invite:account:<ID>"、"invite:ip:<IP>"
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- 購入の記録。品の名前と値段は購入時の写し。
-- handed_at は品を本人に渡した時刻（まだなら NULL）。大人は自分で、子供の品は親が付ける。
-- handed_by はチェックした人の user.id（親が複数いても、誰が渡したかわかる）。
CREATE TABLE purchases (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  item_name    TEXT NOT NULL,
  price        INTEGER NOT NULL CHECK (price >= 1),
  purchased_at INTEGER NOT NULL,
  handed_at    INTEGER,
  handed_by    TEXT
);

-- アカウントの写真（サイトだけが使う）。画面で 256px の正方形に縮めてから送る。data は base64。
-- 置くと user.image が /api/avatars/<account_id>?v=<updated_at> になる。消すと user.image は NULL。
CREATE TABLE avatars (
  account_id   TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,            -- image/webp | image/jpeg | image/png
  data         TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);
```

### ショップと花

旧 `happa0827/kumamorun`（Next.js、「くまもーるん交換所」）のショップは、このサイトの `/shop` に入った。花を使って品を買う。

- 購入は `progress.flowers` を減らす。花が増えるのはアプリの開花（`/evolve`）、減るのはサイトの購入だけ。
- **アプリへの約束**: 花の数は、サーバーの値を正とする。`/sync` と `/evolve` の応答（409 の `current` を含む）の `flowers` で、手元の値を上書きする。手元で花を数え直して送ることはしない（その API もない）。
- 購入は花の減算と記録の追加を1つのトランザクションで書く。花が足りなければ `CHECK (flowers >= 0)` で取り消す。
- 購入の通知メールは Gmail API で送る（`src/server/gmail.ts`。本番には送信元のドメインがないため）。Google ログインの OAuth クライアントに、`gmail.send` のスコープで取ったリフレッシュトークン `GMAIL_REFRESH_TOKEN` と送信元 `GMAIL_SENDER` を足すと有効になる。そろっていなければ、開発のときだけ Void のローカルの受け箱に送る。

### ライブ状況の形

今の `liveStatus` のキーを引き継ぐ。`body_json` に入れる。

```
keeping, phase, label, remainingSec, startedAt, duration, running,
startBlocked, blockReason, daily, week
```

`phase` は `lunch | play | break | paused | reward | finished | ended | idle | offline`。`appRunning` と停止の判定は、`app_running` と `updated_at` から**サーバーが**決める（`now - updated_at > 60秒` なら停止）。

## API

すべて `/api/app/v1/…`。認証は `Authorization: Bearer <端末のトークン>`（`/exchange` を除く）。時刻はサーバーの時刻を正とする。

| メソッドと経路 | 内容 |
|---|---|
| `POST /exchange` | `{ code, deviceName }` を受け、`{ token }` を返す。コードは一度しか使えず、5分で失効する。 |
| `POST /logout` | この端末のトークンを失効する。`204`。 |
| `GET /sync` | 設定、直近7日の記録、進化段階、花の数をまとめて返す。下記。 |
| `PUT /settings` | `{ restrictions }` を保存する（後勝ち）。`204`。 |
| `PUT /days` | `{ daily, history }` を保存する。日付ごとに後勝ちで書き、新しい7日より古い行は消す。`204`。 |
| `POST /evolve` | `{ expectedStage, nextStage, flowersToAdd }`。下記。 |
| `PUT /live-status` | ライブ状況を書く。`updated_at` はサーバーが入れる。`{ serverTime }` を返す。 |
| `POST /live-status/offline` | 正常終了とログアウトで、オフラインを明示する。最後の本文は残し、`phase` だけ `offline` にする。`204`。 |
| `POST /import` | 初回ログインで、ローカルのデータを取り込む。下記。 |

### 形

時刻は Unix ミリ秒。日付は端末のローカル日付の `"YYYY-MM-DD"`。

```ts
type Daily   = { date: string; plays: number; failures: number };          // 回数は 0 以上の整数
type History = Record<string, { plays: number; failures: number }>;        // キーは日付

// GET /sync、POST /import の応答
{ restrictions: object | null, daily: Daily | null, history: History,
  stage: number, flowers: number, serverTime: number }
// daily は保存されている最新の日付の記録。history は新しい順に最大7日。

// PUT /days
{ daily: Daily | null, history: History }   // 同じ日付は daily を優先する

// POST /import
{ daily: Daily | null, history: History, stage: 0..5, flowers: number, restrictions: object | null }
```

- `restrictions` の中身は今の `{ weekday: { lunchStart, lunchEnd, endTime }, weekend: {…} }`。サーバーはオブジェクトであることと、大きさ（8KB 以下）だけを見る。
- `PUT /live-status` の本文は「ライブ状況の形」のキーをすべて持つ。`appRunning` と `updatedAt` は送らない（来ても捨てる）。`phase: "offline"` を送ると停止として書く。
- `/import` は、進化、設定、記録のどれもない空のアカウントにだけ書く。空でなければ `409`（`{ error: "not_empty" }`）。旧版の `evolution = 6` は、アプリが `5` に丸めてから送る。
- 子供のアカウントでは、`/import` の `flowers` を取り込まず `0` にする（段階、設定、記録は取り込む）。端末のデータは書き換えられ、子供は花でショップの品（親が決めた現実のごほうび）を買えるため。応答の `flowers` が正なので、アプリは今までどおり上書きすればよい。
- 種類を選ぶ前のアカウントには、子供の制限がかからない。そのため、招待コードで子供として入ったときに `progress.flowers` を `0` にする（段階は残す）。アプリは次の `/sync` で `0` を受け取る。

### 進化

サーバーは現在の `stage` が `expectedStage` と一致するときだけ、次の不変条件を確かめ、段階と花を**1つのトランザクション**で書く。行がなければ、段階 0、花 0 から始める。

- 成長: `nextStage = expectedStage + 1`、`flowersToAdd = 0`
- 開花: `expectedStage = 5`、`nextStage = 0`、`flowersToAdd = 1`、または夜桜（`'11'`）なら `2`。どの花が咲くかはアプリが決める。

成功すると `{ stage, flowers }` を返す。一致しなければ `409` で `{ error: "conflict", current: { stage, flowers } }` を返す。アプリは、読み直して判定し直す。

子供のアカウントは、1日（日本時間）に1回だけ進化できる（`progress.evolved_on`）。同じ日の2回目は `409` で `{ error: "already_evolved_today", current }` を返し、段階も花も変えない。アプリは日付が変わったときに前の日を評価して1回だけ進化するので、ふつうは当たらない。当たったら `current` で上書きし、再送しない。大人は確かめない。

### エラー

| 状態 | 意味 | アプリの動き |
|---|---|---|
| `401` | トークンが無効、または失効 | 再ログインを促す |
| `409` | 比較書き込みの衝突 | 読み直して判定し直す |
| `422` | 不変条件の違反、形が不正 | 再試行しない。ログに残す |
| `429`、`5xx` | 混雑、障害 | 間隔を延ばして再試行する |

## 段階

### 段階 0: 検証（別エージェント）

小さな Void プロジェクトで次を確かめ、本実装に進むかを決める。

- [x] `void init` から `void deploy` まで通り、D1 が作られる（Worker `kumamorun-project`、D1 `kumamorun-project-db`）
- [x] メールとパスワードでの登録とログイン（その後、パスワードをやめてメールのコードに替えた。ローカルの受け箱で、送信、ログイン、間違いと使い回しの拒否まで確認）
- [ ] OAuth（Google など）でのログイン。ローカルと本番の戻り先を登録できる
- [ ] パスキーでの登録とログイン（`@better-auth/passkey` を `auth.ts` に配線済み。サーバーが登録とログインの情報を返すところまで確認。ブラウザでの実際の登録とログインは未確認）
- [x] ディープリンクの使い捨てコード交換（`/exchange`）が成立する
- [x] `batch()` による、段階と花を1つにした更新が原子的に動く（途中の文が失敗すると、前の文も取り消される）

結果は報告し、**パスキーの扱い**と、Void のまま進めるかを決める。使えなければ Next.js + Vercel + Neon に切り替える（ADR 0002）。

### 段階 1: サイト、認証、D1、API（別エージェント）

- 上のスキーマとマイグレーション
- 認証画面（登録、ログイン、パスキー、OAuth）
- 端末の一覧と失効の画面
- ディープリンクの発行（ログイン後に「アプリを開く」）
- 上の API のすべて
- 状況ページ（ライブ状況を10秒ごとに取得して表示）。下記。

#### サイトの経路

| 経路 | 内容 |
|---|---|
| `/` | ログインしていれば状況ページ（親は子供の状況）、していなければログイン（Google とパスキー。登録は Google。開発のときだけメールのコードも出る）。`?next=` でログイン後の移動先を渡す |
| `/settings` | アカウント（名前の変更）、端末の一覧と失効、パスキーの登録と削除、ログアウト |
| `/link` | アプリの「ログイン」から開く。ログイン後に「アプリを開く」で `kumamorun://auth?code=…` を渡す |
| `GET /api/status` | 状況ページが10秒ごとに読む。`{ appRunning, updatedAt, serverTime, status }`。親は `?account=<子供の ID>` |
| `/welcome` | アカウントの種類を選ぶ（大人、親として家族を作る、招待コードで家族に入る）。招待コードは、入る前に「誰の家族に、親か子供として」を見せて確かめる（`/api/account/invite-preview`。入るときと同じ回数の上限）。種類のないアカウントは、どのページからもここへ移る |
| `/family` | 親だけ。子供の一覧と追加、子供のログインリンク、子供の端末の失効、招待コード、親の一覧 |
| `/child-login` | 子供のログインリンク。`#code=…` を `/api/auth/family/child-sign-in` で使い、子供としてログインする |

親は、`/`、`/shop`、`/link` で `?child=<ID>` を付けて子供を選ぶ。API は `?account=<ID>` で子供を指す（`/api/status`、`/api/login-code`、`/api/shop/items`、`/api/shop/notify-emails`）。ショップの品と通知先を変えられるのは大人（自分）と親（子供）、買えるのは大人と子供（自分の花）。子供が家族に入ると、通知先に招いた親のメールアドレスが入る。親の画面では、通知先を家族の親からチェックで選べ、親以外の宛先（祖父母など）も手で足せる（合わせて5件まで）。招待コードを試せるのは、1時間にアカウントごと10回、IP ごと30回まで（超えると `429`）。`?next=` の移動先は、URL として解釈して同じサイトの経路だけを通す（`src/safe-next.ts`。`/\evil.com` のような形を通さない）。

#### 状況ページの表示

今の `status-kumamorun`（`../status-kumamorun`、Next.js + Firebase）の `components/live-status-view.tsx` を引き継ぐ。

- 帯: 停止なら「アプリ停止」、`keeping` なら「守れている」、そうでなければ「守れていない」
- 残り: `phase = paused` なら `remainingSec`、それ以外は `startedAt + duration` から毎秒数え直す。停止中は `--:--`
- 状態（`label`）、当日の失敗数、最終更新（何秒前）
- 直近1週間の表（日付、遊び、失敗、成功）。`week` をそのまま出す

### 段階 2: アプリの Rust 同期とディープリンク（このリポジトリ）

- `kumamorun://auth` のディープリンクを受ける（`tauri-plugin-deep-link`）
- トークンを OS の資格情報ストアに保管する
- Rust の HTTP クライアントで `/sync`、`/settings`、`/days`、`/evolve`、`/live-status` を呼ぶ
- 書き込みのキューと、間隔を延ばす再試行
- 初回ログインで、ローカルのデータを `/import` で取り込む
- WebView の Firebase 関連（`src/cloud/cloud.ts`、`sync.ts`）を外し、`firebase` を依存から外す
- 開発ビルドは `http://localhost` の API につなぐ

### 段階 3: 最後の Firebase 版（このリポジトリ）

- データの書き出し機能（保険）を足して配布する
- 切り替え日をアプリとサイトで案内する。「それまでに、最新版を一度起動してください」

### 段階 4: 切り替え日（共同）

1. Void のサイトと API を本番に出す。
2. 新しいアプリ版を配布する。
3. 利用者が新しく登録し、初回ログインでローカルのデータを取り込む。
4. 旧版は、Firebase に書けなくなっても、ローカルのタイマーは動き続ける。

### 段階 5: 後片付け（このリポジトリ）

- Firebase を読み取り専用にし、取り込みの確認後に削除する
- Electron 版（`kumamorun-app`）の整理
- `docs/acceptance.md`、`README.md` の Firebase の記述を直す

## 受け入れ条件

- 強制終了から60秒以内に、状況ページが停止になる
- 正常終了とログアウトでは、すぐにオフラインになる
- 進化は、二重にも欠落にもならない。段階と花は常に同時に変わる
- ネットワークを切って記録を重ねても、つながった後に失われない
- 端末の失効後、その端末の API 呼び出しは `401` になる
- 開発ビルドが、本番のデータに触れない
- トレイ常駐中も、ライブ状況が20秒ごとに届く（Windows 実機、release ビルド）

## 未決

- パスキーの、ブラウザでの登録とログイン（本番のドメインを含む）。
- Google の OAuth。クライアント ID とシークレット、戻り先 `/api/auth/callback/google`（ローカルと本番）の登録。
- 本番は Google の設定が済むまで、誰も新しく登録できない（ログイン画面に注意が出る）。
- 本番でメールのコードも使う場合（今は見送り）: Cloudflare に置いた独自のドメインで `void.config.ts` の `email.from` を決め、`void email setup --platform cloudflare` のあと `void.lock.json` をコミットし、CI の deploy に `--require-email` を足す。Workers Free は確認済みの宛先にしか送れない。
