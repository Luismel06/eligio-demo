#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPO_DIR="/opt/corestack/apps/rivnu/repo/CoreStackSystemsv1"
readonly SECRET_FILE="/opt/corestack/apps/rivnu/secrets/api.env"
readonly DEPLOY_ENV="/opt/corestack/apps/rivnu/secrets/deploy.env"
readonly COMPOSE_FILE="${REPO_DIR}/deploy/docker/compose.production.yml"
readonly BACKUP_ROOT="/opt/corestack/backups/rivnu/api-env"

[[ -f "$SECRET_FILE" && -f "$DEPLOY_ENV" && -f "$COMPOSE_FILE" ]] || {
  echo "Required deployment files are missing." >&2
  exit 1
}
[[ $(stat -c '%a' "$SECRET_FILE") == "600" ]] || {
  echo "api.env must have mode 0600." >&2
  exit 1
}

grep -q 'rivnu_rehearsal' "$SECRET_FILE" || {
  echo "api.env does not point to rivnu_rehearsal; refusing unexpected switch." >&2
  exit 2
}

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${BACKUP_ROOT}/${timestamp}-before-production-switch"
install -d -m 0750 "$backup_dir"
backup_file="${backup_dir}/api.env"
cp -p "$SECRET_FILE" "$backup_file"

compose=(docker compose --env-file "$DEPLOY_ENV" -f "$COMPOSE_FILE")
switched=false

rollback() {
  trap - ERR
  cp -p "$backup_file" "$SECRET_FILE"
  "${compose[@]}" up -d --no-build --force-recreate rivnu-api >/dev/null
  echo "Rollback restored rivnu-api to rivnu_rehearsal." >&2
}
trap 'echo "Production database switch failed." >&2; rollback' ERR

sed -i 's/rivnu_rehearsal/rivnu_production/g' "$SECRET_FILE"
grep -q 'rivnu_production' "$SECRET_FILE"
! grep -q 'rivnu_rehearsal' "$SECRET_FILE"
switched=true

"${compose[@]}" up -d --no-build --force-recreate rivnu-api

for attempt in 1 2 3 4 5 6 7 8; do
  health="$(docker inspect -f '{{.State.Health.Status}}' rivnu-api 2>/dev/null || true)"
  echo "attempt=${attempt} api_health=${health}"
  [[ "$health" == healthy ]] && break
  sleep 5
done
[[ "${health:-}" == healthy ]] || { echo "rivnu-api did not become healthy." >&2; exit 3; }

docker exec -w /app/apps/api rivnu-api node -e "const {PrismaClient}=require('@qorvex/database'); const p=new PrismaClient(); p.\$connect().then(()=>console.log('Prisma production connection: OK')).then(()=>p.\$disconnect()).catch(()=>process.exit(1));"

trap - ERR
echo "API now uses rivnu_production. Backup: $backup_file"
