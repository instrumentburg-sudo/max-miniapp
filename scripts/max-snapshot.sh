#!/usr/bin/env bash
# Invoked over SSH by deploy.sh. No network calls here; also runnable on a test tree.
set -euo pipefail
umask 077
root="${1:?root required}"
action="${2:?action required}"
archive="${3:-}"
[[ "$root" = /* && "$root" != / && "$(realpath -e -- "$root")" = "$root" ]] || { echo 'Invalid deployment root' >&2; exit 1; }
web="$root/www"
backups="$root/max-deploy-backups"
[[ -d "$web" && ! -L "$web" && "$(realpath -e -- "$web")" = "$web" ]] || { echo 'Invalid web root' >&2; exit 1; }
for name in max-app max-api; do
  [[ -d "$web/$name" && ! -L "$web/$name" && "$(realpath -e -- "$web/$name")" = "$web/$name" ]] || { echo "Invalid target: $name" >&2; exit 1; }
done
[[ ! -L "$backups" ]] || { echo 'Backup directory cannot be a symlink' >&2; exit 1; }
mkdir -p -- "$backups"
[[ "$(realpath -e -- "$backups")" = "$backups" ]] || exit 1
chmod 700 "$backups"
verify() {
  [[ "$archive" == "$backups"/snapshot-*.tar.gz && -f "$archive" && ! -L "$archive" && "$(realpath -e -- "$archive")" = "$archive" ]] || { echo 'Invalid archive path' >&2; exit 1; }
  [[ -f "$archive.sha256" && ! -L "$archive.sha256" ]] || { echo 'Missing archive checksum' >&2; exit 1; }
  # Verify only this archive, never paths supplied by checksum-file content.
  expected="$(cut -c 1-64 "$archive.sha256")"
  [[ "$expected" =~ ^[0-9a-f]{64}$ && "$(sha256sum "$archive" | cut -d ' ' -f 1)" = "$expected" ]] || { echo 'Archive checksum mismatch' >&2; exit 1; }
  gzip -t "$archive"
  listing="$(tar -tzf "$archive")"
  for required in max-app/ max-app/index.html max-app/.htaccess max-api/ max-api/index.php max-api/.htaccess; do
    [[ $'\n'"$listing"$'\n' == *$'\n'"$required"$'\n'* ]] || { echo "Archive lacks $required" >&2; exit 1; }
  done
  while IFS= read -r member; do
    [[ "$member" == max-app/ || "$member" == max-app/* || "$member" == max-api/ || "$member" == max-api/* ]] || { echo 'Unexpected archive namespace' >&2; exit 1; }
    [[ "/$member/" != *'/../'* && "/$member/" != *'/./'* ]] || { echo 'Unsafe archive member' >&2; exit 1; }
  done <<< "$listing"
}
case "$action" in
  backup)
    for required in max-app/index.html max-app/.htaccess max-api/index.php max-api/.htaccess; do
      [[ -f "$web/$required" && ! -L "$web/$required" ]] || { echo "Missing regular file $required" >&2; exit 1; }
    done
    archive="$(mktemp "$backups/snapshot-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX.tar.gz")"
    tar -czpf "$archive" -C "$web" max-app max-api
    sha256sum "$archive" > "$archive.sha256"
    verify
    # Compares ALL archived files, including hidden files and dirty server handlers.
    tar -dzf "$archive" -C "$web"
    echo "BACKUP_ARCHIVE=$archive"
    echo "BACKUP_SHA256=$expected"
    ;;
  verify)
    verify
    echo "VERIFIED_ARCHIVE=$archive"
    ;;
  restore)
    verify
    stage="$(mktemp -d "$backups/restore-XXXXXXXX")"
    tar -xzpf "$archive" --no-same-owner -C "$stage"
    for name in max-app max-api; do
      [[ -d "$stage/$name" && ! -L "$stage/$name" ]] || { echo 'Unsafe restored root' >&2; exit 1; }
    done
    # Preserve the replaced deployment; do not overlay, which would leave new handlers.
    displaced="$(mktemp -d "$backups/replaced-XXXXXXXX")"
    # Each move must be a filesystem rename, not copy+delete across mounts.
    device="$(stat -c %d "$web")"
    for path in "$stage" "$displaced" "$web/max-app" "$web/max-api"; do
      [[ "$(stat -c %d "$path")" = "$device" ]] || { echo 'Restore requires a single filesystem for atomic directory moves' >&2; exit 1; }
    done
    echo "RESTORE_STAGE=$stage"
    echo "RESTORE_DISPLACED=$displaced"
    rollback_partial() {
      local result=$?
      # Do not recurse through EXIT, and ignore repeated disconnect/termination
      # signals throughout recovery. External mv inherits ignored signals too.
      trap '' HUP INT TERM
      trap - EXIT
      if (( result != 0 )); then
        for name in max-app max-api; do
          if [[ -d "$displaced/$name" ]]; then
            if [[ -e "$web/$name" ]]; then
              if ! mv -- "$web/$name" "$stage/failed-$name"; then
                echo "Rollback could not move $web/$name aside; saved original: $displaced/$name" >&2
                continue
              fi
            fi
            if ! mv -- "$displaced/$name" "$web/$name"; then
              echo "Rollback needs manual recovery: $displaced/$name -> $web/$name" >&2
            fi
          fi
        done
      fi
      exit "$result"
    }
    trap rollback_partial EXIT
    # A signal trap exits nonzero, invoking the same EXIT rollback as a failed
    # move. Disable further signals before exit so recovery cannot be interrupted.
    trap 'trap "" HUP INT TERM; exit 129' HUP
    trap 'trap "" HUP INT TERM; exit 130' INT
    trap 'trap "" HUP INT TERM; exit 143' TERM
    for name in max-app max-api; do
      mv -- "$web/$name" "$displaced/$name"
      mv -- "$stage/$name" "$web/$name"
    done
    tar -dzf "$archive" -C "$web"
    trap - EXIT HUP INT TERM
    rmdir "$stage"
    echo "RESTORED_ARCHIVE=$archive"
    echo "REPLACED_DEPLOYMENT=$displaced"
    ;;
  *) echo 'Expected backup, verify or restore' >&2; exit 2 ;;
esac
