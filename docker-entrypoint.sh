#!/bin/sh
set -eu

uid="${KAEL_UID:-1000}"
gid="${KAEL_GID:-1000}"

mkdir -p /data /workspace
chown "$uid:$gid" /data /workspace

exec setpriv --reuid="$uid" --regid="$gid" --clear-groups "$@"
