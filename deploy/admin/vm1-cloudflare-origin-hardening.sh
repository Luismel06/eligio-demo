#!/usr/bin/env bash
set -Eeuo pipefail

readonly NGINX_TARGET="/etc/nginx/conf.d/cloudflare-real-ip.conf"
readonly SOURCE_CONFIG="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/cloudflare-real-ip.conf"
readonly BACKUP_ROOT="/opt/corestack/backups/cloudflare-origin"

readonly -a CF_NETWORKS=(
  173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22
  141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20
  197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13
  104.24.0.0/14 172.64.0.0/13 131.0.72.0/22
  2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32
  2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
)

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi
[[ -f "$SOURCE_CONFIG" ]] || { echo "Missing config: $SOURCE_CONFIG" >&2; exit 2; }
command -v ufw >/dev/null || { echo "ufw is required." >&2; exit 2; }

action="${1:-audit}"

add_cloudflare_rules() {
  local network port
  for network in "${CF_NETWORKS[@]}"; do
    for port in 80 443; do
      ufw allow from "$network" to any port "$port" proto tcp >/dev/null
    done
  done
}

delete_cloudflare_rules() {
  local network port
  for network in "${CF_NETWORKS[@]}"; do
    for port in 80 443; do
      ufw --force delete allow from "$network" to any port "$port" proto tcp >/dev/null 2>&1 || true
    done
  done
}

audit() {
  nginx -t
  ufw status verbose
  if [[ -f "$NGINX_TARGET" ]]; then
    sha256sum "$NGINX_TARGET"
  else
    echo "Cloudflare real-IP config is not installed."
  fi
}

case "$action" in
  audit)
    audit
    ;;
  apply)
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_dir="${BACKUP_ROOT}/${timestamp}-before-apply"
    install -d -m 0750 "$backup_dir"
    ufw status numbered > "$backup_dir/ufw-status-before.txt"
    [[ -f "$NGINX_TARGET" ]] && cp -a "$NGINX_TARGET" "$backup_dir/cloudflare-real-ip.previous"

    rollback() {
      trap - ERR
      ufw allow 80/tcp >/dev/null
      ufw allow 443/tcp >/dev/null
      delete_cloudflare_rules
      if [[ -f "$backup_dir/cloudflare-real-ip.previous" ]]; then
        cp -a "$backup_dir/cloudflare-real-ip.previous" "$NGINX_TARGET"
      else
        unlink "$NGINX_TARGET" 2>/dev/null || true
      fi
      nginx -t && systemctl reload nginx
      echo "Rollback completed." >&2
    }
    trap 'echo "Hardening failed; restoring previous access." >&2; rollback' ERR

    install -m 0644 "$SOURCE_CONFIG" "$NGINX_TARGET"
    nginx -t
    add_cloudflare_rules
    ufw --force delete allow 80/tcp >/dev/null
    ufw --force delete allow 443/tcp >/dev/null
    systemctl reload nginx
    systemctl is-active nginx
    ufw status verbose

    trap - ERR
    echo "Backup: $backup_dir"
    ;;
  rollback)
    backup_dir="${2:-}"
    if [[ -z "$backup_dir" || "$backup_dir" != "${BACKUP_ROOT}/"* || ! -d "$backup_dir" ]]; then
      echo "Usage: $0 rollback /opt/corestack/backups/cloudflare-origin/EXACT_BACKUP_DIRECTORY" >&2
      exit 64
    fi
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    delete_cloudflare_rules
    if [[ -f "$backup_dir/cloudflare-real-ip.previous" ]]; then
      cp -a "$backup_dir/cloudflare-real-ip.previous" "$NGINX_TARGET"
    else
      unlink "$NGINX_TARGET" 2>/dev/null || true
    fi
    nginx -t
    systemctl reload nginx
    audit
    ;;
  *)
    echo "Usage: $0 audit|apply|rollback BACKUP_DIRECTORY" >&2
    exit 64
    ;;
esac
