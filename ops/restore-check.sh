#!/bin/sh
# Prove that the most recent backup actually restores.
#
# A backup nobody has restored is a hope, not a backup. This restores the newest dump into
# a throwaway database, counts the rows in a few tables that matter, and drops it again.
#
#   docker compose run --rm backup /ops/restore-check.sh
#
# Configuration:
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE   the server holding the scratch database
#   BACKUP_DIR        where dumps live (default /backups)
#   RESTORE_DATABASE  the scratch database name (default ekavist_restore_check)

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-ekavist}"
PGDATABASE="${PGDATABASE:-ekavist}"
RESTORE_DATABASE="${RESTORE_DATABASE:-ekavist_restore_check}"
export PGHOST PGPORT PGUSER

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) restore-check: $*"
}

newest="$(find "$BACKUP_DIR" -name "${PGDATABASE}-*.dump" -type f | sort | tail -n 1)"
if [ -z "$newest" ]; then
  log "FAILED: no dump found in ${BACKUP_DIR}"
  exit 1
fi
log "restoring ${newest} into ${RESTORE_DATABASE}"

psql -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${RESTORE_DATABASE}\";"
psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${RESTORE_DATABASE}\" OWNER \"${PGUSER}\";"

# `--exit-on-error` is deliberate: a restore that "mostly worked" is a failed restore.
pg_restore --dbname="$RESTORE_DATABASE" --no-owner --exit-on-error "$newest"

for table in Organization User Project Task Message; do
  count="$(psql -d "$RESTORE_DATABASE" -tAc "SELECT COUNT(*) FROM \"${table}\";")"
  log "${table}: ${count} row(s)"
done

psql -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE \"${RESTORE_DATABASE}\";"
log "done; the backup restores"
