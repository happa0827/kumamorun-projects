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
# ショップのページ（BODY）の props にある通知先（"notifyEmails":[…]）
notify_emails() { grep -oE '"notifyEmails":\[[^]]*\]' <<<"$BODY" | head -1; }
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
# 後ろの4つは、URL の解釈で . と .. がたたまれて //evil.com になる形（/%252e は、サーバーには /%2e で届く）
for bad in '/%5Cevil.com' '//evil.com' '/%09/evil.com' 'https://evil.com' '/%5C%5Cevil.com' \
  '/.//evil.com' '/..//evil.com' '/%252e//evil.com' '/./%5Cevil.com'; do
  got=$(location "/welcome?next=$bad")
  if [ "$got" = "/" ]; then echo "ok      next=$bad は / へ"; else echo "NG      next=$bad が「$got」へ"; FAIL=$((FAIL+1)); fi
done
got=$(location "/welcome?next=/shop%3Fchild%3Dx")
if [ "$got" = "/shop?child=x" ]; then echo "ok      next=/shop?child=x はそのまま"; else echo "NG      next=/shop?child=x が「$got」へ"; FAIL=$((FAIL+1)); fi
# ログインしていないと、ログイン画面へ移す。選んでいた子供（?child=）も、移動先に残す
got=$(curl -s -o /dev/null -D - "$B/shop?child=abc" | tr -d '\r' | grep -i '^location:' | cut -d' ' -f2-)
if [ "$got" = "/?next=%2Fshop%3Fchild%3Dabc" ]; then echo "ok      ログインなしの /shop?child=abc は、?child= を残してログイン画面へ"; else echo "NG      ログインなしの /shop?child=abc が「$got」へ"; FAIL=$((FAIL+1)); fi
# /welcome も、ログイン画面へ移す。ログインのあとに /welcome から元の移動先へ進めるよう、next を残す
got=$(curl -s -o /dev/null -D - "$B/welcome?next=/shop" | tr -d '\r' | grep -i '^location:' | cut -d' ' -f2-)
if [ "$got" = "/?next=%2Fwelcome%3Fnext%3D%252Fshop" ]; then echo "ok      ログインなしの /welcome?next=/shop は、next を残してログイン画面へ"; else echo "NG      ログインなしの /welcome?next=/shop が「$got」へ"; FAIL=$((FAIL+1)); fi

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
PJAR=$(mktemp); CJAR=$(mktemp); GJAR=$(mktemp); QJAR=$(mktemp); XJAR=$(mktemp); AJAR=$(mktemp); NJAR=$(mktemp); FJAR=$(mktemp); YJAR=$(mktemp)
trap 'rm -f "$JAR" "$PJAR" "$CJAR" "$GJAR" "$QJAR" "$XJAR" "$AJAR" "$NJAR" "$FJAR" "$YJAR"' EXIT
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
expect 200 "子供のアプリで取り込み（花 1000000 を送る）" "${H[@]}" -H "Authorization: Bearer $CTOKEN" -X POST "$B/api/app/v1/import" -d "$(jq -c '.flowers = 1000000' <<<"$IMPORT")"
check "子供の花は取り込まない（0）。段階は取り込む" '.flowers == 0 and .stage == 4'
expect 200 "子供の成長 4→5（今日の1回目）" "${H[@]}" -H "Authorization: Bearer $CTOKEN" -X POST "$B/api/app/v1/evolve" -d '{"expectedStage":4,"nextStage":5,"flowersToAdd":0}'
expect 409 "子供の開花（今日の2回目）" "${H[@]}" -H "Authorization: Bearer $CTOKEN" -X POST "$B/api/app/v1/evolve" -d '{"expectedStage":5,"nextStage":0,"flowersToAdd":2}'
check "already_evolved_today と今の値（変わらない）" '.error == "already_evolved_today" and .current == {"stage":5,"flowers":0}'
expect 409 "子供の、段階の合わない進化はふつうの conflict" "${H[@]}" -H "Authorization: Bearer $CTOKEN" -X POST "$B/api/app/v1/evolve" -d '{"expectedStage":4,"nextStage":5,"flowersToAdd":0}'
check "conflict" '.error == "conflict" and .current.stage == 5'
# 前の日に進化した扱いにすると、また進化できる（ローカルの D1 だけ）。そのあと、買う試験のために花を 6 にする
vp exec void db execute "UPDATE progress SET evolved_on = '2000-01-01' WHERE account_id = '$CHILD'" >/dev/null 2>&1
expect 200 "次の日の子供の開花（夜桜で +2）" "${H[@]}" -H "Authorization: Bearer $CTOKEN" -X POST "$B/api/app/v1/evolve" -d '{"expectedStage":5,"nextStage":0,"flowersToAdd":2}'
check "段階 0、花 2" '.stage == 0 and .flowers == 2'
vp exec void db execute "UPDATE progress SET flowers = 6 WHERE account_id = '$CHILD'" >/dev/null 2>&1
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
if grep -qE "\"parents\":\[[^]]*\"email\":\"parent-$EMAIL\"" <<<"$BODY"; then echo "ok      家族の親が通知先の候補に出る"; else echo "NG      家族の親が通知先の候補に出ない"; FAIL=$((FAIL+1)); fi
if grep -q "parent-$EMAIL" <<<"$(notify_emails)"; then echo "ok      作った親が通知先に入っている"; else echo "NG      作った親が通知先にない: $(notify_emails)"; FAIL=$((FAIL+1)); fi
expect 200 "親が親以外の宛先も足す" -b "$PJAR" "${H[@]}" -X PUT "$B/api/shop/notify-emails?account=$CHILD" -d "{\"emails\":[\"parent-$EMAIL\",\"grandma@example.com\"]}"
check "親と親以外の宛先" ".emails == [\"parent-$EMAIL\",\"grandma@example.com\"]"
expect 200 "親を外して親以外だけにする" -b "$PJAR" "${H[@]}" -X PUT "$B/api/shop/notify-emails?account=$CHILD" -d '{"emails":["grandma@example.com"]}'
check "親以外だけ" '.emails == ["grandma@example.com"]'
# あとの購入通知の確認のために、親の宛先に戻す
expect 200 "通知先を親に戻す" -b "$PJAR" "${H[@]}" -X PUT "$B/api/shop/notify-emails?account=$CHILD" -d "{\"emails\":[\"parent-$EMAIL\"]}"
expect 200 "子供のログインリンク（1本目）" -b "$PJAR" "${H[@]}" -X POST "$B/api/family/children/$CHILD/sign-in-link"
OLDLCODE=$(jq -r .url <<<"$BODY" | sed 's/.*code=//')
expect 200 "子供のログインリンク（2本目）" -b "$PJAR" "${H[@]}" -X POST "$B/api/family/children/$CHILD/sign-in-link"
LCODE=$(jq -r .url <<<"$BODY" | sed 's/.*code=//')
expect 404 "大人の ID のログインリンクは作れない" -b "$PJAR" "${H[@]}" -X POST "$B/api/family/children/$(curl -s -b "$JAR" "$B/api/auth/get-session" | jq -r .user.id)/sign-in-link"
expect 401 "新しいリンクを発行すると、前のリンクは使えない" "${H[@]}" -X POST "$B/api/auth/family/child-sign-in" -d "{\"code\":\"$OLDLCODE\"}"
echo "-- リンクを開いただけではログインしない。誰としてログインするかを見せて押させる"
expect 200 "ログインせずにリンクを確かめる" "${H[@]}" -X POST "$B/api/child-login/preview" -d "{\"code\":\"$LCODE\"}"
check "子供の名前と発行した親、今はログインなし" ".child.name == \"たろう\" and .issuer.email == \"parent-$EMAIL\" and .current == null and (has(\"childId\") | not)"
expect 200 "大人でログイン中にリンクを確かめる" -b "$JAR" "${H[@]}" -X POST "$B/api/child-login/preview" -d "{\"code\":\"$LCODE\"}"
check "今のアカウント（大人）から切り替わると分かる" ".current.email == \"$EMAIL\" and .current.same == false"
expect 200 "確かめたあとも大人のまま" -b "$JAR" "$B/api/auth/get-session"
check "大人のセッション" ".user.email == \"$EMAIL\""
expect 400 "前のリンクは確かめられない" "${H[@]}" -X POST "$B/api/child-login/preview" -d "{\"code\":\"$OLDLCODE\"}"
expect 200 "子供がリンクでログイン（確かめてもコードは使われない）" -c "$CJAR" -b "$CJAR" "${H[@]}" -X POST "$B/api/auth/family/child-sign-in" -d "{\"code\":\"$LCODE\"}"
expect 401 "リンクの使い回し" "${H[@]}" -X POST "$B/api/auth/family/child-sign-in" -d "{\"code\":\"$LCODE\"}"
expect 200 "子供のセッション" -b "$CJAR" "$B/api/auth/get-session"
check "子供としてログインしている" ".user.id == \"$CHILD\""
# パスキーの登録で OS に出す名前。画面は name に端末の目安（Windows など）を渡す
expect 200 "子供のパスキーの登録の情報" -b "$CJAR" "${H[@]}" "$B/api/auth/passkey/generate-register-options?name=Windows"
check "名前で出る（仮のアドレスと端末の目安は出ない）" '.user.name == "たろう" and .user.displayName == "たろう" and (.challenge | length) > 0 and (tostring | test("invalid") | not)'
expect 200 "大人のパスキーの登録の情報" -b "$JAR" "${H[@]}" "$B/api/auth/passkey/generate-register-options?name=Windows"
check "メールアドレスで出る" ".user.name == \"$EMAIL\" and .user.displayName == \"$EMAIL\""
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
expect 200 "入る前に招待コードを確かめる" -b "$GJAR" "${H[@]}" -X POST "$B/api/account/invite-preview" -d "{\"inviteCode\":\"$INVITE\"}"
check "子供として、招いた親のアドレスが見える" ".kind == \"child\" and .inviter.email == \"parent-$EMAIL\" and (.parents | length) == 1"
expect 400 "違うコードの確かめ" -b "$GJAR" "${H[@]}" -X POST "$B/api/account/invite-preview" -d '{"inviteCode":"ZZZZ-ZZZZ"}'
expect 200 "招待コードで子供になる（確かめてもコードは使われない。小文字と記号なしでも通る）" -b "$GJAR" "${H[@]}" -X POST "$B/api/account/kind" -d "{\"inviteCode\":\"$(tr -d '-' <<<"$INVITE" | tr 'A-Z' 'a-z')\"}"
check "子供" '.kind == "child"'
expect 409 "入ったあとの確かめ" -b "$GJAR" "${H[@]}" -X POST "$B/api/account/invite-preview" -d "{\"inviteCode\":\"$INVITE\"}"
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
echo "-- 親は、自分の Google で登録した子供になりすませない"
expect 404 "Google の子供のログインリンクは作れない" -b "$PJAR" "${H[@]}" -X POST "$B/api/family/children/$GID/sign-in-link"
expect 403 "Google の子供のアプリのコードも作れない" -b "$PJAR" "${H[@]}" -X POST "$B/api/login-code?account=$GID"
echo "-- 親が子供の端末を失効する"
expect 200 "Google の子供が自分でアプリのコードを発行" -b "$GJAR" "${H[@]}" -X POST "$B/api/login-code"
GCODE=$(jq -r .url <<<"$BODY" | sed 's/.*code=//')
expect 200 "Google の子供の端末の交換" "${H[@]}" -X POST "$B/api/app/v1/exchange" -d "{\"code\":\"$GCODE\",\"deviceName\":\"GOOGLE-CHILD-PC\"}"
GTOKEN=$(jq -r .token <<<"$BODY")
expect 200 "家族の画面に子供の端末が出る" -b "$PJAR" "$B/family"
CDEV=$(grep -o 'data-device-id="[^"]*" data-device-name="CHILD-PC"' <<<"$BODY" | cut -d'"' -f2)
GDEV=$(grep -o 'data-device-id="[^"]*" data-device-name="GOOGLE-CHILD-PC"' <<<"$BODY" | cut -d'"' -f2)
if [ -n "$CDEV" ] && [ -n "$GDEV" ]; then echo "ok      両方の子供の端末が出る"; else echo "NG      子供の端末が出ない（CHILD-PC=$CDEV GOOGLE-CHILD-PC=$GDEV）"; FAIL=$((FAIL+1)); fi
expect 404 "大人は子供の端末を失効できない" -b "$JAR" "${H[@]}" -X DELETE "$B/api/devices/$CDEV"
expect 404 "子供はきょうだいの端末を失効できない" -b "$GJAR" "${H[@]}" -X DELETE "$B/api/devices/$CDEV"
expect 200 "失効の前は同期できる" -H "Authorization: Bearer $CTOKEN" "$B/api/app/v1/sync"
expect 204 "親が、親が作った子供の端末を失効" -b "$PJAR" "${H[@]}" -X DELETE "$B/api/devices/$CDEV"
expect 401 "失効した子供の端末" -H "Authorization: Bearer $CTOKEN" "$B/api/app/v1/sync"
expect 204 "2人目の親が、Google の子供の端末を失効" -b "$QJAR" "${H[@]}" -X DELETE "$B/api/devices/$GDEV"
expect 401 "失効した Google の子供の端末" -H "Authorization: Bearer $GTOKEN" "$B/api/app/v1/sync"
echo "-- ログインリンクがほかの人に開かれたとき、親が子供をすべての端末からログアウトさせる"
expect 403 "ほかのサイトからのリンクでのログイン（Cookie なし）" -H 'Content-Type: application/json' -H 'Origin: https://evil.example' -X POST "$B/api/auth/family/child-sign-in" -d '{"code":"x"}'
expect 200 "子供のログインリンク（漏れる）" -b "$PJAR" "${H[@]}" -X POST "$B/api/family/children/$CHILD/sign-in-link"
ALCODE=$(jq -r .url <<<"$BODY" | sed 's/.*code=//')
expect 200 "ほかの人がリンクで先にログイン" -c "$AJAR" -b "$AJAR" "${H[@]}" -X POST "$B/api/auth/family/child-sign-in" -d "{\"code\":\"$ALCODE\"}"
expect 200 "入った人がアプリの端末を作る" -b "$AJAR" "${H[@]}" -X POST "$B/api/login-code"
ACODE=$(jq -r .url <<<"$BODY" | sed 's/.*code=//')
ATOKEN=$(curl -s "${H[@]}" -X POST "$B/api/app/v1/exchange" -d "{\"code\":\"$ACODE\",\"deviceName\":\"INTRUDER-PC\"}" | jq -r .token)
expect 200 "入った人が、まだ使っていないアプリのコードも持つ" -b "$AJAR" "${H[@]}" -X POST "$B/api/login-code"
ACODE2=$(jq -r .url <<<"$BODY" | sed 's/.*code=//')
expect 200 "入った人のリンク（まだ使っていない）" -b "$PJAR" "${H[@]}" -X POST "$B/api/family/children/$CHILD/sign-in-link"
ALCODE2=$(jq -r .url <<<"$BODY" | sed 's/.*code=//')
# パスキーは curl では登録できないので、ローカルの D1 に行だけ入れる
vp exec void db execute "INSERT INTO passkey (id, publicKey, userId, credentialID, counter, deviceType, backedUp) VALUES ('smoke-$CHILD', 'x', '$CHILD', 'smoke-cred-$CHILD', 0, 'singleDevice', 0)" >/dev/null 2>&1
# passkeys <ID>  ローカルの D1 で、そのユーザーのパスキーの数
passkeys() { vp exec void db execute "SELECT count(*) AS n FROM passkey WHERE userId = '$1'" 2>/dev/null | grep -xE '[0-9]+'; }
if [ "$(passkeys "$CHILD")" = 1 ]; then echo "ok      子供のパスキーがある（ログアウトの前）"; else echo "NG      子供のパスキーを入れられない"; FAIL=$((FAIL+1)); fi
expect 404 "大人は子供をログアウトさせられない" -b "$JAR" "${H[@]}" -X POST "$B/api/auth/family/sign-out-child" -d "{\"childId\":\"$CHILD\"}"
expect 404 "子供は自分でこの経路を使えない" -b "$CJAR" "${H[@]}" -X POST "$B/api/auth/family/sign-out-child" -d "{\"childId\":\"$CHILD\"}"
expect 404 "Google の子供はログアウトさせられない" -b "$PJAR" "${H[@]}" -X POST "$B/api/auth/family/sign-out-child" -d "{\"childId\":\"$GID\"}"
expect 200 "2人目の親が子供をすべての端末からログアウト" -b "$QJAR" "${H[@]}" -X POST "$B/api/auth/family/sign-out-child" -d "{\"childId\":\"$CHILD\"}"
expect 200 "入った人のセッション" -b "$AJAR" "$B/api/auth/get-session"
check "入った人はログアウトしている" '. == null'
expect 200 "子供のセッション" -b "$CJAR" "$B/api/auth/get-session"
check "子供もログアウトしている" '. == null'
expect 401 "入った人のアプリの端末" -H "Authorization: Bearer $ATOKEN" "$B/api/app/v1/sync"
expect 401 "入った人のアプリのコード" "${H[@]}" -X POST "$B/api/app/v1/exchange" -d "{\"code\":\"$ACODE2\",\"deviceName\":\"INTRUDER-2\"}"
expect 401 "まだ使っていないログインリンク" "${H[@]}" -X POST "$B/api/auth/family/child-sign-in" -d "{\"code\":\"$ALCODE2\"}"
if [ "$(passkeys "$CHILD")" = 0 ]; then echo "ok      子供のパスキーが消えた"; else echo "NG      子供のパスキーが残っている"; FAIL=$((FAIL+1)); fi
expect 200 "Google の子供のセッションはそのまま" -b "$GJAR" "$B/api/auth/get-session"
check "Google の子供" ".user.id == \"$GID\""
expect 200 "新しいリンク" -b "$PJAR" "${H[@]}" -X POST "$B/api/family/children/$CHILD/sign-in-link"
NLCODE=$(jq -r .url <<<"$BODY" | sed 's/.*code=//')
expect 200 "子供は新しいリンクでログインし直せる" -c "$CJAR" -b "$CJAR" "${H[@]}" -X POST "$B/api/auth/family/child-sign-in" -d "{\"code\":\"$NLCODE\"}"
echo "-- 前から使っていた人が招待で子供になると、通知先は残り、花は 0 になる"
signup "$NJAR" "notify-$EMAIL"
curl -s -o /dev/null -b "$NJAR" "${H[@]}" -X POST "$B/api/account/kind" -d '{"kind":"adult"}'
expect 200 "大人のときの通知先" -b "$NJAR" "${H[@]}" -X PUT "$B/api/shop/notify-emails" -d '{"emails":["own-choice@example.com"]}'
NID=$(curl -s -b "$NJAR" "$B/api/auth/get-session" | jq -r .user.id)
NCODE=$(curl -s -b "$NJAR" "${H[@]}" -X POST "$B/api/login-code" | jq -r .url | sed 's/.*code=//')
NTOKEN=$(curl -s "${H[@]}" -X POST "$B/api/app/v1/exchange" -d "{\"code\":\"$NCODE\",\"deviceName\":\"NOTIFY-PC\"}" | jq -r .token)
# 「種類ができる前」の利用者に戻す（ローカルの D1 だけ）
vp exec void db execute "DELETE FROM members WHERE account_id = '$NID'" >/dev/null 2>&1
# 種類のないあいだは子供の制限がかからないので、端末のトークンで同じ日に何度も進化して花を増やす
for st in 0 1 2 3 4; do curl -s -o /dev/null "${H[@]}" -H "Authorization: Bearer $NTOKEN" -X POST "$B/api/app/v1/evolve" -d "{\"expectedStage\":$st,\"nextStage\":$((st+1)),\"flowersToAdd\":0}"; done
curl -s -o /dev/null "${H[@]}" -H "Authorization: Bearer $NTOKEN" -X POST "$B/api/app/v1/evolve" -d '{"expectedStage":5,"nextStage":0,"flowersToAdd":2}'
for st in 0 1 2; do curl -s -o /dev/null "${H[@]}" -H "Authorization: Bearer $NTOKEN" -X POST "$B/api/app/v1/evolve" -d "{\"expectedStage\":$st,\"nextStage\":$((st+1)),\"flowersToAdd\":0}"; done
expect 200 "種類のないあいだに増やした花" -H "Authorization: Bearer $NTOKEN" "$B/api/app/v1/sync"
check "段階 3、花 2" '.stage == 3 and .flowers == 2'
NINVITE=$(curl -s -b "$PJAR" "${H[@]}" -X POST "$B/api/family/invites" -d '{"kind":"child"}' | jq -r .code)
expect 200 "招待コードで子供になる" -b "$NJAR" "${H[@]}" -X POST "$B/api/account/kind" -d "{\"inviteCode\":\"$NINVITE\"}"
expect 200 "親が子供のショップを開く" -b "$PJAR" "$B/shop?child=$NID"
# 親のアドレスは通知先の候補（parents）としてページに出るので、props の notifyEmails だけを見る
got=$(notify_emails)
if grep -q 'own-choice@example.com' <<<"$got" && ! grep -q "parent-$EMAIL" <<<"$got"; then echo "ok      決めていた通知先が残る"; else echo "NG      通知先が上書きされた: $got"; FAIL=$((FAIL+1)); fi
expect 200 "子供になったあとの同期" -H "Authorization: Bearer $NTOKEN" "$B/api/app/v1/sync"
check "花は 0、段階は残る" '.stage == 3 and .flowers == 0'
expect 409 "子供になったら、同じ日にはもう進化できない（入る前の進化と同じ日）" "${H[@]}" -H "Authorization: Bearer $NTOKEN" -X POST "$B/api/app/v1/evolve" -d '{"expectedStage":3,"nextStage":4,"flowersToAdd":0}'
check "already_evolved_today" '.error == "already_evolved_today"'
echo "-- 子供は1つの家族に20人まで（親が作る子供と、招待で入る子供を合わせて）"
signup "$FJAR" "full-$EMAIL"
curl -s -o /dev/null -b "$FJAR" "${H[@]}" -X POST "$B/api/account/kind" -d '{"kind":"parent"}'
FINVITE=$(curl -s -b "$FJAR" "${H[@]}" -X POST "$B/api/family/invites" -d '{"kind":"child"}' | jq -r .code)
RESULTS=$(for i in $(seq 20); do curl -s -o /dev/null -w '%{http_code}\n' -b "$FJAR" "${H[@]}" -X POST "$B/api/auth/family/add-child" -d "{\"name\":\"子$i\"}"; done)
if [ "$(grep -c '^200$' <<<"$RESULTS")" = 20 ]; then echo "ok      20人目までは作れる"; else echo "NG      20人目までに 200 以外: $(tr '\n' ' ' <<<"$RESULTS")"; FAIL=$((FAIL+1)); fi
expect 409 "21人目は作れない" -b "$FJAR" "${H[@]}" -X POST "$B/api/auth/family/add-child" -d '{"name":"子21"}'
check "too_many_children" '.message == "too_many_children" or .code == "TOO_MANY_CHILDREN"'
signup "$YJAR" "late-child-$EMAIL"
expect 403 "上限の家族に、招待コードで子供として入れない" -b "$YJAR" "${H[@]}" -X POST "$B/api/account/kind" -d "{\"inviteCode\":\"$FINVITE\"}"
check "family_full" '.error == "family_full"'
expect 200 "招待コードは使われずに残る" -b "$YJAR" "${H[@]}" -X POST "$B/api/account/invite-preview" -d "{\"inviteCode\":\"$FINVITE\"}"
echo "-- まだ使われていない招待コードの一覧と取り消し"
expect 200 "親の招待コード（取り消す）" -b "$PJAR" "${H[@]}" -X POST "$B/api/family/invites" -d '{"kind":"parent"}'
RCODE=$(jq -r .code <<<"$BODY"); RID=$(jq -r .id <<<"$BODY")
expect 200 "招待コードの一覧" -b "$PJAR" "$B/api/family/invites"
check "出したコードが一覧にある（コードとハッシュは出ない）" ".invites | any(.id == \"$RID\" and .kind == \"parent\" and (.createdBy | type) == \"string\") and (tostring | test(\"$RCODE\") | not) and (tostring | test(\"code\") | not)"
expect 200 "家族の画面に一覧が出る" -b "$PJAR" "$B/family"
if grep -q "data-invite-id=\"$RID\"" <<<"$BODY"; then echo "ok      家族の画面に、取り消せる招待コードが出る"; else echo "NG      家族の画面に招待コードが出ない"; FAIL=$((FAIL+1)); fi
expect 403 "大人は一覧を見られない" -b "$JAR" "$B/api/family/invites"
expect 404 "ほかの家族の親は取り消せない" -b "$FJAR" "${H[@]}" -X DELETE "$B/api/family/invites/$RID"
expect 403 "子供は取り消せない" -b "$GJAR" "${H[@]}" -X DELETE "$B/api/family/invites/$RID"
expect 204 "2人目の親が取り消す" -b "$QJAR" "${H[@]}" -X DELETE "$B/api/family/invites/$RID"
expect 404 "2回目の取り消し" -b "$PJAR" "${H[@]}" -X DELETE "$B/api/family/invites/$RID"
expect 400 "取り消したコードは確かめられない" -b "$YJAR" "${H[@]}" -X POST "$B/api/account/invite-preview" -d "{\"inviteCode\":\"$RCODE\"}"
expect 400 "取り消したコードでは入れない" -b "$YJAR" "${H[@]}" -X POST "$B/api/account/kind" -d "{\"inviteCode\":\"$RCODE\"}"
expect 200 "取り消したあとの一覧" -b "$PJAR" "$B/api/family/invites"
check "一覧から消える" ".invites | all(.id != \"$RID\")"

echo "== 種類ができる前からの利用者（端末あり）が親を選ぶ"
LJAR=$(mktemp); trap 'rm -f "$JAR" "$PJAR" "$CJAR" "$GJAR" "$QJAR" "$XJAR" "$AJAR" "$NJAR" "$FJAR" "$YJAR" "$LJAR"' EXIT
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
