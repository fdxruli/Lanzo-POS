#!/usr/bin/env bash
set -euo pipefail

database="${1:-fin01_cert_final}"
if [[ ! "${database}" =~ ^fin01_cert[a-z0-9_]*$ ]]; then
  echo "FIN01_FIXTURE_DATABASE_REQUIRED" >&2
  exit 2
fi

fixture_dir=docs/reports/fin01-r22
raw_evidence="${fixture_dir}/raw-evidence.zip"
container_id="${PG_CONTAINER_ID:-}"

if [[ -z "${container_id}" ]]; then
  echo "FIN01_EPHEMERAL_POSTGRES_CONTAINER_REQUIRED" >&2
  exit 2
fi

if [[ ! -f "${raw_evidence}" ]]; then
  echo "FIN01_RAW_EVIDENCE_ARCHIVE_MISSING" >&2
  exit 2
fi

docker exec "${container_id}" pg_isready -U postgres -d postgres
version_num="$(docker exec "${container_id}" psql -X -A -t -U postgres -d postgres -c 'show server_version_num')"
if [[ ! "${version_num}" =~ ^17 ]]; then
  echo "FIN01_POSTGRES_17_REQUIRED: ${version_num}" >&2
  exit 2
fi

unzip -oq "${raw_evidence}" -d "${fixture_dir}"
node scripts/fin01/build-isolated-fixture.mjs
docker exec "${container_id}" createdb -U postgres "${database}"

for fixture in \
  "${fixture_dir}/isolated-schema.sql" \
  "${fixture_dir}/extra-functions.sql" \
  "${fixture_dir}/isolated-cancel-payment.sql" \
  scripts/fin01/seed.sql \
  supabase/migrations/20261022135915_fin01_historical_credit_owner_authorization.sql
do
  echo "APPLY_SYNTHETIC_FIXTURE ${fixture}"
  docker exec -i "${container_id}" psql -X -v ON_ERROR_STOP=1 -U postgres -d "${database}" < "${fixture}"
done

echo "FIN01_SYNTHETIC_PG17_FIXTURE_READY database=${database} server_version_num=${version_num}"
