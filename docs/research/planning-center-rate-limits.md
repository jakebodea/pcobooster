# Planning Center rate limit audit

Research date: September 23, 2026. Branch base: `alchemy-config-checks-and-session-cache` (`19a2aec`), with the `planning-center-shared-cache` (`d481394`) and `effect-native-planning-center` (`e8cf1f1`) branches read for context.

**Status: audit and recommendation.** No application code changed. Request counts below come from reading the code, not from production logs: the proactive pause logs at `debug` and pino runs at `info` (`packages/api/src/logger.ts:4`), so Workers Logs currently cannot show how often it happens. Treat every count as an estimate to confirm with the observability change in recommendation 1.

**Update (`pco-observability-and-pacing`):** recommendations 1 and 6 are implemented in the core client and oRPC transport; see [API architecture](../api-architecture.md#planning-center-adapters). Section 3 describes the fixed pause that recommendation 6 replaced.

## Summary

The app does hit Planning Center's limit, and it can do so from a single page load. Several oRPC procedures fan out into 50 to 300 Planning Center requests on a cold or partly warm cache. The documented budget is 100 requests per 20 seconds per user. The worst paths:

| Screen and procedure | Cold requests (example org) | Notes |
| --- | --- | --- |
| People dashboard, `people.dashboard` | about 75 to 310 | One request per active team, then schedules for 48 people at up to 6 pages each |
| Person detail, `people.dashboardPerson` | about 50 to 70 | Scans every plan in the month across every service type, 2 requests per plan. Hovering a roster row prefetches it with no delay |
| Assign view candidate list, `people.list` | about 65; about 58 again once the 60 s cache lapses | Fetches the roster of every plan within 28 days either side of the date, across all service types, plus blockouts for every candidate. **Replaced** by three progressive procedures, each within 40 requests; see [the update](#assign-view-candidate-list-peoplelist-the-worst-path-in-scheduling) |
| Plan row hover on Services, `people.warmup` | about 37 | Builds the same plan-window history as `people.list`, on hover. **Removed**: opening a plan loads `people.planWindowHistory` instead |
| Song search, `songs.search` | about 12 sequential pages per service type | Cached per service type although the catalog covers the whole organization |

Two platform facts make this worse than the Planning Center limit alone:

1. **Workers Free allows 50 subrequests per invocation**, and D1 and KV calls count too ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). `docs/environment.md` says the account is on Workers Free. Each of the first three procedures above can exceed 50 outbound fetches in one invocation. Many fan-out sites catch errors and return empty data (for example `people-service.ts:687-693`, `transforms.ts:203-205`, `get-people-dashboard.ts:668-671`, `get-people-dashboard-person.ts:152-155`), so a "Too many subrequests" failure would appear as missing data, not as an error. Check Workers Logs for this before tuning anything else. (Fixed since: see recommendation 1.)
2. **Workers allows 6 connections per invocation waiting for response headers at once** (same page). The code's concurrency of 8 (`PEOPLE_HYDRATION_CONCURRENCY`, `TEAM_PEOPLE_CONCURRENCY`) and the unbounded `Promise.all` in person detail queue behind that limit.

The 1 second proactive pause adds latency but does not prevent 429s on these fan-outs. See [the proactive pause](#3-the-proactive-pause-and-shared-buckets).

## 1. Planning Center's rate limit rules

Primary source: [Rate Limiting](https://api.planningcenteronline.com/docs/overview/rate-limiting) (fetched September 23, 2026). The local export in `docs/planning-center-api/` covers vertices only (attributes, includes, ordering, queries). It has no rate limit, pagination, or per-edge filter pages, so the facts below come from the live docs and the live documentation API (`https://api.planningcenteronline.com/services/v2/documentation/2018-11-01/vertices/<vertex>`).

- **Limit and window:** "100 requests per 20 seconds per authenticated user." Requests with an `offset` above 30,000 get a stricter "75 requests per 20 seconds." That is 5 requests per second sustained, not the "100 rps API window" stated in the comment at `get-people-for-position.ts:63-66`.
- **What it is keyed by:** the authenticated user. The docs do not say whether the window is fixed or sliding, and they do not mention the application. Our reading is that the bucket belongs to the Planning Center person: every request made with that user's credentials, from any tab, prefetch, device, or Worker isolate, counts against one budget.
- **Dynamic limits:** "Individual endpoints may enforce their own limits that are lower or higher than the defaults. Rate limits can also be adjusted dynamically at any time and without prior notice." And: "Your application should never hard-code rate limit values." The documentation API reports a `rate_limits` list for each vertex and edge. Every Services vertex and edge this app uses returns an empty list today, so none has a published endpoint-specific limit.
- **Headers:** every response carries `X-PCO-API-Request-Rate-Limit` (maximum for the period), `X-PCO-API-Request-Rate-Period` (for example "20 seconds"), and `X-PCO-API-Request-Rate-Count` (requests used so far in the period). The docs say to "Always rely on these headers, not assumed values, when deciding how to pace your requests" (reworded to avoid a dash).
- **429:** the API returns `429 Too Many Requests` with an error body and a `Retry-After` header in seconds.
- **OAuth and personal access tokens:** the [authentication docs](https://api.planningcenteronline.com/docs/overview/authentication) say a PAT "allows you to use the API from your own account", and OAuth is for apps used by many churches. They do not say whether a user's OAuth tokens and PATs share a bucket. Because the limit is per authenticated user and both credentials act as that user, assume they share one until measured. The rate headers on two calls in a row, one with each credential, would settle it. Consequences for this app:
  - **Signed-in users** each have their own bucket. Two schedulers in the same organization do not share a budget, but one scheduler's tabs, hover prefetches, and concurrent procedures all do.
  - **Demo visitors** all use one demo PAT (`planning-center-access.ts:103-107`), so every concurrent demo visitor shares one 100-per-20-seconds budget.
  - **`DEV_AUTH_BYPASS`** uses the developer's PAT, which likely shares a bucket with that developer's own Planning Center use.
- **Pagination:** the documentation API gives `per_page` as "min=1, max=100, default=25", with `offset` pagination and a `links.next` URL. `people-service.ts:387` and `plans-service.ts:223` request `per_page=200`, which is above the maximum. Nothing depends on 200, but those calls cannot return 200 rows per page.
- **OAuth token lifetime:** "OAuth access tokens expire after 2 hours" (authentication docs). This matters because every cache scope is a hash of the access token (`core-client.ts:295-301`), so every cache goes cold at least every 2 hours per user. KV entries on the shared-cache branch expire the same way.

Per-edge filters that the code does not use yet (from the documentation API):

| Edge | Filters |
| --- | --- |
| `/services/v2/people/{id}/blockouts` | `future`, `past` |
| `/services/v2/people/{id}/schedules` | `after`, `before`, `future`, `past`, `all`, `with_declined`, `not_across_organizations` |
| `/services/v2/service_types/{id}/plans/{id}/team_members` | `confirmed`, `not_archived`, `not_declined`, `not_deleted` |
| `/services/v2/songs/{id}/song_schedules` | `after`, `before`, `most_recent`, `three_most_recent`, ... |
| `/services/v2/teams` | `editable`, `service_types`; can include `people`, `person_team_position_assignments`, `team_positions` |

## 2. Request inventory per screen

### How requests are made

- `PlanningCenterCoreClient` (`packages/api/src/planning-center/core-client.ts`) issues every request. `fetchAll` and `fetchAllWithIncluded` (`:455-507`) follow `links.next` **one page after another**, with `per_page=100` and a `maxPages` cap (default 10 and 5). A paginated read costs `ceil(rows / 100)` requests, one round trip each.
- In-flight GET deduplication (`:391-423`) applies only to requests without an abort signal. Almost every caller passes a signal, so it rarely applies.
- Caches are `PlanningCenterReadCache` instances in module scope (per isolate), keyed by the credential hash. They coalesce concurrent loads of the same key. The shared-cache branch moves them into `ServerDependencies` and backs three of them with KV (see [what the shared KV cache covers](#what-the-shared-kv-cache-covers)).
- `resolveOrganizationTimeZone` (`resolve-organization-timezone.ts:38-67`) costs one `GET /services/v2` per credential per hour. It is not coalesced, so concurrent cold procedures each fetch it once.
- Browser React Query stale times (`apps/web/src/hooks/*`) decide how often procedures run. Each procedure is its own Worker invocation with its own 50-subrequest budget, but they all share one Planning Center bucket.

### Example organization

Counts use a mid-size church: S = 4 active service types with weekly plans, T = 12 active teams, 25 people rostered per plan, 20 people assigned to a position, 30% of candidates with a repeating blockout, 1,200 songs, and 150 people on teams. Where the result depends on these, the formula is given too.

### Services list (`/services`, `routes/_app/services/index.tsx`)

`SchedulePlansPage` runs `catalog.serviceTypes`, `catalog.plans` once per selected service type (`use-service-plan-selection.ts:103-118`), `catalog.organization`, and `people.myScheduledPlans`.

| Procedure | Path | Cold | Warm |
| --- | --- | --- | --- |
| `catalog.serviceTypes` | `application/catalog.ts:32` to `get-service-types.ts:13` to `catalog-service.ts:84` (`fetchAll` of `/service_types`, 5 min TTL) | 1 | 0 |
| `catalog.plans` (x S) | `get-plans.ts:26` to `plans-service.ts:120` (`filter=after`, 3 pages max, 5 min TTL) | 1 each, plus 1 for the time zone | 0 |
| `catalog.organization` | time zone resolver | 1 | 0 |
| `people.myScheduledPlans` | `get-current-user-scheduled-plans.ts:86` (`/oauth/userinfo` plus `/people/{me}/schedules?order=-starts_at`, 5 pages max, 60 s memory TTL) | 2 to 6 | 0 to 6 (browser stale time 60 s) |

Total: about 8 to 12 cold. Not a problem on its own. `myScheduledPlans` pages through the user's whole schedule history, newest first, up to 500 rows, when the plan list only needs upcoming plans. `filter=future` or `filter=after` would cap it at one page.

**Hover prefetch.** Hovering a plan row for 300 ms (`TEAM_POSITIONS_PREFETCH_DELAY_MS`, `lib/service-plan-selection.ts:18`) or selecting it calls `prefetchPlanData` (`use-service-plan-selection.ts:321-331`). That runs `catalog.teamPositions` (about 3), `planItems.list` (1), and **`people.warmup`**. `people.warmup` (`get-people-for-position.ts:594-616`) builds the whole plan-window history: 1 service types request, S plan-range requests, and one `team_members` request for every plan within 28 days either side (`PLAN_HISTORY_HALF_RANGE_DAYS = 28`). With weekly plans that is about 8 plans per service type, so **about 37 requests per hovered row date**. Moving the pointer down a list of Sundays can spend the whole 100-request budget in a few seconds.

### Plan workspace (`/services/$serviceTypeId/plans/$planId/$view`)

`useDashboardController` (`use-dashboard-controller.ts:55-110`) always loads `catalog.serviceTypes`, `catalog.plans`, `catalog.teamPositions`, and `planTimes.list`, and prefetches `planItems.list` in every view except Plan (`:216-234`).

| Procedure | Path | Cold | Warm (memory TTL) |
| --- | --- | --- | --- |
| `catalog.teamPositions` | `get-team-positions.ts:541-574`: `team_positions?include=team` (single page, `catalog-service.ts:106`), `needed_positions?include=team` (`:136`), `team_members?include=person,team,plan` (`people-service.ts:442`) | 3 (5 on the series fallback, `:346-392`) | 0 within 30 s. Then 1 to 2, because `team_members` is 30 s and `needed_positions` 60 s |
| `planTimes.list` | `plan-times.ts:256` to `plans-service.ts:210` | 1 | 0 (5 min) |
| `planItems.list` | `get-plan-items.ts:15` to `plan-items-service.ts:53` (`include=song,arrangement,key,item_notes,item_times`) | 1 | 0 (30 s) |

Opening a plan cold costs about 6 to 8 requests. Not a problem. `team_positions` reads one page of 100 with no pagination, so a service type with more than 100 positions is silently cut off. That is a correctness issue, not a rate issue.

### Assign view candidate list (`people.list`), the worst path in scheduling

> **Update (September 24, 2026, `people-list-progressive`):** `people.list` and `people.warmup` are replaced by three procedures the browser calls progressively, each within a 40 request budget with a continuation (see [API architecture](../api-architecture.md#progressive-procedures)):
>
> - `people.positionCandidates`: position assignments and the selected plan's fresh roster. The list renders from this alone.
> - `people.planWindowHistory`: every roster in the 57-day window, in window order until the budget runs out, continued with `deferredPlans`. One browser query per plan date, shared by every position and plan on it; opening a plan loads it.
> - `people.candidateDetails`: blocked on the plan date for 16 candidates per call, continued with `deferredPersonIds`; with `scheduleHistory` it also reads each person's own schedules when the window has no plans.
>
> Split choice: history needs every roster in the window (the plan-window read is inherently per plan, not per person), while availability is per person and independent of history, so the two run in parallel as separate budgets. Candidates come first because they cost about 3 requests and let the view render at once. Scores are normalized across available candidates, so they appear when every part has arrived; until then the list keeps a stable order (slot status, then name) with blocked people in place.
>
> Measured against the dev organization (7 active service types, 39 plans in the window, 19 candidates for a vocals position, September 27 plan), with the real modules and a counting fetch:
>
> | Call | Cold requests | Cold time | Warm (same isolate) |
> | --- | --- | --- | --- |
> | `people.list` (removed) | 65 (65 to 67 across runs) | 6.3 to 9.1 s |  |
> | `people.positionCandidates` | 2 (time zone cached) | 0.6 to 0.9 s | 0; another position on the plan: 1 |
> | `people.planWindowHistory` | 38, one call (1 service type list, 7 plan ranges, 30 rosters) | 4.5 to 5.1 s | 0 |
> | `people.candidateDetails`, 16 people | 20 | 1.6 s | 0 |
> | `people.candidateDetails`, 3 people | 4 | 0.7 to 0.9 s | 0 |
> | Total | 64, no call over 40 | list visible after about 0.7 s, complete after about 5 s | 0 |
>
> The assembled list equaled `people.list`'s output exactly for this position (compared live before the old procedure was removed). The history payload is 142 KB as compact roster rows (400 KB when the server expanded every row into history items). A larger org spills into a second history call rather than exceeding the budget; `position-candidates-equivalence.test.ts` forces one roster per call and still matches.
>
> Also fixed: the old per-person fallback (used when the window had no plans) read schedules with `order=-starts_at` and no filter, which Planning Center scopes to upcoming schedules only, so past services never counted. It now reads `filter=after` from 28 days before the plan.
>
> **Blockout filter, checked live on September 24, 2026.** The documentation API lists `future` and `past` as the only filters on `/people/{id}/blockouts`; `blockout_dates` has none. Across the dev organization's 125 people with blockouts (3,599 blockouts), `filter=future` kept every one-time blockout that ends in the future, including ones that started months earlier (for example April 8, 2026 to January 1, 2027), and dropped every one that had ended. All 13 repeating blockouts in the organization had a `repeat_until` in the past, and `filter=future` dropped all of them, which is also what an end-date rule predicts. No repeating blockout that started in the past and repeats into the future exists there, so whether `future` keeps one (its parent `ends_at` is the first occurrence's end) could not be verified without writing test data to the organization. Blockout lists therefore stay unfiltered: correct, at one page per person for almost everyone. The cost of not filtering is concentrated in 10 people with 104 to 235 blockouts (2 to 3 pages each). If a repeating blockout is later confirmed to survive `filter=future`, that filter would save those pages.

Path: `use-people.ts` to `transport/orpc/people.ts:18` to `application/people.ts:88` to `getPeopleForPosition` (`get-people-for-position.ts:446-592`). The web enables the query only when the plan has a `sortDate` (`use-dashboard-controller.ts:83-93`), so `date` is always set and the shared plan-window path always runs.

| Step | Code | Requests |
| --- | --- | --- |
| Time zone | `:455` | 0 to 1 |
| Position assignments (`include=person,team_position`) | `:481`, `people-service.ts:403-431` (5 min TTL) | 1 (per 100 assignees) |
| Plan-window history: service types | `:331`, `getServiceTypesCached` (5 min) | 1 |
| Plan-window history: plans in ±28 days with `include=plan_times`, per active service type | `:345-365`, `plans-service.ts:120` (5 min), concurrency 6 | S = 4 |
| Plan-window history: `team_members` for every plan in the window | `:366-404`, `people-service.ts:433` (**30 s TTL**), concurrency 8 | about 8 x S = 32 |
| Per candidate: all blockouts, past and future | `:522`, `transforms.ts:159-206`, `people-service.ts:240` (60 s) | C = 20 |
| Per candidate: `blockout_dates` for every repeating blockout | `transforms.ts:184` (60 s) | about 0.3 x C = 6, more if people have several repeating blockouts |

- **Cold:** about 1 + 1 + 1 + 4 + 32 + 20 + 6 = **65**. Formula: `3 + S + (plans in 57 days) + C x (1 + repeating blockouts)`.
- **Warm within 60 s** (another position in the same plan): 1 for the new position's assignments, plus blockouts for candidates not seen yet.
- **After 60 s:** the plan-window snapshot (`PLAN_WINDOW_HISTORY_CACHE_TTL_MS`, 60 s) and blockouts expire, and `team_members` expired at 30 s. Service types and plan ranges are still cached, so the next load costs about 32 + 20 + 6 = **58** again. A scheduler working through a plan for 10 minutes rebuilds this every minute.
- **Slot hover:** hovering a position for 180 ms (`SLOT_PEOPLE_PREFETCH_DELAY_MS`, `use-dashboard-controller.ts:34`, `:236-275`) prefetches `people.list` for that position. Past the first position, each hover costs about 1 + C new blockout reads.
- Rosters for past plans in the window almost never change, but they are fetched again every 30 to 60 seconds.
- Blockouts are fetched unfiltered. `filter=future` exists and would drop past blockouts, which are the majority for long-time volunteers, from every page.

### People dashboard (`/people`, `people.dashboard`)

> **Update (September 24, 2026):** `people.dashboard` is replaced by `people.dashboardRoster` (one `teams?include=people` read, 2 requests cold with the time zone) and `people.dashboardActivity` (16 people per call, schedules filtered to the last 91 days onward, rehearsal PlanTimes read once per service type; measured 16 to 19 requests cold, capped at 40 with `deferredPersonIds` as the continuation). The browser loads 48 people in 3 calls, 2 at a time, and loads more on request. The analysis below describes the old procedure. It also missed that `/people/{id}/schedules` without a filter returns only upcoming schedules, so past services never counted.

Path: `use-people-dashboard.ts` to `application/people.ts:186` to `get-people-dashboard.ts:641-756`.

| Step | Code | Requests |
| --- | --- | --- |
| Time zone | `:734` | 0 to 1 |
| All teams | `people-service.ts:667` (in `getAllPeopleFromTeams`, 5 min TTL; KV-backed on the shared-cache branch) | 1 |
| People per active team | `people-service.ts:677-695`, concurrency 8 | T = 12 |
| Schedules for the first 48 roster people (sorted by last name) | `get-people-dashboard.ts:662-679`, `SCHEDULE_MAX_PAGES = 6`, concurrency 4, unfiltered | 48 to 288 |
| Rehearsal `PlanTime` enrichment per plan with times missing from the include | `people-service.ts:325-369`, `getPlanPlanTimes` (5 min) | about 10 to 20 distinct plans |

- **Cold:** about 1 + 1 + 12 + 48 + 15 = **77** when each person's schedules fit in one page, up to about **315** when they need all 6 pages. The whole result is cached for 2 minutes per credential (`PEOPLE_DASHBOARD_CACHE_TTL_MS`). This is the only procedure that always goes past both the Planning Center budget and the Workers Free subrequest cap on a cold load.
- `requestBudget` in the response (`:710-717`) already reports `teamRequests` and `scheduleRequests`, but nothing logs them.
- Correctness: the team-people read (`people-service.ts:682`) is a single `fetchCollection` without `per_page`, so it returns Planning Center's default of **25 people per team** and never paginates. Larger teams are cut off.

### Person detail (`/people/$personId`, `people.dashboardPerson`)

Path: `use-people-dashboard-person.ts` to `application/people.ts:218` to `get-people-dashboard-person.ts:515-608`.

| Step | Code | Requests |
| --- | --- | --- |
| Time zone | `:580` | 0 to 1 |
| Person | `:526`, `people-service.ts:147` (60 s) | 1 |
| Schedules twice: default order, and `order=-starts_at`, `PERSON_SCHEDULE_MAX_PAGES = 10` each | `:65-96` (60 s) | 2 to 20 |
| Rehearsal `PlanTime` enrichment for those schedules | `people-service.ts:325-369` | about 5 |
| Month roster: service types | `:133` | 1 |
| Month roster: plans in the month, per service type (all, including archived) | `:137-155`, `Promise.all` with no concurrency limit | S = 4 |
| Month roster: `team_members` **and** `plan_times` for every plan in the month | `:157-173`, `Promise.all` with no concurrency limit | 2 x about 18 = 36 |

- **Cold:** about 1 + 1 + 2 + 5 + 1 + 4 + 36 = **50** with short schedule histories, up to about **70** with long ones. The month roster scan fetches every plan's roster in the organization to find one person.
- **Another person within 30 s:** about 3 to 25, depending on history length.
- **Another person after 30 s:** `team_members` has expired, so the 18 roster reads repeat.
- **Hover prefetch with no delay:** `people-page.tsx:164-180` prefetches `people.dashboardPerson` on `onPointerEnter`, `onFocus`, and `onTouchStart` (`roster-table-body.tsx:73`, `shared-components.tsx:105-113`). Moving the pointer across 10 roster rows starts 10 procedures at once, about 30 to 250 requests, all on the same user's bucket. This is the most likely source of 429s on the People pages.

### Run sheet and songs

| Procedure | Path | Cold | Warm |
| --- | --- | --- | --- |
| `planItems.list` | above | 1 | 0 (30 s) |
| `songs.search` | `search-songs.ts:22-73` to `songs-service.ts:52-86` (`fetchAll /songs?order=title`, 15 pages max, 15 min TTL; KV-backed on the shared-cache branch) | ceil(songs / 100), about 12, **one after another** | 0 |
| `songs.options` | `get-song-options.ts:54-65`: song, arrangements with keys (5 min), `last_scheduled_item` (never cached) | 3 | 1 |
| `planItems.create` and `update` | `plan-item-payload.ts:63` song defaults (the `songs.options` reads), then one write | 1 to 4 | 1 to 2 |

The song catalog cache key includes the service type (`search-songs.ts:41-42`, `` `${cacheKey}:${serviceTypeId}` ``), but the catalog fetch has no service type filter. Every service type loads the same 12 pages separately, and so does every token refresh.

### Writes (`schedule.*`, `planTimes.*`, `planPeople.updateTimes`)

These are small: `schedule.assign` reads `team_positions` (cached) and the person's assignments (`schedule-person.ts:51-60`), then makes one POST. Writes are never paused or retried (`core-client.ts:220`, `:346`). They do clear the caches that the heavy reads depend on (`people-service.ts:618-654`, `get-people-for-position.ts:618-637`), so the first `people.list` after a scheduling change costs the full plan-window rebuild again.

### Unused by the web app

`people.scheduleHistory` and `people.blockouts` have no caller in `apps/web`. They cost 1 to 4 requests each. (`people.scheduleHistory` has since been removed.)

## 3. The proactive pause and shared buckets

`maybePauseNearRateLimit` (`core-client.ts:215-236`, called at `:339`) runs after every successful GET. When `count >= 0.8 x limit`, which is request 80 of 100 in the current period, it sleeps 1 second **after the response arrives and before returning it**. The effect-native rewrite keeps the same rule as `pauseNearRateLimit` (`effect-native-planning-center:packages/api/src/planning-center/core-client.ts:236-248`).

What it does to the counts above:

- **Sequential pagination** (`fetchAllWithIncluded`, `songs.search`, multi-page schedules): every page after the threshold adds 1 s. A 12-page song catalog loaded near the threshold takes about 12 s longer. The pause also runs after the last page, so even a one-page read gets 1 s slower.
- **Concurrent fan-out** (`people.list`, `people.warmup`, dashboard, person detail): each worker slot holds its result for 1 s. At an effective concurrency of 6 (the Workers connection cap) and about 300 ms per round trip, throughput drops to about 6 / 1.3 s, or 4.6 requests per second. The 20 requests left between 80 and 100 then take about 4 s. That usually finishes well inside the 20 s window, so request 101 still gets a 429. Pausing mostly adds latency and rarely prevents the 429.
- **After a 429:** reads retry twice (`MAX_RETRIES`, `:29`) and wait `Retry-After` seconds each time (`:144-152`), up to the rest of the 20 s window. Every concurrent worker that got a 429 does the same, and each retry counts against the new window. One fan-out that crosses the limit can take 20 to 40 s. That matches "feels slow".
- **Scope:** the pause reads only the headers of the response it just received. It keeps no state between requests, and other concurrent procedures, isolates, and tabs for the same user never see it. Nothing is logged at a level that reaches Workers Logs (`log.debug`, `:231`). Retries log at `warn` (`:353-361`), so 429 retries are the only visible trace today.
- **Buckets:** because the limit is per authenticated user (section 1), the pause protects nothing across users. Users in the same organization have separate buckets and do not slow each other down. The same user's tabs, prefetches, and parallel procedures share one bucket. All demo visitors share the demo PAT's bucket.

Example with the budget at 80 after a plan hover (about 40) and a `people.list` (about 35 so far): the next `people.list` needs 58. About 20 get through with 1 s pauses over about 4 s, then the remaining 38 get 429s, wait out the window (up to about 16 s), and retry. Most of them succeed in the next window, so the list appears after about 20 to 25 s instead of about 2 s.

### What the shared KV cache covers

The `planning-center-shared-cache` branch backs three caches with Workers KV so all isolates share them: service types (`catalog.service-types`), the team-people directory (`people.all-team-people`), and song catalogs (`songs.catalogs`) (`factory.ts` `bindReadCaches`; `docs/api-architecture.md` "Planning Center read caches"). The TTLs stay the same: 5, 5, and 15 minutes.

| Covers | Saves per cold load |
| --- | --- |
| `people.dashboard` team fan-out | 1 + T (about 13) |
| `songs.search` catalog | about 12 sequential pages, per service type |
| Service types in `people.list`, `people.warmup`, `people.dashboardPerson`, `catalog.serviceTypes` | 1 |

It deliberately leaves out, because mutations clear these caches or they have many keys:

- `team_members`, the biggest multiplier.
- Plan ranges, blockouts, and schedules.
- The plan-window snapshot, dashboard, and person-detail results.

KV keys use the same credential-hash scope, so they also go cold on every 2-hour token refresh. KV reads and writes also count toward the 50-subrequest cap on Workers Free. Net effect: good for songs and the dashboard's team step, but little help for `people.list`, `people.warmup`, or person detail.

## 4. Recommendations

Ranked by expected benefit for the effort. "After rewrite" marks changes to `core-client.ts` or the service classes, which `effect-native-planning-center` is rewriting. Land those after it merges so they do not conflict. Changes to feature modules in `modules/planning-center/*` and to `apps/web` do not conflict. Service-level TTL constants and endpoint parameters are small edits that rebase easily, but coordinate them with that branch.

1. **Make rate limiting visible.** Low effort. **After rewrite** for the core-client part. **Implemented.** Pacing waits, pacing rejections, and 429s log at `info` (429s at `info` rather than `warn`, so every one reaches Workers Logs alongside the pauses); each procedure that calls Planning Center logs one `info` summary from a root oRPC middleware; the client raises a typed `PlanningCenterSubrequestLimitError` for "Too many subrequests" and logs it at `warn`. Pages and cache hit/miss counts are not in the summary yet. **Implemented** (`no-silent-empty-data`): no fan-out site falls back to empty data after a rate or subrequest limit any more. `recoverUnlessInterrupted` is gone; `recoverPlanningCenterFailure` recovers only the failure kinds a caller lists, and rate limits, subrequest limits, and interruption always propagate. The sites this audit listed now fail (person detail service types, pending requests, and plan ranges other than 404s; plan-by-plan plan times other than 404s), were removed with `people.list` (`get-people-for-position.ts`, the blockout fallback in `transforms.ts`), or keep a logged fallback for provider errors only (organization time zone). See [API architecture](../api-architecture.md#planning-center-adapters).
   - Log the proactive pause at `info`, with endpoint path, rate count, limit, and period.
   - Log each 429 at `warn`, with `Retry-After` and the attempt number.
   - Add one `info` summary per oRPC procedure: procedure name, Planning Center request count, pages, pauses, total pause ms, 429s, and cache hit/miss counts. Emit it from `transport/orpc/execute.ts`, which does not conflict, using a request-scoped counter that the client increments.
   - Log "Too many subrequests" errors instead of swallowing them in the fan-out `catch` blocks.
   - With these logs in Workers Logs, the counts in this document can be checked against real traffic before and after each fix. At 200,000 log events per day on Workers Free, one summary line per procedure is cheap.

2. **Confirm the Workers Free subrequest cap, and decide on Workers Paid.** Low effort, but an account decision for the user. `people.list`, `people.warmup`, `people.dashboard`, and `people.dashboardPerson` can all exceed 50 subrequests on a cold cache. On Free, the rest fail and are swallowed as empty data. Workers Paid raises the cap to 10,000 and would also let the shared KV tier cover more caches (as `docs/api-architecture.md` on the shared-cache branch notes). Without Paid, every recommendation below must also keep each procedure under about 45 Planning Center requests.

3. **Stop heavy work on hover.** Low effort, web only, no conflict. Removes the largest source of bursts.
   - Person rows: prefetch `people.dashboardPerson` only after a 250 to 300 ms hover, as the plan rows already do, or only on click and focus. `onTouchStart` already covers mobile intent.
   - Plan rows: do not call `people.warmup` on hover. Run it when the plan is selected, or when the Assign view opens.
   - Expected: a pointer sweep over 10 people drops from about 30 to 250 requests to 0. A plan hover drops from about 41 to about 4.

4. **Cut `people.list` and `people.warmup` fan-out.** **Implemented** (TTLs and concurrency in `people-list-detail-fanout`; the split into budgeted progressive procedures in `people-list-progressive`, see [the update](#assign-view-candidate-list-peoplelist-the-worst-path-in-scheduling)). Blockouts stay unfiltered; `filter=future` is unverified for repeating blockouts. Medium effort. Modules do not conflict; the TTL and filter edits in `people-service.ts` are small.
   - Give past plans' `team_members` a long TTL (for example 30 minutes, cleared by this app's own writes as today), and keep 30 s only for the selected plan and future plans. Expected: the 60 s rebuild drops from about 32 roster reads to about 4 to 8.
   - Raise `PLAN_WINDOW_HISTORY_CACHE_TTL_MS` from 60 s to 5 minutes. Writes already clear it (`invalidatePlanWindowHistory`).
   - Fetch blockouts with `filter=future` (edge filter above). Fetch `blockout_dates` only for repeating blockouts whose `repeat_until` is empty or after the plan date. Raise the blockout TTL to 5 minutes. Expected: about 26 per load drops to about 20 cold and about 0 warm, with fewer pages for long-time volunteers.
   - Coalesce the time zone lookup like other cache reads.
   - Cap concurrency at 6 to match the Workers connection limit, and fix the "100 rps" comment (`get-people-for-position.ts:63-66`).
   - Combined: a repeat `people.list` after a minute drops from about 58 to about 5 to 10 requests.

5. **Rebuild person detail around the person's own schedules.** Medium effort. Module only.
   - The month roster scan (`get-people-dashboard-person.ts:121-200`) reads every plan's roster and times in the organization, about 40 requests, to find one person.
   - `/people/{id}/schedules` supports `filter=after` and `filter=before` (also `with_declined`). A month-bounded schedules query with `include=plan_times`, plus `getPlanPlanTimes` only for plans with missing rehearsal times, should return the same entries in about 1 to 3 requests.
   - Check first why the roster scan was added (for example, unconfirmed or declined rows, or a Planning Center permission gap). Keep the scan as a fallback only if the schedules query really misses those rows.
   - Also merge the two unbounded schedule reads (`:70-83`) into one bounded `filter=after` query.
   - Expected: about 50 to 70 cold drops to about 5 to 10.

6. **Replace the fixed 1 s pause with pacing based on the headers, shared per credential.** Medium effort. **After rewrite.** **Implemented** for pacing, the 5 s cap, and the typed fail-fast (`PlanningCenterRateLimitError`, mapped to `RateLimited`). Pacing starts at half the reported limit. **Implemented** (`planning-center-api-optimization`): optional work is marked speculative in the browser and fails earlier than required reads; see [Request priority](../api-architecture.md#request-priority). Not implemented: serving stale cache entries when the budget is low.
   - Keep one in-isolate limiter per cache scope. Seed it from the last seen `Rate-Count`, `Rate-Limit`, and `Rate-Period`, and let concurrent procedures for that user take tokens from it before they send.
   - When the budget runs low:
     - Spread required reads across the time left in the window: wait about `remaining window / remaining budget` per request. Do not wait after the response.
     - Make optional work fail fast, including prefetch, `people.warmup`, and history enrichment, with a typed `RateLimited` result the web can ignore.
     - Serve an expired cache entry if one exists (stale-while-revalidate).
   - On 429, wait at most about 5 s. Past that, fail the read quickly with `RateLimited` and its `retryAfterSeconds` (already mapped at `planning-center-access.ts:146-153`) so the browser can retry, instead of holding the request for up to 40 s.
   - Never hard-code 100 or 20, as the docs warn.
   - This cannot coordinate across isolates. Only a Durable Object per user could, which is not worth it until the logs from recommendation 1 show cross-isolate 429s.

7. **Stop caches going cold on token refresh.** Medium effort. **After rewrite and the shared-cache branch.**
   - Scope caches by the Planning Center person (and organization) instead of the access-token hash. The person ID is already available from `/oauth/userinfo` and is stable across the 2-hour refreshes.
   - This keeps every per-user cache, including KV, warm across refreshes and cuts KV writes. Permissions stay per user, so it is no less safe than today.
   - Sharing across users in the same organization would save more, but Planning Center permissions differ per user, so do not share across users without a permission-safe key.

8. **Fix the song catalog key and pagination.** Low effort. The module key change does not conflict; parallel pages need the core client (**after rewrite**).
   - Drop `serviceTypeId` from the catalog cache key (`search-songs.ts:41-42`). Expected: S times fewer catalog loads, about 36 requests saved for the example org.
   - Raise the TTL to about 1 hour. Songs change rarely, and the app never writes them.
   - Once the first page returns `meta.total_count`, fetch the remaining offsets in parallel. Expected: about 12 x RTT becomes about 2 x RTT, with no fewer requests.

9. **Bound the People dashboard.** Medium effort. Modules, plus a small `people-service.ts` change.
   - Load team people with `per_page=100` and pagination. This fixes the 25-per-team truncation. `teams?include=people` is worth testing as a single request for all teams, but check its include limits against real data first.
   - Hydrate schedules with `filter=after` (month start) and 1 or 2 pages, not 6 unfiltered.
   - Expected: about 77 to 315 cold drops to about 60 to 65. The 48-person hydration is still the floor. Going further means Workers Paid plus a longer-lived shared tier, or sampling fewer people.

10. **Small fixes.** Low effort.
    - `myScheduledPlans`: use `filter=future` (1 page instead of up to 5).
    - Presentation identity: `presentation.ts:31` keys its organization cache by the per-request catalog service, so every presented request (all demo traffic) makes an extra `GET /services/v2`. Key it by cache scope.
    - Replace `per_page=200` with 100.
    - Paginate `team_positions` past 100.
    - Cache `last_scheduled_item` for a short time.

What we would not do: raise browser stale times further. The costly misses are server-side TTLs of 30 to 60 s under browser stale times of 5 to 10 minutes. The server rebuilds because of prefetches, invalidations, token refresh, and cross-isolate misses, not because of browser refetches.

## Sources

- Planning Center, [Rate Limiting](https://api.planningcenteronline.com/docs/overview/rate-limiting), [Authentication](https://api.planningcenteronline.com/docs/overview/authentication), [JSON API](https://api.planningcenteronline.com/docs/overview/json-api) (fetched September 23, 2026).
- Planning Center Services documentation API, for example `https://api.planningcenteronline.com/services/v2/documentation/2018-11-01/vertices/person` and `.../plan_person`: per-edge `filters`, `rate_limits`, and the `per_page` bounds.
- Local export `docs/planning-center-api/services/2018-11-01/vertices/*.md`: includes, ordering, and queries per vertex.
- Cloudflare, [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): 50 subrequests per invocation on Free and 10,000 on Paid, with KV and D1 counted, and 6 simultaneous connections waiting for headers.
- Code at `alchemy-config-checks-and-session-cache` (`19a2aec`): the file and line references above. Shared-cache design: `git show planning-center-shared-cache:docs/api-architecture.md`.
