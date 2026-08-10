#!/usr/bin/env bash
set -Eeuo pipefail

readonly DATABASE_NAME="rivnu_rehearsal"
readonly MIGRATOR_ROLE="rivnu_migrator"
readonly RUNTIME_ROLE="rivnu_runtime"
readonly SECRET_FILE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/rivnu-rehearsal-db.env"
readonly BACKUP_ROOT="/var/backups/corestack/postgresql"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

if [[ ! -f "$SECRET_FILE" ]]; then
  echo "Missing protected secret file: $SECRET_FILE" >&2
  exit 1
fi

if [[ $(stat -c '%a' "$SECRET_FILE") != "600" ]]; then
  echo "Secret file must have mode 0600." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$SECRET_FILE"
: "${RIVNU_MIGRATOR_PASSWORD:?missing migrator password}"
: "${RIVNU_RUNTIME_PASSWORD:?missing runtime password}"

psql_admin=(sudo -u postgres psql -X -v ON_ERROR_STOP=1)
action="${1:-audit}"

audit() {
  "${psql_admin[@]}" -P pager=off -c "select datname, pg_get_userbyid(datdba) as owner from pg_database where datname = '${DATABASE_NAME}';"
  "${psql_admin[@]}" -P pager=off -c "select rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin from pg_roles where rolname in ('${MIGRATOR_ROLE}', '${RUNTIME_ROLE}') order by rolname;"
}

case "$action" in
  audit)
    audit
    ;;
  apply)
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_dir="${BACKUP_ROOT}/${timestamp}-before-rivnu-rehearsal"
    install -d -m 0750 -o postgres -g postgres "$backup_dir"
    "${psql_admin[@]}" -Atqc 'select datname from pg_database order by datname;' > "$backup_dir/databases-before.txt"
    "${psql_admin[@]}" -Atqc 'select rolname from pg_roles order by rolname;' > "$backup_dir/roles-before.txt"

    "${psql_admin[@]}" \
      --set=migrator_password="$RIVNU_MIGRATOR_PASSWORD" \
      --set=runtime_password="$RIVNU_RUNTIME_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE rivnu_migrator LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'migrator_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rivnu_migrator')
\gexec

SELECT format('ALTER ROLE rivnu_migrator PASSWORD %L', :'migrator_password')
\gexec

SELECT format(
  'CREATE ROLE rivnu_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'runtime_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rivnu_runtime')
\gexec

SELECT format('ALTER ROLE rivnu_runtime PASSWORD %L', :'runtime_password')
\gexec

SELECT 'CREATE DATABASE rivnu_rehearsal OWNER rivnu_migrator TEMPLATE template0 ENCODING ''UTF8'''
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'rivnu_rehearsal')
\gexec

REVOKE ALL ON DATABASE rivnu_rehearsal FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE rivnu_rehearsal TO rivnu_runtime;
SQL

    "${psql_admin[@]}" --dbname="$DATABASE_NAME" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO rivnu_migrator;
GRANT USAGE ON SCHEMA public TO rivnu_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rivnu_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO rivnu_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE rivnu_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rivnu_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE rivnu_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO rivnu_runtime;
SQL

    audit
    echo "Metadata backup: $backup_dir"
    ;;
  rollback)
    if [[ ${CONFIRM_DROP_RIVNU_REHEARSAL:-} != "YES" ]]; then
      echo "Destructive rollback refused. Set CONFIRM_DROP_RIVNU_REHEARSAL=YES after confirming the rehearsal DB may be deleted." >&2
      exit 65
    fi
    "${psql_admin[@]}" -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '${DATABASE_NAME}' and pid <> pg_backend_pid();"
    "${psql_admin[@]}" -c "drop database if exists ${DATABASE_NAME};"
    "${psql_admin[@]}" -c "drop role if exists ${RUNTIME_ROLE};"
    "${psql_admin[@]}" -c "drop role if exists ${MIGRATOR_ROLE};"
    ;;
  *)
    echo "Usage: $0 audit|apply|rollback" >&2
    exit 64
    ;;
esac
