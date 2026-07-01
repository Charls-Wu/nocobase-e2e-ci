#!/usr/bin/env bash
set -euo pipefail

PACKAGE_DIR="${1:-}"

if [[ -z "$PACKAGE_DIR" ]]; then
  echo "::error::Usage: scripts/run-target.sh <package-dir>"
  exit 2
fi

if [[ "$PACKAGE_DIR" == *".."* || "$PACKAGE_DIR" == /* || "$PACKAGE_DIR" != packages/* ]]; then
  echo "::error::Invalid package directory: $PACKAGE_DIR"
  exit 2
fi

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "::error::Missing required environment variable: $name"
    exit 1
  fi
}

require_env DOCKER_REGISTRY
require_env DOCKER_USERNAME
require_env DOCKER_PASSWORD
require_env NOCOBASE_DOCKER_IMAGE
require_env NOCOBASE_DOCKER_VERSION

cd e2e

if [[ ! -f "$PACKAGE_DIR/package.json" ]]; then
  echo "::error::Resolved package is missing package.json: $PACKAGE_DIR"
  exit 1
fi

package_hash="$(printf '%s' "$PACKAGE_DIR" | cksum | awk '{ print $1 }')"
export PLAYWRIGHT_BASE_ENV="${PLAYWRIGHT_BASE_ENV:-app${GITHUB_RUN_ID:-0}${package_hash}}"

echo "::group::Install Playwright browsers for $PACKAGE_DIR"
yarn --cwd "$PACKAGE_DIR" playwright:install
echo "::endgroup::"

echo "::group::Run E2E package $PACKAGE_DIR"
echo "PLAYWRIGHT_BASE_ENV=$PLAYWRIGHT_BASE_ENV"
echo "NOCOBASE_DOCKER_VERSION=$NOCOBASE_DOCKER_VERSION"
yarn --cwd "$PACKAGE_DIR" test:e2e
echo "::endgroup::"
