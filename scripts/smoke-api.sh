#!/usr/bin/env bash
# アプリ向け API の通し確認。ローカルの void dev に対して流す（本番には向けない）。
#   BASE=http://localhost:5173 bash scripts/smoke-api.sh
# 毎回、新しいアカウントを作る。期待と違う行には NG が付き、最後に件数を出す。
set -u
B=${BASE:-http://localhost:5173}
case "$B" in http://localhost*|http://127.0.0.1*) ;; *) echo "ローカルだけで使ってください: $B" >&2; exit 2 ;; esac
JAR=$(mktemp); trap 'rm -f "$JAR"' EXIT
EMAIL="smoke-$(date +%s%N)@example.com"
H=(-H 'Content-Type: application/json' -H "Origin: $B")
FAIL=0

# expect <期待する状態> <説明> curl の引数…
expect() {
  local want=$1 what=$2; shift 2
  local out code
  out=$(curl -s -w '\n%{http_code}' "$@"); code=${out##*$'\n'}; BODY=${out%$'\n'*}
  if [ "$code" = "$want" ]; then echo "ok  $code $what"; else echo "NG  $code（期待 $want） $what: ${BODY:0:200}"; FAIL=$((FAIL+1)); fi
}
api() { local m=$1 p=$2; shift 2; curl -s "${H[@]}" -H "Authorization: Bearer $TOKEN" -X "$m" "$B/api/app/v1$p" "$@"; }
eapi() { local want=$1 what=$2 m=$3 p=$4; shift 4; expect "$want" "$what" "${H[@]}" -H "Authorization: Bearer $TOKEN" -X "$m" "$B/api/app/v1$p" "$@"; }
check() { if jq -e "$2" <<<"$BODY" >/dev/null; then echo "ok      $1"; else echo "NG      $1: ${BODY:0:300}"; FAIL=$((FAIL+1)); fi; }
# signup <クッキーの入れ物> <メールアドレス>  メールのコードで新しいアカウントを作り、ログインする（種類はまだない）
signup() {
  local jar=$1 email=$2 otp=""
  curl -s -o /dev/null -X DELETE "${INBOX[@]}"
  curl -s -o /dev/null "${H[@]}" -X POST "$B/api/auth/email-otp/send-verification-otp" -d "{\"email\":\"$email\",\"type\":\"sign-in\"}"
  for _ in 1 2 3 4 5; do otp=$(curl -s "${INBOX[@]}" | grep -oE 'ログインコード: [0-9]{6}' | head -1 | grep -oE '[0-9]{6}'); [ -n "$otp" ] && break; sleep 0.5; done
  expect 200 "$email で登録" -c "$jar" -b "$jar" "${H[@]}" -X POST "$B/api/auth/sign-in/email-otp" -d "{\"email\":\"$email\",\"otp\":\"$otp\"}"
}

# 招待コードを試した回数は IP ごとにも数える。ローカルの void dev も cf-connecting-ip（127.0.0.1）を付けるので、
# 1時間のうちに何度も流すと前の回の分が残って上限に届く。毎回、ローカルの D1 の IP の分を消してから始める。
vp exec void db execute "DELETE FROM rate_limits WHERE key LIKE 'invite:ip:%'" >/dev/null 2>&1 \
  || { echo "rate_limits を消せません（vp exec void db execute）" >&2; exit 2; }

echo "== 認証（メールのコード。初めてのアドレスなので、そのまま登録になる）"
# コードは void dev の受け箱から読む。受け箱は HTML の一覧しかないので、送る前に空にする。
DEV_TOKEN=$(<"$(dirname "$0")/../.void/dev-trigger-token")
INBOX=(-H "x-void-dev-trigger: $DEV_TOKEN" "$B/__void/inbox")
curl -s -o /dev/null -X DELETE "${INBOX[@]}"
expect 200 "コードの送信" "${H[@]}" -X POST "$B/api/auth/email-otp/send-verification-otp" -d "{\"email\":\"$EMAIL\",\"type\":\"sign-in\"}"
OTP=""; for _ in 1 2 3 4 5; do OTP=$(curl -s "${INBOX[@]}" | grep -oE 'ログインコード: [0-9]{6}' | head -1 | grep -oE '[0-9]{6}'); [ -n "$OTP" ] && break; sleep 0.5; done
if [ -n "$OTP" ]; then echo "ok      受け箱にコードが届いた"; else echo "NG      受け箱にコードが届かない"; FAIL=$((FAIL+1)); fi
WRONG=$([ "$OTP" = "000000" ] && echo 111111 || echo 000000)
expect 400 "間違ったコード" "${H[@]}" -X POST "$B/api/auth/sign-in/email-otp" -d "{\"email\":\"$EMAIL\",\"otp\":\"$WRONG\"}"
expect 200 "コードでログイン（登録）" -c "$JAR" -b "$JAR" "${H[@]}" -X POST "$B/api/auth/sign-in/email-otp" -d "{\"email\":\"$EMAIL\",\"otp\":\"$OTP\"}"
expect 400 "使ったコードの使い回し" "${H[@]}" -X POST "$B/api/auth/sign-in/email-otp" -d "{\"email\":\"$EMAIL\",\"otp\":\"$OTP\"}"
expect 400 "パスワードでの登録は無効" "${H[@]}" -X POST "$B/api/auth/sign-up/email" -d "{\"email\":\"pw-$EMAIL\",\"password\":\"password-123\",\"name\":\"smoke\"}"
expect 401 "ログインなしのコード発行" "${H[@]}" -X POST "$B/api/login-code"

echo "== アカウントの種類（このアカウントは大人）"
expect 403 "種類を選ぶ前のコード発行" -b "$JAR" "${H[@]}" -X POST "$B/api/login-code"
check "kind_required" '.error == "kind_required"'
expect 302 "種類を選ぶ前の状況ページは /welcome へ" -b "$JAR" "$B/"
expect 422 "不明な種類" -b "$JAR" "${H[@]}" -X POST "$B/api/account/kind" -d '{"kind":"child"}'
expect 400 "不明な招待コード" -b "$JAR" "${H[@]}" -X POST "$B/api/account/kind" -d '{"inviteCode":"AAAA-AAAA"}'
expect 200 "大人を選ぶ" -b "$JAR" "${H[@]}" -X POST "$B/api/account/kind" -d '{"kind":"adult"}'
expect 409 "選び直しはできない" -b "$JAR" "${H[@]}" -X POST "$B/api/account/kind" -d '{"kind":"parent"}'
expect 302 "選んだ後の /welcome は移動先へ" -b "$JAR" "$B/welcome"
echo "-- 移動先（?next=）はサイトの中だけ"
location() { curl -s -o /dev/null -D - -b "$JAR" "$B$1" | tr -d '\r' | grep -i '^location:' | cut -d' ' -f2-; }
for bad in '/%5Cevil.com' '//evil.com' '/%09/evil.com' 'https://evil.com' '/%5C%5Cevil.com'; do
  got=$(location "/welcome?next=$bad")
  if [ "$got" = "/" ]; then echo "ok      next=$bad は / へ"; else echo "NG      next=$bad が「$got」へ"; FAIL=$((FAIL+1)); fi
done
got=$(location "/welcome?next=/shop%3Fchild%3Dx")
if [ "$got" = "/shop?child=x" ]; then echo "ok      next=/shop?child=x はそのまま"; else echo "NG      next=/shop?child=x が「$got」へ"; FAIL=$((FAIL+1)); fi

echo "== ディープリンクのコード交換"
expect 200 "コード発行" -b "$JAR" "${H[@]}" -X POST "$B/api/login-code"
CODE=$(jq -r .url <<<"$BODY" | sed 's/.*code=//')
expect 200 "交換" "${H[@]}" -X POST "$B/api/app/v1/exchange" -d "{\"code\":\"$CODE\",\"deviceName\":\"SMOKE-PC\"}"
TOKEN=$(jq -r .token <<<"$BODY")
expect 401 "同じコードの2回目" "${H[@]}" -X POST "$B/api/app/v1/exchange" -d "{\"code\":\"$CODE\",\"deviceName\":\"SMOKE-PC\"}"
expect 422 "形が不正な交換" "${H[@]}" -X POST "$B/api/app/v1/exchange" -d '{"code":""}'

echo "== 取り込みと同期"
eapi 200 "空のアカウントの同期" GET /sync
check "初期値" '.restrictions == null and .daily == null and .history == {} and .stage == 0 and .flowers == 0'
IMPORT='{"daily":{"date":"2026-11-08","plays":3,"failures":1},"history":{"2026-11-01":{"plays":9,"failures":9},"2026-11-02":{"plays":1,"failures":0},"2026-11-03":{"plays":1,"failures":0},"2026-11-04":{"plays":1,"failures":0},"2026-11-05":{"plays":1,"failures":0},"2026-11-06":{"plays":1,"failures":0},"2026-11-07":{"plays":2,"failures":0},"2026-11-08":{"plays":0,"failures":0}},"stage":4,"flowers":7,"restrictions":{"weekday":{"lunchStart":"12:00","lunchEnd":"13:00","endTime":"22:00"}}}'
eapi 422 "段階 6 の取り込み" POST /import -d "$(jq -c '.stage = 6' <<<"$IMPORT")"
eapi 200 "取り込み" POST /import -d "$IMPORT"
check "取り込んだ値（daily が history より優先、8日目は捨てる）" '.stage == 4 and .flowers == 7 and .daily == {"date":"2026-11-08","plays":3,"failures":1} and (.history | length) == 7 and .history["2026-11-01"] == null and .restrictions.weekday.endTime == "22:00"'
eapi 409 "2回目の取り込み" POST /import -d "$IMPORT"

echo "== 設定と記録"
eapi 204 "設定の保存" PUT /settings -d '{"restrictions":{"weekday":{"endTime":"21:00"}}}'
eapi 422 "配列の設定" PUT /settings -d '{"restrictions":[1]}'
eapi 204 "記録の保存（翌日）" PUT /days -d '{"daily":{"date":"2026-11-09","plays":1,"failures":0},"history":{"2026-11-08":{"plays":5,"failures":1}}}'
eapi 422 "日付の形が不正" PUT /days -d '{"daily":{"date":"11/09","plays":1,"failures":0},"history":{}}'
eapi 422 "負の回数" PUT /days -d '{"daily":null,"history":{"2026-11-09":{"plays":-1,"failures":0}}}'
eapi 200 "同期" GET /sync
check "設定と記録が反映、古い日は消える" '.restrictions == {"weekday":{"endTime":"21:00"}} and .daily.date == "2026-11-09" and .history["2026-11-08"].plays == 5 and (.history | length) == 7 and .history["2026-11-02"] == null'

echo "== 進化"
eapi 200 "成長 4→5" POST /evolve -d '{"expectedStage":4,"nextStage":5,"flowersToAdd":0}'
eapi 200 "開花（夜桜で +2）" POST /evolve -d '{"expectedStage":5,"nextStage":0,"flowersToAdd":2}'
check "段階 0、花 9" '.stage == 0 and .flowers == 9'
eapi 409 "同じ開花の再送" POST /evolve -d '{"expectedStage":5,"nextStage":0,"flowersToAdd":1}'
check "今の値が添えられる" '.current == {"stage":0,"flowers":9}'
eapi 422 "段階を飛ばす" POST /evolve -d '{"expectedStage":0,"nextStage":2,"flowersToAdd":0}'
eapi 422 "開花で +3" POST /evolve -d '{"expectedStage":5,"nextStage":0,"flowersToAdd":3}'
echo "-- 同時に10回の成長（成功は1回だけ）"
RESULTS=$(for i in $(seq 10); do curl -s -o /dev/null -w '%{http_code}\n' "${H[@]}" -H "Authorization: Bearer $TOKEN" -X POST "$B/api/app/v1/evolve" -d '{"expectedStage":0,"nextStage":1,"flowersToAdd":0}' & done; wait)
OK=$(grep -c '^200$' <<<"$RESULTS"); CONFLICT=$(grep -c '^409$' <<<"$RESULTS")
if [ "$OK" = 1 ] && [ "$CONFLICT" = 9 ]; then echo "ok      200 が1回、409 が9回"; else echo "NG      200 が $OK 回、409 が $CONFLICT 回"; FAIL=$((FAIL+1)); fi

echo "== ライブ状況"
LIVE='{"keeping":true,"phase":"play","label":"遊び","remainingSec":600,"startedAt":1794100000000,"duration":900,"running":true,"startBlocked":false,"blockReason":null,"daily":{"date":"2026-11-09","plays":1,"failures":0},"week":[{"date":"2026-11-09","plays":1,"failures":0,"success":true}]}'
expect 200 "書く前の状況" -b "$JAR" "$B/api/status"
check "停止" '.appRunning == false and .status == null'
eapi 200 "ライブ状況を書く" PUT /live-status -d "$LIVE"
eapi 422 "phase が不正" PUT /live-status -d "$(jq -c '.phase = "dancing"' <<<"$LIVE")"
eapi 422 "キーが足りない" PUT /live-status -d '{"phase":"play"}'
expect 200 "サイトから読む" -b "$JAR" "$B/api/status"
check "動作中、本文がそのまま" '.appRunning == true and .status.phase == "play" and .status.label == "遊び" and (.updatedAt | type) == "number"'
eapi 204 "オフラインを明示" POST /live-status/offline
expect 200 "サイトから読む" -b "$JAR" "$B/api/status"
check "すぐに停止、本文は残る" '.appRunning == false and .status.phase == "offline" and .status.label == "遊び"'
expect 401 "ログインなしの状況" "$B/api/status"

echo "== ショップ（花 9 から）"
S=(-b "$JAR" "${H[@]}")
expect 200 "ショップの画面" -b "$JAR" "$B/shop"
expect 401 "ログインなしの購入" "${H[@]}" -X POST "$B/api/shop/purchase" -d '{"itemId":"default-1","expectedPrice":2}'
expect 422 "値段 0 の品" "${S[@]}" -X PUT "$B/api/shop/items" -d '{"items":[{"id":"a","name":"無料","price":0}]}'
expect 422 "6つの品" "${S[@]}" -X PUT "$B/api/shop/items" -d "{\"items\":$(jq -nc '[range(6) | {id: "i\(.)", name: "品", price: 1}]')}"
expect 422 "同じ ID の品" "${S[@]}" -X PUT "$B/api/shop/items" -d '{"items":[{"id":"a","name":"x","price":1},{"id":"a","name":"y","price":1}]}'
expect 200 "品の保存" "${S[@]}" -X PUT "$B/api/shop/items" -d '{"items":[{"id":"a","name":"テスト","price":4},{"id":"b","name":"高い品","price":50}]}'
expect 404 "ない品" "${S[@]}" -X POST "$B/api/shop/purchase" -d '{"itemId":"default-1","expectedPrice":2}'
expect 409 "値段が変わった" "${S[@]}" -X POST "$B/api/shop/purchase" -d '{"itemId":"a","expectedPrice":3}'
check "price_changed と今の花" '.error == "price_changed" and .flowers == 9'
expect 409 "花が足りない" "${S[@]}" -X POST "$B/api/shop/purchase" -d '{"itemId":"b","expectedPrice":50}'
check "insufficient" '.error == "insufficient" and .flowers == 9'
expect 422 "不正な通知先" "${S[@]}" -X PUT "$B/api/shop/notify-emails" -d '{"emails":["not-an-email"]}'
expect 200 "通知先の保存" "${S[@]}" -X PUT "$B/api/shop/notify-emails" -d '{"emails":["parent@example.com"]}'
curl -s -o /dev/null -X DELETE "${INBOX[@]}"
expect 200 "購入" "${S[@]}" -X POST "$B/api/shop/purchase" -d '{"itemId":"a","expectedPrice":4}'
check "花 5、記録、通知" '.flowers == 5 and .purchase.itemName == "テスト" and .purchase.price == 4 and .notified == true'
if curl -s "${INBOX[@]}" | grep -q '購入通知'; then echo "ok      受け箱に購入通知が届いた"; else echo "NG      受け箱に購入通知が届かない"; FAIL=$((FAIL+1)); fi
echo "-- 同時に5回の購入（花 5、値段 4。成功は1回だけ）"
RESULTS=$(for i in $(seq 5); do curl -s -o /dev/null -w '%{http_code}\n' "${S[@]}" -X POST "$B/api/shop/purchase" -d '{"itemId":"a","expectedPrice":4}' & done; wait)
OK=$(grep -c '^200$' <<<"$RESULTS"); CONFLICT=$(grep -c '^409$' <<<"$RESULTS")
if [ "$OK" = 1 ] && [ "$CONFLICT" = 4 ]; then echo "ok      200 が1回、409 が4回"; else echo "NG      200 が $OK 回、409 が $CONFLICT 回"; FAIL=$((FAIL+1)); fi
eapi 200 "アプリの同期にも反映" GET /sync
check "花 1" '.flowers == 1'
expect 200 "品を既定に戻す" "${S[@]}" -X DELETE "$B/api/shop/items"
check "既定の4つ" '(.items | length) == 4 and .items[0].name == "チョコパイ"'
if [ "$(curl -s -b "$JAR" "$B/shop" | grep -o 'テスト' | wc -l)" -ge 2 ]; then echo "ok      画面に購入の記録が出る"; else echo "NG      画面に購入の記録が出ない"; FAIL=$((FAIL+1)); fi

echo "== 端末の失効"
expect 200 "2台目のコード" -b "$JAR" "${H[@]}" -X POST "$B/api/login-code"
CODE2=$(jq -r .url <<<"$BODY" | sed 's/.*code=//')
expect 200 "2台目の交換" "${H[@]}" -X POST "$B/api/app/v1/exchange" -d "{\"code\":\"$CODE2\",\"deviceName\":\"SMOKE-LAPTOP\"}"
TOKEN2=$(jq -r .token <<<"$BODY")
DEVICE2=$(curl -s -b "$JAR" "$B/settings" | grep -o 'data-device-id="[^"]*" data-device-name="SMOKE-LAPTOP"' | cut -d'"' -f2)
if [ -n "$DEVICE2" ]; then
  expect 204 "サイトから失効" -b "$JAR" "${H[@]}" -X DELETE "$B/api/devices/$DEVICE2"
  expect 404 "2回目の失効" -b "$JAR" "${H[@]}" -X DELETE "$B/api/devices/$DEVICE2"
  expect 401 "失効した端末" -H "Authorization: Bearer $TOKEN2" "$B/api/app/v1/sync"
  expect 200 "失効していない端末" -H "Authorization: Bearer $TOKEN" "$B/api/app/v1/sync"
else
  echo "NG      端末の一覧から ID を読めない"; FAIL=$((FAIL+1))
fi

echo "== 家族（親、親が作った子供、招待で入った子供と親）"
PJAR=$(mktemp); CJAR=$(mktemp); GJAR=$(mktemp); QJAR=$(mktemp); XJAR=$(mktemp)
trap 'rm -f "$JAR" "$PJAR" "$CJAR" "$GJAR" "$QJAR" "$XJAR"' EXIT
signup "$PJAR" "parent-$EMAIL"
expect 200 "親を選ぶ（家族を作る）" -b "$PJAR" "${H[@]}" -X POST "$B/api/account/kind" -d '{"kind":"parent"}'
expect 403 "大人は子供を作れない" -b "$JAR" "${H[@]}" -X POST "$B/api/auth/family/add-child" -d '{"name":"x"}'
expect 200 "親が子供を作る" -b "$PJAR" "${H[@]}" -X POST "$B/api/auth/family/add-child" -d '{"name":"たろう"}'
CHILD=$(jq -r .id <<<"$BODY")
expect 200 "家族の画面" -b "$PJAR" "$B/family"
expect 302 "大人は家族の画面に入れない" -b "$JAR" "$B/family"
expect 403 "親は自分のコードを発行しない" -b "$PJAR" "${H[@]}" -X POST "$B/api/login-code"
expect 200 "親が子供のアプリのコードを発行" -b "$PJAR" "${H[@]}" -X POST "$B/api/login-code?account=$CHILD"
CCODE=$(jq -r .url <<<"$BODY" | sed 's/.*code=//')
expect 200 "子供の端末の交換" "${H[@]}" -X POST "$B/api/app/v1/exchange" -d "{\"code\":\"$CCODE\",\"deviceName\":\"CHILD-PC\"}"
CTOKEN=$(jq -r .token <<<"$BODY")
expect 200 "子供のアプリで取り込み（花 6）" "${H[@]}" -H "Authorization: Bearer $CTOKEN" -X POST "$B/api/app/v1/import" -d "$(jq -c '.flowers = 6' <<<"$IMPORT")"
expect 200 "子供のアプリの同期" "${H[@]}" -H "Authorization: Bearer $CTOKEN" -X GET "$B/api/app/v1/sync"
expect 204 "子供のアプリから設定を変える" "${H[@]}" -H "Authorization: Bearer $CTOKEN" -X PUT "$B/api/app/v1/settings" -d '{"restrictions":{"weekday":{"endTime":"20:00"}}}'
expect 200 "親が子供の状況を読む" -b "$PJAR" "$B/api/status?account=$CHILD"
expect 403 "親は子供を指定しないと読めない" -b "$PJAR" "$B/api/status"
expect 403 "大人は他人の状況を読めない" -b "$JAR" "$B/api/status?account=$CHILD"
expect 200 "親が子供の状況ページを開く" -b "$PJAR" "$B/?child=$CHILD"
expect 200 "親が子供の品を決める" -b "$PJAR" "${H[@]}" -X PUT "$B/api/shop/items?account=$CHILD" -d '{"items":[{"id":"c","name":"アイス","price":2}]}'
expect 403 "大人は他人の品を変えられない" -b "$JAR" "${H[@]}" -X PUT "$B/api/shop/items?account=$CHILD" -d '{"items":[]}'
expect 403 "親は買えない" -b "$PJAR" "${H[@]}" -X POST "$B/api/shop/purchase" -d '{"itemId":"c","expectedPrice":2}'
expect 200 "親が子供のショップを開く" -b "$PJAR" "$B/shop?child=$CHILD"
expect 200 "子供のログインリンク" -b "$PJAR" "${H[@]}" -X POST "$B/api/family/children/$CHILD/sign-in-link"
LCODE=$(jq -r .url <<<"$BODY" | sed 's/.*code=//')
expect 404 "大人の ID のログインリンクは作れない" -b "$PJAR" "${H[@]}" -X POST "$B/api/family/children/$(curl -s -b "$JAR" "$B/api/auth/get-session" | jq -r .user.id)/sign-in-link"
expect 200 "子供がリンクでログイン" -c "$CJAR" -b "$CJAR" "${H[@]}" -X POST "$B/api/auth/family/child-sign-in" -d "{\"code\":\"$LCODE\"}"
expect 401 "リンクの使い回し" "${H[@]}" -X POST "$B/api/auth/family/child-sign-in" -d "{\"code\":\"$LCODE\"}"
expect 200 "子供のセッション" -b "$CJAR" "$B/api/auth/get-session"
check "子供としてログインしている" ".user.id == \"$CHILD\""
expect 200 "子供が自分の状況を読む" -b "$CJAR" "$B/api/status"
check "アプリの書き込みが見える前でも読める" '.appRunning == false'
expect 403 "子供は品を変えられない" -b "$CJAR" "${H[@]}" -X PUT "$B/api/shop/items" -d '{"items":[]}'
expect 403 "子供は通知先を変えられない" -b "$CJAR" "${H[@]}" -X PUT "$B/api/shop/notify-emails" -d '{"emails":[]}'
curl -s -o /dev/null -X DELETE "${INBOX[@]}"
expect 200 "子供が買う" -b "$CJAR" "${H[@]}" -X POST "$B/api/shop/purchase" -d '{"itemId":"c","expectedPrice":2}'
check "花 4、親に通知" '.flowers == 4 and .notified == true'
if curl -s "${INBOX[@]}" | grep -q "parent-$EMAIL"; then echo "ok      親の宛先に購入通知が届いた"; else echo "NG      親の宛先に購入通知が届かない"; FAIL=$((FAIL+1)); fi
expect 200 "子供がアプリのコードを発行" -b "$CJAR" "${H[@]}" -X POST "$B/api/login-code"
expect 403 "子供は招待コードを作れない" -b "$CJAR" "${H[@]}" -X POST "$B/api/family/invites" -d '{"kind":"child"}'
echo "-- 招待コード"
expect 200 "子供の招待コード" -b "$PJAR" "${H[@]}" -X POST "$B/api/family/invites" -d '{"kind":"child"}'
INVITE=$(jq -r .code <<<"$BODY")
signup "$GJAR" "google-child-$EMAIL"
expect 200 "招待コードで子供になる（小文字と記号なしでも通る）" -b "$GJAR" "${H[@]}" -X POST "$B/api/account/kind" -d "{\"inviteCode\":\"$(tr -d '-' <<<"$INVITE" | tr 'A-Z' 'a-z')\"}"
check "子供" '.kind == "child"'
signup "$XJAR" "late-$EMAIL"
expect 400 "使った招待コードの使い回し" -b "$XJAR" "${H[@]}" -X POST "$B/api/account/kind" -d "{\"inviteCode\":\"$INVITE\"}"
GID=$(curl -s -b "$GJAR" "$B/api/auth/get-session" | jq -r .user.id)
expect 200 "親の招待コード" -b "$PJAR" "${H[@]}" -X POST "$B/api/family/invites" -d '{"kind":"parent"}'
PINVITE=$(jq -r .code <<<"$BODY")
echo "-- 招待コードを試せるのは1時間に10回（アカウントごと。late は使い回しで1回試した）"
# 本番の Cloudflare が付ける IP のヘッダーを1回だけ付け、アカウントと IP の両方を数える経路も通す
expect 400 "IP 付きの試し（2回目）" -b "$XJAR" "${H[@]}" -H "cf-connecting-ip: 203.0.113.$((RANDOM % 250))" -X POST "$B/api/account/kind" -d '{"inviteCode":"ZZZZ-ZZZZ"}'
RESULTS=$(for i in $(seq 8); do curl -s -o /dev/null -w '%{http_code}\n' -b "$XJAR" "${H[@]}" -X POST "$B/api/account/kind" -d '{"inviteCode":"ZZZZ-ZZZZ"}'; done)
if [ "$(grep -c '^400$' <<<"$RESULTS")" = 8 ]; then echo "ok      10回目までは 400"; else echo "NG      10回目までに 400 以外: $(tr '\n' ' ' <<<"$RESULTS")"; FAIL=$((FAIL+1)); fi
expect 429 "11回目は正しいコードでも止まる" -b "$XJAR" "${H[@]}" -X POST "$B/api/account/kind" -d "{\"inviteCode\":\"$PINVITE\"}"
check "too_many_attempts" '.error == "too_many_attempts"'
expect 200 "止められた試しはコードを使わない（late はまだ種類なし）" -b "$XJAR" "$B/api/auth/get-session"
expect 302 "late は /welcome のまま" -b "$XJAR" "$B/"
signup "$QJAR" "parent2-$EMAIL"
expect 200 "招待コードで2人目の親になる" -b "$QJAR" "${H[@]}" -X POST "$B/api/account/kind" -d "{\"inviteCode\":\"$PINVITE\"}"
check "親" '.kind == "parent"'
expect 200 "2人目の親も子供の状況を読める" -b "$QJAR" "$B/api/status?account=$GID"
expect 200 "2人目の親も、親が作った子供を読める" -b "$QJAR" "$B/api/status?account=$CHILD"
expect 403 "子供はきょうだいの状況を読めない" -b "$CJAR" "$B/api/status?account=$GID"

echo "== 種類ができる前からの利用者（端末あり）が親を選ぶ"
LJAR=$(mktemp); trap 'rm -f "$JAR" "$PJAR" "$CJAR" "$GJAR" "$QJAR" "$XJAR" "$LJAR"' EXIT
signup "$LJAR" "legacy-$EMAIL"
curl -s -o /dev/null -b "$LJAR" "${H[@]}" -X POST "$B/api/account/kind" -d '{"kind":"adult"}'
LCODE=$(curl -s -b "$LJAR" "${H[@]}" -X POST "$B/api/login-code" | jq -r .url | sed 's/.*code=//')
LTOKEN=$(curl -s "${H[@]}" -X POST "$B/api/app/v1/exchange" -d "{\"code\":\"$LCODE\",\"deviceName\":\"OLD-PC\"}" | jq -r .token)
LID=$(curl -s -b "$LJAR" "$B/api/auth/get-session" | jq -r .user.id)
# 端末を持ったまま「種類ができる前」に戻す（ローカルの D1 だけ）
vp exec void db execute "DELETE FROM members WHERE account_id = '$LID'" >/dev/null 2>&1
expect 200 "親を選ぶ" -b "$LJAR" "${H[@]}" -X POST "$B/api/account/kind" -d '{"kind":"parent"}'
expect 200 "前からの端末は同期できる" -H "Authorization: Bearer $LTOKEN" "$B/api/app/v1/sync"
expect 200 "親の設定" -b "$LJAR" "$B/settings"
if grep -q '親のアカウントのまま' <<<"$BODY"; then echo "ok      親の設定に、残った端末の注意が出る"; else echo "NG      親の設定に、残った端末の注意が出ない"; FAIL=$((FAIL+1)); fi
LDEV=$(grep -o 'data-device-id="[^"]*" data-device-name="OLD-PC"' <<<"$BODY" | cut -d'"' -f2)
expect 204 "親の設定から失効" -b "$LJAR" "${H[@]}" -X DELETE "$B/api/devices/$LDEV"
expect 401 "失効した端末" -H "Authorization: Bearer $LTOKEN" "$B/api/app/v1/sync"

echo "== ログアウト"
eapi 204 "ログアウト" POST /logout
eapi 401 "ログアウト後" GET /sync

echo
if [ "$FAIL" = 0 ]; then echo "すべて通りました"; else echo "NG が $FAIL 件"; exit 1; fi
