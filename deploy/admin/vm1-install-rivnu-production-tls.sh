#!/usr/bin/env bash
set -Eeuo pipefail

readonly SITE_NAME="rivnu-production.conf"
readonly SITE_AVAILABLE="/etc/nginx/sites-available/${SITE_NAME}"
readonly SITE_ENABLED="/etc/nginx/sites-enabled/${SITE_NAME}"
readonly LEGACY_ENABLED="/etc/nginx/sites-enabled/rivnu.corestacksystems.com"
readonly BACKUP_ROOT="/opt/corestack/backups/nginx"
readonly SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly HTTP_CONFIG="${SOURCE_DIR}/rivnu-production-http.conf"
readonly TLS_CONFIG="${SOURCE_DIR}/rivnu-production.conf.template"
readonly CERT_NAME="rivnu.corestack-systems.com"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

for command in nginx certbot; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 2; }
done
for file in "$HTTP_CONFIG" "$TLS_CONFIG"; do
  [[ -f "$file" ]] || { echo "Missing candidate config: $file" >&2; exit 2; }
done

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${BACKUP_ROOT}/${timestamp}-before-rivnu-production-tls"
install -d -m 0750 "$backup_dir"

[[ -e "$SITE_AVAILABLE" ]] && cp -a "$SITE_AVAILABLE" "$backup_dir/site-available.previous"
[[ -L "$SITE_ENABLED" ]] && readlink "$SITE_ENABLED" > "$backup_dir/site-enabled-link.previous"
[[ -L "$LEGACY_ENABLED" ]] && readlink "$LEGACY_ENABLED" > "$backup_dir/legacy-enabled-link.previous"

rollback() {
  trap - ERR
  if [[ -f "$backup_dir/site-available.previous" ]]; then
    cp -a "$backup_dir/site-available.previous" "$SITE_AVAILABLE"
  else
    unlink "$SITE_AVAILABLE" 2>/dev/null || true
  fi
  if [[ -f "$backup_dir/site-enabled-link.previous" ]]; then
    ln -sfn "$(<"$backup_dir/site-enabled-link.previous")" "$SITE_ENABLED"
  else
    unlink "$SITE_ENABLED" 2>/dev/null || true
  fi
  if [[ -f "$backup_dir/legacy-enabled-link.previous" ]]; then
    ln -sfn "$(<"$backup_dir/legacy-enabled-link.previous")" "$LEGACY_ENABLED"
  fi
  nginx -t && systemctl reload nginx
}
trap 'echo "Installation failed; restoring Nginx configuration." >&2; rollback' ERR

install -d -m 0755 /var/www/certbot
install -m 0644 "$HTTP_CONFIG" "$SITE_AVAILABLE"
ln -sfn "$SITE_AVAILABLE" "$SITE_ENABLED"
unlink "$LEGACY_ENABLED" 2>/dev/null || true
nginx -t
systemctl reload nginx

certbot certonly --webroot --webroot-path /var/www/certbot \
  --cert-name "$CERT_NAME" --non-interactive --agree-tos \
  --register-unsafely-without-email --keep-until-expiring \
  -d rivnu.corestack-systems.com -d rivnu-api.corestack-systems.com

install -m 0644 "$TLS_CONFIG" "$SITE_AVAILABLE"
nginx -t
systemctl reload nginx
systemctl is-active nginx
certbot certificates --cert-name "$CERT_NAME"

trap - ERR
echo "Backup: $backup_dir"
