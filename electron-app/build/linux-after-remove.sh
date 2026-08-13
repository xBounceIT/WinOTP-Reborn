#!/bin/sh

set -eu

# Debian passes a named action and RPM passes the number of installed package
# versions. Do not remove the active registration while replacing the package.
case "${1:-}" in
  upgrade | failed-upgrade | abort-install | abort-upgrade | 1)
    exit 0
    ;;
esac

while IFS=: read -r _ _ _ _ _ home_directory _; do
  case "$home_directory" in
    /*) ;;
    *) continue ;;
  esac
  [ -d "$home_directory" ] || continue

  chrome_directory="$home_directory/.config/google-chrome/NativeMessagingHosts"
  chromium_directory="$home_directory/.config/chromium/NativeMessagingHosts"
  firefox_directory="$home_directory/.mozilla/native-messaging-hosts"

  for manifest_directory in "$chrome_directory" "$chromium_directory" "$firefox_directory"; do
    [ -d "$manifest_directory" ] || continue
    [ ! -L "$manifest_directory" ] || continue
    rm -f -- "$manifest_directory/com.xbounceit.winotp.json"
  done

  rmdir -- "$chrome_directory" 2>/dev/null || true
  rmdir -- "$chromium_directory" 2>/dev/null || true
  rmdir -- "$firefox_directory" 2>/dev/null || true
done < /etc/passwd
