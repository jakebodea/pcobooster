# Repository Guidelines

## Product Naming

- Public/product naming should use `pcobooster.com`.
- Avoid introducing old product names in new docs, UI copy, or PR descriptions unless referring to historical context.

## Project Structure & Module Organization

- `apps/web/`: TanStack Start product UI on Cloudflare Workers. File routes live in `apps/web/src/routes` (`src/routeTree.gen.ts` is generated and committed); the sign-in gate and other request middleware in `src/start.ts`; components, hooks, and public assets under `apps/web/src` and `apps/web/public`.
- `apps/server/`: the API Worker, an Alchemy Effect-native `Cloudflare.Worker` (`src/worker.ts`) that reads its settings with `Config` at startup, binds D1, and serves the Hono composition root (`src/app.ts`: Better Auth, oRPC, the OpenAPI reference, CORS, and cache policy). `src/database.ts` declares the D1 database and its `Drizzle.Schema`; `src/stage.ts` derives per-stage origins for both the Worker and `alchemy.run.ts`.
- `apps/marketing/`: independent marketing site, a TanStack Start app prerendered to static files. Its interactive product replica lives in `apps/marketing/src/components/product-demo/` with fictional fixtures; it shares design tokens and shared UI from `packages/ui` (currently the phone menu) with the product; its own primitives stay in `apps/marketing/src/components/ui`.
- `apps/admin/`: private TanStack Start admin app for `admin.pcobooster.com`, deployed as its own Cloudflare Worker. See `docs/admin.md`.
- `packages/design-tokens/`: product color and radius tokens (`tokens.css`, light on `:root`, dark under `.dark`) shared by `apps/web` and the marketing replica.
- `packages/ui/`: UI shared by `apps/web` and `apps/marketing`, one export per component (`@pcobooster/ui/mobile-menu`). Components are primitive-free (each app supplies its own buttons and headers) and styled with Tailwind utilities that exist in both apps; each app `@source`s `packages/ui/src` and imports a component's CSS (`@pcobooster/ui/mobile-menu.css`) when it has one.
- `packages/contracts/`: browser-safe oRPC contracts, transport schemas, and safe error payloads.
- `packages/planning-center-models/`: browser-safe Planning Center shapes and pure calendar/scheduling rules.
- `packages/presentation-mode/`: server-side presentation-mode guard, seed, and cache namespace.
- `packages/api/src/application/`: Effect programs and typed application faults.
- `packages/api/src/modules/`: server business behavior grouped by the external capability it implements.
- `packages/api/src/transport/orpc/`: thin oRPC adapters; `packages/api/src/orpc.ts` assembles the router.
- `packages/api/src/planning-center/services/`: Planning Center API service wrappers (raw API access only).
- `packages/api/src/db/` and `packages/api/migrations/`: Drizzle client, schema, and migrations.
- `packages/config/`: shared TypeScript configuration.
- Tests stay colocated beside source (`packages/*/src/**/*.test.ts`, `apps/*/src/**/*.test.ts`).

## Build, Test, and Development Commands

- Use Bun for dependency management and scripts. `bun.lock` is the only committed lockfile; do not add `package-lock.json` or run npm-based install workflows for this repo.
- `bun run dev`: start API, product, and admin through Alchemy, plus the marketing dev server (ports 3000, 3001, 3002, and 3003).
- `bun run build`: build the Vite apps through Turborepo. Alchemy bundles the API Worker itself on `dev`/deploy.
- `bun run check` (also `lint`): run Ultracite formatting and type-aware lint checks; warnings fail the check. All selected presets in `oxlint.config.ts` remain strict.
- `bun run lint:ci`: same as `lint` with `--format github` for Action annotations (used by CI).
- `bun run fix` (also `lint:fix`): apply Ultracite fixes and formatting. Review fixes and run validation afterward.
- `bun run ci`: run the strict local CI gate: check, typecheck, and the complete test suite.
- `bun run typecheck`: run TypeScript checks (`tsc --noEmit`).
- `bun run test`: run Vitest test suite once.
- `bun run test:watch`: run Vitest in watch mode.
- `bun run db:generate`: generate SQLite migrations from the Drizzle schema interactively. `Drizzle.Schema` (`apps/server/src/database.ts`) also generates them on `bun run dev`/deploy; commit every generated migration (a test enforces it). Name new migrations with `bun run --cwd packages/api db:generate --name <what_changed>`. Alchemy applies them at startup/deploy. Migrations must keep the deployed code working (expand, then contract); see [docs/database.md](docs/database.md#migrations-must-keep-the-running-app-online).
- Deployment and rollback changes: read [docs/ci-cd.md](docs/ci-cd.md) and [docs/database.md](docs/database.md). Merges to `main` deploy production automatically through CI. Confirm any deployment you run yourself (`deploy:*`, `infra:deploy`) with the user before executing it.
- `bun run infra:plan`: dry-run the CI/deploy control plane (`alchemy.ci.ts`: GitHub ruleset, environments, Cloudflare deploy tokens, Infisical secrets and OIDC bindings) with drift detection. Apply only with `bun run infra:deploy` after the user confirms.

### Codex cloud sessions

- Setup/maintenance scripts live under `scripts/codex-cloud/`; see [docs/codex-cloud.md](docs/codex-cloud.md).
- `bun run ci` is secretless. Local D1 belongs to the checkout; no Neon branch setup or teardown is required.
- Cloud app commands read only Infisical Development `/cloud`. Keep local PAT and deployment secrets out of cloud sessions.

## Coding Style & Naming Conventions

- TypeScript throughout; prefer explicit types at module boundaries.
- Use `camelCase` for variables/functions, `PascalCase` for components/types.
- Keep oRPC handlers as transport layers. Put behavior in explicit feature modules and raw external API calls in services.
- Use `oxlint.config.ts` and `oxfmt.config.ts` as the standards source of truth. Keep all selected presets enabled and fix the underlying cause of findings. Prefer runtime validation and type narrowing to assertions; comments should explain verified invariants.
- Shared UI primitives own appearance through variants; compose layout at call sites and use semantic color tokens. Reuse existing variants. Add a variant only for an intentional, reusable design treatment, never solely to relocate forbidden caller styles.

## Testing Guidelines

- Framework: Vitest, with tests colocated beside API and web source.
- Prioritize tests for transforms/matching/sorting logic and Planning Center edge cases.
- Inject narrow typed service dependencies into feature modules and pass fresh test implementations explicitly. Request paths must not rely on process-global credentials or implicit async context. Preserve exact assertions on optional flags so missing values cannot pass as `false`.
- Prefer test-driven fixes for regressions: reproduce the bug or edge case with a focused failing test, then implement the smallest code change that makes it pass.
- Run `bun run ci` and `bun run build` before opening a PR.

## Commit & Pull Request Guidelines

- For dependent changes, use GitHub native stacks with the official `gh-stack` extension; follow the workflow in [README.md](README.md#stacked-pull-requests). Validate each layer and merge through the stack after its checks pass.
- Commit messages: short, imperative, scoped to a change (e.g., `Refactor data flow and harden scheduling foundations`).
- Prefer small commits for follow-up cleanup instead of amend-heavy history.
- PRs should include: summary, behavior changes, test coverage notes, and screenshots for UI changes.
- For visible or high-risk changes, use the repo-local `proofed-pr` workflow in `docs/proofed-delivery.md`; proof must match the current PR head and base.

## Request Budget (Workers Free)

The account is on Cloudflare Workers Free: each Worker invocation may make at most 50 subrequests (Planning Center calls, D1, KV, and service-binding calls all count), and Planning Center allows 100 requests per 20 seconds per user. Design within these limits; see `docs/research/planning-center-rate-limits.md`.

- Transport caps every procedure at `PLANNING_CENTER_REQUEST_CAP` (40) Planning Center requests, retries included, leaving the rest for session, D1, KV, and flag subrequests; progressive procedures plan against `PROGRESSIVE_REQUEST_BUDGET` with real counts (`packages/api/src/planning-center/request-budget.ts`). Change the reserve there when a procedure adds non-Planning Center subrequests.
- Keep each oRPC procedure well under the cap. Split heavy screens into several small procedures the browser calls progressively (for example, list first, then details in batches) instead of one call that fans out.
- Treat the budget as explicit: when a procedure cannot finish within it, return partial data with a continuation cursor. Never swallow a subrequest or rate-limit failure into empty data.
- Fetch less per call: prefer Planning Center `include`, filters (such as future-only blockouts), and a person's own records over scanning every roster. Cache slow-changing data (past plans, service types) longer.
- Prefetch only on clear intent (click, or a debounced hover); never run Planning Center fan-out on incidental pointer movement.
- Load what the user is waiting on first. Anything not on screen yet (hover prefetches, other tabs' data, warm-ups) is speculative: queue it with `requestScheduler.runSpeculative` (or `useIntentPrefetch`), mark its queries with `speculativeQuery`, and call oRPC from query functions through `callForQuery`. See [Request priority](docs/api-architecture.md#request-priority).
- Log per-procedure request counts, rate-limit pauses, and 429s at `info` so Workers Logs shows which screens approach the limits.

## Architecture Notes

- Preferred flow: `apps/web` -> oRPC contract -> `apps/server` -> `packages/api/src/transport/orpc/*` -> Effect application program -> `packages/api/src/modules/*` -> service adapter.
- Better Auth is mounted directly by Hono at `/api/auth/*`. The product Worker's `/api/*` and `/admin/*` server routes forward through service bindings (locally too), so browser requests stay on the web origin.
- Product operations use oRPC. Better Auth, liveness health, and the OpenAPI reference are the intentional non-oRPC surfaces.
- Database access uses Drizzle through `packages/api/src/db`; migrations include Better Auth tables.
- The API Worker builds `ServerDependencies` (`packages/api/src/server.ts`: typed `ServerConfig`, Drizzle database, Better Auth, feature flags, Planning Center read caches) once per isolate and passes them explicitly: in the oRPC context, and to Effect programs as the `Server` service. `packages/api` never reads `process.env` or `cloudflare:workers`; add new settings to `ServerConfig` and read them in `apps/server/src/worker.ts`.
- Browser query keys, persistence schemas, and cache hydration live in `apps/web/src/lib`. The web app may import contracts and Planning Center models, never `packages/api`.
- Backward compatibility is not a priority during the current dev phase; prefer cleaner APIs/URLs/UX over temporary compatibility shims unless explicitly requested.

## Learned User Preferences

- When replacing behavior, remove legacy or unused code paths instead of keeping parallel implementations.
- Prefer shadcn HoverCard for hover-revealed UI labels/help. Use the default tight `HoverCardContent` (`variant="label"`) or `HoverLabel` for short text; use `variant="panel"` for richer previews. Do not introduce Tooltip-based hover UI; replace existing tooltips with HoverCard when touching nearby code.
- For People detail pages, prefer app-shell breadcrumb navigation over in-page back buttons.
- Prefer lightweight inline and popover edits that persist on close (click outside, Escape, Enter, or field blur where appropriate) instead of explicit Done/Save/Cancel footers. Skip success toasts for these autosaves; keep error toasts. Reuse `apps/web/src/hooks/use-persist-on-close-popover.ts` (`usePersistOnClosePopover`, `useDraftPopover`). Opt into Enter-to-close via `enterToClose` (TanStack Hotkeys, scoped to `contentRef`); do not use Enter-to-close for Command/list popovers where Enter selects rows.
- Keep hover, active, and selection color changes instant. Do not use `transition-colors` or `transition-plan-item`; `local/no-transition-colors` enforces this.

## Learned Workspace Facts

- People availability and blockouts: compare the plan `sort_date` instant to blockouts using each blockout’s Planning Center `time_zone` (calendar-day logic); pass the full ISO `date` through the `people.planWindowHistory` and `people.candidateDetails` oRPC inputs. Naive UTC-midnight or date-only string overlap checks can mislabel people near timezone boundaries.
- Congregation-local business dates (plan windows, schedule history frequency, calendar-day deltas) use the org IANA zone from Planning Center, falling back to `PLANNING_CENTER_TIME_ZONE` (inlined into the product build as `import.meta.env.VITE_PLANNING_CENTER_TIME_ZONE`), with shared helpers in `packages/planning-center-models/src/calendar.ts`.
- Date formatters must pass an explicit time zone. Workers and CI run in UTC and browsers in the viewer's zone, so host-zone formatting puts late-evening services on the wrong day. Label congregation dates with `formatCalendarDateLabel(instant, orgTimeZone, style)` (server code takes the zone from `resolveTimeZone`, browser code from `useOrganizationTimeZone`); format UTC-noon civil-date carriers in `"UTC"`. `lint/time-zone-formatting.test.ts` rejects `Intl.DateTimeFormat` without `timeZone`, `toLocale*String`, and local getters such as `getDate()` outside its allow-list. Vitest forces `TZ=UTC` so tests match Workers on every machine; cover zone logic with an org zone such as `America/Los_Angeles` and an instant whose UTC day differs.
- Person card frequency labels should align with recommendation scoring: distinct calendar service/rehearsal days in org TZ, not raw plan-time row counts or grouped-card counts.
- Feature flags are Cloudflare Flagship flags managed by Alchemy, not environment settings or build-time `define`s. Add a flag to the registry in `packages/api/src/config/feature-flags.ts` (key and per-tier value), put targeting rules in `apps/server/src/feature-flags.ts`, and evaluate it per request through `ServerDependencies.featureFlags`; the browser asks the API. Dashboard edits are overwritten on deploy, and the local stage serves registry values without Flagship. See [docs/environment.md](docs/environment.md#feature-flags).

# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Fix and format code**: `bun run fix`
- **Check for issues**: `bun run check`
- **Diagnose setup**: `bun x ultracite doctor`

Oxlint + Oxfmt (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Give images explicit `width` and `height` and serve them as static assets from `public/`

### Framework-Specific Guidance

**TanStack Start (web, admin, marketing):**

- Add pages as file routes under `src/routes`, and commit the regenerated `src/routeTree.gen.ts` (`vite dev` or `vite build` rewrites it).
- Keep server functions (`*.functions.ts`) as SSR glue; product operations go through oRPC to the Hono API Worker.
- Read Worker bindings with `import { env } from "cloudflare:workers"` inside handlers and middleware; browser code reads build-time `import.meta.env.VITE_*` values defined in `vite.config.ts`.
- Put request-wide behavior (sign-in gate, response headers) in request middleware registered in `src/start.ts`, after the explicit CSRF middleware.
- Set document metadata with route `head()`.
- Throw router control flow as `redirect({ ..., throw: true })` and `notFound({ throw: true })`.

**React 19+:**

- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**

- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Oxlint + Oxfmt Can't Help

Oxlint + Oxfmt's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Oxlint + Oxfmt can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Oxlint + Oxfmt. Run `bun x ultracite fix` before committing to ensure compliance.
