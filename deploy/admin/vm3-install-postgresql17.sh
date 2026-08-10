#!/usr/bin/env bash
set -Eeuo pipefail

readonly PGDG_KEY="/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc"
readonly PGDG_SOURCE="/etc/apt/sources.list.d/pgdg.sources"
readonly BACKUP_ROOT="/var/backups/corestack/postgresql"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

action="${1:-audit}"

audit() {
  . /etc/os-release
  echo "os=${PRETTY_NAME} codename=${VERSION_CODENAME:-unknown}"
  pg_lsclusters
  dpkg-query -W -f='${binary:Package} ${Version}\n' postgresql-16 postgresql-client-16 postgresql-17 postgresql-client-17 2>/dev/null || true
  df -hT / /var/lib/postgresql
}

case "$action" in
  audit)
    audit
    ;;
  install)
    . /etc/os-release
    if [[ ${ID:-} != "ubuntu" || ${VERSION_CODENAME:-} != "noble" ]]; then
      echo "Refusing: this reviewed procedure is only for Ubuntu 24.04 noble." >&2
      exit 2
    fi

    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_dir="${BACKUP_ROOT}/${timestamp}-before-postgresql17-install"
    install -d -m 0750 -o postgres -g postgres "$backup_dir"
    pg_lsclusters > "$backup_dir/clusters-before.txt"
    dpkg-query -W -f='${binary:Package} ${Version}\n' 'postgresql*' > "$backup_dir/packages-before.txt" 2>/dev/null || true
    cp -a /etc/postgresql "$backup_dir/etc-postgresql"
    if [[ -f "$PGDG_SOURCE" ]]; then
      cp -a "$PGDG_SOURCE" "$backup_dir/pgdg.sources.previous"
    fi
    if [[ -f "$PGDG_KEY" ]]; then
      cp -a "$PGDG_KEY" "$backup_dir/apt.postgresql.org.asc.previous"
    fi

    apt-get update
    apt-get install --yes --no-install-recommends ca-certificates curl postgresql-common
    install -d -m 0755 /usr/share/postgresql-common/pgdg
    curl --fail --show-error --silent \
      --output "$PGDG_KEY" \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc
    chmod 0644 "$PGDG_KEY"

    cat > "$PGDG_SOURCE" <<'EOF'
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: noble-pgdg
Architectures: amd64
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
EOF
    chmod 0644 "$PGDG_SOURCE"

    apt-get update
    apt-get install --yes postgresql-17 postgresql-client-17

    audit
    echo "Backup: $backup_dir"
    echo "PostgreSQL 16 was not removed. Do not drop or upgrade any cluster yet."
    ;;
  *)
    echo "Usage: $0 audit|install" >&2
    exit 64
    ;;
esac
