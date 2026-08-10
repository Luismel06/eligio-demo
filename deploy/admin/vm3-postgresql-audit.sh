#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

echo "== PostgreSQL clusters/version =="
pg_lsclusters
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -Atqc 'select version();'

echo "== PostgreSQL listeners =="
ss -lntp | awk 'NR == 1 || $4 ~ /:5432$/'

echo "== Relevant postgresql.conf settings =="
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -Atqc "select name || '=' || setting from pg_settings where name in ('listen_addresses','port','ssl','data_directory','hba_file','config_file') order by name;"

echo "== pg_hba rules (password fields do not exist here) =="
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -P pager=off -c 'select rule_number,type,database,user_name,address,netmask,auth_method,error from pg_hba_file_rules order by rule_number;'

echo "== Roles (no password material) =="
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -P pager=off -c 'select rolname,rolsuper,rolcreatedb,rolcreaterole,rolcanlogin from pg_roles order by rolname;'

echo "== Databases (no contents) =="
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -P pager=off -c 'select datname,pg_get_userbyid(datdba) as owner,datallowconn from pg_database order by datname;'

echo "== Firewall =="
ufw status verbose
ufw status numbered

echo "== Capacity =="
df -hT / /var/lib/postgresql
du -sh /var/lib/postgresql 2>/dev/null || true
