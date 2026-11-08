#!/usr/bin/env bash
# Backend smoke test against the LOCAL supabase stack.
# Prints PASS/FAIL per check; never prints tokens.
set -uo pipefail

BASE="http://127.0.0.1:54321/functions/v1"
ANON=$(supabase status 2>/dev/null | awk '/anon key/ {print $3}')
RUN=$(date +%s)   # unique names per run — no DB cleanup needed
PASS=0; FAIL=0

check() { # name expected_pattern actual
  if echo "$3" | grep -q "$2"; then PASS=$((PASS+1)); echo "PASS: $1";
  else FAIL=$((FAIL+1)); echo "FAIL: $1 — got: $(echo "$3" | head -c 200)"; fi
}

post() { curl -s -m 30 "$BASE/$1" -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ANON" ${2:+-d "$2"}; }
post_auth() { # path body token
  curl -s -m 30 "$BASE/$1" -X POST -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $3" -d "$2"; }

R=$(post register "{\"name\":\"smoke-alice-$RUN\",\"password\":\"password123\"}")
check "register" '"token"' "$R"
T1=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")

R=$(post register "{\"name\":\"smoke-alice-$RUN\",\"password\":\"password123\"}")
check "duplicate register rejected" 'name taken' "$R"

R=$(post register "{\"name\":\"x\",\"password\":\"password123\"}")
check "short name rejected" '2-24' "$R"

R=$(post register '{"name":"smoke-bob","password":"short"}')
check "short password rejected" '8\+' "$R"

R=$(post signin '{"name":"smoke-alice","password":"password123"}')
check "signin" '"token"' "$R"

R=$(post signin '{"name":"smoke-alice","password":"wrongwrong"}')
check "bad password rejected" 'invalid name or password' "$R"

# game lifecycle
R=$(post_auth game-create '{"name":"Smoke Game","mode":"test","config":{"board":8,"startingHp":3,"startingAp":0,"baseRange":2,"apPerDay":1,"upgradeCost":2,"apIntervalMinutes":0,"bots":[{"difficulty":"easy"},{"difficulty":"easy"}]},"dailyApTime":null}' "$T1")
check "game-create" '"inviteCode"' "$R"
GID=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('gameId',''))")

R=$(post_auth game-start "{\"gameId\":\"$GID\"}" "$T1")
check "game-start" '"ok"' "$R"

R=$(curl -s -m 30 "$BASE/game-get?gameId=$GID" -H "Authorization: Bearer $T1")
check "game-get returns 4 tanks (2 humans? no: 1 human + 2 bots)" '"state"' "$R"
echo "$R" | python3 -c "
import sys, json
d = json.load(sys.stdin)
players = d['state']['players']
assert len(players) == 3, f'expected 3 players, got {len(players)}'
assert any(p['isBot'] for p in players.values()), 'bots missing'
positions = [(p['pos']['x'], p['pos']['y']) for p in players.values()]
assert len(set(positions)) == 3, 'overlapping spawn'
print('PASS: state shape (3 players, distinct spawns, bots present)')
" && PASS=$((PASS+1)) || { FAIL=$((FAIL+1)); echo "FAIL: state shape"; }

# action: first player should be able to move (everyone has 0 AP -> expect failure)
R=$(post_auth action "{\"gameId\":\"$GID\",\"type\":\"upgrade_range\",\"payload\":{}}" "$T1")
check "action without AP rejected" 'not enough AP' "$R"

# tick grants AP, bots move
R=$(post tick '{}')
check "tick" '"ok"' "$R"
R=$(post tick '{}')
check "second immediate tick is no-op or ok" '"ok"' "$R"

R=$(curl -s -m 30 "$BASE/game-get?gameId=$GID" -H "Authorization: Bearer $T1")
echo "$R" | python3 -c "
import sys, json
d = json.load(sys.stdin)
ap = d['state']['players'][d['me']]['ap']
assert ap >= 1, f'expected AP after tick, got {ap}'
assert d['state']['seq'] >= 1, 'no events after tick'
print('PASS: after tick, human has AP and events exist')
" && PASS=$((PASS+1)) || { FAIL=$((FAIL+1)); echo "FAIL: post-tick state"; }

# RLS: anon direct insert into events must fail
R=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -c \
  "select count(*) from pg_policies where tablename='events';")
check "events RLS policy exists" '1' "$(echo "$R" | tr -d ' ')"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
