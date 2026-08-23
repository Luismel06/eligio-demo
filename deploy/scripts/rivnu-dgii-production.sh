#!/usr/bin/env bash

set -Eeuo pipefail

readonly PRODUCTION_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PRODUCTION_REPO_DIR="$(cd -- "${PRODUCTION_SCRIPT_DIR}/../.." && pwd)"
readonly PRODUCTION_COMPOSE_FILE="${PRODUCTION_REPO_DIR}/deploy/docker/compose.production.yml"
readonly PRODUCTION_API_ENV='/opt/corestack/apps/rivnu/secrets/api.env'
readonly PRODUCTION_DEPLOY_ENV='/opt/corestack/apps/rivnu/secrets/deploy.env'
readonly PRODUCTION_LOCK='/opt/corestack/apps/rivnu/data/rivnu-dgii-production.lock'
readonly PRODUCTION_PROJECT='rivnu'
readonly PRODUCTION_NETWORK='rivnu-network'
readonly PRODUCTION_DB_SUFFIX='@10.0.0.4:5432/rivnu_production?schema=public&sslmode=require'
readonly PRODUCTION_APP_URL='https://rivnu.corestack-systems.com'
readonly PRODUCTION_API_URL='https://rivnu-api.corestack-systems.com'
readonly PRODUCTION_DGII_REGISTRY_URL='https://dgii.gov.do/app/WebApps/Consultas/RNC/DGII_RNC.zip'

production_die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

production_usage() {
  cat <<'USAGE'
Uso:
  deploy/scripts/rivnu-dgii-production.sh check
  deploy/scripts/rivnu-dgii-production.sh --image-tag SHA check
  deploy/scripts/rivnu-dgii-production.sh --image-tag SHA import-official /ruta/DGII_RNC.TXT FECHA_ISO [VERSION]
  deploy/scripts/rivnu-dgii-production.sh --image-tag SHA sync-official
  deploy/scripts/rivnu-dgii-production.sh sync-official

`--image-tag` permite validar/importar con imágenes candidatas locales antes del
corte. Sin esa opción, el script exige que el tag de deploy.env sea exactamente
el que ejecutan API y Web. Este script nunca contiene acciones de seed, reset,
fixture, stop ni down.
USAGE
}

production_require_command() {
  command -v "$1" >/dev/null 2>&1 || production_die "falta el comando requerido: $1"
}

production_read_env() {
  local production_file="$1"
  local production_key="$2"
  local production_count

  production_count="$(awk -F= -v key="$production_key" '$1 == key { count += 1 } END { print count + 0 }' "$production_file")"
  [[ "$production_count" == '1' ]] ||
    production_die "${production_file} debe contener exactamente una variable ${production_key}"
  awk -v key="$production_key" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); print; exit }' "$production_file"
}

production_assert_secret_file() {
  local production_file="$1"
  local production_mode

  [[ -f "$production_file" && ! -L "$production_file" ]] ||
    production_die "falta el archivo regular de secretos: ${production_file}"
  [[ "$(realpath -e -- "$production_file")" == "$production_file" ]] ||
    production_die "${production_file} no puede atravesar enlaces simbólicos"
  production_mode="$(stat -c '%a' "$production_file")"
  [[ "$production_mode" == '600' ]] ||
    production_die "${production_file} debe tener permisos 0600 (actual: ${production_mode})"
  if LC_ALL=C grep -q $'\r' "$production_file"; then
    production_die "${production_file} contiene finales de línea CRLF no permitidos"
  fi
}

production_resolve_image_tag() {
  local production_override="$1"
  local production_tag

  production_tag="${production_override:-$(production_read_env "$PRODUCTION_DEPLOY_ENV" RIVNU_IMAGE_TAG)}"
  [[ "$production_tag" =~ ^[0-9a-f]{7,40}$ ]] ||
    production_die 'el tag de imagen debe ser un SHA hexadecimal de 7 a 40 caracteres'
  printf '%s' "$production_tag"
}

production_validate_candidate_images() {
  local production_tag="$1"
  local production_service

  for production_service in api web; do
    docker run --rm --pull never \
      --network none \
      --read-only \
      --cap-drop ALL \
      --pids-limit 32 \
      --memory 128m \
      --memory-swap 128m \
      --security-opt no-new-privileges:true \
      --entrypoint sh \
      "corestack/rivnu-${production_service}:${production_tag}" \
      -c '
        set -eu
        test -r apps/api/dist/cli/import-dgii-registry.js
        printf "%s  %s\n" \
          968fdfa95acaaa71c28ea7f127dcffb6cf09d16be30cb8b112f4e60a64765c9e packages/database/prisma/migrations/20260807123000_return_refund_reference/migration.sql \
          d5d9c4f97e4549e677e03db04e7b37fb4f1fb104757119448542cc5c014ba0f3 packages/database/prisma/migrations/20260821163000_dgii_tax_identity_registry/migration.sql \
          158b8d4e716d6d399c39531a5d4d3f00437d48465a8e71158c65093d1d74e709 packages/database/prisma/migrations/20260821213000_tax_identity_approval_requests/migration.sql \
          95670250188093b8a05dab2d07c46e895a7a64bd728a4b575f3deff4ca311334 packages/database/prisma/migrations/20260822014500_pos_only_tax_identity_approvals/migration.sql \
          | sha256sum --check --status
      '
  done
}

production_validate_environment() {
  local production_tag="$1"
  local production_override="$2"
  local production_database_url
  local production_direct_url
  local production_hmac_secret
  local production_jwt_secret
  local production_expected_id
  local production_running_id
  local production_service

  production_require_command docker
  production_require_command realpath
  production_assert_secret_file "$PRODUCTION_API_ENV"
  production_assert_secret_file "$PRODUCTION_DEPLOY_ENV"

  [[ "$(production_read_env "$PRODUCTION_API_ENV" NODE_ENV)" == 'production' ]] ||
    production_die 'NODE_ENV debe ser production'
  production_database_url="$(production_read_env "$PRODUCTION_API_ENV" DATABASE_URL)"
  production_direct_url="$(production_read_env "$PRODUCTION_API_ENV" DIRECT_URL)"
  [[ "$production_database_url" == postgresql://rivnu_runtime:*"$PRODUCTION_DB_SUFFIX" ]] ||
    production_die 'DATABASE_URL no apunta a la base de producción aprobada'
  [[ "$production_direct_url" == postgresql://rivnu_runtime:*"$PRODUCTION_DB_SUFFIX" ]] ||
    production_die 'DIRECT_URL no apunta a la base de producción aprobada'
  [[ "$(production_read_env "$PRODUCTION_DEPLOY_ENV" NEXT_PUBLIC_APP_URL)" == "$PRODUCTION_APP_URL" ]] ||
    production_die 'NEXT_PUBLIC_APP_URL no corresponde al dominio de producción'
  [[ "$(production_read_env "$PRODUCTION_DEPLOY_ENV" NEXT_PUBLIC_API_URL)" == "$PRODUCTION_API_URL" ]] ||
    production_die 'NEXT_PUBLIC_API_URL no corresponde al dominio de producción'

  production_hmac_secret="$(production_read_env "$PRODUCTION_API_ENV" TAX_IDENTITY_HMAC_SECRET)"
  production_jwt_secret="$(production_read_env "$PRODUCTION_API_ENV" JWT_SECRET)"
  [[ "$production_hmac_secret" =~ ^[[:xdigit:]]{64,128}$ ]] ||
    production_die 'TAX_IDENTITY_HMAC_SECRET no cumple la longitud/formato de producción'
  [[ "$production_hmac_secret" != "$production_jwt_secret" ]] ||
    production_die 'TAX_IDENTITY_HMAC_SECRET debe ser distinto de JWT_SECRET'
  if grep -Eq '^(DGII_ALLOW_TEST_FIXTURE|RIVNU_PREVIEW_GUARD)=' "$PRODUCTION_API_ENV"; then
    production_die 'api.env contiene una variable exclusiva del preview'
  fi

  docker network inspect "$PRODUCTION_NETWORK" >/dev/null 2>&1 ||
    production_die "falta la red Docker ${PRODUCTION_NETWORK}"
  docker image inspect "corestack/rivnu-api:${production_tag}" >/dev/null 2>&1 ||
    production_die "no existe localmente corestack/rivnu-api:${production_tag}"
  docker image inspect "corestack/rivnu-web:${production_tag}" >/dev/null 2>&1 ||
    production_die "no existe localmente corestack/rivnu-web:${production_tag}"
  production_validate_candidate_images "$production_tag" ||
    production_die "las imágenes ${production_tag} no contienen el mismo release DGII aprobado"

  if [[ -z "$production_override" ]]; then
    for production_service in api web; do
      production_expected_id="$(docker image inspect --format '{{.Id}}' "corestack/rivnu-${production_service}:${production_tag}")"
      production_running_id="$(docker inspect --format '{{.Image}}' "rivnu-${production_service}" 2>/dev/null || true)"
      [[ "$production_running_id" == "$production_expected_id" ]] ||
        production_die "rivnu-${production_service} no ejecuta el tag aprobado ${production_tag}"
      [[ "$(docker inspect --format '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "rivnu-${production_service}")" == 'true healthy' ]] ||
        production_die "rivnu-${production_service} no está ejecutándose y saludable"
      [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "rivnu-${production_service}")" == "$PRODUCTION_PROJECT" ]] ||
        production_die "rivnu-${production_service} no pertenece al proyecto Compose aprobado"
    done
  fi
}

production_acquire_registry_lock() {
  production_require_command flock
  if [[ -e "$PRODUCTION_LOCK" && ( ! -f "$PRODUCTION_LOCK" || -L "$PRODUCTION_LOCK" ) ]]; then
    production_die 'el lock operacional existente no es un archivo regular seguro'
  fi
  exec 9>>"$PRODUCTION_LOCK"
  chmod 0600 "$PRODUCTION_LOCK"
  flock --nonblock 9 ||
    production_die 'ya hay otra carga o sincronización DGII de producción en ejecución'
}

production_active_checksum() {
  local production_checksum_sql

  production_checksum_sql=$'SELECT "checksumSha256" FROM "DgiiRegistryDataset" WHERE "status" = \'ACTIVE\' AND "source" = \'DGII_OFFICIAL\' LIMIT 1;'
  docker run --rm --pull never \
    --user "$(id -u):$(id -g)" \
    --network "$PRODUCTION_NETWORK" \
    --env-file "$PRODUCTION_API_ENV" \
    --read-only \
    --tmpfs /tmp:size=16m,mode=1777 \
    --cap-drop ALL \
    --cpus 0.15 \
    --memory 96m \
    --memory-swap 96m \
    --pids-limit 32 \
    --security-opt no-new-privileges:true \
    postgres:17-alpine \
    sh -c 'db_url="${DIRECT_URL%%\?*}?sslmode=require"; exec psql "$db_url" -v ON_ERROR_STOP=1 -Atc "$1"' \
    sh "$production_checksum_sql"
}

production_import_official() {
  local production_tag="$1"
  local production_source_file="${2:-}"
  local production_source_updated_at="${3:-}"
  local production_version="${4:-}"
  local production_resolved_file
  local production_container_user
  local production_source_size
  local -a production_command

  production_require_command date
  production_require_command id
  production_require_command realpath

  [[ "$production_source_file" == /* ]] ||
    production_die 'import-official requiere una ruta absoluta al TXT oficial'
  [[ -f "$production_source_file" && ! -L "$production_source_file" && -r "$production_source_file" ]] ||
    production_die 'el TXT oficial debe ser un archivo regular, legible y no un enlace simbólico'
  production_source_size="$(stat -c '%s' "$production_source_file")"
  [[ "$production_source_size" -ge 50000000 && "$production_source_size" -le 250000000 ]] ||
    production_die 'el TXT oficial quedó fuera del rango seguro de 50 a 250 MB'
  [[ "$production_source_updated_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    production_die 'la fecha debe usar UTC ISO-8601, por ejemplo 2026-08-22T06:58:46Z'
  date -u -d "$production_source_updated_at" '+%Y-%m-%dT%H:%M:%SZ' >/dev/null ||
    production_die 'la fecha de actualización no es válida'
  if [[ -n "$production_version" && ! "$production_version" =~ ^[A-Za-z0-9._-]{1,80}$ ]]; then
    production_die 'VERSION solo puede contener letras, números, punto, guion y guion bajo'
  fi

  production_resolved_file="$(realpath -- "$production_source_file")"
  production_container_user="$(id -u):$(id -g)"
  production_command=(
    node
    apps/api/dist/cli/import-dgii-registry.js
    --file
    /production-import/DGII_RNC.TXT
    --source-updated-at
    "$production_source_updated_at"
  )
  if [[ -n "$production_version" ]]; then
    production_command+=(--version "$production_version")
  fi

  RIVNU_IMAGE_TAG="$production_tag" docker compose \
    --project-name "$PRODUCTION_PROJECT" \
    --env-file "$PRODUCTION_DEPLOY_ENV" \
    --file "$PRODUCTION_COMPOSE_FILE" \
    run --rm --no-deps --pull never -T \
    --user "$production_container_user" \
    --volume "${production_resolved_file}:/production-import/DGII_RNC.TXT:ro" \
    rivnu-api \
    "${production_command[@]}"
}

production_sync_official() {
  local production_tag="$1"
  local production_sync_dir
  local production_sync_headers
  local production_sync_archive
  local production_sync_text
  local production_sync_http_date
  local production_sync_source_updated_at
  local production_sync_version
  local production_sync_archive_size
  local production_sync_checksum
  local production_current_checksum

  production_require_command curl
  production_require_command python3
  production_require_command date
  production_require_command sha256sum
  production_require_command stat
  docker image inspect postgres:17-alpine >/dev/null 2>&1 ||
    production_die 'falta la imagen local postgres:17-alpine requerida para la comprobación de checksum'

  production_sync_dir="$(mktemp -d /tmp/rivnu-dgii-production-sync.XXXXXX)"
  chmod 0700 "$production_sync_dir"
  production_sync_headers="${production_sync_dir}/headers"
  production_sync_archive="${production_sync_dir}/DGII_RNC.zip"
  production_sync_text="${production_sync_dir}/DGII_RNC.TXT"
  trap 'rm -f -- "${production_sync_headers:-}" "${production_sync_archive:-}" "${production_sync_text:-}"; rmdir -- "${production_sync_dir:-}" 2>/dev/null || true' EXIT RETURN

  curl \
    --fail \
    --silent \
    --show-error \
    --retry 3 \
    --retry-all-errors \
    --connect-timeout 15 \
    --max-time 300 \
    --max-filesize 67108864 \
    --proto '=https' \
    --user-agent 'Mozilla/5.0 (compatible; CoreStack-RIVNU-DGII-Production-Sync/1.0)' \
    --dump-header "$production_sync_headers" \
    --output "$production_sync_archive" \
    "$PRODUCTION_DGII_REGISTRY_URL"

  production_sync_archive_size="$(stat -c '%s' "$production_sync_archive")"
  [[ "$production_sync_archive_size" -ge 1048576 && "$production_sync_archive_size" -le 67108864 ]] ||
    production_die 'el ZIP oficial quedó fuera del rango seguro de 1 a 64 MiB'

  production_sync_http_date="$(
    awk 'BEGIN { IGNORECASE = 1 }
      /^last-modified:[[:space:]]*/ {
        sub(/^[^:]+:[[:space:]]*/, "");
        sub(/\r$/, "");
        value = $0
      }
      END { print value }
    ' "$production_sync_headers"
  )"
  [[ -n "$production_sync_http_date" ]] ||
    production_die 'DGII no informó Last-Modified; no se puede fechar el padrón de forma verificable'
  production_sync_source_updated_at="$(date -u -d "$production_sync_http_date" '+%Y-%m-%dT%H:%M:%SZ')" ||
    production_die 'Last-Modified del ZIP oficial no es una fecha válida'

  python3 - "$production_sync_archive" "$production_sync_text" <<'PY'
import shutil
import sys
import zipfile
from pathlib import PurePosixPath

archive_path, output_path = sys.argv[1:]
with zipfile.ZipFile(archive_path) as archive:
    files = [entry for entry in archive.infolist() if not entry.is_dir()]
    if len(files) != 1:
        raise SystemExit('DGII ZIP rejected: expected exactly one regular file.')

    entry = files[0]
    path = PurePosixPath(entry.filename.replace('\\', '/'))
    if path.name.upper() != 'DGII_RNC.TXT' or '..' in path.parts or path.is_absolute():
        raise SystemExit('DGII ZIP rejected: unexpected entry name.')
    if entry.file_size < 50_000_000 or entry.file_size > 250_000_000:
        raise SystemExit('DGII ZIP rejected: uncompressed TXT size is outside the safe range.')

    with archive.open(entry, 'r') as source, open(output_path, 'xb') as destination:
        shutil.copyfileobj(source, destination, length=1024 * 1024)
PY
  chmod 0600 "$production_sync_text"

  production_sync_checksum="$(sha256sum "$production_sync_text" | awk '{ print $1 }')"
  production_current_checksum="$(production_active_checksum)"
  if [[ -n "$production_current_checksum" && "$production_current_checksum" == "$production_sync_checksum" ]]; then
    printf 'El padrón oficial activo ya coincide con el ZIP actual de DGII; no se reimportó.\n'
    rm -f -- "$production_sync_headers" "$production_sync_archive" "$production_sync_text"
    rmdir -- "$production_sync_dir"
    trap - EXIT RETURN
    return 0
  fi

  production_sync_version="dgii-$(date -u -d "$production_sync_source_updated_at" '+%Y%m%dT%H%M%SZ')-${production_sync_checksum:0:12}"
  production_import_official \
    "$production_tag" \
    "$production_sync_text" \
    "$production_sync_source_updated_at" \
    "$production_sync_version"

  rm -f -- "$production_sync_headers" "$production_sync_archive" "$production_sync_text"
  rmdir -- "$production_sync_dir"
  trap - EXIT RETURN
}

production_main() {
  local production_override=''
  local production_action
  local production_tag

  if [[ "${1:-}" == '--image-tag' ]]; then
    [[ "$#" -ge 3 ]] || production_die '--image-tag requiere un SHA y una acción'
    production_override="$2"
    shift 2
  fi

  production_action="${1:-}"
  shift || true
  case "$production_action" in
    check)
      [[ "$#" -eq 0 ]] || production_die 'check no acepta argumentos'
      production_tag="$(production_resolve_image_tag "$production_override")"
      production_validate_environment "$production_tag" "$production_override"
      printf 'Configuración DGII de producción validada para el tag %s.\n' "$production_tag"
      ;;
    import-official)
      [[ "$#" -ge 2 && "$#" -le 3 ]] ||
        production_die 'import-official requiere ARCHIVO FECHA_ISO y VERSION opcional'
      production_tag="$(production_resolve_image_tag "$production_override")"
      production_validate_environment "$production_tag" "$production_override"
      production_acquire_registry_lock
      production_import_official "$production_tag" "$@"
      ;;
    sync-official)
      [[ "$#" -eq 0 ]] || production_die 'sync-official no acepta argumentos'
      production_tag="$(production_resolve_image_tag "$production_override")"
      production_validate_environment "$production_tag" "$production_override"
      production_acquire_registry_lock
      production_sync_official "$production_tag"
      ;;
    help|-h|--help|'')
      production_usage
      ;;
    *)
      production_die "acción desconocida: ${production_action}"
      ;;
  esac
}

production_main "$@"
