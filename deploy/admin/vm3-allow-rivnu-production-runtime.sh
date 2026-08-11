#!/usr/bin/env bash
set -Eeuo pipefail

readonly DATABASE_NAME="rivnu_production"
readonly RUNTIME_ROLE="rivnu_runtime"
readonly APP_HOST="10.0.0.3/32"
readonly HBA_RULE="hostssl ${DATABASE_NAME} ${RUNTIME_ROLE} ${APP_HOST} scram-sha-256"
readonly BACKUP_ROOT="/var/backups/corestack/postgresql"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

hba_file="$(sudo -u postgres psql -X -p 5432 -Atqc 'show hba_file;')"
[[ -f "$hba_file" ]] || { echo "PostgreSQL HBA file not found: $hba_file" >&2; exit 1; }

action="${1:-audit}"

case "$action" in
  audit)
    printf 'hba_file=%s\n' "$hba_file"
    grep -Fn -- "$HBA_RULE" "$hba_file" || true
    sudo -u postgres psql -X -p 5432 -P pager=off -c "select datname from pg_database where datname = '${DATABASE_NAME}';"
    ;;
  apply)
    if grep -Fqx -- "$HBA_RULE" "$hba_file"; then
      echo "Required pg_hba.conf rule already exists."
    else
      timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
      backup_dir="${BACKUP_ROOT}/${timestamp}-before-rivnu-production-hba"
      install -d -m 0750 -o postgres -g postgres "$backup_dir"
      cp -a "$hba_file" "$backup_dir/pg_hba.conf.previous"
      printf '\n# RIVNU production runtime: VM2 only\n%s\n' "$HBA_RULE" >> "$hba_file"
      if ! sudo -u postgres psql -X -p 5432 -v ON_ERROR_STOP=1 -c 'select pg_reload_conf();' >/dev/null; then
        cp -a "$backup_dir/pg_hba.conf.previous" "$hba_file"
        sudo -u postgres psql -X -p 5432 -v ON_ERROR_STOP=1 -c 'select pg_reload_conf();' >/dev/null || true
        echo "Reload failed; previous pg_hba.conf restored." >&2
        exit 2
      fi
      echo "Backup: $backup_dir"
    fi
    grep -Fqx -- "$HBA_RULE" "$hba_file"
    sudo -u postgres psql -X -p 5432 -P pager=off -c "select datname from pg_database where datname = '${DATABASE_NAME}';"
    ;;
  *)
    echo "Usage: $0 audit|apply" >&2
    exit 64
    ;;
esac
