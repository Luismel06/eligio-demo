#!/usr/bin/env bash

set -Eeuo pipefail

readonly API_ENV='/opt/corestack/apps/rivnu/secrets/api.env'
readonly CONFIG_LOCK='/opt/corestack/apps/rivnu/data/rivnu-dgii-production.lock'

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "falta el comando requerido: $1"
}

read_env() {
  local file="$1"
  local key="$2"
  local count

  count="$(awk -F= -v key="$key" '$1 == key { count += 1 } END { print count + 0 }' "$file")"
  [[ "$count" == '1' ]] || die "${file} debe contener exactamente una variable ${key}"
  awk -v key="$key" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

append_or_validate() {
  local file="$1"
  local key="$2"
  local expected="$3"
  local count
  local current

  count="$(awk -F= -v key="$key" '$1 == key { count += 1 } END { print count + 0 }' "$file")"
  if [[ "$count" == '0' ]]; then
    printf '%s=%s\n' "$key" "$expected" >>"$file"
    return
  fi
  [[ "$count" == '1' ]] || die "${API_ENV} contiene ${key} más de una vez"
  current="$(read_env "$file" "$key")"
  [[ "$current" == "$expected" ]] ||
    die "${key} ya existe con un valor inesperado; revísalo antes de continuar"
}

main() {
  local api_mode
  local api_dir
  local temp_file
  local backup_file
  local hmac_count
  local hmac_secret
  local jwt_secret

  require_command awk
  require_command flock
  require_command openssl
  require_command realpath

  [[ "$#" -eq 0 ]] || die 'este comando no acepta argumentos'

  [[ -f "$API_ENV" && ! -L "$API_ENV" ]] || die "falta el archivo regular ${API_ENV}"
  [[ "$(realpath -e -- "$API_ENV")" == "$API_ENV" ]] ||
    die 'api.env no puede atravesar enlaces simbólicos'
  api_mode="$(stat -c '%a' "$API_ENV")"
  [[ "$api_mode" == '600' ]] || die "api.env debe tener permisos 0600 (actual: ${api_mode})"
  [[ "$(read_env "$API_ENV" NODE_ENV)" == 'production' ]] ||
    die 'NODE_ENV debe ser production'
  [[ "$(read_env "$API_ENV" DATABASE_URL)" == postgresql://rivnu_runtime:*'@10.0.0.4:5432/rivnu_production?schema=public&sslmode=require' ]] ||
    die 'DATABASE_URL no apunta a la base de producción aprobada'
  [[ "$(read_env "$API_ENV" DIRECT_URL)" == postgresql://rivnu_runtime:*'@10.0.0.4:5432/rivnu_production?schema=public&sslmode=require' ]] ||
    die 'DIRECT_URL no apunta a la base de producción aprobada'

  if [[ -e "$CONFIG_LOCK" && ( ! -f "$CONFIG_LOCK" || -L "$CONFIG_LOCK" ) ]]; then
    die 'el lock operacional existente no es un archivo regular seguro'
  fi
  exec 9>>"$CONFIG_LOCK"
  chmod 0600 "$CONFIG_LOCK"
  flock --nonblock 9 || die 'otra configuración DGII de producción está en ejecución'

  api_dir="$(dirname -- "$API_ENV")"
  temp_file="$(mktemp "${api_dir}/.api.env.dgii.XXXXXX")"
  backup_file="${api_dir}/api.env.pre-dgii-$(date -u +%Y%m%dT%H%M%SZ).bak"
  [[ ! -e "$backup_file" ]] || die "el respaldo objetivo ya existe: ${backup_file}"
  trap 'rm -f -- "${temp_file:-}"' EXIT
  cp --preserve=mode,ownership -- "$API_ENV" "$temp_file"

  append_or_validate "$temp_file" TAX_IDENTITY_OVERRIDE_RATE_LIMIT_WINDOW_MS 900000
  append_or_validate "$temp_file" TAX_IDENTITY_OVERRIDE_RATE_LIMIT_MAX 5
  append_or_validate "$temp_file" TAX_IDENTITY_APPROVAL_REQUEST_RATE_LIMIT_WINDOW_MS 900000
  append_or_validate "$temp_file" TAX_IDENTITY_APPROVAL_REQUEST_RATE_LIMIT_MAX 20
  append_or_validate "$temp_file" TAX_IDENTITY_APPROVAL_REQUEST_READ_RATE_LIMIT_WINDOW_MS 900000
  append_or_validate "$temp_file" TAX_IDENTITY_APPROVAL_REQUEST_READ_RATE_LIMIT_MAX 300
  append_or_validate "$temp_file" TAX_IDENTITY_APPROVAL_REQUEST_TTL_MINUTES 30
  append_or_validate "$temp_file" DGII_REGISTRY_MAX_AGE_HOURS 216
  append_or_validate "$temp_file" DGII_REGISTRY_RETAIN_SUPERSEDED_DATASETS 1
  append_or_validate "$temp_file" DGII_REGISTRY_IMPORT_STALE_HOURS 24

  hmac_count="$(awk -F= '$1 == "TAX_IDENTITY_HMAC_SECRET" { count += 1 } END { print count + 0 }' "$temp_file")"
  [[ "$hmac_count" -le 1 ]] || die 'TAX_IDENTITY_HMAC_SECRET aparece más de una vez'
  if [[ "$hmac_count" == '0' ]]; then
    hmac_secret="$(openssl rand -hex 48)"
    printf 'TAX_IDENTITY_HMAC_SECRET=%s\n' "$hmac_secret" >>"$temp_file"
  else
    hmac_secret="$(read_env "$temp_file" TAX_IDENTITY_HMAC_SECRET)"
  fi

  jwt_secret="$(read_env "$temp_file" JWT_SECRET)"
  [[ "$hmac_secret" =~ ^[[:xdigit:]]{64,128}$ ]] ||
    die 'TAX_IDENTITY_HMAC_SECRET debe ser hexadecimal y tener entre 64 y 128 caracteres'
  [[ "$hmac_secret" != "$jwt_secret" ]] ||
    die 'TAX_IDENTITY_HMAC_SECRET debe ser diferente de JWT_SECRET'
  if LC_ALL=C grep -q $'\r' "$temp_file"; then
    die 'api.env contiene finales de línea CRLF no permitidos'
  fi
  if grep -Eq '^(DGII_ALLOW_TEST_FIXTURE|RIVNU_PREVIEW_GUARD)=' "$temp_file"; then
    die 'api.env de producción contiene una variable exclusiva del preview'
  fi

  cp --preserve=mode,ownership -- "$API_ENV" "$backup_file"
  chmod 0600 "$backup_file" "$temp_file"
  chown --reference="$API_ENV" "$backup_file" "$temp_file"
  mv -- "$temp_file" "$API_ENV"
  trap - EXIT

  printf 'Configuración DGII de producción instalada. Respaldo: %s\n' "$backup_file"
  printf 'El secreto HMAC fue validado sin mostrar su valor.\n'
}

main "$@"
