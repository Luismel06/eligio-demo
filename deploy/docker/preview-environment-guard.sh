#!/bin/sh

set -eu

readonly expected_guard='RIVNU_DGII_PREVIEW_ONLY'
readonly expected_node_env='development'

fail() {
  printf '%s\n' "RIVNU DGII preview guard refused to start: $*" >&2
  exit 78
}

[ "${RIVNU_PREVIEW_GUARD:-}" = "$expected_guard" ] || fail 'missing preview-only marker'
[ "${NODE_ENV:-}" = "$expected_node_env" ] || fail 'NODE_ENV must be development'
[ -n "${DATABASE_URL:-}" ] || fail 'DATABASE_URL is required'
[ -n "${DIRECT_URL:-}" ] || fail 'DIRECT_URL is required'

node <<'NODE'
const expected = {
  protocol: 'postgresql:',
  username: 'rivnu_preview',
  hostname: 'rivnu-dgii-preview-db',
  port: '5432',
  pathname: '/rivnu_dgii_preview',
  schema: 'public',
};

for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  let parsed;

  try {
    parsed = new URL(process.env[key]);
  } catch {
    process.stderr.write(`RIVNU DGII preview guard refused to start: ${key} is invalid.\n`);
    process.exit(78);
  }

  const valid =
    parsed.protocol === expected.protocol &&
    parsed.username === expected.username &&
    parsed.password.length >= 32 &&
    parsed.hostname === expected.hostname &&
    parsed.port === expected.port &&
    parsed.pathname === expected.pathname &&
    parsed.searchParams.size === 1 &&
    parsed.searchParams.get('schema') === expected.schema;

  if (!valid) {
    process.stderr.write(
      `RIVNU DGII preview guard refused to start: ${key} does not target the isolated preview database.\n`,
    );
    process.exit(78);
  }
}
NODE

exec "$@"
