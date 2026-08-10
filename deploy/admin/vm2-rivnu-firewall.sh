#!/usr/bin/env bash
set -Eeuo pipefail

readonly VM1_IP="10.0.0.2"
readonly VM2_IP="10.0.0.3"
readonly API_PORT="4001"
readonly COMMENT="RIVNU API from VM1 reverse proxy"
readonly BACKUP_ROOT="/opt/corestack/backups/ufw"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

action="${1:-audit}"

audit() {
  ufw status verbose
  ss -lntp | awk 'NR == 1 || $4 ~ /:3001$|:4001$/'
}

case "$action" in
  audit)
    audit
    ;;
  apply)
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_dir="${BACKUP_ROOT}/${timestamp}-before-rivnu-api"
    install -d -m 0750 "$backup_dir"
    cp -a /etc/ufw "$backup_dir/etc-ufw"
    ufw status verbose > "$backup_dir/status-before.txt"

    if ufw status | grep -Fq "4001/tcp"; then
      echo "A rule mentioning 4001/tcp already exists; refusing an ambiguous change." >&2
      echo "Review with: sudo ufw status numbered" >&2
      exit 2
    fi

    ufw allow from "$VM1_IP" to "$VM2_IP" port "$API_PORT" proto tcp comment "$COMMENT"
    ufw status numbered
    echo "Backup: $backup_dir"
    ;;
  rollback)
    ufw --force delete allow from "$VM1_IP" to "$VM2_IP" port "$API_PORT" proto tcp
    ufw status numbered
    ;;
  *)
    echo "Usage: $0 audit|apply|rollback" >&2
    exit 64
    ;;
esac
