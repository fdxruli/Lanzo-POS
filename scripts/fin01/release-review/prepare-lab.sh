#!/usr/bin/env bash
set -euo pipefail

database="${1:-fin01_cert_template}"
if [[ ! "${database}" =~ ^fin01_cert_[a-z0-9_]+$ ]]; then
  echo "FIN01_SYNTHETIC_DATABASE_REQUIRED" >&2
  exit 2
fi
container_id="${PG_CONTAINER_ID:-}"
if [[ -z "${container_id}" ]]; then
  echo "FIN01_EPHEMERAL_POSTGRES_CONTAINER_REQUIRED" >&2
  exit 2
fi

readonly base_sha='1a0d758d09310f2914c475c37d358c4cf885cc01'
readonly lab_branch='lab/fin01-pg17-recovery-20261029'
readonly evidence_commit='9853236a31d55d9cb6542364c30e9e06be6eddd3'
readonly public_source_commit='fd4975ea8b525f2e0b1a812e91142b24fd435dc3'
readonly evidence_zip_sha='a55890947a22dc3601100e443ad23c278ba53e17a2dc3f35df477f91f7d98fd3'
readonly migration_3d14='supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql'
readonly migration_3d14_sha='02eafa69f7a91343890ecc3cb2515cb37d4fcddb1de0f0fe187aa3db9a26a18b'
readonly fixture_dir='docs/reports/fin01-r22/release-review/fixtures'
readonly temp_dir="$(mktemp -d)"
trap 'rm -rf "${temp_dir}"' EXIT

# The exact previous evidence commit is immutable. Fetch its public ref, then
# prove it and the canonical source commit remain beneath the approved base.
git fetch --no-tags origin "refs/heads/${lab_branch}:refs/remotes/origin/${lab_branch}"
git fetch --no-tags origin "refs/heads/main:refs/remotes/origin/main"
test "$(git rev-parse refs/remotes/origin/main)" = "${base_sha}"
git cat-file -e "${evidence_commit}^{commit}"
git cat-file -e "${public_source_commit}^{commit}"
git merge-base --is-ancestor "${evidence_commit}" "refs/remotes/origin/${lab_branch}"
git merge-base --is-ancestor "${public_source_commit}" "${base_sha}"

version_num="$(docker exec "${container_id}" psql -X -A -t -U postgres -d postgres -c 'show server_version_num')"
if [[ "${version_num}" != '170011' && "${version_num}" != '170006' ]]; then
  echo "FIN01_PG17_6_OR_17_11_REQUIRED:${version_num}" >&2
  exit 2
fi

mkdir -p "${fixture_dir}" artifacts/fin01/logs
git show "${evidence_commit}:docs/reports/fin01-r22/raw-evidence.zip" > "${temp_dir}/raw-evidence.zip"
printf '%s  %s\n' "${evidence_zip_sha}" "${temp_dir}/raw-evidence.zip" | sha256sum --check --status
unzip -t "${temp_dir}/raw-evidence.zip" >/dev/null
for name in extra-functions.sql fixture-defaults.sql isolated-cancel-payment.sql; do
  unzip -p "${temp_dir}/raw-evidence.zip" "${name}" > "${fixture_dir}/${name}"
done
git show "${evidence_commit}:docs/reports/fin01-r22/fixture-functions.json" > "${fixture_dir}/fixture-functions.json"
git show "${evidence_commit}:docs/reports/fin01-r22/fixture-tables.json" > "${fixture_dir}/fixture-tables.json"
git show "${public_source_commit}:supabase/tests/fixtures/pr338-real-financial/02-function-sources.json" > "${temp_dir}/02-function-sources.json"
git show "${public_source_commit}:supabase/tests/fixtures/pr338-real-financial/06-function-acl.sql" > "${temp_dir}/06-function-acl.sql"

node scripts/fin01/release-review/hydrate-public-lab-sources.mjs \
  "--sources=${temp_dir}/02-function-sources.json" \
  "--acl=${temp_dir}/06-function-acl.sql" \
  "--fixtures=${fixture_dir}"
node scripts/fin01/release-review/build-isolated-fixture.mjs

if [[ "$(sha256sum "${migration_3d14}" | awk '{print $1}')" != "${migration_3d14_sha}" ]]; then
  echo 'CANONICAL_3D14_MIGRATION_SHA256_MISMATCH' >&2
  exit 2
fi

docker exec -i "${container_id}" createdb -U postgres "${database}"
for fixture in \
  "${fixture_dir}/isolated-schema.sql" \
  "${fixture_dir}/extra-functions.sql" \
  "${fixture_dir}/isolated-cancel-payment.sql" \
  scripts/fin01/release-review/seed.sql \
  "${fixture_dir}/pre-3d14-source-functions.sql" \
  "${migration_3d14}"
do
  echo "APPLY_HASH_PINNED_SYNTHETIC_FIXTURE_OR_CANONICAL_MIGRATION ${fixture}"
  docker exec -i "${container_id}" psql -X -v ON_ERROR_STOP=1 -U postgres -d "${database}" < "${fixture}"
done

echo "VERIFY_POST_3D14_REPLAY_CATALOG_PROFILE ${database}"
node scripts/fin01/release-review/verify-post3d14-replay.mjs \
  | docker exec -i "${container_id}" psql -X -v ON_ERROR_STOP=1 -U postgres -d "${database}"

echo "SEED_SYNTHETIC_VERSION_ONLY_LEDGER ${database}"
node scripts/fin01/release-review/render-synthetic-ledger.mjs \
  | docker exec -i "${container_id}" psql -X -v ON_ERROR_STOP=1 -U postgres -d "${database}"

docker exec "${container_id}" psql -X -v ON_ERROR_STOP=1 -U postgres -d "${database}" \
  -c "alter database ${database} set application_name='fin01-selective-lab';"

echo "FIN01_SYNTHETIC_POST_3D14_REPLAY_READY database=${database} server_version_num=${version_num} ledger_rows=333 evidence_commit=${evidence_commit}"
