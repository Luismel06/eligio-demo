#!/usr/bin/env bash

set -Eeuo pipefail

readonly PREVIEW_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PREVIEW_REPO_DIR="$(cd -- "${PREVIEW_SCRIPT_DIR}/../.." && pwd)"
readonly PREVIEW_COMPOSE_FILE="${PREVIEW_REPO_DIR}/deploy/docker/compose.preview.dgii.yml"
readonly PREVIEW_SECRET_DIR='/opt/corestack/apps/rivnu/secrets/preview-dgii'
readonly PREVIEW_DB_ENV="${PREVIEW_SECRET_DIR}/db.env"
readonly PREVIEW_API_ENV="${PREVIEW_SECRET_DIR}/api.env"
readonly PREVIEW_DEPLOY_ENV="${PREVIEW_SECRET_DIR}/deploy.env"
readonly PREVIEW_PROJECT='rivnu-dgii-preview'
readonly PREVIEW_GUARD='RIVNU_DGII_PREVIEW_ONLY'
readonly PREVIEW_DB_USER='rivnu_preview'
readonly PREVIEW_DB_HOST='rivnu-dgii-preview-db'
readonly PREVIEW_DB_PORT='5432'
readonly PREVIEW_DB_NAME='rivnu_dgii_preview'
readonly PREVIEW_APP_URL='http://127.0.0.1:3101'
readonly PREVIEW_API_URL='http://127.0.0.1:4101'
readonly PREVIEW_DGII_REGISTRY_URL='https://dgii.gov.do/app/WebApps/Consultas/RNC/DGII_RNC.zip'

preview_die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

preview_usage() {
  cat <<'USAGE'
Uso:
  deploy/scripts/rivnu-dgii-preview.sh init-secrets
  deploy/scripts/rivnu-dgii-preview.sh check
  deploy/scripts/rivnu-dgii-preview.sh build
  deploy/scripts/rivnu-dgii-preview.sh initialize --confirm-preview-reset
  deploy/scripts/rivnu-dgii-preview.sh migrate
  deploy/scripts/rivnu-dgii-preview.sh seed --confirm-preview-reset
  deploy/scripts/rivnu-dgii-preview.sh fixture
  deploy/scripts/rivnu-dgii-preview.sh import-official /ruta/DGII_RNC.TXT FECHA_ISO [VERSION]
  deploy/scripts/rivnu-dgii-preview.sh sync-official
  deploy/scripts/rivnu-dgii-preview.sh up
  deploy/scripts/rivnu-dgii-preview.sh status
  deploy/scripts/rivnu-dgii-preview.sh logs
  deploy/scripts/rivnu-dgii-preview.sh stop
  deploy/scripts/rivnu-dgii-preview.sh down

`initialize` y `seed` borran/recrean solamente los datos de la base aislada
`rivnu_dgii_preview`; por eso requieren la confirmación literal indicada.
`down` conserva el volumen del preview.
USAGE
}

preview_require_command() {
  command -v "$1" >/dev/null 2>&1 || preview_die "falta el comando requerido: $1"
}

preview_read_env() {
  local preview_file="$1"
  local preview_key="$2"
  local preview_count
  local preview_value

  preview_count="$(awk -F= -v key="$preview_key" '$1 == key { count += 1 } END { print count + 0 }' "$preview_file")"
  [[ "$preview_count" == '1' ]] ||
    preview_die "${preview_file} debe contener exactamente una variable ${preview_key}"

  preview_value="$(awk -v key="$preview_key" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); print; exit }' "$preview_file")"
  printf '%s' "$preview_value"
}

preview_assert_secret_file() {
  local preview_file="$1"
  local preview_mode

  [[ -f "$preview_file" && ! -L "$preview_file" ]] ||
    preview_die "falta el archivo regular de secretos: ${preview_file}"
  preview_mode="$(stat -c '%a' "$preview_file")"
  [[ "$preview_mode" == '600' ]] ||
    preview_die "${preview_file} debe tener permisos 0600 (actual: ${preview_mode})"
  if LC_ALL=C grep -q $'\r' "$preview_file"; then
    preview_die "${preview_file} contiene finales de línea CRLF no permitidos"
  fi
}

preview_validate_secrets() {
  local preview_db_user
  local preview_db_password
  local preview_db_name
  local preview_database_url
  local preview_direct_url
  local preview_expected_url
  local preview_jwt_secret
  local preview_hmac_secret
  local preview_tag
  local preview_secret_dir_mode

  [[ -d "$PREVIEW_SECRET_DIR" && ! -L "$PREVIEW_SECRET_DIR" ]] ||
    preview_die "la ruta de secretos debe ser un directorio real: ${PREVIEW_SECRET_DIR}"
  [[ "$(realpath -e -- "$PREVIEW_SECRET_DIR")" == "$PREVIEW_SECRET_DIR" ]] ||
    preview_die 'la ruta de secretos no puede atravesar enlaces simbólicos'
  preview_secret_dir_mode="$(stat -c '%a' "$PREVIEW_SECRET_DIR")"
  [[ "$preview_secret_dir_mode" == '700' ]] ||
    preview_die "${PREVIEW_SECRET_DIR} debe tener permisos 0700 (actual: ${preview_secret_dir_mode})"

  preview_assert_secret_file "$PREVIEW_DB_ENV"
  preview_assert_secret_file "$PREVIEW_API_ENV"
  preview_assert_secret_file "$PREVIEW_DEPLOY_ENV"

  preview_db_user="$(preview_read_env "$PREVIEW_DB_ENV" POSTGRES_USER)"
  preview_db_password="$(preview_read_env "$PREVIEW_DB_ENV" POSTGRES_PASSWORD)"
  preview_db_name="$(preview_read_env "$PREVIEW_DB_ENV" POSTGRES_DB)"

  [[ "$preview_db_user" == "$PREVIEW_DB_USER" ]] ||
    preview_die 'POSTGRES_USER no corresponde al preview'
  [[ "$preview_db_name" == "$PREVIEW_DB_NAME" ]] ||
    preview_die 'POSTGRES_DB no corresponde al preview'
  [[ "$preview_db_password" =~ ^[[:xdigit:]]{48,128}$ ]] ||
    preview_die 'POSTGRES_PASSWORD debe ser hexadecimal y tener al menos 48 caracteres'

  preview_expected_url="postgresql://${PREVIEW_DB_USER}:${preview_db_password}@${PREVIEW_DB_HOST}:${PREVIEW_DB_PORT}/${PREVIEW_DB_NAME}?schema=public"
  preview_database_url="$(preview_read_env "$PREVIEW_API_ENV" DATABASE_URL)"
  preview_direct_url="$(preview_read_env "$PREVIEW_API_ENV" DIRECT_URL)"
  [[ "$preview_database_url" == "$preview_expected_url" ]] ||
    preview_die 'DATABASE_URL no apunta exactamente a la base aislada del preview'
  [[ "$preview_direct_url" == "$preview_expected_url" ]] ||
    preview_die 'DIRECT_URL no apunta exactamente a la base aislada del preview'
  [[ "$(preview_read_env "$PREVIEW_API_ENV" NODE_ENV)" == 'development' ]] ||
    preview_die 'NODE_ENV debe ser development en el preview'
  [[ "$(preview_read_env "$PREVIEW_API_ENV" RIVNU_PREVIEW_GUARD)" == "$PREVIEW_GUARD" ]] ||
    preview_die 'falta la marca de seguridad RIVNU_PREVIEW_GUARD'
  [[ "$(preview_read_env "$PREVIEW_API_ENV" CORS_ORIGIN)" == 'http://127.0.0.1:3101,http://localhost:3101' ]] ||
    preview_die 'CORS_ORIGIN no corresponde al preview local'
  [[ -z "$(preview_read_env "$PREVIEW_API_ENV" SUPABASE_URL)" ]] ||
    preview_die 'SUPABASE_URL debe permanecer vacío en el preview aislado'
  [[ -z "$(preview_read_env "$PREVIEW_API_ENV" SUPABASE_SERVICE_ROLE_KEY)" ]] ||
    preview_die 'SUPABASE_SERVICE_ROLE_KEY debe permanecer vacío en el preview aislado'

  preview_jwt_secret="$(preview_read_env "$PREVIEW_API_ENV" JWT_SECRET)"
  preview_hmac_secret="$(preview_read_env "$PREVIEW_API_ENV" TAX_IDENTITY_HMAC_SECRET)"
  [[ "$preview_jwt_secret" =~ ^[[:xdigit:]]{64,128}$ ]] ||
    preview_die 'JWT_SECRET del preview debe ser hexadecimal y tener al menos 64 caracteres'
  [[ "$preview_hmac_secret" =~ ^[[:xdigit:]]{64,128}$ ]] ||
    preview_die 'TAX_IDENTITY_HMAC_SECRET del preview debe ser hexadecimal y tener al menos 64 caracteres'

  [[ "$(preview_read_env "$PREVIEW_DEPLOY_ENV" RIVNU_DGII_PREVIEW_SECRET_DIR)" == "$PREVIEW_SECRET_DIR" ]] ||
    preview_die 'RIVNU_DGII_PREVIEW_SECRET_DIR no coincide con la ruta aislada aprobada'
  [[ "$(preview_read_env "$PREVIEW_DEPLOY_ENV" NEXT_PUBLIC_APP_URL)" == "$PREVIEW_APP_URL" ]] ||
    preview_die 'NEXT_PUBLIC_APP_URL no corresponde a 127.0.0.1:3101'
  [[ "$(preview_read_env "$PREVIEW_DEPLOY_ENV" NEXT_PUBLIC_API_URL)" == "$PREVIEW_API_URL" ]] ||
    preview_die 'NEXT_PUBLIC_API_URL no corresponde a 127.0.0.1:4101'

  preview_tag="$(preview_read_env "$PREVIEW_DEPLOY_ENV" RIVNU_DGII_PREVIEW_TAG)"
  [[ "$preview_tag" =~ ^dgii-preview-[A-Za-z0-9._-]+$ ]] ||
    preview_die 'RIVNU_DGII_PREVIEW_TAG debe comenzar con dgii-preview-'

  if grep -Eq '^(ALLOW_PRODUCTION_SEED|CONFIRM_CLEAN_RIVNU)=.*(true|YES)' "$PREVIEW_API_ENV"; then
    preview_die 'el archivo API del preview contiene una habilitación destructiva de producción'
  fi
}

preview_compose() {
  docker compose \
    --project-name "$PREVIEW_PROJECT" \
    --env-file "$PREVIEW_DEPLOY_ENV" \
    --file "$PREVIEW_COMPOSE_FILE" \
    "$@"
}

preview_validate_compose() {
  local preview_services
  local preview_expected_services
  local preview_config_json
  local preview_tag
  local preview_guard_path

  preview_require_command docker
  preview_require_command jq
  preview_require_command realpath
  preview_validate_secrets

  preview_compose --profile setup config --quiet
  preview_services="$(preview_compose --profile setup config --services | LC_ALL=C sort)"
  preview_expected_services="$(printf '%s\n' \
    rivnu-dgii-preview-api \
    rivnu-dgii-preview-configure \
    rivnu-dgii-preview-db \
    rivnu-dgii-preview-fixture \
    rivnu-dgii-preview-migrate \
    rivnu-dgii-preview-seed \
    rivnu-dgii-preview-web | LC_ALL=C sort)"
  [[ "$preview_services" == "$preview_expected_services" ]] ||
    preview_die 'Compose contiene servicios fuera del conjunto aislado esperado'

  preview_config_json="$(preview_compose --profile setup config --format json)"
  preview_tag="$(preview_read_env "$PREVIEW_DEPLOY_ENV" RIVNU_DGII_PREVIEW_TAG)"
  preview_guard_path="${PREVIEW_REPO_DIR}/deploy/docker/preview-environment-guard.sh"
  jq -e \
    --arg api_image "corestack/rivnu-api:${preview_tag}" \
    --arg web_image "corestack/rivnu-web:${preview_tag}" \
    --arg guard_path "$preview_guard_path" '
    def service($name): .services[$name];
    def exact_networks($name; $expected):
      ((service($name).networks | keys | sort) == ($expected | sort));
    def no_ports($name):
      (((service($name).ports // []) | length) == 0);
    def guarded_read_only($name):
      service($name).entrypoint == ["/usr/local/bin/rivnu-preview-environment-guard"] and
      service($name).environment.NODE_ENV == "development" and
      service($name).environment.RIVNU_PREVIEW_GUARD == "RIVNU_DGII_PREVIEW_ONLY" and
      service($name).read_only == true and
      service($name).tmpfs == ["/tmp:size=64m,mode=1777"] and
      service($name).security_opt == ["no-new-privileges:true"] and
      (service($name).volumes | length) == 1 and
      service($name).volumes[0].type == "bind" and
      service($name).volumes[0].source == $guard_path and
      service($name).volumes[0].target == "/usr/local/bin/rivnu-preview-environment-guard" and
      service($name).volumes[0].read_only == true;
    def exact_limits($name; $cpus; $memory; $reservation):
      service($name).cpus == $cpus and
      (service($name).mem_limit | tonumber) == $memory and
      (service($name).memswap_limit | tonumber) == $memory and
      ((service($name).mem_reservation // "0") | tonumber) == $reservation and
      service($name).pids_limit == 96;

    (.services | keys | sort) == ([
      "rivnu-dgii-preview-api",
      "rivnu-dgii-preview-configure",
      "rivnu-dgii-preview-db",
      "rivnu-dgii-preview-fixture",
      "rivnu-dgii-preview-migrate",
      "rivnu-dgii-preview-seed",
      "rivnu-dgii-preview-web"
    ] | sort) and
    (.networks | keys | sort) == ([
      "rivnu-dgii-preview-data",
      "rivnu-dgii-preview-edge"
    ] | sort) and
    (.volumes | keys) == ["rivnu-dgii-preview-pgdata"] and
    .networks["rivnu-dgii-preview-data"].name == "rivnu-dgii-preview-data" and
    .networks["rivnu-dgii-preview-data"].internal == true and
    .networks["rivnu-dgii-preview-edge"].name == "rivnu-dgii-preview-edge" and
    ((.networks["rivnu-dgii-preview-edge"].internal // false) == false) and
    .volumes["rivnu-dgii-preview-pgdata"].name == "rivnu-dgii-preview-pgdata" and
    service("rivnu-dgii-preview-db").image == "postgres:17-alpine" and
    service("rivnu-dgii-preview-api").image == $api_image and
    service("rivnu-dgii-preview-migrate").image == $api_image and
    service("rivnu-dgii-preview-seed").image == $api_image and
    service("rivnu-dgii-preview-configure").image == $api_image and
    service("rivnu-dgii-preview-fixture").image == $api_image and
    service("rivnu-dgii-preview-web").image == $web_image and
    .services["rivnu-dgii-preview-api"].command == [
      "node",
      "apps/api/dist/main.js"
    ] and
    .services["rivnu-dgii-preview-seed"].command == [
      "node",
      "packages/database/node_modules/tsx/dist/cli.mjs",
      "packages/database/prisma/seed.ts"
    ] and
    .services["rivnu-dgii-preview-migrate"].command == [
      "node",
      "packages/database/node_modules/prisma/build/index.js",
      "migrate",
      "deploy",
      "--schema",
      "packages/database/prisma/schema.prisma"
    ] and
    .services["rivnu-dgii-preview-configure"].command == [
      "node",
      "apps/api/dist/cli/configure-dgii-preview.js"
    ] and
    .services["rivnu-dgii-preview-fixture"].command == [
      "node",
      "apps/api/dist/cli/load-dgii-preview-fixture.js"
    ] and
    .services["rivnu-dgii-preview-fixture"].environment.DGII_ALLOW_TEST_FIXTURE == "true" and
    .services["rivnu-dgii-preview-api"].ports == [{
      "mode": "ingress",
      "host_ip": "127.0.0.1",
      "target": 4000,
      "published": "4101",
      "protocol": "tcp"
    }] and
    .services["rivnu-dgii-preview-web"].ports == [{
      "mode": "ingress",
      "host_ip": "127.0.0.1",
      "target": 3000,
      "published": "3101",
      "protocol": "tcp"
    }] and
    no_ports("rivnu-dgii-preview-db") and
    no_ports("rivnu-dgii-preview-migrate") and
    no_ports("rivnu-dgii-preview-seed") and
    no_ports("rivnu-dgii-preview-configure") and
    no_ports("rivnu-dgii-preview-fixture") and
    exact_networks("rivnu-dgii-preview-db"; ["rivnu-dgii-preview-data"]) and
    exact_networks("rivnu-dgii-preview-migrate"; ["rivnu-dgii-preview-data"]) and
    exact_networks("rivnu-dgii-preview-seed"; ["rivnu-dgii-preview-data"]) and
    exact_networks("rivnu-dgii-preview-configure"; ["rivnu-dgii-preview-data"]) and
    exact_networks("rivnu-dgii-preview-fixture"; ["rivnu-dgii-preview-data"]) and
    exact_networks("rivnu-dgii-preview-api"; ["rivnu-dgii-preview-data", "rivnu-dgii-preview-edge"]) and
    exact_networks("rivnu-dgii-preview-web"; ["rivnu-dgii-preview-edge"]) and
    (service("rivnu-dgii-preview-db").volumes | length) == 1 and
    service("rivnu-dgii-preview-db").volumes[0].type == "volume" and
    service("rivnu-dgii-preview-db").volumes[0].source == "rivnu-dgii-preview-pgdata" and
    service("rivnu-dgii-preview-db").volumes[0].target == "/var/lib/postgresql/data" and
    guarded_read_only("rivnu-dgii-preview-api") and
    guarded_read_only("rivnu-dgii-preview-migrate") and
    guarded_read_only("rivnu-dgii-preview-seed") and
    guarded_read_only("rivnu-dgii-preview-configure") and
    guarded_read_only("rivnu-dgii-preview-fixture") and
    service("rivnu-dgii-preview-web").read_only == true and
    service("rivnu-dgii-preview-web").tmpfs == ["/tmp:size=64m,mode=1777"] and
    service("rivnu-dgii-preview-web").security_opt == ["no-new-privileges:true"] and
    service("rivnu-dgii-preview-db").security_opt == ["no-new-privileges:true"] and
    exact_limits("rivnu-dgii-preview-db"; 0.25; 268435456; 134217728) and
    exact_limits("rivnu-dgii-preview-api"; 0.45; 402653184; 167772160) and
    exact_limits("rivnu-dgii-preview-web"; 0.30; 402653184; 134217728) and
    exact_limits("rivnu-dgii-preview-migrate"; 0.35; 402653184; 0) and
    exact_limits("rivnu-dgii-preview-seed"; 0.35; 402653184; 0) and
    exact_limits("rivnu-dgii-preview-configure"; 0.20; 268435456; 0) and
    exact_limits("rivnu-dgii-preview-fixture"; 0.25; 335544320; 0)
  ' >/dev/null <<<"$preview_config_json" ||
    preview_die 'Compose no conserva imágenes, guardas, límites, comandos, puertos, redes o volumen aislados esperados'
}

preview_init_secrets() {
  local preview_db_password
  local preview_jwt_secret
  local preview_hmac_secret
  local preview_tag
  local preview_database_url
  local preview_db_tmp
  local preview_api_tmp
  local preview_deploy_tmp

  preview_require_command openssl
  preview_require_command install
  preview_require_command realpath
  if [[ -e "$PREVIEW_SECRET_DIR" && ( ! -d "$PREVIEW_SECRET_DIR" || -L "$PREVIEW_SECRET_DIR" ) ]]; then
    preview_die "la ruta de secretos existente no es un directorio real: ${PREVIEW_SECRET_DIR}"
  fi
  for preview_existing in "$PREVIEW_DB_ENV" "$PREVIEW_API_ENV" "$PREVIEW_DEPLOY_ENV"; do
    [[ ! -e "$preview_existing" ]] ||
      preview_die "no se sobrescribirá el secreto existente: ${preview_existing}"
  done

  install -d -m 0700 "$PREVIEW_SECRET_DIR"
  # The parent directory is setgid on VM2; explicitly remove the inherited
  # group bit so this preview directory remains private to its operator.
  chmod 0700 "$PREVIEW_SECRET_DIR"
  chmod g-s "$PREVIEW_SECRET_DIR"
  [[ "$(realpath -e -- "$PREVIEW_SECRET_DIR")" == "$PREVIEW_SECRET_DIR" ]] ||
    preview_die 'la ruta de secretos no puede atravesar enlaces simbólicos'
  umask 077
  preview_db_password="$(openssl rand -hex 24)"
  preview_jwt_secret="$(openssl rand -hex 32)"
  preview_hmac_secret="$(openssl rand -hex 32)"
  preview_tag="dgii-preview-$(date -u +%Y%m%d%H%M%S)"
  preview_database_url="postgresql://${PREVIEW_DB_USER}:${preview_db_password}@${PREVIEW_DB_HOST}:${PREVIEW_DB_PORT}/${PREVIEW_DB_NAME}?schema=public"
  preview_db_tmp="$(mktemp "${PREVIEW_SECRET_DIR}/.db.env.XXXXXX")"
  preview_api_tmp="$(mktemp "${PREVIEW_SECRET_DIR}/.api.env.XXXXXX")"
  preview_deploy_tmp="$(mktemp "${PREVIEW_SECRET_DIR}/.deploy.env.XXXXXX")"
  trap 'rm -f -- "${preview_db_tmp:-}" "${preview_api_tmp:-}" "${preview_deploy_tmp:-}"' RETURN

  printf '%s\n' \
    "POSTGRES_USER=${PREVIEW_DB_USER}" \
    "POSTGRES_PASSWORD=${preview_db_password}" \
    "POSTGRES_DB=${PREVIEW_DB_NAME}" \
    'PGDATA=/var/lib/postgresql/data/pgdata' >"$preview_db_tmp"

  printf '%s\n' \
    "DATABASE_URL=${preview_database_url}" \
    "DIRECT_URL=${preview_database_url}" \
    "JWT_SECRET=${preview_jwt_secret}" \
    'JWT_EXPIRES_IN=8h' \
    'CORS_ORIGIN=http://127.0.0.1:3101,http://localhost:3101' \
    'NODE_ENV=development' \
    "RIVNU_PREVIEW_GUARD=${PREVIEW_GUARD}" \
    'TRUST_PROXY=false' \
    'API_PORT=4000' \
    'API_RATE_LIMIT_WINDOW_MS=900000' \
    'API_RATE_LIMIT_MAX=600' \
    'AUTH_RATE_LIMIT_WINDOW_MS=900000' \
    'AUTH_RATE_LIMIT_MAX=10' \
    'TAX_IDENTITY_OVERRIDE_RATE_LIMIT_WINDOW_MS=900000' \
    'TAX_IDENTITY_OVERRIDE_RATE_LIMIT_MAX=5' \
    'DGII_REGISTRY_MAX_AGE_HOURS=216' \
    'DGII_REGISTRY_RETAIN_SUPERSEDED_DATASETS=1' \
    'DGII_REGISTRY_IMPORT_STALE_HOURS=24' \
    "TAX_IDENTITY_HMAC_SECRET=${preview_hmac_secret}" \
    'API_JSON_BODY_LIMIT=20mb' \
    'API_FORM_BODY_LIMIT=20mb' \
    'INTERNAL_ALLOWED_IPS=' \
    'MOBILE_OCR_PUBLIC_RATE_LIMIT_WINDOW_MS=600000' \
    'MOBILE_OCR_PUBLIC_RATE_LIMIT_MAX=30' \
    'SUPABASE_URL=' \
    'SUPABASE_SERVICE_ROLE_KEY=' \
    'SUPABASE_PRODUCT_IMAGE_BUCKET=product-images' >"$preview_api_tmp"

  printf '%s\n' \
    "RIVNU_DGII_PREVIEW_TAG=${preview_tag}" \
    "RIVNU_DGII_PREVIEW_SECRET_DIR=${PREVIEW_SECRET_DIR}" \
    "NEXT_PUBLIC_APP_URL=${PREVIEW_APP_URL}" \
    "NEXT_PUBLIC_API_URL=${PREVIEW_API_URL}" \
    'RIVNU_DGII_PREVIEW_DB_CPUS=0.25' \
    'RIVNU_DGII_PREVIEW_DB_MEMORY_LIMIT=256m' \
    'RIVNU_DGII_PREVIEW_DB_MEMORY_SWAP_LIMIT=256m' \
    'RIVNU_DGII_PREVIEW_DB_MEMORY_RESERVATION=128m' \
    'RIVNU_DGII_PREVIEW_DB_PIDS_LIMIT=96' \
    'RIVNU_DGII_PREVIEW_API_CPUS=0.45' \
    'RIVNU_DGII_PREVIEW_API_MEMORY_LIMIT=384m' \
    'RIVNU_DGII_PREVIEW_API_MEMORY_SWAP_LIMIT=384m' \
    'RIVNU_DGII_PREVIEW_API_MEMORY_RESERVATION=160m' \
    'RIVNU_DGII_PREVIEW_API_PIDS_LIMIT=96' \
    'RIVNU_DGII_PREVIEW_WEB_CPUS=0.30' \
    'RIVNU_DGII_PREVIEW_WEB_MEMORY_LIMIT=384m' \
    'RIVNU_DGII_PREVIEW_WEB_MEMORY_SWAP_LIMIT=384m' \
    'RIVNU_DGII_PREVIEW_WEB_MEMORY_RESERVATION=128m' \
    'RIVNU_DGII_PREVIEW_WEB_PIDS_LIMIT=96' >"$preview_deploy_tmp"

  install -m 0600 "$preview_db_tmp" "$PREVIEW_DB_ENV"
  install -m 0600 "$preview_api_tmp" "$PREVIEW_API_ENV"
  install -m 0600 "$preview_deploy_tmp" "$PREVIEW_DEPLOY_ENV"
  rm -f -- "$preview_db_tmp" "$preview_api_tmp" "$preview_deploy_tmp"
  trap - RETURN

  printf 'Secretos exclusivos del preview creados en %s (no se mostró ningún valor).\n' "$PREVIEW_SECRET_DIR"
}

preview_database_up() {
  preview_compose up --detach --wait --wait-timeout 60 rivnu-dgii-preview-db
}

preview_acquire_registry_lock() {
  preview_require_command flock
  exec 9>"${PREVIEW_SECRET_DIR}/dgii-registry.lock"
  chmod 0600 "${PREVIEW_SECRET_DIR}/dgii-registry.lock"
  flock --nonblock 9 ||
    preview_die 'ya hay otra carga o sincronización del padrón DGII en ejecución'
}

preview_container_is_running() {
  local preview_container_name="$1"
  local preview_running

  preview_running="$(
    docker inspect --format '{{.State.Running}}' "$preview_container_name" 2>/dev/null || true
  )"
  [[ "$preview_running" == 'true' ]]
}

preview_with_app_services_paused() (
  local preview_api_was_running='false'
  local preview_web_was_running='false'
  local -a preview_services_to_stop=()

  preview_restore_app_services() {
    local preview_original_status="$?"
    local preview_restore_status=0
    local -a preview_services_to_restore=()

    trap - EXIT
    set +e

    if [[ "$preview_api_was_running" == 'true' ]]; then
      preview_services_to_restore+=(rivnu-dgii-preview-api)
    fi
    if [[ "$preview_web_was_running" == 'true' ]]; then
      if [[ "$preview_api_was_running" != 'true' ]]; then
        preview_services_to_restore+=(rivnu-dgii-preview-api)
      fi
      preview_services_to_restore+=(rivnu-dgii-preview-web)
    fi

    if (( ${#preview_services_to_restore[@]} > 0 )); then
      printf 'Restaurando el estado previo de API/Web del preview...\n'
      preview_compose up --detach "${preview_services_to_restore[@]}"
      preview_restore_status=$?

      if [[ "$preview_web_was_running" == 'true' && "$preview_api_was_running" != 'true' ]]; then
        local preview_api_stop_status
        preview_compose stop rivnu-dgii-preview-api
        preview_api_stop_status=$?
        if [[ "$preview_restore_status" -eq 0 ]]; then
          preview_restore_status="$preview_api_stop_status"
        fi
      fi
    fi

    if [[ "$preview_original_status" -ne 0 ]]; then
      if [[ "$preview_restore_status" -ne 0 ]]; then
        printf 'Advertencia: la operación falló y tampoco se pudo restaurar completamente API/Web del preview.\n' >&2
      fi
      exit "$preview_original_status"
    fi
    exit "$preview_restore_status"
  }

  if preview_container_is_running rivnu-dgii-preview-api; then
    preview_api_was_running='true'
  fi
  if preview_container_is_running rivnu-dgii-preview-web; then
    preview_web_was_running='true'
  fi

  trap preview_restore_app_services EXIT

  if [[ "$preview_web_was_running" == 'true' ]]; then
    preview_services_to_stop+=(rivnu-dgii-preview-web)
  fi
  if [[ "$preview_api_was_running" == 'true' ]]; then
    preview_services_to_stop+=(rivnu-dgii-preview-api)
  fi
  if (( ${#preview_services_to_stop[@]} > 0 )); then
    printf 'Pausando temporalmente API/Web del preview para respetar el presupuesto de recursos...\n'
    preview_compose stop "${preview_services_to_stop[@]}"
  fi

  "$@"
)

preview_migrate() {
  preview_compose stop rivnu-dgii-preview-web rivnu-dgii-preview-api >/dev/null 2>&1 || true
  preview_database_up
  preview_compose --profile setup run --rm rivnu-dgii-preview-migrate
}

preview_reset_database() {
  preview_compose stop rivnu-dgii-preview-web rivnu-dgii-preview-api >/dev/null 2>&1 || true
  preview_database_up
  preview_compose --profile setup run --rm rivnu-dgii-preview-migrate \
    node \
    packages/database/node_modules/prisma/build/index.js \
    migrate \
    reset \
    --force \
    --skip-seed \
    --skip-generate \
    --schema \
    packages/database/prisma/schema.prisma
}

preview_seed() {
  [[ "${1:-}" == '--confirm-preview-reset' ]] ||
    preview_die 'seed requiere --confirm-preview-reset'
  preview_reset_database
  preview_compose --profile setup run --rm rivnu-dgii-preview-seed
  preview_configure
}

preview_configure() {
  preview_compose --profile setup run --rm rivnu-dgii-preview-configure
}

preview_fixture_only() {
  preview_compose --profile setup run --rm rivnu-dgii-preview-fixture
}

preview_fixture_job() {
  preview_database_up
  preview_fixture_only
}

preview_fixture() {
  preview_with_app_services_paused preview_fixture_job
}

preview_import_official_job() {
  local preview_resolved_file="$1"
  local preview_source_updated_at="$2"
  local preview_version="$3"
  local preview_container_user
  local -a preview_import_command

  preview_container_user="$(id -u):$(id -g)"
  preview_import_command=(
    node
    apps/api/dist/cli/import-dgii-registry.js
    --file
    /preview-import/DGII_RNC.TXT
    --source-updated-at
    "$preview_source_updated_at"
  )
  if [[ -n "$preview_version" ]]; then
    preview_import_command+=(--version "$preview_version")
  fi

  preview_database_up
  preview_compose run --rm --no-deps --user "$preview_container_user" \
    --volume "${preview_resolved_file}:/preview-import/DGII_RNC.TXT:ro" \
    rivnu-dgii-preview-api \
    "${preview_import_command[@]}"
}

preview_import_official() {
  local preview_source_file="${1:-}"
  local preview_source_updated_at="${2:-}"
  local preview_version="${3:-}"
  local preview_resolved_file

  preview_require_command date
  preview_require_command id
  preview_require_command realpath

  [[ "$preview_source_file" == /* ]] ||
    preview_die 'import-official requiere una ruta absoluta al TXT oficial ya descargado'
  [[ -f "$preview_source_file" && ! -L "$preview_source_file" && -r "$preview_source_file" ]] ||
    preview_die 'el TXT oficial debe ser un archivo regular, legible y no un enlace simbólico'
  [[ "$preview_source_updated_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    preview_die 'la fecha debe usar UTC ISO-8601, por ejemplo 2026-08-21T12:00:00Z'
  date -u -d "$preview_source_updated_at" '+%Y-%m-%dT%H:%M:%SZ' >/dev/null ||
    preview_die 'la fecha de actualización no es válida'
  if [[ -n "$preview_version" && ! "$preview_version" =~ ^[A-Za-z0-9._-]{1,80}$ ]]; then
    preview_die 'VERSION solo puede contener letras, números, punto, guion y guion bajo'
  fi

  preview_resolved_file="$(realpath -- "$preview_source_file")"
  preview_with_app_services_paused \
    preview_import_official_job \
    "$preview_resolved_file" \
    "$preview_source_updated_at" \
    "$preview_version"
}

preview_sync_official() {
  local preview_sync_dir
  local preview_sync_headers
  local preview_sync_archive
  local preview_sync_text
  local preview_sync_http_date
  local preview_sync_source_updated_at
  local preview_sync_version
  local preview_sync_archive_size
  local preview_sync_checksum
  local preview_active_checksum

  preview_require_command curl
  preview_require_command python3
  preview_require_command date
  preview_require_command sha256sum
  preview_require_command stat
  preview_sync_dir="$(mktemp -d /tmp/rivnu-dgii-sync.XXXXXX)"
  chmod 0700 "$preview_sync_dir"
  preview_sync_headers="${preview_sync_dir}/headers"
  preview_sync_archive="${preview_sync_dir}/DGII_RNC.zip"
  preview_sync_text="${preview_sync_dir}/DGII_RNC.TXT"
  trap 'rm -f -- "${preview_sync_headers:-}" "${preview_sync_archive:-}" "${preview_sync_text:-}"; rmdir -- "${preview_sync_dir:-}" 2>/dev/null || true' EXIT RETURN

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
    --user-agent 'Mozilla/5.0 (compatible; CoreStack-RIVNU-DGII-Sync/1.0)' \
    --dump-header "$preview_sync_headers" \
    --output "$preview_sync_archive" \
    "$PREVIEW_DGII_REGISTRY_URL"

  preview_sync_archive_size="$(stat -c '%s' "$preview_sync_archive")"
  [[ "$preview_sync_archive_size" -ge 1048576 && "$preview_sync_archive_size" -le 67108864 ]] ||
    preview_die 'el ZIP oficial quedó fuera del rango seguro de 1 a 64 MiB'

  preview_sync_http_date="$(
    awk 'BEGIN { IGNORECASE = 1 }
      /^last-modified:[[:space:]]*/ {
        sub(/^[^:]+:[[:space:]]*/, "");
        sub(/\r$/, "");
        value = $0
      }
      END { print value }
    ' "$preview_sync_headers"
  )"
  [[ -n "$preview_sync_http_date" ]] ||
    preview_die 'DGII no informó Last-Modified; no se puede fechar el padrón de forma verificable'
  preview_sync_source_updated_at="$(date -u -d "$preview_sync_http_date" '+%Y-%m-%dT%H:%M:%SZ')" ||
    preview_die 'Last-Modified del ZIP oficial no es una fecha válida'

  python3 - "$preview_sync_archive" "$preview_sync_text" <<'PY'
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
  chmod 0600 "$preview_sync_text"

  preview_sync_checksum="$(sha256sum "$preview_sync_text" | awk '{ print $1 }')"
  preview_database_up
  preview_active_checksum="$(
    docker exec rivnu-dgii-preview-db \
      psql -U "$PREVIEW_DB_USER" -d "$PREVIEW_DB_NAME" -Atc \
      'SELECT "checksumSha256" FROM "DgiiRegistryDataset" WHERE "status" = '\''ACTIVE'\'' AND "source" = '\''DGII_OFFICIAL'\'' LIMIT 1;' \
      2>/dev/null || true
  )"
  if [[ -n "$preview_active_checksum" && "$preview_active_checksum" == "$preview_sync_checksum" ]]; then
    printf 'El padrón oficial activo ya coincide con el ZIP publicado por DGII; no se reimportó.\n'
    rm -f -- "$preview_sync_headers" "$preview_sync_archive" "$preview_sync_text"
    rmdir -- "$preview_sync_dir"
    trap - EXIT RETURN
    return 0
  fi

  preview_sync_version="dgii-$(date -u -d "$preview_sync_source_updated_at" '+%Y%m%dT%H%M%SZ')-${preview_sync_checksum:0:12}"
  preview_import_official \
    "$preview_sync_text" \
    "$preview_sync_source_updated_at" \
    "$preview_sync_version"

  rm -f -- "$preview_sync_headers" "$preview_sync_archive" "$preview_sync_text"
  rmdir -- "$preview_sync_dir"
  trap - EXIT RETURN
}

preview_initialize() {
  [[ "${1:-}" == '--confirm-preview-reset' ]] ||
    preview_die 'initialize requiere --confirm-preview-reset'
  preview_seed --confirm-preview-reset
  preview_fixture_only
  preview_compose up --detach rivnu-dgii-preview-api rivnu-dgii-preview-web
}

preview_main() {
  local preview_action="${1:-}"
  shift || true

  case "$preview_action" in
    init-secrets)
      [[ "$#" -eq 0 ]] || preview_die 'init-secrets no acepta argumentos'
      preview_init_secrets
      ;;
    check)
      [[ "$#" -eq 0 ]] || preview_die 'check no acepta argumentos'
      preview_validate_compose
      printf 'Configuración del preview validada; producción no fue consultada ni modificada.\n'
      ;;
    build)
      [[ "$#" -eq 0 ]] || preview_die 'build no acepta argumentos'
      preview_validate_compose
      preview_compose build rivnu-dgii-preview-api rivnu-dgii-preview-web
      ;;
    initialize)
      [[ "$#" -eq 1 ]] || preview_die 'initialize requiere un solo argumento de confirmación'
      preview_validate_compose
      preview_acquire_registry_lock
      preview_initialize "$1"
      ;;
    migrate)
      [[ "$#" -eq 0 ]] || preview_die 'migrate no acepta argumentos'
      preview_validate_compose
      preview_acquire_registry_lock
      preview_migrate
      ;;
    seed)
      [[ "$#" -eq 1 ]] || preview_die 'seed requiere un solo argumento de confirmación'
      preview_validate_compose
      preview_acquire_registry_lock
      preview_seed "$1"
      ;;
    fixture)
      [[ "$#" -eq 0 ]] || preview_die 'fixture no acepta argumentos'
      preview_validate_compose
      preview_acquire_registry_lock
      preview_fixture
      ;;
    import-official)
      [[ "$#" -ge 2 && "$#" -le 3 ]] ||
        preview_die 'import-official requiere ARCHIVO FECHA_ISO y VERSION opcional'
      preview_validate_compose
      preview_require_command date
      preview_require_command id
      preview_require_command realpath
      preview_acquire_registry_lock
      preview_import_official "$@"
      ;;
    sync-official)
      [[ "$#" -eq 0 ]] || preview_die 'sync-official no acepta argumentos'
      preview_validate_compose
      preview_acquire_registry_lock
      preview_sync_official
      ;;
    up)
      [[ "$#" -eq 0 ]] || preview_die 'up no acepta argumentos'
      preview_validate_compose
      preview_acquire_registry_lock
      preview_migrate
      preview_compose up --detach rivnu-dgii-preview-api rivnu-dgii-preview-web
      ;;
    status)
      [[ "$#" -eq 0 ]] || preview_die 'status no acepta argumentos'
      preview_validate_compose
      preview_compose ps
      ;;
    logs)
      [[ "$#" -eq 0 ]] || preview_die 'logs no acepta argumentos'
      preview_validate_compose
      preview_compose logs --follow --tail 200 rivnu-dgii-preview-api rivnu-dgii-preview-web
      ;;
    stop)
      [[ "$#" -eq 0 ]] || preview_die 'stop no acepta argumentos'
      preview_validate_compose
      preview_acquire_registry_lock
      preview_compose stop rivnu-dgii-preview-web rivnu-dgii-preview-api rivnu-dgii-preview-db
      ;;
    down)
      [[ "$#" -eq 0 ]] || preview_die 'down no acepta argumentos'
      preview_validate_compose
      preview_acquire_registry_lock
      preview_compose down --remove-orphans
      ;;
    help|-h|--help|'')
      preview_usage
      ;;
    *)
      preview_usage >&2
      preview_die "acción desconocida: ${preview_action}"
      ;;
  esac
}

preview_main "$@"
