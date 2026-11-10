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

echo "== ログアウト"
eapi 204 "ログアウト" POST /logout
eapi 401 "ログアウト後" GET /sync

echo
if [ "$FAIL" = 0 ]; then echo "すべて通りました"; else echo "NG が $FAIL 件"; exit 1; fi
