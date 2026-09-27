#!/bin/sh
# Take one database backup.
#
# Custom format (`-Fc`), because it is compressed, it restores selectively, and
# `pg_restore --list` can read it back as a cheap integrity check — a dump that cannot be
# listed is a dump that will not restore, and finding that out now is the entire point.
#
# Run by the `backup` service in docker-compose.yml, and safe to run by hand:
#
#   docker compose run --rm backup /ops/backup.sh
#
# Configuration comes from the environment:
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE   the server to dump
#   BACKUP_DIR        where dumps are written (default /backups)
#   RETENTION_DAYS    how long a dump is kept (default 14)

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-ekavist}"
PGDATABASE="${PGDATABASE:-ekavist}"
export PGHOST PGPORT PGUSER PGDATABASE

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${BACKUP_DIR}/${PGDATABASE}-${timestamp}.dump"

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: $*"
}

mkdir -p "$BACKUP_DIR"

log "dumping ${PGDATABASE} from ${PGHOST}:${PGPORT} to ${target}"
pg_dump --format=custom --compress=6 --file="$target" "$PGDATABASE"

# An unreadable dump is worse than no dump, because it is silent. Fail loudly instead.
if ! pg_restore --list "$target" > /dev/null 2>&1; then
  log "FAILED: ${target} is not a readable dump; removing it"
  rm -f "$target"
  exit 1
fi

size="$(wc -c < "$target" | tr -d ' ')"
log "wrote ${target} (${size} bytes), table of contents verified"

# Retention runs after a successful dump, never before: a failed backup must not be the
# reason the previous good one was deleted.
removed="$(find "$BACKUP_DIR" -name "${PGDATABASE}-*.dump" -type f -mtime "+${RETENTION_DAYS}" -print -delete | wc -l | tr -d ' ')"
log "removed ${removed} dump(s) older than ${RETENTION_DAYS} days"

kept="$(find "$BACKUP_DIR" -name "${PGDATABASE}-*.dump" -type f | wc -l | tr -d ' ')"
log "done; ${kept} dump(s) retained"
