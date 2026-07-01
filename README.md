# NocoBase E2E CI Worker

Public GitHub Actions worker for running selected packages from the private `nocobase/e2e` repository.

This repository is only an executor. It does not store private E2E test code and does not decide changed-file mappings.

## Current Scope

The first version supports manual `workflow_dispatch` runs only:

- `targets=plugin-block-iframe`: run one E2E package.
- `targets=package-a,package-b`: run multiple E2E packages in a GitHub Actions matrix.
- `targets=*`: run all packages in `nocobase/e2e/packages/*` that define `scripts.test:e2e`.

It does not support `targets=changed`. Changed-file resolution is expected to happen in the upstream build/dispatch worker before this worker is triggered.

Multiple packages run as separate matrix jobs with `fail-fast=false` and `max-parallel=10`. One failing package does not cancel the others. Each package uploads a result artifact, then the final notify job summarizes all package results.

Each package also uploads Playwright artifacts:

- `playwright-report-<package>`: HTML report zip. Download and unzip it, then open `index.html`.
- `test-results-<package>`: Playwright attachments such as traces, screenshots, and videos when generated.

Artifacts are retained for 7 days by default.

## Required Secrets

Configure these repository secrets before running with `dry_run=false`:

```text
NOCOBASE_E2E_TOKEN
DOCKER_USERNAME
DOCKER_PASSWORD
```

`NOCOBASE_E2E_TOKEN` must be able to read the private `nocobase/e2e` repository.

## Optional Feishu Secrets

Configure these repository secrets to send one summary notification after all selected packages finish:

```text
FEISHU_WEBHOOK_URL
FEISHU_SECRET
```

`FEISHU_SECRET` is only needed when the Feishu custom bot enables signature verification. If `FEISHU_WEBHOOK_URL` is not configured, the workflow still writes the GitHub Actions summary and skips Feishu notification.

The Feishu card includes the overall result, each package result, and GitHub artifact download links for the package reports when available.

## Required Variables

Configure these repository variables, or pass overrides in workflow inputs:

```text
DOCKER_REGISTRY
NOCOBASE_DOCKER_IMAGE
```

## Workflow Inputs

```text
targets
  '*' or comma-separated E2E package names.

nocobase_version
  Docker version/tag used by nb init, for example next, develop, main, pr-123.

e2e_repo
  Private E2E repository. Default: nocobase/e2e.

e2e_ref
  Branch, tag, or SHA in the E2E repository. Default: main.

nocobase_docker_image
  Optional override for vars.NOCOBASE_DOCKER_IMAGE.

docker_registry
  Optional override for vars.DOCKER_REGISTRY.

dry_run
  Resolve targets only. Default: true.
```

## E2E Package Requirement

The E2E package must use the external version variable when initializing NocoBase from Docker.

For example, `packages/plugin-block-iframe/package.json` should use:

```bash
--version="${NOCOBASE_DOCKER_VERSION:?NOCOBASE_DOCKER_VERSION is required}"
```

instead of a fixed value such as:

```bash
--version=next
```

This allows the same test package to run against `main`, `next`, `develop`, or PR image tags.

## Safe First Test

After configuring `NOCOBASE_E2E_TOKEN`, run a dry-run first:

```text
targets=plugin-block-iframe
nocobase_version=next
e2e_ref=<branch containing the package update>
dry_run=true
```

Then run the actual test:

```text
targets=plugin-block-iframe
nocobase_version=next
e2e_ref=<branch containing the package update>
dry_run=false
```

To test matrix fan-out and summary behavior:

```text
targets=example-e2e,plugin-block-iframe
nocobase_version=develop
e2e_ref=develop
dry_run=false
```
