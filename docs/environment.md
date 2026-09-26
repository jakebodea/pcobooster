# Application configuration

Infisical is the source of truth for application secrets. Alchemy reads them at deployment time and binds the approved values to Cloudflare Workers. The API Worker (`apps/server/src/worker.ts`) declares its settings itself: each `Config` it reads at startup is bound at deploy and read back at runtime, then resolved into the typed `ServerConfig` (`packages/api/src/config/server-config.ts`). Do not create application `.env` files or maintain a second set of values in Cloudflare. Redeploy after changing secrets. Feature flags are not configuration; they live in code and Cloudflare Flagship (see [Feature flags](#feature-flags)). Values the product build inlines (browser keys) take effect only in a rebuilt frontend; `scripts/cloudflare/prepare.ts` stamps them into the build inputs so Alchemy rebuilds when they change.

## Environment boundaries

| Use | Infisical source | Runtime |
| --- | --- | --- |
| Local development | Original project, Development `/` and `/local` | Local Workers and persistent local D1 |
| Codex cloud | Original project, Development `/` and `/cloud` | Local Workers and local D1 |
| Previews | `pcobooster-preview`, Staging `/` | Independent `pr-<number>` Workers and D1 |
| Production | Dedicated production deployment project, Production `/` | `prod` Workers and retained D1 |

The preview project ID is `586fd830-7861-4b84-a8a6-d05c9bf7a14a`. Its Viewer identity has no membership in the original project. Infisical Free cannot limit Viewer to an environment; separate projects therefore contain only credentials suitable for that deployment tier. Never copy development PATs, production session secrets, demo credentials, or the source PostgreSQL connection into the preview project.

The production deployment project is `pcobooster-production` (`2eca20e1-20ac-4f06-a086-99ea5c590483`). Its app secrets and main-bound Viewer OIDC identity are configured. Its `CLOUDFLARE_API_TOKEN` is written by `alchemy.ci.ts` (see [CI/CD](ci-cd.md#control-plane-as-code)) and permits account-level Workers Scripts, Workers KV Storage, D1, Secrets Store, and Flagship writes, plus Zone Read, DNS Write, and Dynamic URL Redirects Write scoped to `pcobooster.com` and `worshipadmin.com`. The initial import and live cutover completed September 23; see the [cutover record](cloudflare-cutover.md). The original project retains the legacy PostgreSQL connection and secrets for recovery; cleanup requires explicit approval.

## Application bindings

| Key | Owner and purpose |
| --- | --- |
| `DB` | Alchemy D1 binding; replaces runtime `DATABASE_URL`. |
| `BETTER_AUTH_SECRET` | Infisical signing secret. Production retains its existing value to preserve sessions. Each preview stage uses its own `Alchemy.Random` key instead, kept in Alchemy state and discarded with the stage; previews do not read this secret. |
| `OAUTH_PROXY_SECRET` | Shared production/preview broker secret. Preview callbacks use production only to finish the provider exchange; preview accounts and sessions stay in preview D1. |
| `PLANNING_CENTER_OAUTH_CLIENT_ID`, `PLANNING_CENTER_OAUTH_CLIENT_SECRET` | Planning Center application credentials from Infisical. |
| `PCOBOOSTER_ADMIN_EMAILS` | Comma-separated admin allowlist. |
| `FeatureFlags` | Alchemy Cloudflare Flagship binding (deployed stages only); see [Feature flags](#feature-flags). |
| `DEMO_ACCESS_KEY`, `DEMO_PLANNING_CENTER_CLIENT`, `DEMO_PLANNING_CENTER_PAT` | Optional production-only read-only demo. |
| `POSTHOG_PROJECT_KEY` | Optional production analytics key (a public ingestion token), bound to the API. The product's and marketing's `vite.config.ts` inline it as `import.meta.env.VITE_POSTHOG_KEY`. |
| `PLANNING_CENTER_TIME_ZONE` | Fallback when Planning Center returns no organization zone. The API defaults it to `America/Los_Angeles`; the product build inlines it as `import.meta.env.VITE_PLANNING_CENTER_TIME_ZONE` for the browser while the organization loads. |

Alchemy owns stage origins, `BETTER_AUTH_URL`, `CORS_ORIGIN`, cookie domain, OAuth receiver allowlist, `NODE_ENV`, and service bindings. Production uses parent-domain cookies for `admin.pcobooster.com`; previews use host-only cookies and serve admin at `/admin` on the preview origin. Do not override these derived values in Infisical.

## Feature flags

Feature flags are typed infrastructure, not Infisical settings. `packages/api/src/config/feature-flags.ts` is the registry: each flag's name, Flagship key, description, and the value each tier serves (`local`, `preview` for `pr-<number>`, `production`). Today it holds three flags, each on locally and in previews and off in production: `people` (key `people-page`), `chordCharts` (key `chord-charts`), and `cleanup` (key `data-cleanup-page`).

- **Deployed stages.** `apps/server/src/feature-flags.ts` declares one [Cloudflare Flagship](https://developers.cloudflare.com/flagship/) app per stage (`pcobooster-<stage>-flags`) and one boolean flag per registry entry, with the tier's value as the default variation plus any targeting rules listed there. The API Worker binds the app with `Cloudflare.Flagship.ReadFlags` and evaluates flags per request through `ServerDependencies.featureFlags`, with the user ID (`userId`, also the rollout `targetingKey`) and the Planning Center organization ID (`organizationId`, recorded at sign-in) when known. An evaluation error, including a missing flag, serves off and logs `Feature flag evaluation failed; serving off`.
- **Alchemy owns the rules.** Every deploy writes each flag's variations, default, enabled state, and rules. Edits in the Cloudflare dashboard take effect within seconds (Flagship propagates globally in up to 30 seconds) but are overwritten by the next deploy, so change `apps/server/src/feature-flags.ts` instead. Deleting a registry entry deletes the flag on the next deploy; remove its evaluations first.
- **Local stage.** `alchemy dev` has no local Flagship: Alchemy proxies the binding to a live app, which would need Cloudflare credentials and create cloud resources for every checkout. The local stage therefore declares no Flagship resources and serves the registry's `local` values (People on). To try other local values, edit the registry; the API reloads.
- **Browser.** The product never inlines flags. The app layout loads `features.people` on the server (`src/lib/people-route.ts`) so the navigation renders with the answer, and the People routes' `beforeLoad` returns not found when it is off. The API independently rejects People dashboard requests when the flag is off.

Deploying Flagship resources needs Flagship access: the deploy tokens need Flagship Write (see [CI/CD](ci-cd.md#oidc-and-token-scope)), and a local Alchemy OAuth profile needs the `flagship.read` and `flagship.write` scopes (`bun alchemy profile edit`, then sign in again). Flagship is in public beta; Cloudflare has not announced pricing.

## Developer credentials

Development `/local` may contain `DEV_AUTH_BYPASS`, `PLANNING_CENTER_CLIENT`, `PLANNING_CENTER_PAT`, and `PRESENTATION_SEED`. Only local commands read it. Codex cloud reads only Development `/cloud`; never `/local`, Staging, or Production. Alchemy binds these development keys only in stage `local`. The product Worker also receives `DEV_AUTH_BYPASS` there; its sign-in gate honors it only in the development server, never in a production build.

`PRESENTATION_MODE` is process-owned: `bun run dev:present` enables it. Every deployed Worker uses production mode, which disables presentation mode and local authentication bypass.

## Deployment credentials

Local deployment uses the saved Alchemy profile. Use `bun alchemy profile edit` to sign in or adjust it; credentials do not belong in shell history or repo files.

GitHub Actions retrieves a narrowly scoped Cloudflare token from Infisical using OIDC. Preview deploys wait for approval; production deploys run on every merge to `main`. Account, project, and identity IDs are GitHub environment variables, not secrets. Tokens never become app Worker bindings. See [CI/CD](ci-cd.md) for permissions and trust boundaries.

`DATABASE_URL` remains only in the original Infisical project for read-only migration/reconciliation and rollback evidence. The deployed app cannot connect to Neon.

## Server logs

Every Worker writes to Cloudflare Workers Logs, which Alchemy enables by default when a Worker sets no `observability` prop. The API's pino output and each request's invocation log (request and response metadata, including client IP and user agent) appear in the Cloudflare dashboard under Workers & Pages, Observability. The account is on the Workers Free plan: 200,000 log events per day across all Workers, kept for 3 days.

Log IDs, not content: pino lines should carry request, user, and plan IDs rather than message text or tokens. Exporting logs to PostHog (OTLP) requires Workers Paid; revisit it after upgrading.
