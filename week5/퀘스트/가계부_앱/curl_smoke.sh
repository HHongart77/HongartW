#!/usr/bin/env bash
# Smoke test every endpoint via curl. Korean bodies written to files via Node (UTF-8 safe).
set -u
BASE="http://127.0.0.1:4800"
TMP="./_curl_tmp"
rm -rf "$TMP"
mkdir -p "$TMP"
pass=0; fail=0

write_json() {
  # write_json <path> <json-literal>
  node -e "require('fs').writeFileSync(process.argv[1], process.argv[2])" "$1" "$2"
}

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "✅ $name → $actual"; ((pass++))
  else
    echo "❌ $name → got '$actual', expected '$expected'"; ((fail++))
  fi
}

echo "━━━ 1) GET /api/health ━━━"
s=$(curl -sS -o "$TMP/r.json" -w "%{http_code}" "$BASE/api/health")
check "status" "200" "$s"
echo "body: $(cat $TMP/r.json)"

echo; echo "━━━ 2) GET /api/transactions?limit=2 ━━━"
s=$(curl -sS -o "$TMP/r.json" -w "%{http_code}" "$BASE/api/transactions?limit=2")
check "status" "200" "$s"
node -e "const j=require('$TMP/r.json'); console.log('rows:',j.data.length,'- first:',j.data[0].date,j.data[0].category,j.data[0].amount);"

echo; echo "━━━ 3) GET /api/transactions?category=식비&limit=3 ━━━"
# URL-encode Korean param
ENCCAT=$(node -e "console.log(encodeURIComponent('식비'))")
s=$(curl -sS -o "$TMP/r.json" -w "%{http_code}" "$BASE/api/transactions?category=$ENCCAT&limit=3")
check "status" "200" "$s"
cnt=$(node -e "const j=require('$TMP/r.json'); console.log(j.data.length)")
check "rows returned" "3" "$cnt"
allfood=$(node -e "const j=require('$TMP/r.json'); console.log(j.data.every(r=>r.category==='식비'))")
check "all rows are 식비" "true" "$allfood"

echo; echo "━━━ 4) POST /api/transactions (INSERT) ━━━"
write_json "$TMP/ins.json" '{"date":"2026-04-20","category":"기타","description":"curl 테스트","amount":1234}'
s=$(curl -sS -o "$TMP/r.json" -w "%{http_code}" -X POST -H "Content-Type: application/json" --data-binary "@$TMP/ins.json" "$BASE/api/transactions")
check "status" "201" "$s"
newid=$(node -e "const j=require('$TMP/r.json'); console.log(j.data.id)")
echo "  inserted id=$newid  desc=$(node -e "console.log(require('$TMP/r.json').data.description)")"

echo; echo "━━━ 5) PATCH /api/transactions/$newid (amount:9999) ━━━"
write_json "$TMP/patch.json" '{"amount":9999}'
s=$(curl -sS -o "$TMP/r.json" -w "%{http_code}" -X PATCH -H "Content-Type: application/json" --data-binary "@$TMP/patch.json" "$BASE/api/transactions/$newid")
check "status" "200" "$s"
newamt=$(node -e "const j=require('$TMP/r.json'); console.log(j.data.amount)")
check "amount updated" "9999" "$newamt"

echo; echo "━━━ 6) DELETE /api/transactions/$newid ━━━"
s=$(curl -sS -o "$TMP/r.json" -w "%{http_code}" -X DELETE "$BASE/api/transactions/$newid")
check "status" "200" "$s"
echo "  body: $(cat $TMP/r.json)"

echo; echo "━━━ 7) POST /api/ask (total) ━━━"
write_json "$TMP/q.json" '{"question":"이번달 얼마 썼어?"}'
s=$(curl -sS -o "$TMP/r.json" -w "%{http_code}" -X POST -H "Content-Type: application/json" --data-binary "@$TMP/q.json" "$BASE/api/ask")
check "status" "200" "$s"
node -e "const j=require('$TMP/r.json'); console.log('  intent:',j.data.intent,'  range:',j.data.range.from,'..',j.data.range.to,'('+j.data.range.source+')'); console.log('  summary:',j.data.summary.slice(0,160));"

echo; echo "━━━ 8) POST /api/ask with body range (2026-04-01 ~ 04-10) ━━━"
write_json "$TMP/q.json" '{"question":"카테고리별 비율","from":"2026-04-01","to":"2026-04-10"}'
s=$(curl -sS -o "$TMP/r.json" -w "%{http_code}" -X POST -H "Content-Type: application/json" --data-binary "@$TMP/q.json" "$BASE/api/ask")
check "status" "200" "$s"
node -e "const j=require('$TMP/r.json'); console.log('  intent:',j.data.intent,'  source:',j.data.range.source); console.log('  summary:',j.data.summary.slice(0,220));"

echo; echo "━━━ 9) POST /api/ask invalid (from > to) → 400 ━━━"
write_json "$TMP/q.json" '{"question":"총합","from":"2026-04-15","to":"2026-04-01"}'
s=$(curl -sS -o "$TMP/r.json" -w "%{http_code}" -X POST -H "Content-Type: application/json" --data-binary "@$TMP/q.json" "$BASE/api/ask")
check "status" "400" "$s"
echo "  body: $(cat $TMP/r.json)"

echo; echo "━━━ 10) POST /api/ask (요일별 breakdown) ━━━"
write_json "$TMP/q.json" '{"question":"요일별 지출 보여줘"}'
s=$(curl -sS -o "$TMP/r.json" -w "%{http_code}" -X POST -H "Content-Type: application/json" --data-binary "@$TMP/q.json" "$BASE/api/ask")
check "status" "200" "$s"
node -e "const j=require('$TMP/r.json'); console.log('  intent:',j.data.intent); console.log('  summary:',j.data.summary);"

echo; echo "━━━ 11) POST /api/analyze alias ━━━"
write_json "$TMP/q.json" '{"question":"가장 비싼 지출은?"}'
s=$(curl -sS -o "$TMP/r.json" -w "%{http_code}" -X POST -H "Content-Type: application/json" --data-binary "@$TMP/q.json" "$BASE/api/analyze")
check "status" "200" "$s"
node -e "const j=require('$TMP/r.json'); console.log('  intent:',j.data.intent); console.log('  summary:',j.data.summary);"

echo; echo "━━━ 12) 404 on unknown route ━━━"
s=$(curl -sS -o "$TMP/r.json" -w "%{http_code}" "$BASE/api/foo")
echo "  status: $s (4xx acceptable)"

echo; echo "━━━ 결과 요약 ━━━"
echo "  통과 $pass / 실패 $fail"
exit $fail
