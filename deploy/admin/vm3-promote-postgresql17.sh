#!/usr/bin/env bash
set -Eeuo pipefail

readonly BACKUP_ROOT="/var/backups/corestack/postgresql"
readonly PG16_CONF_DIR="/etc/postgresql/16/main"
readonly PG17_CONF_DIR="/etc/postgresql/17/main"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

action="${1:-audit}"

audit() {
  pg_lsclusters
  ss -lntp | awk 'NR == 1 || $4 ~ /:5432$|:5433$/'
  sudo -u postgres psql -X -p 5432 -Atqc "select current_setting('server_version'), current_database();" 2>/dev/null || true
  sudo -u postgres psql -X -p 5433 -Atqc "select current_setting('server_version'), current_database();" 2>/dev/null || true
}

restore_configs() {
  local backup_dir="$1"
  pg_ctlcluster 16 main stop --force 2>/dev/null || true
  pg_ctlcluster 17 main stop --force 2>/dev/null || true
  cp -a "$backup_dir/16-postgresql.conf" "$PG16_CONF_DIR/postgresql.conf"
  cp -a "$backup_dir/16-pg_hba.conf" "$PG16_CONF_DIR/pg_hba.conf"
  cp -a "$backup_dir/17-postgresql.conf" "$PG17_CONF_DIR/postgresql.conf"
  cp -a "$backup_dir/17-pg_hba.conf" "$PG17_CONF_DIR/pg_hba.conf"
  pg_ctlcluster 16 main start
  pg_ctlcluster 17 main start
}

case "$action" in
  audit)
    audit
    ;;
  apply)
    if [[ $(sudo -u postgres psql -X -p 5433 -Atqc "select count(*) from pg_database where datname not in ('postgres','template0','template1');") != "0" ]]; then
      echo "Refusing: PostgreSQL 17 cluster is not empty." >&2
      exit 2
    fi

    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_dir="${BACKUP_ROOT}/${timestamp}-before-pg17-promotion"
    install -d -m 0750 -o postgres -g postgres "$backup_dir"
    cp -a "$PG16_CONF_DIR/postgresql.conf" "$backup_dir/16-postgresql.conf"
    cp -a "$PG16_CONF_DIR/pg_hba.conf" "$backup_dir/16-pg_hba.conf"
    cp -a "$PG17_CONF_DIR/postgresql.conf" "$backup_dir/17-postgresql.conf"
    cp -a "$PG17_CONF_DIR/pg_hba.conf" "$backup_dir/17-pg_hba.conf"
    pg_lsclusters > "$backup_dir/clusters-before.txt"

    pg_conftool 16 main set port 5433
    pg_conftool 17 main set port 5432
    pg_conftool 17 main set listen_addresses 'localhost,10.0.0.4'

    if ! grep -Fq 'rivnu_runtime 10.0.0.3/32' "$PG17_CONF_DIR/pg_hba.conf"; then
      printf '\n# RIVNU rehearsal/application access from VM2 only\n' >> "$PG17_CONF_DIR/pg_hba.conf"
      printf 'host rivnu_rehearsal rivnu_runtime 10.0.0.3/32 scram-sha-256\n' >> "$PG17_CONF_DIR/pg_hba.conf"
      printf 'host rivnu_rehearsal rivnu_migrator 10.0.0.3/32 scram-sha-256\n' >> "$PG17_CONF_DIR/pg_hba.conf"
    fi

    pg_ctlcluster 16 main stop --force
    pg_ctlcluster 17 main stop --force
    pg_ctlcluster 16 main start
    if ! pg_ctlcluster 17 main start; then
      echo "PostgreSQL 17 failed to start; restoring previous configuration." >&2
      restore_configs "$backup_dir"
      exit 3
    fi

    if ! sudo -u postgres psql -X -p 5432 -Atqc "select current_setting('server_version_num')::int >= 170000;" | grep -Fxq t; then
      echo "Port 5432 is not PostgreSQL 17; restoring previous configuration." >&2
      restore_configs "$backup_dir"
      exit 4
    fi

    audit
    echo "Backup: $backup_dir"
    echo "PostgreSQL 16 remains available on port 5433 for rollback."
    ;;
  rollback)
    backup_dir="${2:-}"
    if [[ -z "$backup_dir" || "$backup_dir" != "${BACKUP_ROOT}/"* || ! -d "$backup_dir" ]]; then
      echo "Usage: $0 rollback /var/backups/corestack/postgresql/EXACT_BACKUP_DIRECTORY" >&2
      exit 64
    fi
    restore_configs "$backup_dir"
    audit
    ;;
  *)
    echo "Usage: $0 audit|apply|rollback BACKUP_DIRECTORY" >&2
    exit 64
    ;;
esac
