#!/usr/bin/env bash
# Run once on the VPS with sudo: installs the /repbish Nginx route and reloads Nginx.
# Safe to run again; restores the previous site file if the config test fails.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
site=/etc/nginx/sites-enabled/larp1t.space
include="    include /etc/nginx/snippets/repbish.conf;"
cp "$here/nginx-repbish.conf" /etc/nginx/snippets/repbish.conf
cp "$site" "/root/larp1t.space.before-repbish"
if ! grep -qF "snippets/repbish.conf" "$site"; then
  sed -i "0,/include \/etc\/nginx\/snippets\/esmlog-api.conf;/s||&\n$include|" "$site"
fi
if nginx -t; then
  systemctl reload nginx
  echo "Done: https://larp1t.space/repbish/"
else
  cp "/root/larp1t.space.before-repbish" "$site"
  echo "Nginx config test failed; the site file was restored and nothing was reloaded." >&2
  exit 1
fi
