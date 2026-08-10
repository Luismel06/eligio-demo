#!/usr/bin/env bash
set -Eeuo pipefail

readonly DATABASE_NAME="rivnu_production"
readonly MIGRATOR_ROLE="rivnu_migrator"
readonly RUNTIME_ROLE="rivnu_runtime"
readonly BUNDLE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly DUMP_FILE="${BUNDLE_DIR}/rivnu-production-final.dump"
readonly HASH_FILE="${BUNDLE_DIR}/rivnu-production-final.dump.sha256"
readonly SECRET_FILE="${BUNDLE_DIR}/rivnu-rehearsal-db.env"
readonly BACKUP_ROOT="/var/backups/corestack/postgresql"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

for file in "$DUMP_FILE" "$HASH_FILE" "$SECRET_FILE"; do
  [[ -f "$file" ]] || { echo "Missing required file: $file" >&2; exit 1; }
done
[[ $(stat -c '%a' "$SECRET_FILE") == "600" ]] || { echo "Secret file must have mode 0600." >&2; exit 1; }

# shellcheck disable=SC1090
source "$SECRET_FILE"
: "${RIVNU_MIGRATOR_PASSWORD:?missing migrator password}"
: "${RIVNU_RUNTIME_PASSWORD:?missing runtime password}"

expected_hash="$(awk 'NR == 1 {print $1}' "$HASH_FILE")"
actual_hash="$(sha256sum "$DUMP_FILE" | awk '{print $1}')"
[[ -n "$expected_hash" && "$actual_hash" == "$expected_hash" ]] || {
  echo "Dump SHA-256 verification failed." >&2
  exit 2
}
echo "Dump SHA-256: verified"

psql_admin=(sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p 5432)
server_version_num="$("${psql_admin[@]}" -Atqc "select current_setting('server_version_num');")"
(( server_version_num >= 170000 )) || { echo "PostgreSQL 17+ is required on port 5432." >&2; exit 3; }

action="${1:-audit}"

validate() {
  "${psql_admin[@]}" -P pager=off --dbname="$DATABASE_NAME" <<'SQL'
SELECT current_setting('server_version') AS server_version;
SELECT count(*) AS public_tables FROM information_schema.tables WHERE table_schema = 'public';
SELECT
  (SELECT count(*) FROM public."_prisma_migrations") AS migration_rows,
  (SELECT count(*) FROM public."Tenant") AS tenants,
  (SELECT count(*) FROM public."User") AS users,
  (SELECT count(*) FROM public."Membership") AS memberships,
  (SELECT count(*) FROM public."Product") AS products,
  (SELECT count(*) FROM public."Customer") AS customers,
  (SELECT count(*) FROM public."Supplier") AS suppliers,
  (SELECT count(*) FROM public."Invoice") AS invoices,
  (SELECT count(*) FROM public."SalesOrder") AS sales_orders,
  (SELECT count(*) FROM public."PurchaseOrder") AS purchase_orders,
  (SELECT count(*) FROM public."AuditLog") AS audit_logs;
SELECT t."slug", count(p.*) AS products
FROM public."Tenant" t
LEFT JOIN public."Product" p ON p."tenantId" = t.id
GROUP BY t."slug"
ORDER BY t."slug";
SQL
}

case "$action" in
  audit)
    "${psql_admin[@]}" -P pager=off -c "select datname, pg_get_userbyid(datdba) as owner from pg_database where datname in ('rivnu_rehearsal', '${DATABASE_NAME}') order by datname;"
    ;;
  apply)
    exists="$("${psql_admin[@]}" -Atqc "select 1 from pg_database where datname = '${DATABASE_NAME}';")"
    [[ -z "$exists" ]] || { echo "Refusing restore: ${DATABASE_NAME} already exists." >&2; exit 4; }

    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_dir="${BACKUP_ROOT}/${timestamp}-before-rivnu-production-restore"
    install -d -m 0750 -o postgres -g postgres "$backup_dir"
    install -m 0600 -o postgres -g postgres "$DUMP_FILE" "$backup_dir/rivnu-production-final.dump"
    cp "$HASH_FILE" "$backup_dir/rivnu-production-final.dump.sha256"
    "${psql_admin[@]}" -Atqc 'select datname from pg_database order by datname;' > "$backup_dir/databases-before.txt"
    "${psql_admin[@]}" -Atqc 'select rolname from pg_roles order by rolname;' > "$backup_dir/roles-before.txt"

    created_database=false
    cleanup() {
      if [[ "$created_database" == true ]]; then
        sudo -u postgres psql -X -p 5432 -v ON_ERROR_STOP=1 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '${DATABASE_NAME}' and pid <> pg_backend_pid();" >/dev/null || true
        sudo -u postgres dropdb -p 5432 "$DATABASE_NAME" || true
      fi
    }
    trap 'echo "Restore failed; removing incomplete production database." >&2; cleanup' ERR

    "${psql_admin[@]}" \
      --set=migrator_password="$RIVNU_MIGRATOR_PASSWORD" \
      --set=runtime_password="$RIVNU_RUNTIME_PASSWORD" <<'SQL'
SELECT format('ALTER ROLE rivnu_migrator PASSWORD %L', :'migrator_password') \gexec
SELECT format('ALTER ROLE rivnu_runtime PASSWORD %L', :'runtime_password') \gexec
SQL

    sudo -u postgres createdb -p 5432 --owner="$MIGRATOR_ROLE" --encoding=UTF8 --template=template0 "$DATABASE_NAME"
    created_database=true
    "${psql_admin[@]}" -c "REVOKE ALL ON DATABASE ${DATABASE_NAME} FROM PUBLIC; GRANT CONNECT, TEMPORARY ON DATABASE ${DATABASE_NAME} TO ${RUNTIME_ROLE};"
    sudo -u postgres pg_restore --dbname="$DATABASE_NAME" --role="$MIGRATOR_ROLE" --no-owner --no-privileges --exit-on-error "$backup_dir/rivnu-production-final.dump"
    "${psql_admin[@]}" --dbname="$DATABASE_NAME" <<SQL
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO ${MIGRATOR_ROLE};
GRANT USAGE ON SCHEMA public TO ${RUNTIME_ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RUNTIME_ROLE};
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${RUNTIME_ROLE};
ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATOR_ROLE} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${RUNTIME_ROLE};
ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATOR_ROLE} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${RUNTIME_ROLE};
SQL
    validate
    trap - ERR
    echo "Pre-restore metadata and immutable dump copy: $backup_dir"
    echo "Production database restore completed. Do not run seed or prisma migrate deploy."
    ;;
  *)
    echo "Usage: $0 audit|apply" >&2
    exit 64
    ;;
esac
