#!/bin/bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_ENV=/srv/aether/secrets/compose.env
URL="${1:-}"

[[ "$URL" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]] || {
  echo "Usage: set-public-url.sh https://your-assigned-ngrok-domain" >&2
  exit 1
}
[[ -w "$COMPOSE_ENV" ]] || {
  echo "Cannot write $COMPOSE_ENV" >&2
  exit 1
}

sed -i \
  -e "s|^AETHER_PUBLIC_URL=.*|AETHER_PUBLIC_URL=$URL|" \
  -e 's|^AETHER_NODE_ENV=.*|AETHER_NODE_ENV=production|' \
  -e 's|^AETHER_BIND_ADDRESS=.*|AETHER_BIND_ADDRESS=127.0.0.1|' \
  "$COMPOSE_ENV"

"$ROOT/infra/deploy/deploy.sh"
