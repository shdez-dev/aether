#!/bin/bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IP="${1:-$(ip -4 route get 1.1.1.1 | awk '{for (i=1;i<=NF;i++) if ($i==\"src\") {print $(i+1); exit}}')}"
SECRETS_DIR=/srv/aether/secrets
RUNTIME_DIR="$ROOT/infra/deploy/runtime"

[[ "$IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || {
  echo "Pass the Raspberry Pi's LAN IPv4 address as the first argument." >&2
  exit 1
}

sudo install -d -m 0700 -o athe -g athe "$SECRETS_DIR" "$RUNTIME_DIR"
if [[ ! -r "$SECRETS_DIR/brevo.env" ]]; then
  echo "Copy the verified Brevo SMTP settings to $SECRETS_DIR/brevo.env before setup." >&2
  exit 1
fi

if [[ ! -e "$SECRETS_DIR/compose.env" ]]; then
  umask 077
  cat >"$SECRETS_DIR/compose.env" <<EOF
AETHER_NODE_ENV=development
AETHER_PUBLIC_URL=http://$IP:8081
AETHER_BIND_ADDRESS=$IP
AETHER_PORT=8081
POSTGRES_PASSWORD=$(openssl rand -hex 32)
KEYCLOAK_DB_PASSWORD=$(openssl rand -hex 32)
KEYCLOAK_ADMIN_USERNAME=aether-admin
KEYCLOAK_ADMIN_PASSWORD=$(openssl rand -hex 32)
OIDC_CLIENT_SECRET=$(openssl rand -hex 32)
SESSION_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
METRICS_TOKEN=$(openssl rand -hex 32)
S3_ACCESS_KEY_ID=$(openssl rand -hex 16)
S3_SECRET_ACCESS_KEY=$(openssl rand -hex 32)
EOF
  chmod 0600 "$SECRETS_DIR/compose.env"
fi

sudo install -m 0644 "$ROOT/infra/deploy/aether-deploy.service" /etc/systemd/system/aether-deploy.service
sudo install -m 0644 "$ROOT/infra/deploy/aether-deploy.timer" /etc/systemd/system/aether-deploy.timer
sudo systemctl daemon-reload
sudo systemctl enable --now aether-deploy.timer

echo "Deployment secrets initialized. Run bash infra/deploy/deploy.sh once to launch AETHER."
