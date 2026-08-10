#!/usr/bin/env bash
set -Eeuo pipefail

readonly DATABASE_NAME="rivnu_rehearsal"
readonly MIGRATOR_ROLE="rivnu_migrator"
readonly RUNTIME_ROLE="rivnu_runtime"
readonly BUNDLE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly DUMP_FILE="${BUNDLE_DIR}/rivnu-source-public.dump"
readonly HASH_FILE="${BUNDLE_DIR}/rivnu-source-public.dump.sha256"
readonly BACKUP_ROOT="/var/backups/corestack/postgresql"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

if [[ ! -f "$DUMP_FILE" || ! -f "$HASH_FILE" ]]; then
  echo "Dump or hash file is missing from $BUNDLE_DIR." >&2
  exit 1
fi

expected_hash="$(awk 'NR == 1 {print $1}' "$HASH_FILE")"
actual_hash="$(sha256sum "$DUMP_FILE" | awk '{print $1}')"
if [[ -z "$expected_hash" || "$actual_hash" != "$expected_hash" ]]; then
  echo "Dump SHA-256 verification failed." >&2
  exit 2
fi
echo "Dump SHA-256: verified"

server_version_num="$(sudo -u postgres psql -X -p 5432 -Atqc "select current_setting('server_version_num');")"
if (( server_version_num < 170000 )); then
  echo "Refusing restore: PostgreSQL 17+ is required on port 5432." >&2
  exit 3
fi

table_count="$(sudo -u postgres psql -X -p 5432 -d "$DATABASE_NAME" -Atqc "select count(*) from information_schema.tables where table_schema='public';")"
if [[ "$table_count" != "0" ]]; then
  echo "Refusing restore: ${DATABASE_NAME} is not empty (${table_count} public tables)." >&2
  exit 4
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${BACKUP_ROOT}/${timestamp}-before-rivnu-restore"
install -d -m 0750 -o postgres -g postgres "$backup_dir"
restore_dump="$backup_dir/rivnu-source-public.dump"
install -m 0600 -o postgres -g postgres "$DUMP_FILE" "$restore_dump"
sudo -u postgres pg_dump -p 5432 --format=custom --no-owner --no-privileges \
  --file="$backup_dir/rivnu-rehearsal-empty.dump" "$DATABASE_NAME"
sudo -u postgres psql -X -p 5432 -Atqc 'select rolname from pg_roles order by rolname;' \
  > "$backup_dir/roles-before.txt"

sudo -u postgres psql -X -p 5432 -v ON_ERROR_STOP=1 --dbname="$DATABASE_NAME" \
  -c 'DROP SCHEMA public;'

sudo -u postgres pg_restore \
  --dbname="$DATABASE_NAME" \
  --role="$MIGRATOR_ROLE" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$restore_dump"

sudo -u postgres psql -X -p 5432 -v ON_ERROR_STOP=1 --dbname="$DATABASE_NAME" <<SQL
GRANT USAGE ON SCHEMA public TO ${RUNTIME_ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RUNTIME_ROLE};
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${RUNTIME_ROLE};
ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATOR_ROLE} IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${RUNTIME_ROLE};
ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATOR_ROLE} IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${RUNTIME_ROLE};
SQL

echo "== Restore validation =="
sudo -u postgres psql -X -p 5432 -P pager=off --dbname="$DATABASE_NAME" <<'SQL'
SELECT current_setting('server_version') AS server_version;
SELECT count(*) AS public_tables
FROM information_schema.tables
WHERE table_schema = 'public';
SELECT
  (SELECT count(*) FROM public."_prisma_migrations") AS migration_rows,
  (SELECT count(*) FROM public."Tenant") AS tenants,
  (SELECT count(*) FROM public."User") AS users,
  (SELECT count(*) FROM public."Membership") AS memberships,
  (SELECT count(*) FROM public."CompanyBranding") AS branding,
  (SELECT count(*) FROM public."CashRegister") AS cash_registers,
  (SELECT count(*) FROM public."FiscalSequence") AS fiscal_sequences;
SELECT
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

echo "Pre-restore backup: $backup_dir"
echo "Restore completed. Do not run seed or migrate deploy."
