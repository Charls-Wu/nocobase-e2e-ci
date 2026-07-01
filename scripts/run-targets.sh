#!/usr/bin/env bash
set -euo pipefail

TARGETS_FILE="${1:-}"

if [[ -z "$TARGETS_FILE" || ! -f "$TARGETS_FILE" ]]; then
  echo "::error::Usage: scripts/run-targets.sh <targets-file>"
  exit 2
fi

TARGETS_FILE="$(realpath "$TARGETS_FILE")"

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

index=0
while IFS= read -r package_dir || [[ -n "$package_dir" ]]; do
  [[ -z "$package_dir" ]] && continue
  index=$((index + 1))

  if [[ ! -f "$package_dir/package.json" ]]; then
    echo "::error::Resolved package is missing package.json: $package_dir"
    exit 1
  fi

  export PLAYWRIGHT_BASE_ENV="app${GITHUB_RUN_ID:-0}${index}"

  echo "::group::Install Playwright browsers for $package_dir"
  yarn --cwd "$package_dir" playwright:install
  echo "::endgroup::"

  echo "::group::Run E2E package $package_dir"
  echo "PLAYWRIGHT_BASE_ENV=$PLAYWRIGHT_BASE_ENV"
  echo "NOCOBASE_DOCKER_VERSION=$NOCOBASE_DOCKER_VERSION"
  yarn --cwd "$package_dir" test:e2e
  echo "::endgroup::"
done < "$TARGETS_FILE"
