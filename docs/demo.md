# Demo link

A private link lets someone use PCOBooster without a Planning Center login, for example a recruiter or interviewer. It runs the real product against your own Planning Center organization, spoofs people's personal details, and cannot change anything.

```text
https://pcobooster.com/demo/<DEMO_ACCESS_KEY>
```

## What visitors see

The link opens a welcome page that explains the demo and highlights Assign, Lineup, and Plan. The demo session starts while they read, so **Explore the demo** opens `/services` immediately. Inside the app, a **Read-only demo** badge sits in the header and the account menu offers **Exit demo**.

## What is spoofed

Demo requests always use presentation masking on the server:

| Spoofed | Kept as is |
| --- | --- |
| Names, initials, and photos, with stable fictional aliases | Organization, service type, team, and position names |
| Blockout reasons and descriptions ("Unavailable") | Plan titles, series, songs, and plan item text |
| Decline notes on the selected plan | Dates, times, schedules, and availability |
| People search, which matches the fictional names | Planning Center IDs |

Aliases come from about 9,500 name combinations and are derived from each person's ID, so the same person has the same alias on every page. Free-form plan item text is not scanned, so avoid putting sensitive notes there.

## How it works

1. `/demo/<key>` calls `demo.start`. The API compares the key with `DEMO_ACCESS_KEY` and sets an HttpOnly `pcobooster-demo` cookie. The cookie holds a token derived from the key, not the key itself.
2. `resolvePlanningCenterAccess` checks for a valid demo cookie before any Better Auth session. A demo request authenticates as `{ kind: "demo" }`, sets `presentation: true` on its access, and gets services built from the demo personal access token.
3. Those services use a read-only `PlanningCenterCoreClient`. Every Planning Center write goes through `request()`, which rejects anything other than `GET` or `HEAD` before it reaches the network. The rejection becomes a `Forbidden` fault that the app shows as "This demo is read-only, so changes aren't saved."
4. Identity reads report a guest. "My plans" is empty, and scheduling audits are skipped because there is no user to attribute them to.

Every screen runs the same code and live Planning Center reads as a signed-in session, so there is nothing to keep in sync.

## Setup

1. Create a personal access token for your Planning Center account at [api.planningcenteronline.com/oauth/applications](https://api.planningcenteronline.com/oauth/applications), or reuse your development token.
2. Generate an access key of at least 24 characters:

   ```bash
   openssl rand -base64 24 | tr '+/' '-_' | tr -d '='
   ```

3. Add these to Infisical Production `/`, then redeploy:

   | Key                           | Value                       |
   | ----------------------------- | --------------------------- |
   | `DEMO_ACCESS_KEY`             | The generated key.          |
   | `DEMO_PLANNING_CENTER_CLIENT` | The token's application ID. |
   | `DEMO_PLANNING_CENTER_PAT`    | The token's secret.         |

The demo stays off unless all three are set and the key is long enough. An unknown key and a disabled demo show the same "isn't active" page.

## Operating it

- **Revoke every link:** change `DEMO_ACCESS_KEY` and redeploy. Existing demo cookies stop working immediately, because their token was derived from the old key.
- **Revoke Planning Center access:** delete the personal access token in Planning Center.
- **Search engines:** `/demo/*` responses send `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`, and the page metadata repeats both. The key never appears in a later URL, because entering replaces the page with `/services`.
- **Rate limits:** demo visitors share the token's Planning Center rate limit with anything else using that token. The default is 100 requests per 20 seconds per authenticated user, or 75 per 20 seconds for requests with an `offset` above 30,000. Individual endpoints may have different limits, and Planning Center can change limits dynamically, so use the response headers rather than relying on those defaults. A `429` response includes `Retry-After`; the existing read caches absorb repeated views. See [Planning Center's rate-limiting documentation](https://api.planningcenteronline.com/docs/overview/rate-limiting).
