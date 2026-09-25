#!/bin/bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec /usr/bin/bash "$ROOT/infra/deploy/deploy.sh" --update
