#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_PG_VERSION_NUM='170006'
EXPECTED_CLI_VERSION='2.79.0'
BASELINE_VERSION='20000101000000'
THREED14_VERSION='20261026214837'
CREATED_DATABASES=()
CURRENT_CASE=''
FAIL_MESSAGE=''
RESULTS_JSON="${PR352_RESULTS_JSON:-${RUNNER_TEMP:-/tmp}/pr352-cli-isolation-results.json}"
RESULTS_NDJSON="${RESULTS_JSON}.cases.ndjson"
CLI_ACTUAL_VERSION=''
SERVER_VERSION=''
LAST_FAILURE_STATUS=''
ACTIVE_DATABASE=''

on_error() {
  local status="$2"
  if [[ -z "$FAIL_MESSAGE" ]]; then
    FAIL_MESSAGE="command failed at line $1 (exit $status)"
  fi
  return "$status"
}
trap 'on_error "$LINENO" "$?"' ERR

fail() {
  FAIL_MESSAGE="$*"
  printf 'PR352_CLI_ISOLATION_FAIL: %s\n' "$*" >&2
  exit 1
}

write_results_json() {
  local run_status="$1" cleanup_status="$2" leaked="$3"
  mkdir -p "$(dirname "$RESULTS_JSON")" || return 1
  node - "$RESULTS_JSON" "$RESULTS_NDJSON" "$CLI_ACTUAL_VERSION" "$SERVER_VERSION" \
    "$run_status" "$cleanup_status" "$FAIL_MESSAGE" "$CURRENT_CASE" \
    "$(IFS=,; printf '%s' "${CREATED_DATABASES[*]}")" "$leaked" <<'NODE'
const fs = require('node:fs');
const [destination, ndjson, cliVersion, pgVersion, runStatus, cleanupStatus,
  failure, failedCase, createdDatabases, leakedSessions] = process.argv.slice(2);
let cases = [];
let caseReadFailure = null;
if (fs.existsSync(ndjson)) {
  try {
    cases = fs.readFileSync(ndjson, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    caseReadFailure = `case result file is invalid: ${error.message}`;
  }
} else {
  caseReadFailure = 'case result file is missing';
}
if (runStatus !== '0' && failedCase && !cases.some((item) => item.caseId === failedCase)) {
  cases.push({ caseId: failedCase, status: 'FAIL', summary: failure || 'scenario did not complete' });
}
const expectedCaseIds = Array.from({ length: 10 }, (_, index) => `CLI-${String(index + 1).padStart(2, '0')}`);
const caseIds = cases.map((item) => item?.caseId);
const uniqueCaseIds = new Set(caseIds);
const leakedSessionCount = /^\d+$/.test(leakedSessions || '') ? Number(leakedSessions) : Number.NaN;
const cleanupPassed = cleanupStatus === '0' && leakedSessionCount === 0;
const failures = [];
if (failure) failures.push(String(failure));
if (caseReadFailure) failures.push(caseReadFailure);
if (runStatus !== '0') failures.push(`harness exited with status ${runStatus}`);
if (cliVersion !== '2.79.0') failures.push(`expected Supabase CLI 2.79.0, received ${cliVersion || 'missing'}`);
if (pgVersion !== '170006') failures.push(`expected PostgreSQL server 170006, received ${pgVersion || 'missing'}`);
if (process.env.GITHUB_REPOSITORY !== 'fdxruli/Lanzo-POS') failures.push('workflow repository does not match fdxruli/Lanzo-POS');
if (process.env.GITHUB_REF !== 'refs/heads/qa/pr352-cli279-pg176-isolation-r3-20261029') failures.push('workflow ref does not match the authorized QA branch');
if (!/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || '')) failures.push('workflow SHA is missing or malformed');
if (cases.length !== 10) failures.push(`expected 10 case records, received ${cases.length}`);
if (uniqueCaseIds.size !== 10) failures.push('case IDs are duplicated or missing');
if (expectedCaseIds.some((caseId) => !uniqueCaseIds.has(caseId))
    || caseIds.some((caseId) => !expectedCaseIds.includes(caseId))) {
  failures.push('case IDs must be exactly CLI-01 through CLI-10');
}
if (cases.some((item) => item?.status !== 'PASS')) failures.push('one or more cases did not pass');
if (!cleanupPassed) failures.push('cleanup did not pass or residual session count was nonzero');
const suitePassed = failures.length === 0;
const report = {
  schemaVersion: 1,
  suite: 'PR352 Supabase CLI/PostgreSQL isolated migration matrix',
  repository: process.env.GITHUB_REPOSITORY || 'local',
  ref: process.env.GITHUB_REF || 'local',
  commit: process.env.GITHUB_SHA || 'local',
  startedAt: process.env.PR352_STARTED_AT || null,
  completedAt: new Date().toISOString(),
  cliVersion: cliVersion || null,
  postgresServerVersionNum: pgVersion || null,
  finalStatus: suitePassed ? 'PASS' : 'FAIL',
  cases,
  failure: failures.length ? failures.join('; ') : null,
  cleanup: {
    status: cleanupPassed ? 'PASS' : 'FAIL',
    createdSyntheticDatabases: (createdDatabases || '').split(',').filter(Boolean),
    leakedSessionsAfterCleanup: Number.isFinite(leakedSessionCount) ? leakedSessionCount : null,
  },
};
fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
if (!suitePassed) process.exitCode = 1;
NODE
}

cleanup() {
  local original_status=$?
  local cleanup_status=0
  local leaked='0'
  trap - EXIT ERR
  set +e

  if [[ -n "${ADMIN_DATABASE_URL:-}" && "${#CREATED_DATABASES[@]}" -gt 0 ]]; then
    local database_list
    database_list="$(printf "'%s'," "${CREATED_DATABASES[@]}")"
    database_list="${database_list%,}"
    leaked="$(PGCONNECT_TIMEOUT=10 timeout -k 5s 20s psql -X -qAt -v ON_ERROR_STOP=1 "$ADMIN_DATABASE_URL" \
      -c "SELECT count(*) FROM pg_stat_activity WHERE datname IN (${database_list}) AND pid <> pg_backend_pid()")"
    if [[ "$leaked" != '0' ]]; then
      printf 'PR352_CLI_ISOLATION_CLEANUP_FAIL: %s PostgreSQL client session(s) remained after tests; terminating before service teardown.\n' "${leaked:-unknown}" >&2
      cleanup_status=1
      PGCONNECT_TIMEOUT=10 timeout -k 5s 20s psql -X -q -v ON_ERROR_STOP=1 "$ADMIN_DATABASE_URL" \
        -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN (${database_list}) AND pid <> pg_backend_pid()" >/dev/null 2>&1
      leaked="$(PGCONNECT_TIMEOUT=10 timeout -k 5s 20s psql -X -qAt -v ON_ERROR_STOP=1 "$ADMIN_DATABASE_URL" \
        -c "SELECT count(*) FROM pg_stat_activity WHERE datname IN (${database_list}) AND pid <> pg_backend_pid()")"
      if [[ "$leaked" != '0' ]]; then
        printf 'PR352_CLI_ISOLATION_CLEANUP_FAIL: %s PostgreSQL client session(s) remain after termination.\n' "${leaked:-unknown}" >&2
      fi
    fi
    for database in "${CREATED_DATABASES[@]}"; do
      PGCONNECT_TIMEOUT=10 timeout -k 5s 20s psql -X -q -v ON_ERROR_STOP=1 "$ADMIN_DATABASE_URL" \
        -c "DROP DATABASE IF EXISTS ${database}" >/dev/null 2>&1 || cleanup_status=1
      local remaining_database
      remaining_database="$(PGCONNECT_TIMEOUT=10 timeout -k 5s 20s psql -X -qAt -v ON_ERROR_STOP=1 "$ADMIN_DATABASE_URL" \
        -c "SELECT count(*) FROM pg_database WHERE datname='${database}'")"
      [[ "$remaining_database" == '0' ]] || cleanup_status=1
    done
  fi

  if [[ "$original_status" != '0' && -z "$FAIL_MESSAGE" ]]; then
    FAIL_MESSAGE="harness exited with status $original_status"
  fi
  if [[ "$cleanup_status" != '0' && -z "$FAIL_MESSAGE" ]]; then
    FAIL_MESSAGE='laboratory cleanup failed'
  fi
  if [[ "$original_status" == '0' && ( -n "$FAIL_MESSAGE" || "$cleanup_status" != '0' ) ]]; then original_status=1; fi
  if [[ -n "${TEMP_ROOT:-}" && -d "$TEMP_ROOT" ]]; then
    rm -rf -- "$TEMP_ROOT" || cleanup_status=1
  fi
  write_results_json "$original_status" "$cleanup_status" "${leaked:-0}"
  local report_status=$?
  if [[ "$report_status" != '0' ]]; then
    [[ -n "$FAIL_MESSAGE" ]] || FAIL_MESSAGE='result integrity validation failed'
    original_status=1
    write_results_json "$original_status" "$cleanup_status" "${leaked:-unknown}" || true
  fi
  rm -f -- "$RESULTS_NDJSON" || true

  if [[ "$cleanup_status" == '0' ]]; then
    printf 'PR352_CLI_ISOLATION_CLEANUP_PASS: temporary databases and files removed; leaked_sessions=%s\n' "$leaked"
  else
    printf 'PR352_CLI_ISOLATION_CLEANUP_FAIL: cleanup did not complete without errors.\n' >&2
  fi
  if [[ "$original_status" == '0' && "$cleanup_status" != '0' ]]; then original_status=1; fi
  if [[ "$original_status" != '0' ]]; then
    printf 'PR352_CLI_ISOLATION_FAIL: exit=%s; cleanup_status=%s\n' "$original_status" "$cleanup_status" >&2
  fi
  exit "$original_status"
}
trap cleanup EXIT

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL must point to the disposable PostgreSQL service}"
[[ "$DATABASE_URL" =~ ^postgresql://postgres:pr352_synthetic_only@127\.0\.0\.1:5432/pr352_cli_bootstrap\?sslmode=disable$ ]] \
  || fail 'refusing a non-loopback or non-synthetic database URL'
for credential_name in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_ID \
  SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_DB_URL SUPABASE_SERVICE_ROLE_KEY \
  SUPABASE_SECRET_KEY SUPABASE_ANON_KEY SUPABASE_PUBLISHABLE_KEY SUPABASE_JWT_SECRET; do
  [[ -z "${!credential_name:-}" ]] || fail 'unexpected Supabase credential or project environment variable is present'
done
while IFS= read -r pg_variable_name; do
  case "$pg_variable_name" in
    PG*) fail "unexpected PostgreSQL environment variable is present: ${pg_variable_name}" ;;
  esac
done < <(compgen -e)
command -v psql >/dev/null 2>&1 || fail 'psql client is unavailable'
command -v supabase >/dev/null 2>&1 || fail 'Supabase CLI is unavailable'
command -v timeout >/dev/null 2>&1 || fail 'timeout utility is unavailable'
command -v node >/dev/null 2>&1 || fail 'Node.js is unavailable'
CLI_ACTUAL_VERSION="$(timeout -k 5s 20s supabase --version)"
[[ "$CLI_ACTUAL_VERSION" == "$EXPECTED_CLI_VERSION" ]] || fail "expected Supabase CLI ${EXPECTED_CLI_VERSION}"
PR352_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export PR352_STARTED_AT

ADMIN_DATABASE_URL="$DATABASE_URL"
TEMP_ROOT="$(mktemp -d "${RUNNER_TEMP:-/tmp}/pr352-cli-matrix.XXXXXX")"
DB_URL_PREFIX="${DATABASE_URL%/pr352_cli_bootstrap?sslmode=disable}"
if [[ "$DB_URL_PREFIX" == "$DATABASE_URL" ]]; then fail 'unexpected bootstrap URL shape'; fi

psql_safe() {
  PGCONNECT_TIMEOUT=10 timeout -k 5s 30s psql -X -v ON_ERROR_STOP=1 "$@"
}

db_url() {
  local database="$1"
  [[ "$database" =~ ^pr352_cli_[a-z_]+$ ]] || fail "invalid synthetic database identifier: ${database}"
  printf '%s/%s?sslmode=disable\n' "$DB_URL_PREFIX" "$database"
}

verify_db() {
  local database="$1"
  local url actual
  url="$(db_url "$database")"
  actual="$(psql_safe -Atqc "SELECT current_database() || ':' || current_setting('server_version_num') || ':' || COALESCE(shobj_description(oid,'pg_database'),'') FROM pg_database WHERE datname=current_database()" "$url")"
  [[ "$actual" == "${database}:${EXPECTED_PG_VERSION_NUM}:LANZO_PR352_CLI_EPHEMERAL" ]] \
    || fail "database identity/version marker failed for ${database}"
}

create_database() {
  local database="$1"
  [[ "$database" =~ ^pr352_cli_[a-z_]+$ ]] || fail "invalid synthetic database identifier: ${database}"
  local exists
  exists="$(psql_safe -Atqc "SELECT count(*) FROM pg_database WHERE datname='${database}'" "$ADMIN_DATABASE_URL")"
  [[ "$exists" == '0' ]] || fail "synthetic database already exists; refusing to reuse ${database}"
  psql_safe -c "CREATE DATABASE ${database}" "$ADMIN_DATABASE_URL" >/dev/null
  CREATED_DATABASES+=("$database")
  ACTIVE_DATABASE="$database"
  psql_safe -c "COMMENT ON DATABASE ${database} IS 'LANZO_PR352_CLI_EPHEMERAL'" "$ADMIN_DATABASE_URL" >/dev/null
  local url
  url="$(db_url "$database")"
  verify_db "$database"
  psql_safe -c 'CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[] NOT NULL, name text NOT NULL)' "$url" >/dev/null
  psql_safe -c "INSERT INTO supabase_migrations.schema_migrations(version, statements, name) VALUES ('${BASELINE_VERSION}', ARRAY['CREATE TABLE public.pr352_cli_seed(id integer)'], 'pr352_synthetic_baseline')" "$url" >/dev/null
}

seed_3d14_history() {
  local database="$1"
  local url
  url="$(db_url "$database")"
  psql_safe -c "INSERT INTO supabase_migrations.schema_migrations(version, statements, name) VALUES ('${THREED14_VERSION}', ARRAY['CREATE TABLE public.pr352_3d14_synthetic_baseline(id integer)'], 'pr352_synthetic_3d14_baseline')" "$url" >/dev/null
}

create_project() {
  local project="$1"
  mkdir -p "$project/supabase/migrations"
  cat > "$project/supabase/config.toml" <<'TOML'
project_id = "pr352-cli-isolation-synthetic"

[db.migrations]
enabled = true
TOML
  printf 'CREATE TABLE public.pr352_cli_seed(id integer);\n' > "$project/supabase/migrations/${BASELINE_VERSION}_pr352_synthetic_baseline.sql"
}

write_3d14_synthetic_file() {
  local project="$1"
  printf 'CREATE TABLE public.pr352_3d14_synthetic_baseline(id integer);\n' \
    > "$project/supabase/migrations/${THREED14_VERSION}_pr352_synthetic_3d14_baseline.sql"
}

cli() {
  local command_name="${1:-}" subcommand="${2:-}" argument database='' db_url_value=''
  local -a original_args=("$@") scan_args=("$@")
  case "$command_name $subcommand" in
    'migration fetch'|'migration list'|'migration new'|'db push') ;;
    *) fail 'unapproved Supabase CLI operation requested' ;;
  esac
  for argument in "$@"; do
    case "$argument" in
      --linked|--linked=*|--project-ref|--project-ref=*|--password|--password=*|\
      --token|--token=*|--access-token|--access-token=*|--workdir|--workdir=*|\
      --config|--config=*|--db-url=*)
        fail 'linked-project or credential CLI flags are forbidden' ;;
    esac
  done
  while ((${#scan_args[@]})); do
    if [[ "${scan_args[0]}" == '--db-url' ]]; then
      ((${#scan_args[@]} >= 2)) || fail 'explicit --db-url value is missing'
      [[ -z "$db_url_value" ]] || fail 'multiple --db-url arguments are forbidden'
      db_url_value="${scan_args[1]}"
      scan_args=("${scan_args[@]:2}")
    else
      scan_args=("${scan_args[@]:1}")
    fi
  done
  if [[ "$command_name $subcommand" == 'migration new' ]]; then
    [[ -z "$db_url_value" ]] || fail 'migration new must not accept a database URL'
    [[ -n "$ACTIVE_DATABASE" ]] || fail 'migration new has no verified synthetic database context'
    verify_db "$ACTIVE_DATABASE"
    local project_dir
    project_dir="$(pwd -P)"
    [[ "$project_dir" == "$TEMP_ROOT/"* ]] || fail 'migration new is allowed only inside the temporary synthetic project'
    [[ -f "$project_dir/supabase/config.toml" ]] \
      && grep -Fxq 'project_id = "pr352-cli-isolation-synthetic"' "$project_dir/supabase/config.toml" \
      || fail 'migration new project does not have the synthetic project marker'
    [[ ! -e "$project_dir/supabase/.temp/project-ref" ]] || fail 'linked Supabase project metadata is forbidden'
  else
    [[ -n "$db_url_value" ]] || fail 'every SQL-capable CLI operation requires an explicit local --db-url'
    if [[ "$db_url_value" =~ ^postgresql://postgres:pr352_synthetic_only@127\.0\.0\.1:5432/(pr352_cli_[a-z_]+)\?sslmode=disable$ ]]; then
      database="${BASH_REMATCH[1]}"
    else
      fail 'CLI database URL is not the exact loopback synthetic form'
    fi
    verify_db "$database"
    local project_dir
    project_dir="$(pwd -P)"
    [[ "$project_dir" == "$TEMP_ROOT/"* ]] || fail 'SQL-capable CLI operation is outside the temporary project root'
    [[ ! -e "$project_dir/supabase/.temp/project-ref" ]] || fail 'linked Supabase project metadata is forbidden'
  fi
  [[ "$(timeout -k 5s 20s supabase --version)" == "$EXPECTED_CLI_VERSION" ]] || fail "Supabase CLI changed from ${EXPECTED_CLI_VERSION} during the matrix"
  # CLI 2.79.0 drops sslmode while round-tripping --db-url through ToPostgresURL.
  # Set the mode only after the URL has been proven to target marked loopback PostgreSQL.
  PGSSLMODE=disable timeout -k 5s 90s supabase "${original_args[@]}"
}

cli_project() (
  local project="$1"
  shift
  cd "$project"
  cli "$@"
)

start_case() {
  CURRENT_CASE="$1"
}

record_case() {
  local case_id="$1" summary="$2" cli_codes="$3" guard_codes="$4" sqlstate="$5"
  local ledger="$6" pending_versions="$7" remote_only_versions="$8"
  node - "$case_id" "$summary" "$cli_codes" "$guard_codes" "$sqlstate" \
    "$ledger" "$pending_versions" "$remote_only_versions" <<'NODE' >> "$RESULTS_NDJSON"
const [caseId, summary, cliCodes, guardCodes, sqlstate, ledgerState,
  pendingVersions, remoteOnlyVersions] = process.argv.slice(2);
const asCodes = (value) => value ? value.split(',').map((code) => Number(code)) : [];
const operationNames = {
  'CLI-01': ['migration fetch', 'migration list'],
  'CLI-02': ['db push --dry-run', 'migration list'],
  'CLI-03': ['db push --dry-run', 'migration list'],
  'CLI-04': ['migration new bridge', 'migration list', 'db push --dry-run'],
  'CLI-05': ['db push apply bridge', 'migration new v2', 'migration list', 'db push --dry-run v2'],
  'CLI-06': ['migration new unexpected', 'migration list', 'db push --dry-run both'],
  'CLI-07': ['migration list', 'db push --dry-run'],
  'CLI-08': ['migration list', 'db push --dry-run'],
  'CLI-09': ['migration new bridge', 'db push apply bridge', 'migration new v2', 'db push apply failing v2'],
  'CLI-10': ['db push apply v2', 'migration list', 'db push --dry-run empty'],
};
const guardNames = {
  'CLI-01': ['canonical ledger check'],
  'CLI-02': ['canonical guard rejects remote-only history'],
  'CLI-03': ['canonical guard rejects out-of-order pending'],
  'CLI-04': ['canonical guard authorizes bridge only'],
  'CLI-05': ['canonical guard authorizes v2 only'],
  'CLI-06': ['canonical guard accepts complete pending set', 'canonical guard rejects v2-only expected set'],
  'CLI-07': ['canonical guard rejects Preview migration'],
  'CLI-08': ['canonical guard accepts actual pending', 'canonical guard rejects unrelated expected version'],
  'CLI-09': [],
  'CLI-10': ['canonical ledger has no pending versions'],
};
const cliExitCodes = asCodes(cliCodes);
const guardExitCodes = asCodes(guardCodes);
if (!operationNames[caseId] || operationNames[caseId].length !== cliExitCodes.length
    || guardNames[caseId].length !== guardExitCodes.length) {
  throw new Error('result operation/code count mismatch for ' + caseId);
}
process.stdout.write(`${JSON.stringify({
  caseId,
  status: 'PASS',
  summary,
  cliOperations: operationNames[caseId].map((command, index) => ({ command, exitCode: cliExitCodes[index] })),
  guardChecks: guardNames[caseId].map((check, index) => ({ check, exitCode: guardExitCodes[index] })),
  sqlstate: sqlstate || null,
  ledgerState: ledgerState || null,
  pendingVersions: (pendingVersions || '').split(',').filter(Boolean),
  remoteOnlyVersions: (remoteOnlyVersions || '').split(',').filter(Boolean),
})}\n`);
NODE
}

verify_cli_ledger() {
  local project="$1" database="$2" expected="$3" output="$4"
  local url
  url="$(db_url "$database")"
  (
    cd "$project"
    cli migration list --db-url "$url" | tee "$output"
    node "$REPO_ROOT/scripts/supabase/verify-canonical-migration-ledger.mjs" \
      "$project/supabase/migrations" "$expected" "$output"
  )
}

expect_cli_failure() {
  local output="$1"
  shift
  local status=0
  if "$@" > "$output" 2>&1; then
    status=0
  else
    status=$?
  fi
  [[ "$status" != '0' ]] || fail "expected command failure but it returned success: $(basename "$output")"
  [[ "$status" != '124' && "$status" != '137' ]] || fail "command timed out while expecting a diagnostic: $(basename "$output")"
  LAST_FAILURE_STATUS="$status"
  printf 'EXPECTED_FAILURE: %s exit=%s\n' "$(basename "$output")" "$status"
}

wait_for_next_second() {
  local previous current
  previous="$(date -u +%Y%m%d%H%M%S)"
  for _ in $(seq 1 25); do
    current="$(date -u +%Y%m%d%H%M%S)"
    [[ "$current" != "$previous" ]] && return 0
    sleep 0.1
  done
  fail 'could not obtain a unique CLI-generated migration timestamp second'
}

new_migration() {
  local project="$1" name="$2"
  local before after generated
  before="$(find "$project/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort)"
  (
    cd "$project"
    cli migration new "$name" </dev/null >&2
  )
  after="$(find "$project/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort)"
  generated="$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after") )"
  [[ "$generated" =~ ^[0-9]{14}_${name}\.sql$ ]] || fail "migration new generated an unexpected path: ${generated}"
  printf '%s\n' "$project/supabase/migrations/$generated"
}

run_push_synthetic() {
  local project="$1" database="$2" url
  verify_db "$database"
  url="$(db_url "$database")"
  printf 'y\n' | cli_project "$project" db push --db-url "$url"
}

push_synthetic() {
  local project="$1" database="$2" output="$3"
  run_push_synthetic "$project" "$database" > "$output" 2>&1
}

assert_remote_versions() {
  local database="$1" expected="$2" actual url
  url="$(db_url "$database")"
  actual="$(psql_safe -Atqc "SELECT string_agg(version, ',' ORDER BY version) FROM supabase_migrations.schema_migrations" "$url")"
  [[ "$actual" == "$expected" ]] || fail "synthetic ledger changed unexpectedly for ${database}"
}

server_version="$(psql_safe -Atqc "SELECT current_setting('server_version_num')" "$ADMIN_DATABASE_URL")"
[[ "$server_version" == "$EXPECTED_PG_VERSION_NUM" ]] || fail "expected PostgreSQL 17.6 (170006), got ${server_version:-empty}"
SERVER_VERSION="$server_version"
bootstrap_database="$(psql_safe -Atqc 'SELECT current_database()' "$ADMIN_DATABASE_URL")"
[[ "$bootstrap_database" == 'pr352_cli_bootstrap' ]] || fail 'connected to unexpected synthetic bootstrap database'
printf 'TOOLCHAIN_PASS: Supabase CLI=%s PostgreSQL server_version_num=%s; all following connections use marked disposable databases.\n' "$EXPECTED_CLI_VERSION" "$server_version"

# Case 1: fetch reconstructs an exact synthetic file when local migrations are empty.
start_case 'CLI-01'
create_database pr352_cli_match
MATCH_PROJECT="$TEMP_ROOT/case-01-match"
mkdir -p "$MATCH_PROJECT/supabase/migrations"
cat > "$MATCH_PROJECT/supabase/config.toml" <<'TOML'
project_id = "pr352-cli-isolation-synthetic"

[db.migrations]
enabled = true
TOML
(
  cd "$MATCH_PROJECT"
  cli migration fetch --db-url "$(db_url pr352_cli_match)"
)
MATCH_FILE="$MATCH_PROJECT/supabase/migrations/${BASELINE_VERSION}_pr352_synthetic_baseline.sql"
[[ -f "$MATCH_FILE" ]] || fail 'Case 1 migration fetch did not create the expected file'
[[ "$(cat "$MATCH_FILE")" == 'CREATE TABLE public.pr352_cli_seed(id integer);' ]] || fail 'Case 1 fetched synthetic SQL differs from the ledger serialization'
verify_cli_ledger "$MATCH_PROJECT" pr352_cli_match NONE "$TEMP_ROOT/case-01-list.txt"
assert_remote_versions pr352_cli_match "$BASELINE_VERSION"
record_case 'CLI-01' 'migration fetch reconstructed exact synthetic SQL; guard and ledger agree' '0,0' '0' '' "$BASELINE_VERSION" '' ''
printf 'CASE_01_PASS: exact synthetic ledger/file match; migration fetch stayed in an empty temporary directory.\n'

# Case 2: an applied remote-only version is diagnosed, not silently ignored.
start_case 'CLI-02'
create_database pr352_cli_remote_only
REMOTE_ONLY_URL="$(db_url pr352_cli_remote_only)"
psql_safe -c "INSERT INTO supabase_migrations.schema_migrations(version, statements, name) VALUES ('20000101000001', ARRAY['CREATE TABLE public.pr352_remote_only(id integer)'], 'pr352_synthetic_remote_only')" "$REMOTE_ONLY_URL" >/dev/null
REMOTE_ONLY_PROJECT="$TEMP_ROOT/case-02-remote-only"
create_project "$REMOTE_ONLY_PROJECT"
expect_cli_failure "$TEMP_ROOT/case-02-push.txt" cli_project "$REMOTE_ONLY_PROJECT" db push --dry-run --db-url "$REMOTE_ONLY_URL"
CASE02_PUSH_EXIT="$LAST_FAILURE_STATUS"
grep -Eqi 'remote migration versions not found in local|remote.*missing.*local|missing local migration' \
  "$TEMP_ROOT/case-02-push.txt" || fail 'Case 2 CLI failure did not report a remote-only history mismatch'
(
  cd "$REMOTE_ONLY_PROJECT"
  cli migration list --db-url "$REMOTE_ONLY_URL" | tee "$TEMP_ROOT/case-02-list.txt"
)
expect_cli_failure "$TEMP_ROOT/case-02-guard.txt" node "$REPO_ROOT/scripts/supabase/verify-canonical-migration-ledger.mjs" "$REMOTE_ONLY_PROJECT/supabase/migrations" NONE "$TEMP_ROOT/case-02-list.txt"
CASE02_GUARD_EXIT="$LAST_FAILURE_STATUS"
assert_remote_versions pr352_cli_remote_only "${BASELINE_VERSION},20000101000001"
psql_safe -Atqc "SELECT to_regclass('public.pr352_remote_only') IS NULL" "$REMOTE_ONLY_URL" | grep -Fxq t || fail 'Case 2 unexpectedly created the remote-only test object'
record_case 'CLI-02' 'remote-only history is rejected without applying SQL' "$CASE02_PUSH_EXIT,0" "$CASE02_GUARD_EXIT" '' "${BASELINE_VERSION},20000101000001" '' '20000101000001'
printf 'CASE_02_PASS: CLI reports the remote-only version; no ledger row was changed.\n'

# Case 3: a local pending version older than the latest remote version is rejected.
start_case 'CLI-03'
create_database pr352_cli_old_pending
OLD_PENDING_URL="$(db_url pr352_cli_old_pending)"
psql_safe -c "INSERT INTO supabase_migrations.schema_migrations(version, statements, name) VALUES ('20261027000000', ARRAY['CREATE TABLE public.pr352_synthetic_remote_latest(id integer)'], 'pr352_synthetic_remote_latest')" "$OLD_PENDING_URL" >/dev/null
OLD_PENDING_PROJECT="$TEMP_ROOT/case-03-old-pending"
create_project "$OLD_PENDING_PROJECT"
printf 'CREATE TABLE public.pr352_synthetic_old_pending(id integer);\n' > "$OLD_PENDING_PROJECT/supabase/migrations/20261025000000_pr352_synthetic_old_pending.sql"
printf 'CREATE TABLE public.pr352_synthetic_remote_latest(id integer);\n' > "$OLD_PENDING_PROJECT/supabase/migrations/20261027000000_pr352_synthetic_remote_latest.sql"
expect_cli_failure "$TEMP_ROOT/case-03-push.txt" cli_project "$OLD_PENDING_PROJECT" db push --dry-run --db-url "$OLD_PENDING_URL"
CASE03_PUSH_EXIT="$LAST_FAILURE_STATUS"
grep -Eqi 'before the last migration|chronological|out.of.order|out of order' "$TEMP_ROOT/case-03-push.txt" \
  || fail 'Case 3 CLI failed for a reason other than an out-of-order local migration'
(
  cd "$OLD_PENDING_PROJECT"
  cli migration list --db-url "$OLD_PENDING_URL" | tee "$TEMP_ROOT/case-03-list.txt"
)
expect_cli_failure "$TEMP_ROOT/case-03-guard.txt" node "$REPO_ROOT/scripts/supabase/verify-canonical-migration-ledger.mjs" "$OLD_PENDING_PROJECT/supabase/migrations" 20261025000000 "$TEMP_ROOT/case-03-list.txt"
CASE03_GUARD_EXIT="$LAST_FAILURE_STATUS"
assert_remote_versions pr352_cli_old_pending "${BASELINE_VERSION},20261027000000"
psql_safe -Atqc "SELECT to_regclass('public.pr352_synthetic_old_pending') IS NULL" "$OLD_PENDING_URL" | grep -Fxq t || fail 'Case 3 unexpectedly created the old pending test object'
record_case 'CLI-03' 'out-of-order local migration is rejected by CLI and canonical guard' "$CASE03_PUSH_EXIT,0" "$CASE03_GUARD_EXIT" '' "${BASELINE_VERSION},20261027000000" '20261025000000' ''
printf 'CASE_03_PASS: older local pending version is rejected before any apply.\n'

# Case 4: a CLI-generated bridge is the only pending version after synthetic 3D.14.
start_case 'CLI-04'
create_database pr352_cli_phase_a
PHASE_A_PROJECT="$TEMP_ROOT/case-04-phase-a"
create_project "$PHASE_A_PROJECT"
seed_3d14_history pr352_cli_phase_a
write_3d14_synthetic_file "$PHASE_A_PROJECT"
wait_for_next_second
BRIDGE_FILE="$(new_migration "$PHASE_A_PROJECT" pr352_bridge_v1_probe)"
BRIDGE_VERSION="$(basename "$BRIDGE_FILE" | cut -c1-14)"
printf 'CREATE TABLE public.pr352_bridge_probe(id integer);\n' > "$BRIDGE_FILE"
verify_cli_ledger "$PHASE_A_PROJECT" pr352_cli_phase_a "$BRIDGE_VERSION" "$TEMP_ROOT/case-04-list.txt"
PHASE_A_URL="$(db_url pr352_cli_phase_a)"
(
  cd "$PHASE_A_PROJECT"
  cli db push --dry-run --db-url "$PHASE_A_URL" 2>&1 | tee "$TEMP_ROOT/case-04-dry-run.txt"
)
grep -Fq "$BRIDGE_VERSION" "$TEMP_ROOT/case-04-dry-run.txt" || fail 'Case 4 dry-run omitted the bridge version'
[[ "$(grep -Ec 'Would push these migrations|pr352_bridge_v1_probe' "$TEMP_ROOT/case-04-dry-run.txt")" -ge 1 ]] || fail 'Case 4 dry-run did not identify the bridge migration'
assert_remote_versions pr352_cli_phase_a "${BASELINE_VERSION},${THREED14_VERSION}"
psql_safe -Atqc "SELECT to_regclass('public.pr352_bridge_probe') IS NULL" "$PHASE_A_URL" | grep -Fxq t || fail 'Case 4 dry-run unexpectedly created the bridge table'
record_case 'CLI-04' 'only synthetic bridge is selected after synthetic 3D.14; dry-run made no change' '0,0,0' '0' '' "${BASELINE_VERSION},${THREED14_VERSION}" "$BRIDGE_VERSION" ''
printf 'CASE_04_PASS: only the CLI-generated bridge is selected after synthetic 3D.14.\n'

# Case 5: once bridge is applied, v2 is the only pending migration; then re-run the dry-run.
start_case 'CLI-05'
push_synthetic "$PHASE_A_PROJECT" pr352_cli_phase_a "$TEMP_ROOT/case-05-bridge-apply.txt" || fail 'Case 5 failed to apply the synthetic bridge'
grep -Fq 'Finished supabase db push' "$TEMP_ROOT/case-05-bridge-apply.txt" || fail 'Case 5 bridge apply did not finish cleanly'
psql_safe -Atqc "SELECT to_regclass('public.pr352_bridge_probe') IS NOT NULL" "$PHASE_A_URL" | grep -Fxq t || fail 'Case 5 bridge table is missing after apply'
assert_remote_versions pr352_cli_phase_a "${BASELINE_VERSION},${THREED14_VERSION},${BRIDGE_VERSION}"
wait_for_next_second
V2_FILE="$(new_migration "$PHASE_A_PROJECT" pr352_supervision_v2_probe)"
V2_VERSION="$(basename "$V2_FILE" | cut -c1-14)"
printf 'CREATE TABLE public.pr352_v2_probe(id integer);\n' > "$V2_FILE"
verify_cli_ledger "$PHASE_A_PROJECT" pr352_cli_phase_a "$V2_VERSION" "$TEMP_ROOT/case-05-v2-list.txt"
(
  cd "$PHASE_A_PROJECT"
  cli db push --dry-run --db-url "$PHASE_A_URL" 2>&1 | tee "$TEMP_ROOT/case-05-v2-dry-run.txt"
)
grep -Fq "$V2_VERSION" "$TEMP_ROOT/case-05-v2-dry-run.txt" || fail 'Case 5 dry-run omitted the v2 version'
! grep -Fq "$BRIDGE_VERSION" "$TEMP_ROOT/case-05-v2-dry-run.txt" || fail 'Case 5 unexpectedly selected the already-applied bridge'
psql_safe -Atqc "SELECT to_regclass('public.pr352_v2_probe') IS NULL" "$PHASE_A_URL" | grep -Fxq t || fail 'Case 5 v2 dry-run unexpectedly created its table'
record_case 'CLI-05' 'bridge applied once; v2 alone is selected and has not been applied' '0,0,0,0' '0' '' "${BASELINE_VERSION},${THREED14_VERSION},${BRIDGE_VERSION}" "$V2_VERSION" ''
printf 'CASE_05_PASS: v2 alone is pending after the bridge ledger entry is confirmed.\n'

# Case 6: two pending versions are both selected; the exact-set guard rejects authorizing only v2.
start_case 'CLI-06'
wait_for_next_second
UNEXPECTED_FILE="$(new_migration "$PHASE_A_PROJECT" pr352_unexpected_probe)"
UNEXPECTED_VERSION="$(basename "$UNEXPECTED_FILE" | cut -c1-14)"
printf 'CREATE TABLE public.pr352_unexpected_probe(id integer);\n' > "$UNEXPECTED_FILE"
verify_cli_ledger "$PHASE_A_PROJECT" pr352_cli_phase_a "$V2_VERSION,$UNEXPECTED_VERSION" "$TEMP_ROOT/case-06-list.txt"
(
  cd "$PHASE_A_PROJECT"
  cli db push --dry-run --db-url "$PHASE_A_URL" 2>&1 | tee "$TEMP_ROOT/case-06-dry-run.txt"
)
grep -Fq "$V2_VERSION" "$TEMP_ROOT/case-06-dry-run.txt" || fail 'Case 6 dry-run omitted v2'
grep -Fq "$UNEXPECTED_VERSION" "$TEMP_ROOT/case-06-dry-run.txt" || fail 'Case 6 dry-run omitted the unexpected migration'
expect_cli_failure "$TEMP_ROOT/case-06-guard.txt" node "$REPO_ROOT/scripts/supabase/verify-canonical-migration-ledger.mjs" "$PHASE_A_PROJECT/supabase/migrations" "$V2_VERSION" "$TEMP_ROOT/case-06-list.txt"
CASE06_GUARD_EXIT="$LAST_FAILURE_STATUS"
assert_remote_versions pr352_cli_phase_a "${BASELINE_VERSION},${THREED14_VERSION},${BRIDGE_VERSION}"
psql_safe -Atqc "SELECT to_regclass('public.pr352_v2_probe') IS NULL AND to_regclass('public.pr352_unexpected_probe') IS NULL" "$PHASE_A_URL" | grep -Fxq t || fail 'Case 6 unexpectedly applied one or more pending objects'
record_case 'CLI-06' 'dry-run selects both pending versions; exact-set guard rejects one-version authorization' '0,0,0' "0,$CASE06_GUARD_EXIT" '' "${BASELINE_VERSION},${THREED14_VERSION},${BRIDGE_VERSION}" "$V2_VERSION,$UNEXPECTED_VERSION" ''
printf 'CASE_06_PASS: CLI selects both pending files; exact-set guard refuses a one-version authorization.\n'

# Case 7: a Preview-only legal file in the Productive directory is treated as pending and rejected.
start_case 'CLI-07'
create_database pr352_cli_preview
PREVIEW_PROJECT="$TEMP_ROOT/case-07-preview"
create_project "$PREVIEW_PROJECT"
printf 'CREATE TABLE public.pr352_preview_only_probe(id integer);\n' \
  > "$PREVIEW_PROJECT/supabase/migrations/20261008180000_create_legal_policy_previews.sql"
PREVIEW_URL="$(db_url pr352_cli_preview)"
(
  cd "$PREVIEW_PROJECT"
  cli migration list --db-url "$PREVIEW_URL" | tee "$TEMP_ROOT/case-07-list.txt"
)
expect_cli_failure "$TEMP_ROOT/case-07-guard.txt" node "$REPO_ROOT/scripts/supabase/verify-canonical-migration-ledger.mjs" "$PREVIEW_PROJECT/supabase/migrations" NONE "$TEMP_ROOT/case-07-list.txt"
CASE07_GUARD_EXIT="$LAST_FAILURE_STATUS"
(
  cd "$PREVIEW_PROJECT"
  cli db push --dry-run --db-url "$PREVIEW_URL" 2>&1 | tee "$TEMP_ROOT/case-07-dry-run.txt"
)
grep -Fq '20261008180000' "$TEMP_ROOT/case-07-dry-run.txt" || fail 'Case 7 did not report the misplaced Preview timestamp as pending'
assert_remote_versions pr352_cli_preview "$BASELINE_VERSION"
psql_safe -Atqc "SELECT to_regclass('public.pr352_preview_only_probe') IS NULL" "$PREVIEW_URL" | grep -Fxq t || fail 'Case 7 unexpectedly executed Preview SQL'
record_case 'CLI-07' 'Preview-only timestamp is detected as pending and never executed' '0,0' "$CASE07_GUARD_EXIT" '' "$BASELINE_VERSION" '20261008180000' ''
printf 'CASE_07_PASS: misplaced Preview version is detected as pending; no Preview SQL was executed.\n'

# Case 8: the exact-set guard rejects an expected version that is not actually pending.
start_case 'CLI-08'
create_database pr352_cli_unexpected
UNEXPECTED_PROJECT="$TEMP_ROOT/case-08-unexpected"
create_project "$UNEXPECTED_PROJECT"
printf 'CREATE TABLE public.pr352_unexpected_only_probe(id integer);\n' \
  > "$UNEXPECTED_PROJECT/supabase/migrations/20261029000000_pr352_unexpected_only_probe.sql"
UNEXPECTED_URL="$(db_url pr352_cli_unexpected)"
verify_cli_ledger "$UNEXPECTED_PROJECT" pr352_cli_unexpected 20261029000000 "$TEMP_ROOT/case-08-list.txt"
(
  cd "$UNEXPECTED_PROJECT"
  cli db push --dry-run --db-url "$UNEXPECTED_URL" 2>&1 | tee "$TEMP_ROOT/case-08-dry-run.txt"
)
expect_cli_failure "$TEMP_ROOT/case-08-guard.txt" node "$REPO_ROOT/scripts/supabase/verify-canonical-migration-ledger.mjs" "$UNEXPECTED_PROJECT/supabase/migrations" 20990101000000 "$TEMP_ROOT/case-08-list.txt"
CASE08_GUARD_EXIT="$LAST_FAILURE_STATUS"
assert_remote_versions pr352_cli_unexpected "$BASELINE_VERSION"
grep -Fq '20261029000000' "$TEMP_ROOT/case-08-dry-run.txt" || fail 'Case 8 CLI did not list the one synthetic pending version'
psql_safe -Atqc "SELECT to_regclass('public.pr352_unexpected_only_probe') IS NULL" "$UNEXPECTED_URL" | grep -Fxq t || fail 'Case 8 unexpectedly applied its synthetic pending object'
record_case 'CLI-08' 'actual pending version is visible; guard rejects a different expected version' '0,0' "0,$CASE08_GUARD_EXIT" '' "$BASELINE_VERSION" '20261029000000' ''
printf 'CASE_08_PASS: CLI reports the pending file, while the guard rejects the non-pending requested version.\n'

# Case 9: failed v2 after a confirmed bridge preserves the bridge and rolls back only the failed migration.
start_case 'CLI-09'
create_database pr352_cli_failure
FAIL_PROJECT="$TEMP_ROOT/case-09-failure"
create_project "$FAIL_PROJECT"
seed_3d14_history pr352_cli_failure
write_3d14_synthetic_file "$FAIL_PROJECT"
wait_for_next_second
FAIL_BRIDGE_FILE="$(new_migration "$FAIL_PROJECT" pr352_bridge_v1_failure_probe)"
FAIL_BRIDGE_VERSION="$(basename "$FAIL_BRIDGE_FILE" | cut -c1-14)"
printf 'CREATE TABLE public.pr352_failure_bridge(id integer);\n' > "$FAIL_BRIDGE_FILE"
push_synthetic "$FAIL_PROJECT" pr352_cli_failure "$TEMP_ROOT/case-09-bridge-apply.txt" || fail 'Case 9 bridge setup did not apply'
FAIL_URL="$(db_url pr352_cli_failure)"
psql_safe -Atqc "SELECT to_regclass('public.pr352_failure_bridge') IS NOT NULL" "$FAIL_URL" | grep -Fxq t || fail 'Case 9 confirmed bridge table is missing'
wait_for_next_second
FAIL_V2_FILE="$(new_migration "$FAIL_PROJECT" pr352_supervision_v2_failure_probe)"
FAIL_V2_VERSION="$(basename "$FAIL_V2_FILE" | cut -c1-14)"
printf 'CREATE TABLE public.pr352_v2_must_rollback(id integer);\nSELECT 1 / 0;\n' > "$FAIL_V2_FILE"
expect_cli_failure "$TEMP_ROOT/case-09-v2-failure.txt" run_push_synthetic "$FAIL_PROJECT" pr352_cli_failure
CASE09_V2_EXIT="$LAST_FAILURE_STATUS"
grep -Eqi 'division by zero' "$TEMP_ROOT/case-09-v2-failure.txt" || fail 'Case 9 did not preserve the PostgreSQL division-by-zero diagnostic'
grep -Fq '22012' "$TEMP_ROOT/case-09-v2-failure.txt" || fail 'Case 9 did not preserve PostgreSQL SQLSTATE 22012'
assert_remote_versions pr352_cli_failure "${BASELINE_VERSION},${THREED14_VERSION},${FAIL_BRIDGE_VERSION}"
psql_safe -Atqc "SELECT to_regclass('public.pr352_failure_bridge') IS NOT NULL" "$FAIL_URL" | grep -Fxq t || fail 'Case 9 failure removed the previously applied bridge'
psql_safe -Atqc "SELECT to_regclass('public.pr352_v2_must_rollback') IS NULL" "$FAIL_URL" | grep -Fxq t || fail 'Case 9 failed migration left partial DDL behind'
record_case 'CLI-09' 'v2 failed with SQLSTATE 22012; bridge remains and v2 table/history rolled back' '0,0,0,1' '' '22012' "${BASELINE_VERSION},${THREED14_VERSION},${FAIL_BRIDGE_VERSION}" "$FAIL_V2_VERSION" ''
printf 'CASE_09_PASS: failure was reported; prior bridge remains and v2 DDL/history rolled back.\n'

# Case 10: after the v2 success path, repeated dry-run reports an empty pending set.
start_case 'CLI-10'
rm -f -- "$UNEXPECTED_FILE"
push_synthetic "$PHASE_A_PROJECT" pr352_cli_phase_a "$TEMP_ROOT/case-10-v2-apply.txt" || fail 'Case 10 failed to apply synthetic v2'
grep -Fq 'Finished supabase db push' "$TEMP_ROOT/case-10-v2-apply.txt" || fail 'Case 10 v2 apply did not finish cleanly'
verify_cli_ledger "$PHASE_A_PROJECT" pr352_cli_phase_a NONE "$TEMP_ROOT/case-10-final-list.txt"
(
  cd "$PHASE_A_PROJECT"
  cli db push --dry-run --db-url "$PHASE_A_URL" 2>&1 | tee "$TEMP_ROOT/case-10-final-dry-run.txt"
)
grep -Eqi 'up to date|no pending|nothing to push' "$TEMP_ROOT/case-10-final-dry-run.txt" || fail 'Case 10 repeated dry-run did not report no pending migrations'
assert_remote_versions pr352_cli_phase_a "${BASELINE_VERSION},${THREED14_VERSION},${BRIDGE_VERSION},${V2_VERSION}"
psql_safe -Atqc "SELECT to_regclass('public.pr352_v2_probe') IS NOT NULL" "$PHASE_A_URL" | grep -Fxq t || fail 'Case 10 v2 table is missing after apply'
record_case 'CLI-10' 'v2 applied once; final ledger and object exist; next dry-run is empty' '0,0,0' '0' '' "${BASELINE_VERSION},${THREED14_VERSION},${BRIDGE_VERSION},${V2_VERSION}" '' ''
printf 'CASE_10_PASS: successful synthetic migrations are recorded once and the next dry-run is empty.\n'

printf 'PR352_CLI_ISOLATION_PASS: PostgreSQL=%s CLI=%s matrix=10/10; real QA SQL bodies were not loaded or executed.\n' \
  "$EXPECTED_PG_VERSION_NUM" "$EXPECTED_CLI_VERSION"
