#!/bin/bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/deploy/compose.yaml"
COMPOSE_ENV="/srv/aether/secrets/compose.env"
RUNTIME_DIR="$ROOT/infra/deploy/runtime"
BREVO_ENV="/srv/aether/secrets/brevo.env"
LOCK_FILE="/run/lock/aether-deploy.lock"

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

BUILD_IMAGES=1
if [[ "${1:-}" == "--update" ]]; then
  cd "$ROOT"
  git fetch --quiet origin main
  current="$(git rev-parse HEAD)"
  target="$(git rev-parse origin/main)"
  [[ "$current" == "$target" ]] && exit 0
  git merge-base --is-ancestor "$current" "$target" || {
    echo "Refusing non-fast-forward deployment: local=$current remote=$target" >&2
    exit 1
  }
  git checkout --detach "$target"
  if git diff --quiet "$current" "$target" -- \
    apps packages Dockerfile package.json pnpm-lock.yaml pnpm-workspace.yaml \
    infra/deploy/configure-keycloak.mjs; then
    BUILD_IMAGES=0
  fi
fi

[[ -r "$COMPOSE_ENV" && -r "$BREVO_ENV" ]] || {
  echo "Missing deployment secrets under /srv/aether/secrets" >&2
  exit 1
}
if ! grep -q '^GARAGE_RPC_SECRET=' "$COMPOSE_ENV"; then
  printf 'GARAGE_RPC_SECRET=%s\n' "$(openssl rand -hex 32)" >>"$COMPOSE_ENV"
  chmod 0600 "$COMPOSE_ENV"
fi
mkdir -p "$RUNTIME_DIR"
set -a
# shellcheck disable=SC1090
source "$COMPOSE_ENV"
set +a

compose() {
  sudo docker compose --env-file "$COMPOSE_ENV" -f "$COMPOSE_FILE" "$@"
}

if [[ "$BUILD_IMAGES" == "1" ]]; then
  sudo docker build --target runtime -t aether-app:local -f "$ROOT/Dockerfile" "$ROOT"
  sudo docker build --target web \
    --build-arg "NEXT_PUBLIC_APP_URL=$AETHER_PUBLIC_URL" \
    -t aether-web:local -f "$ROOT/Dockerfile" "$ROOT"
else
  echo "No application source changes detected; reusing existing AETHER images."
fi

sudo docker run --rm --user "$(id -u):$(id -g)" --env-file "$COMPOSE_ENV" \
  -v "$ROOT:/app" -v "$RUNTIME_DIR:/run/aether" \
  -v "/srv/aether/secrets:/run/secrets:ro" \
  -w /app aether-app:local \
  node /app/infra/deploy/render-app-env.mjs \
  /run/secrets/compose.env /run/aether/app.env
sudo docker run --rm --user "$(id -u):$(id -g)" --env-file "$COMPOSE_ENV" \
  -v "$ROOT:/app" -v "$RUNTIME_DIR:/run/aether" \
  -v "/srv/aether/secrets:/run/secrets:ro" \
  -w /app aether-app:local \
  node /app/infra/deploy/render-realm.mjs \
  /app/infra/keycloak/aether-local-realm.json \
  /run/aether/realm.import.json /run/secrets/brevo.env
sudo docker run --rm --user "$(id -u):$(id -g)" \
  -v "$ROOT:/app" -v "/srv/aether/secrets:/run/secrets:ro" \
  -v "$RUNTIME_DIR:/run/aether" -w /app aether-app:local \
  node /app/infra/deploy/render-garage-config.mjs \
  /run/secrets/compose.env /run/aether/garage.toml
chmod 0600 "$RUNTIME_DIR/app.env" "$RUNTIME_DIR/realm.import.json" "$RUNTIME_DIR/garage.toml"

compose up -d postgres keycloak garage clamav
compose run --rm keycloak-config
compose run --rm migrate
compose up -d --remove-orphans
# Refresh the single-file Caddy bind mount after Git replaces Caddyfile by inode.
compose up -d --force-recreate gateway

HEALTH_URL="http://${AETHER_BIND_ADDRESS:-127.0.0.1}:${AETHER_PORT:-8081}/"
for attempt in $(seq 1 40); do
  if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null; then
    echo "AETHER deployment healthy at $AETHER_PUBLIC_URL"
    exit 0
  fi
  sleep 3
done

compose ps
echo "AETHER gateway did not become healthy" >&2
exit 1
