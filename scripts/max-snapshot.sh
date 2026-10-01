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
    rollback_partial() {
      result=$?
      if (( result != 0 )); then
        for name in max-app max-api; do
          if [[ -d "$displaced/$name" ]]; then
            if [[ -e "$web/$name" ]]; then mv -- "$web/$name" "$stage/failed-$name"; fi
            mv -- "$displaced/$name" "$web/$name"
          fi
        done
      fi
      exit "$result"
    }
    trap rollback_partial EXIT
    for name in max-app max-api; do
      mv -- "$web/$name" "$displaced/$name"
      mv -- "$stage/$name" "$web/$name"
    done
    tar -dzf "$archive" -C "$web"
    trap - EXIT
    rmdir "$stage"
    echo "RESTORED_ARCHIVE=$archive"
    echo "REPLACED_DEPLOYMENT=$displaced"
    ;;
  *) echo 'Expected backup, verify or restore' >&2; exit 2 ;;
esac
