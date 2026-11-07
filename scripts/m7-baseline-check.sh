#!/usr/bin/env bash
# M7 baseline check runner (issue #12). Prints one PASS / FAIL / UNRUN line per check.
#
#   DATABASE_URL=postgresql://postgres@localhost:55432/atlas_m7 scripts/m7-baseline-check.sh [--with-install]
#
# - DATABASE_URL must be passed in by the caller and must point at localhost or 127.0.0.1.
#   Anything else is refused (exit 2) before a single check runs. Use a FRESH database per run:
#   the script runs migrations and the seed against it.
# - Commands are explicit and macOS-safe: ./node_modules/.bin/<tool> or node ./node_modules/...
#   Never scripts/dev.ts, never `prisma db seed` (it calls tsx.CMD), never `pnpm exec`.
# - A check whose prerequisite is missing prints UNRUN (with the reason), not FAIL.
# - Exit codes: 0 all PASS | 1 any FAIL | 2 refused or bad usage | 3 no FAIL but something UNRUN.
# - Env knobs: M7_LOG_DIR (log folder), M7_PORT (production server port, default 3107),
#   M7_TIMEOUT (seconds per long check, default 900), M7_TAIL (log lines shown for a FAIL, default 12),
#   M7_HANDOFF_FILE (handoff record, default docs/baseline-handoff.md).
# - External-model and provider keys are scrubbed from every child process (see SCRUB_VARS).
#   This script never creates or reads a .env file and never prints the database password.

set -euo pipefail

WITH_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --with-install) WITH_INSTALL=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "REFUSED: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${M7_PORT:-3107}"
CHECK_TIMEOUT="${M7_TIMEOUT:-900}"
TAIL_LINES="${M7_TAIL:-12}"
HANDOFF_FILE="${M7_HANDOFF_FILE:-docs/baseline-handoff.md}"
NODE_MIN_MAJOR=20
NODE_MIN_MINOR=11
SCRUB_VARS="GEMINI_API_KEY YOUTUBE_API_KEY GITHUB_TOKEN NEXT_PUBLIC_GOOGLE_MAPS_API_KEY OPENAI_API_KEY GOOGLE_API_KEY ADMIN_BASIC_USER ADMIN_BASIC_PASSWORD"
PSQL=""
for candidate in "$(command -v psql 2>/dev/null || true)" /opt/homebrew/opt/postgresql@16/bin/psql; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then PSQL="$candidate"; break; fi
done

# ---------------------------------------------------------------- database guard (runs first)
if [ -z "${DATABASE_URL:-}" ]; then
  echo "REFUSED: DATABASE_URL is not set. Pass a disposable local database inline, e.g." >&2
  echo "  DATABASE_URL=postgresql://postgres@localhost:55432/atlas_m7 $0" >&2
  exit 2
fi
command -v node >/dev/null 2>&1 || { echo "REFUSED: node not found on PATH." >&2; exit 2; }

# Parse with the WHATWG URL parser, not a regex, so user:pass@host and ?host= tricks are handled.
DB_PARSED="$(node -e '
  try {
    const u = new URL(process.argv[1]);
    const override = ["host", "hostaddr"].find((k) => u.searchParams.has(k)) || "";
    process.stdout.write([u.protocol, u.hostname, u.port || "5432", decodeURIComponent(u.pathname.replace(/^\//, "")), override].join("\t"));
  } catch (e) { process.exit(3); }
' "$DATABASE_URL" 2>/dev/null)" || { echo "REFUSED: DATABASE_URL is not a parseable URL." >&2; exit 2; }
IFS=$'\t' read -r DB_PROTO DB_HOST DB_PORT DB_NAME DB_HOST_OVERRIDE <<<"$DB_PARSED"
case "$DB_PROTO" in
  postgres:|postgresql:) ;;
  *) echo "REFUSED: DATABASE_URL protocol '$DB_PROTO' is not postgres/postgresql." >&2; exit 2 ;;
esac
if [ -n "$DB_HOST_OVERRIDE" ]; then
  echo "REFUSED: DATABASE_URL carries a '$DB_HOST_OVERRIDE=' query parameter that can redirect the connection." >&2
  exit 2
fi
case "$DB_HOST" in
  localhost|127.0.0.1) ;;
  *) echo "REFUSED: database host '$DB_HOST' is not localhost or 127.0.0.1. Disposable local databases only." >&2; exit 2 ;;
esac
export DATABASE_URL

LOG_DIR="${M7_LOG_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/m7-baseline.XXXXXX")}"
mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------- helpers
PASS_N=0; FAIL_N=0; UNRUN_N=0
SERVER_PID=""
LAST_RC=0

record() { # status id detail
  printf '%-6s %-22s %s\n' "$1" "$2" "$3"
  case "$1" in PASS) PASS_N=$((PASS_N+1));; FAIL) FAIL_N=$((FAIL_N+1));; UNRUN) UNRUN_N=$((UNRUN_N+1));; esac
}
pass()  { record PASS  "$1" "$2"; }
unrun() { record UNRUN "$1" "$2"; }
fail()  { record FAIL  "$1" "$2"; if [ -f "$LOG_DIR/$1.log" ]; then tail -n "$TAIL_LINES" "$LOG_DIR/$1.log" | sed 's/^/         | /'; fi; }

# Every child runs without provider keys (so a stray model call is impossible), noninteractive, in its own
# session (perl setsid + exec keeps the pid, which becomes the process-group id used for the kill).
SCRUB_ARGS=()
for v in $SCRUB_VARS; do SCRUB_ARGS+=(-u "$v"); done
SETSID_PERL='use POSIX qw(setsid); setsid(); exec @ARGV or die "exec failed: $!"'

# Run "$@" with a hard timeout. Returns the command's exit code, or 124 on timeout.
# Output is the caller's redirect.
run_limited() {
  local secs="$1"; shift
  env "${SCRUB_ARGS[@]}" CI=1 NEXT_TELEMETRY_DISABLED=1 perl -e "$SETSID_PERL" -- "$@" </dev/null &
  local pid=$!
  ( sleep "$secs"; kill -TERM -- "-$pid" 2>/dev/null; sleep 5; kill -KILL -- "-$pid" 2>/dev/null ) >/dev/null 2>&1 &
  local watchdog=$!
  local rc=0
  wait "$pid" || rc=$?
  kill "$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true
  if [ "$rc" -eq 143 ] || [ "$rc" -eq 137 ]; then rc=124; fi
  return "$rc"
}

# check <id> <timeout-seconds> <command...>: PASS on exit 0, FAIL otherwise. Never aborts the script.
check() {
  local id="$1" secs="$2"; shift 2
  local started rc=0
  started=$(date +%s)
  run_limited "$secs" "$@" >"$LOG_DIR/$id.log" 2>&1 || rc=$?
  local took=$(( $(date +%s) - started ))
  LAST_RC="$rc"
  if [ "$rc" -eq 0 ]; then pass "$id" "exit 0 in ${took}s :: $*"
  elif [ "$rc" -eq 124 ]; then fail "$id" "TIMEOUT after ${secs}s :: $*"
  else fail "$id" "exit $rc in ${took}s :: $*"; fi
  return 0
}

port_listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
log_has() { grep -qE "$2" "$LOG_DIR/$1.log" 2>/dev/null; }

stop_server() {
  if [ -n "$SERVER_PID" ]; then
    kill -TERM -- "-$SERVER_PID" 2>/dev/null || true
    sleep 1
    kill -KILL -- "-$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
}
trap stop_server EXIT

# ---------------------------------------------------------------- header (records the evidence context)
echo "== M7 baseline check =="
echo "date_utc        : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "revision        : $(git rev-parse HEAD 2>/dev/null || echo unknown) ($(git branch --show-current 2>/dev/null || echo detached))"
DIRTY="$(git status --porcelain 2>/dev/null || true)"
if [ -z "$DIRTY" ]; then echo "tree            : clean"; else
  echo "tree            : DIRTY ($(printf '%s\n' "$DIRTY" | wc -l | tr -d ' ') path(s))"
  printf '%s\n' "$DIRTY" | sed 's/^/                  /'
fi
echo "os              : $(uname -srm)"
echo "node            : $(node -v)"
if command -v pnpm >/dev/null 2>&1; then PNPM_V="$(pnpm -v 2>/dev/null || echo error)"; else PNPM_V="not found"; fi
echo "pnpm            : $PNPM_V"
echo "database        : host=$DB_HOST port=$DB_PORT name=$DB_NAME (credentials not printed)"
if [ -n "$PSQL" ]; then
  echo "postgres        : $("$PSQL" "$DATABASE_URL" -Atc 'show server_version' 2>/dev/null || echo 'unreachable via psql')"
else
  echo "postgres        : psql not found, version not recorded"
fi
echo "lockfile        : $(shasum -a 256 pnpm-lock.yaml | cut -c1-16) (sha256 prefix)"
echo "test files      : $(ls test/*.test.ts 2>/dev/null | tr '\n' ' ')"
echo "e2e specs       : $(ls tests-node/*.spec.ts 2>/dev/null | tr '\n' ' ')"
echo "scrubbed env    : $SCRUB_VARS"
echo "log dir         : $LOG_DIR"
echo "--"

# ---------------------------------------------------------------- prerequisites
NODE_OK=0
NODE_V="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_V%%.*}"; NODE_REST="${NODE_V#*.}"; NODE_MINOR="${NODE_REST%%.*}"
if [ "$NODE_MAJOR" -gt "$NODE_MIN_MAJOR" ] || { [ "$NODE_MAJOR" -eq "$NODE_MIN_MAJOR" ] && [ "$NODE_MINOR" -ge "$NODE_MIN_MINOR" ]; }; then
  NODE_OK=1; pass node-engine "node $NODE_V satisfies engines >=$NODE_MIN_MAJOR.$NODE_MIN_MINOR"
else
  fail node-engine "node $NODE_V is below engines >=$NODE_MIN_MAJOR.$NODE_MIN_MINOR"
fi

DEPS_OK=0
if [ -x node_modules/.bin/prisma ] && [ -x node_modules/.bin/next ] && [ -x node_modules/.bin/tsx ] && [ -f node_modules/typescript/bin/tsc ]; then DEPS_OK=1; fi

# install-frozen mutates node_modules and needs the network, so it is opt-in.
if [ "$WITH_INSTALL" -eq 1 ]; then
  if command -v pnpm >/dev/null 2>&1; then
    check install-frozen "$CHECK_TIMEOUT" pnpm install --frozen-lockfile
    if [ -x node_modules/.bin/prisma ] && [ -x node_modules/.bin/next ] && [ -x node_modules/.bin/tsx ] && [ -f node_modules/typescript/bin/tsc ]; then DEPS_OK=1; fi
  else
    unrun install-frozen "pnpm not found"
  fi
else
  unrun install-frozen "opt-in (mutates node_modules); rerun with --with-install"
fi

DB_UP=0
if (exec 3<>"/dev/tcp/$DB_HOST/$DB_PORT") 2>/dev/null; then DB_UP=1; fi

# ---------------------------------------------------------------- build-side checks (no database needed to run)
GEN_OK=0
if [ "$DEPS_OK" -eq 0 ]; then
  for id in prisma-generate typecheck lint unit-tests; do unrun "$id" "node_modules incomplete (prisma/next/tsx/tsc missing); install first"; done
else
  check prisma-generate 300 ./node_modules/.bin/prisma generate
  if [ "$LAST_RC" -eq 0 ]; then GEN_OK=1; fi
  check typecheck 600 node ./node_modules/typescript/bin/tsc --noEmit
  # Plan requires a noninteractive lint gate: stdin is /dev/null and CI=1, so a prompt or a missing config is a FAIL.
  check lint 300 ./node_modules/.bin/next lint
  if ls test/*.test.ts >/dev/null 2>&1; then
    check unit-tests 600 ./node_modules/.bin/tsx --test test/*.test.ts
  else
    unrun unit-tests "no test/*.test.ts files"
  fi
fi

if [ -f scripts/assert-no-mock-data.ts ] && [ "$DEPS_OK" -eq 1 ]; then
  check no-mock-scan 300 ./node_modules/.bin/tsx scripts/assert-no-mock-data.ts
  echo "         (text-pattern scan only: it does not establish privacy or authorization; every signal needs a recorded disposition)"
else
  unrun no-mock-scan "scripts/assert-no-mock-data.ts or dependencies missing"
fi

# ---------------------------------------------------------------- database checks
MIGRATE_OK=0
if [ "$DEPS_OK" -eq 0 ]; then
  for id in migrate-deploy seed prisma-read; do unrun "$id" "node_modules incomplete"; done
elif [ "$DB_UP" -eq 0 ]; then
  for id in migrate-deploy seed prisma-read; do unrun "$id" "nothing listening on $DB_HOST:$DB_PORT"; done
else
  check migrate-deploy 300 ./node_modules/.bin/prisma migrate deploy
  if [ "$LAST_RC" -eq 0 ]; then MIGRATE_OK=1; fi
  if [ "$MIGRATE_OK" -eq 1 ]; then
    # Explicit tsx path. `prisma db seed` would call node_modules/.bin/tsx.CMD (Windows only on main).
    check seed 600 ./node_modules/.bin/tsx prisma/seed.ts
    check prisma-read 120 ./node_modules/.bin/tsx scripts/verify-prisma.ts
  else
    unrun seed "migrate-deploy did not succeed"
    unrun prisma-read "migrate-deploy did not succeed"
  fi
fi
unrun prisma-crud "no create/update/delete probe exists on main (scripts/verify-prisma.ts is read-only); owed by M1 tests"
unrun restart-preservation "no check exists on main (seed twice, curated rows and roles unchanged); owed by M1 tests"

# ---------------------------------------------------------------- production runtime
BUILD_OK=0
if [ "$DEPS_OK" -eq 0 ]; then
  unrun build "node_modules incomplete"
elif [ "$GEN_OK" -eq 0 ]; then
  unrun build "prisma-generate did not succeed, so next build has no client to compile against"
else
  check build "$CHECK_TIMEOUT" ./node_modules/.bin/next build
  if [ "$LAST_RC" -eq 0 ] && [ -f .next/BUILD_ID ]; then BUILD_OK=1; fi
fi

SERVER_UP=0
if [ "$BUILD_OK" -eq 0 ]; then
  unrun start-prod "production build is not available"
elif port_listening "$PORT"; then
  unrun start-prod "port $PORT is already in use; set M7_PORT to a free port"
else
  env "${SCRUB_ARGS[@]}" CI=1 NEXT_TELEMETRY_DISABLED=1 perl -e "$SETSID_PERL" -- ./node_modules/.bin/next start -p "$PORT" \
    >"$LOG_DIR/start-prod.log" 2>&1 </dev/null &
  SERVER_PID=$!   # the exec chain keeps this pid, and setsid made it the process-group id; stop_server kills the group
  code=""
  for _ in $(seq 1 45); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
    if [ "$code" = "200" ]; then SERVER_UP=1; break; fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
    sleep 1
  done
  if [ "$SERVER_UP" -eq 1 ]; then pass start-prod "GET / returned 200 on next start -p $PORT"
  else fail start-prod "GET / did not return 200 within 45s (last http code: ${code:-none})"; fi
fi

# Same-server route probe: statuses only. Content/privacy assertions are owed by M3/M2/M4 tests.
if [ "$SERVER_UP" -eq 1 ]; then
  ROUTES_BAD=""
  for route in / /robots /contributions /map /network; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://127.0.0.1:$PORT$route" 2>/dev/null || echo 000)"
    printf '%s %s\n' "$code" "$route" >>"$LOG_DIR/route-probe.log"
    case "$code" in 200) ;; *) ROUTES_BAD="$ROUTES_BAD $route=$code" ;; esac
  done
  if [ -z "$ROUTES_BAD" ]; then pass route-probe "public routes / /robots /contributions /map /network return 200 (status only)"
  else fail route-probe "non-200:$ROUTES_BAD"; fi
else
  unrun route-probe "production server is not up"
fi

# Playwright baseURL is hardcoded to localhost:3000 and reuseExistingServer is on. If anything else holds
# 3000 (another worktree) it would test the wrong code, so run only when 3000 is free and our server is
# on 3000, else UNRUN.
if [ "$SERVER_UP" -eq 0 ]; then
  unrun e2e-playwright "production server is not up"
elif [ "$PORT" != "3000" ]; then
  unrun e2e-playwright "playwright.config.ts hardcodes baseURL localhost:3000; this run served on $PORT (rerun with M7_PORT=3000 when 3000 is free)"
else
  # Missing browser binaries are a missing prerequisite (UNRUN), not a repo failure. Never install them here.
  E2E_RC=0
  run_limited 900 env PLAYWRIGHT_EXTERNAL_SERVER=1 ./node_modules/.bin/playwright test --trace off \
    >"$LOG_DIR/e2e-playwright.log" 2>&1 || E2E_RC=$?
  if [ "$E2E_RC" -eq 0 ]; then pass e2e-playwright "exit 0 :: playwright test --trace off against next start on :3000"
  elif log_has e2e-playwright "Executable doesn't exist"; then unrun e2e-playwright "playwright browser binaries not installed; not installing from this script"
  else fail e2e-playwright "exit $E2E_RC :: playwright test --trace off against next start on :3000"; fi
fi
stop_server

# ---------------------------------------------------------------- python package, handoff record, checks nobody has written yet
if command -v python3 >/dev/null 2>&1 && python3 -c 'import pytest' >/dev/null 2>&1; then
  check pytest 600 python3 -m pytest -q
else
  unrun pytest "python3 with pytest not available; not installing from this script"
fi

if [ ! -f "$HANDOFF_FILE" ]; then
  unrun handoff-record "$HANDOFF_FILE does not exist yet (written by M7 at final gate)"
else
  MISSING=""
  for heading in "Tested revision" "Environment" "Setup commands" "Public policy" "Demo script" "Repaired" "Contained" "Deferred"; do
    grep -qiE "^#+ .*$heading" "$HANDOFF_FILE" || MISSING="$MISSING [$heading]"
  done
  if [ -z "$MISSING" ]; then pass handoff-record "$HANDOFF_FILE has all required headings (structure only, not content truth)"
  else fail handoff-record "$HANDOFF_FILE is missing headings:$MISSING"; fi
fi

for id in denial-direct privacy-cross-view discovery-journey controls-valid-invalid map-cold-read nav-phone-keyboard; do
  case "$id" in
    denial-direct)        why="forged/unauthorized action+API calls cause no side effects; owed by M2/M6/M8-A (NoneTP) as test/*.test.ts" ;;
    privacy-cross-view)   why="private/pending/internal-note markers absent from HTML, RSC, APIs, file/hybrid paths; owed by M3/M5 (Suk-Nsr)" ;;
    discovery-journey)    why="search -> source -> results on checked data; owed by M3/M5/M8-B (Suk-Nsr) and M8-C (Pongchayanneung)" ;;
    controls-valid-invalid) why="valid filters return fixture IDs, invalid rejected, empty differs from error; owed by M8-A (NoneTP) and M8-B (Suk-Nsr)" ;;
    map-cold-read)        why="cold read makes no model call, cache write or invented claim; owed by M4 (Pongchayanneung)" ;;
    nav-phone-keyboard)   why="390px and desktop, Thai/English, keyboard only; owed by M8-C (Pongchayanneung)" ;;
  esac
  unrun "$id" "no automated check on main: $why"
done

# ---------------------------------------------------------------- summary
echo "--"
echo "SUMMARY: PASS=$PASS_N FAIL=$FAIL_N UNRUN=$UNRUN_N  (logs: $LOG_DIR)"
echo "UNRUN is not a pass. A required outcome with any FAIL or UNRUN keeps issue #12 open."
if [ "$FAIL_N" -gt 0 ]; then exit 1; fi
if [ "$UNRUN_N" -gt 0 ]; then exit 3; fi
exit 0
