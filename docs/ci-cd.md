# CI/CD

The Cloudflare workflow separates secretless validation from deployment: labeled pull requests deploy previews, and merges to `main` deploy production. `ci` runs dependency review, strict linting, typechecks, and tests. `cloudflare-build` runs the product's and the admin app's Vite Worker builds (with the prerendered marketing site staged into the product) without credentials. Both run for pull requests and merge queue commits; deployment jobs never run for `merge_group`.

Run the local gates before opening a pull request:

```sh
bun run ci
bun run build
bun run build:cloudflare
```

Use Node 24 and the pinned Bun version. Actions are pinned to immutable commits and installs use the frozen Bun lockfile. CI has no Turborepo remote-cache credential.

Shared steps live in composite actions:

- `.github/actions/setup` pins Node and Bun, restores the Bun package cache, and installs. Change toolchain versions there only.
- `.github/actions/infisical` exchanges the job's OIDC token for one environment's secrets.

The `ci` job also runs checksum-verified `actionlint`. Run it locally when you edit workflows.

Concurrency is set per job. A new push to a pull request cancels that PR's older `ci` and `cloudflare-build` jobs. Deploy and cleanup jobs share a per-stage group that never cancels, so an Alchemy state update is never interrupted.

`scripts/check-patches.test.ts` runs in `bun run test`. It fails if any installed copy of a patched dependency is missing a line the patch adds, for example after a stale Bun cache.

## Preview lifecycle

Previews deploy only on request. Add the `preview` label to a same-repository pull request; adding the label, and every later push while it is present, requests a deployment once validation passes. The label is the approval: while it is present, every push to the PR deploys without further review, so only label a PR whose incoming commits you trust. Pull requests without the label get checks only, with no waiting deployment. Adding the label reruns nothing: the `labeled` run skips `ci` and `cloudflare-build` and its `preview` job waits for those checks to pass on the current head.

Deploys build from source: Alchemy runs each Vite app's build itself and skips an app whose inputs are unchanged, so `cloudflare-build` outputs are validation only. Feature flags are evaluated at runtime, so every stage builds the same product bundle. Fork PRs receive secretless checks only. A labeled revision gets preview app secrets and an account-scoped Cloudflare token, so review workflow/dependency changes before they land on a labeled PR.

A preview job authenticates to Infisical using GitHub OIDC, checks the PR is still open at the expected head, and runs `bun alchemy deploy --stage pr-<number>`. Alchemy owns a separate D1 database, Planning Center cache KV namespace, and API/web/admin Workers for each PR. The preview URL is exposed in GitHub's deployment environment. Production data is never copied into these databases.

Every deploy then runs `scripts/cloudflare/verify-deployment.ts`. Both the web and API Workers carry the deployed `GITHUB_SHA` as a `PCOBOOSTER_VERSION` env prop, so every commit redeploys both even when only one app changed. The script polls the web Worker's `GET /version` and the API's `POST /api/rpc/health` (through the web Worker) until both report the commit, then checks that `/` returns 200. A deploy that finishes without the new code live in either Worker, or with a broken web → API binding, fails the job.

Pass a value a Worker must redeploy for as an `env` prop, not a `Config` read inside an Effect-native Worker's init (`apps/server/src/worker.ts`): Alchemy's change detection hashes `env` props and file inputs but not init-time `Config` reads, so changing only such a value (including rotating a secret) plans as a noop. Force a redeploy with `bun alchemy deploy --force` after rotating one.

Teardown uses `alchemy.cleanup.ts`. It has the application stack's name and state but declares no resources. That lets `alchemy destroy alchemy.cleanup.ts --stage pr-<number>` remove everything a stage recorded, without app secrets, a build, or configuration that `main` added after the PR opened. It refuses any stage that isn't `pr-<number>`.

Cleanup runs in the `cloudflare-preview-cleanup` environment. That environment is restricted to `main` and needs no approval, because it only ever runs trusted `main` code:

- Closing a same-repository PR triggers `pull_request_target`, which checks out `main` (never PR code), confirms the PR is still closed, and destroys its stage.
- A nightly sweep (`scripts/cloudflare/sweep-previews.ts`, also available through `workflow_dispatch`) lists `pcobooster-pr-*` Workers and D1 databases, then destroys every stage whose PR is no longer open. It also destroys an open PR's stage once it has gone 3 days without a deploy, measured by the newest Worker upload; the next push to a labeled PR recreates it. Previews therefore expire even when a PR stays open. Use `--dry-run` locally to see what it would destroy.

Deployment and cleanup share a per-stage concurrency group. Reopening the PR creates a fresh deployment request.

## Production

Merge equals deploy. A push to `main` deploys production after `ci` and `cloudflare-build` pass. So does a manual CI run on `main` with `deploy_production`. `cloudflare-production` accepts only the `main` branch and has no approval gate. The job rejects a revision superseded by newer `main` before reading production secrets. Post-deploy verification then fails the run unless pcobooster.com serves the merged commit. The merge queue and its required checks are the only gate before production, so keep them strict.

After verification, the job marks the release on PostHog charts. It skips with a warning when `POSTHOG_ANNOTATION_API_KEY` is absent; see [analytics](analytics.md#deploy-annotations). PostHog dashboards are applied separately with `bun run posthog:deploy`, never by CI.

Infisical's production OIDC identity binds the environment subject and the `ref=refs/heads/main` claim. The production project contains production app secrets and its own Cloudflare token; it excludes development PATs and migration-only `DATABASE_URL`.

`CLOUDFLARE_CUSTOM_DOMAINS=1` in the production GitHub environment attaches pcobooster.com, www, and admin to the production Workers.

To roll back, revert the change on `main`; the revert deploys like any other merge. Schema changes follow [database migrations](database.md#migrations-must-keep-the-running-app-online), so the previous code stays compatible with the migrated database.

A deploy you run yourself (`bun run deploy:production`, `bun run infra:deploy`) is still a manual production change: confirm it with Jake first.

## OIDC and token scope

GitHub environment variables are `INFISICAL_PROJECT_ID`, `INFISICAL_IDENTITY_ID`, `INFISICAL_ENV_SLUG`, and `CLOUDFLARE_ACCOUNT_ID`. Infisical supplies `CLOUDFLARE_API_TOKEN`; no long-lived Infisical or Cloudflare credential is stored in GitHub.

The issuer/discovery URL is `https://token.actions.githubusercontent.com`; audience is `https://github.com/bodegalabs/pcobooster`. This repository uses immutable OIDC subjects:

- Preview and cleanup: `repo:bodegalabs@305914027/pcobooster@1125110564:environment:cloudflare-preview{,-cleanup}`. This is an Infisical glob that matches exactly those two environments.
- Production: `repo:bodegalabs@305914027/pcobooster@1125110564:environment:cloudflare-production`

Access tokens have a one-hour TTL and maximum TTL. The preview identity is Viewer only in `pcobooster-preview`. Its Cloudflare token permits Workers Scripts Write, Workers KV Storage Write, D1 Write, Secrets Store Write, and Flagship Write in the current account. Each stage's API declares a KV namespace for the shared Planning Center read cache (`apps/server/src/planning-center-cache.ts`), which needs Workers KV Storage Write. It has no DNS, registrar, R2, or token-administration permission. These account-level permissions can affect other resources in that account; project separation does not create resource-level Cloudflare isolation. Only revisions on a PR you labeled may deploy previews.

Each deployed stage's API declares a Cloudflare Flagship app and flags ([Feature flags](environment.md#feature-flags)), so both deploy tokens also carry the account-level **Flagship Write** permission group (it includes read). Alchemy 2.0.0-beta.79's typed permission catalog does not list Flagship yet, so `alchemy.ci.ts` references it by ID (`521a41dc78f94eaba5e643528846cb7b`). App-scoped Flagship tokens do not fit, because previews create their apps. Changing `deployPermissions` updates both tokens in place (their values do not change), so apply it with `CLOUDFLARE_TOKEN_ADMIN_API_TOKEN` as described in [Control plane as code](#control-plane-as-code).

The production token has the same account-level deployment permissions, plus Zone Read, DNS Write, and Dynamic URL Redirects Write scoped to two zones: `pcobooster.com` and the former `worshipadmin.com`, which the `prod` stage answers with a redirect rule (see the [former domain cutover](cloudflare-cutover.md#former-domain-cutover)). It has no Zone Write, so it can neither create nor delete zones: a new zone is created by hand and then adopted. `alchemy.ci.ts` resolves their IDs by name at plan time, so a zone must exist before `infra:plan` or `infra:deploy` can run. The token is stored only in the production Infisical project. `Cloudflare.state()` shares the bootstrapped Alchemy state Worker and Secrets Store across stages. Keep their credentials out of application bindings, artifacts, and logs.

## Control plane as code

`alchemy.ci.ts` (stack `pcobooster-ci`, stage `ci`, state in the shared `Cloudflare.state()` store) owns the CI/deploy control plane. Change these settings there, not in the GitHub, Cloudflare, or Infisical dashboards:

- Repository merge settings on `bodegalabs/pcobooster`: squash on, merge commits off, auto-merge on, delete branches on merge. `allowRebaseMerge` is deliberately unmanaged; the ruleset alone keeps `main` squash-only.
- The `main` ruleset "Protect main via pull requests" (`scripts/infra/main-ruleset.ts`): required checks `ci` and `cloudflare-build` from GitHub Actions, the squash merge queue, squash-only merges, linear history, no deletion or force pushes, and no bypass actors. `main-ruleset.test.ts` compares it with a snapshot of the live ruleset.
- The `cloudflare-preview` (any branch, no reviewers), `cloudflare-preview-cleanup` (`main` only), and `cloudflare-production` (`main` only, no reviewers) environments and their variables. The repository is public, so GitHub accepts environment protection rules on the Free plan.
- The preview and production Cloudflare deploy tokens, as account-owned API tokens.
- `CLOUDFLARE_API_TOKEN` in each Infisical deployment project (preview `staging`, production `prod`, path `/`), written from the token Alchemy just created.
- Both Infisical identities' GitHub OIDC bindings.

Alchemy has no Infisical provider and its GitHub ruleset cannot express merge queues, so `scripts/infra/` adds small providers for the Infisical secret, the OIDC binding, and the ruleset. It also gives Alchemy's GitHub Repository, Environment, and Variable providers a lookup by name. Everything that already existed is adopted: the plan shows it as `adopted`, and the first deploy writes only differences. The ruleset is found by name and adopted explicitly (`adopt(true)`); it is updated in place, never recreated. All adopted GitHub and Infisical objects are retained if their declaration is removed.

### Credentials

| Credential | Used for | Source |
| --- | --- | --- |
| GitHub | Repository, ruleset, environments, variables | `GITHUB_TOKEN=$(gh auth token)`; needs repository admin |
| Infisical | Secrets and OIDC bindings | `INFISICAL_API_TOKEN=$(infisical user get token --plain)`; needs admin on both deployment projects |
| Cloudflare | The shared state store | Your default Alchemy OAuth profile (`bun alchemy profile edit` to connect, `bun alchemy profile refresh` to renew). The scripts unset `CLOUDFLARE_API_TOKEN` so a stray deploy token is never used. |
| Cloudflare token admin | Creating, updating, reading, or revoking deploy tokens | `CLOUDFLARE_TOKEN_ADMIN_API_TOKEN`, only when a token changes |

Neither the Alchemy OAuth scopes nor the deploy tokens can mint API tokens; that needs `Account API Tokens Write`. Only `AccountApiToken` calls use the token-admin credential (`scripts/infra/cloudflare.ts`), so the rest of the stack never runs with it. Create it when you need it: Cloudflare dashboard → Manage Account → Account API Tokens → Create Token → Custom token, permission Account · Account API Tokens · Edit on this account, expiring the same day. Delete it after the deploy. Do not store it in Infisical: both CI identities can read their whole project.

`bun run infra:plan` is a dry run with drift detection and needs no token-admin credential; without one it trusts the recorded token state. `bun run infra:deploy` applies. Review the plan first and confirm with Jake before applying.

### Rotating the deploy tokens

The tokens expire on `deployTokens.expiresOn` in `alchemy.ci.ts`. To rotate, bump `deployTokens.generation` (and move `expiresOn` a year out), then:

1. `bun run infra:plan`, and check that it creates only the two new tokens, updates the two Infisical secrets, and deletes the previous generation.
2. `CLOUDFLARE_TOKEN_ADMIN_API_TOKEN=<short-lived admin token> bun run infra:deploy`. Alchemy creates the new tokens, writes them to Infisical, and then revokes the previous generation.
3. Deploy a preview (re-run a pull request's `preview` job) and production (run CI on `main` with `deploy_production`). Both must pass `verify-deployment.ts`.

A job already running when step 2 revokes the old token fails; re-run it.

The first `infra:deploy` replaces the hand-made tokens rather than rotating Alchemy's. It creates generation 1 and overwrites `CLOUDFLARE_API_TOKEN` in both projects, but the hand-made tokens stay valid because Alchemy never managed them. After a preview and a production deploy succeed on the new tokens, delete the hand-made ones in the Cloudflare dashboard (Manage Account → Account API Tokens): preview `fb50d1add65f36b1376ba24b8de59b56` and production `8241ade77e46e28393c7d7ffa4dd1793`.

## Merge gates

The `main` ruleset requires `ci` and `cloudflare-build` and is managed by `alchemy.ci.ts`. Preserve the merge queue, squash-only merging, and absence of bypass actors. Never remove a gate merely to bypass a red or missing check.

Cloudflare/D1 became the live production system on September 23, 2026; see the [cutover record](cloudflare-cutover.md). Vercel temporarily forwards cached DNS traffic to Cloudflare, and Neon is retained as the source snapshot. Follow [database migration and rollback](database.md): after D1 accepts new writes, routing back to the old PostgreSQL snapshot alone is not a safe rollback.
