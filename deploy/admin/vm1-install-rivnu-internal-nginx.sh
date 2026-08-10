#!/usr/bin/env bash
set -Eeuo pipefail

readonly SITE_NAME="rivnu-internal.conf"
readonly SITE_AVAILABLE="/etc/nginx/sites-available/${SITE_NAME}"
readonly SITE_ENABLED="/etc/nginx/sites-enabled/${SITE_NAME}"
readonly BACKUP_ROOT="/opt/corestack/backups/nginx"
readonly SOURCE_CONFIG="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/rivnu-internal.conf"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

if [[ ! -f "$SOURCE_CONFIG" ]]; then
  echo "Missing candidate config: $SOURCE_CONFIG" >&2
  exit 1
fi

action="${1:-audit}"

audit() {
  nginx -t
  nginx -v
  ls -l /etc/nginx/sites-enabled
  ss -lntp | awk 'NR == 1 || $4 ~ /:80$|:443$/'
}

case "$action" in
  audit)
    audit
    ;;
  apply)
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_dir="${BACKUP_ROOT}/${timestamp}-before-rivnu-internal"
    install -d -m 0750 "$backup_dir"

    if [[ -e "$SITE_AVAILABLE" ]]; then
      cp -a "$SITE_AVAILABLE" "$backup_dir/site-available.previous"
    fi
    if [[ -L "$SITE_ENABLED" ]]; then
      readlink "$SITE_ENABLED" > "$backup_dir/site-enabled-link.previous"
    elif [[ -e "$SITE_ENABLED" ]]; then
      cp -a "$SITE_ENABLED" "$backup_dir/site-enabled-file.previous"
    fi

    install -m 0644 "$SOURCE_CONFIG" "$SITE_AVAILABLE"
    ln -sfn "$SITE_AVAILABLE" "$SITE_ENABLED"

    if ! nginx -t; then
      if [[ -f "$backup_dir/site-available.previous" ]]; then
        cp -a "$backup_dir/site-available.previous" "$SITE_AVAILABLE"
      else
        unlink "$SITE_AVAILABLE"
      fi
      if [[ -f "$backup_dir/site-enabled-link.previous" ]]; then
        ln -sfn "$(<"$backup_dir/site-enabled-link.previous")" "$SITE_ENABLED"
      elif [[ -f "$backup_dir/site-enabled-file.previous" ]]; then
        cp -a "$backup_dir/site-enabled-file.previous" "$SITE_ENABLED"
      else
        unlink "$SITE_ENABLED"
      fi
      echo "Validation failed; previous state restored." >&2
      exit 3
    fi

    systemctl reload nginx
    systemctl is-active nginx
    echo "Backup: $backup_dir"
    ;;
  rollback)
    backup_dir="${2:-}"
    if [[ -z "$backup_dir" || "$backup_dir" != "${BACKUP_ROOT}/"* || ! -d "$backup_dir" ]]; then
      echo "Usage: $0 rollback /opt/corestack/backups/nginx/EXACT_BACKUP_DIRECTORY" >&2
      exit 64
    fi

    if [[ -f "$backup_dir/site-available.previous" ]]; then
      cp -a "$backup_dir/site-available.previous" "$SITE_AVAILABLE"
    else
      unlink "$SITE_AVAILABLE" 2>/dev/null || true
    fi
    if [[ -f "$backup_dir/site-enabled-link.previous" ]]; then
      ln -sfn "$(<"$backup_dir/site-enabled-link.previous")" "$SITE_ENABLED"
    elif [[ -f "$backup_dir/site-enabled-file.previous" ]]; then
      cp -a "$backup_dir/site-enabled-file.previous" "$SITE_ENABLED"
    else
      unlink "$SITE_ENABLED" 2>/dev/null || true
    fi
    nginx -t
    systemctl reload nginx
    systemctl is-active nginx
    ;;
  *)
    echo "Usage: $0 audit|apply|rollback BACKUP_DIRECTORY" >&2
    exit 64
    ;;
esac
