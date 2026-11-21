# Kept: architecture

## Principles

- **Pure core, thin edges.** Every decision (expected delivery date, risk, promise detection, customer drafts, the portal view) is a pure TypeScript function in `src/domain/` with no Forge imports. That makes the rules easy to read and fully unit-tested.
- **State-based, not event-based.** Events only decide *when* to re-check. Each check re-reads the current state of the chain (request → links → work item → sprint, release, due date) and recomputes. A missed event is caught by the hourly sweep, and running a check twice gives the same result.
- **Explainable.** Every risk carries reasons with evidence: what changed, from what to what, who changed it, and when.
- **Customer-safe by construction.** The portal gets a separate, minimal projection, never the internal record. Anything addressed to the customer is posted as the agent, only after a person clicks Send.
- **Quiet by default.** One internal note per worsening change. Recovery is silent. The guard is keyed on the exact transition, so a second slip still alerts.

## Code map

| Folder | What lives there |
|---|---|
| `src/domain/` | Pure rules: `expected.ts` (when will the fix reach the customer?), `risk.ts` (risk level and reasons), `detect.ts` (find promises in reply text), `draft.ts` (honest customer update), `portal.ts` (customer-safe stages), `changes.ts` (changelog → evidence), `evaluate.ts` (state transitions, JQL summaries) |
| `src/jira/` | Small REST adapters: issues and search, comments (ADF), entity properties, projects, sprints and releases, users, field discovery |
| `src/store/` | Forge KVS: the `promise` custom entity (indexed) and settings |
| `src/services/` | Use cases: track, accept, withdraw, tell the customer, evaluate, sweep, dashboards, portal, sample scenario |
| `src/handlers/` | Forge entry points: UI resolvers, dynamic badges, triggers, scheduled sweep, Rovo actions |
| `src/frontend/` | UI Kit screens: request panel, developer panel, Promises page (global and queue), settings, portal |
| `resources/agent/prompt.md` | The Rovo agent's instructions |

## Forge modules

| Module | Key | Where it shows |
|---|---|---|
| `jira:issueContext` | `kept-promises-panel` | Service requests: "Customer promises", with a live risk badge (`dynamicProperties`) |
| `jira:issueContext` | `kept-dev-panel` | Developer work items: "Customers waiting", with a badge |
| `jira:globalPage` | `kept-global-page` | Apps → Kept: all promises, sample scenario |
| `jiraServiceManagement:queuePage` | `kept-queue-page` | Service space sidebar: promises for that space |
| `jiraServiceManagement:portalRequestDetail` | `kept-portal` | Customer portal: "Fix progress" (customers and unlicensed users) |
| `jira:adminPage` | `kept-settings` | Jira settings → Apps → Kept |
| `jira:entityProperty` | `kept-index` | JQL: `keptRisk`, `keptRank`, `keptPromiseDate`, `keptPromises`, `keptWaiting`, `keptEarliestPromise`, `keptAtRisk` |
| `trigger` | issue, link, sprint, version, lifecycle | Re-check on change (`ignoreSelf: true`) |
| `scheduledTrigger` | `kept-hourly-sweep` | Hourly: dates that pass, missed events |
| `rovo:agent` | `kept-agent` | Rovo chat, and "Ask Rovo" buttons (`rovo.open`) |
| `action` ×5 | `get-promise-context`, `list-promises-at-risk`, `find-promises-in-request`, `track-promise`, `post-customer-update` | Used by the agent. The last two change data, so Rovo asks the user to confirm |

## The risk rules (`src/domain/risk.ts`)

1. **Expected delivery date** (`expected.ts`): the release date of the earliest unreleased fix version. If the work item's sprint ends after that release, the sprint end, with the note "may miss that release". Otherwise the open sprint's end date, then the due date. Done with no unreleased version means delivered. Done with an unreleased version means waiting for the release.
2. **Risk level**, compared with the promised date:
   - **Delivered**: fixed and released (on time or late, said plainly).
   - **Broken**: the promised date has passed and the fix hasn't reached the customer.
   - **At risk**: the plan lands after the promise; or there is no plan and the promise is within 14 days; or work hasn't started and the promise is within 3 days.
   - **Tight**: the plan lands less than the safety margin (2 days) before the promise, or the sprint may miss the release.
   - **No plan yet**: no sprint, release or due date, but the promise is far away.
   - **On track**: everything else.
   - **No link**: no developer work item is linked.
3. All three numbers are settings. Each level has a fixed wording, tested in `test/domain/risk.test.ts`.

## Flow of a slip

1. A developer moves `TD-11` from Sprint 14 to Sprint 15.
2. `avi:jira:updated:issue` arrives with the changelog. `changes.ts` keeps only the fields that matter for delivery (sprint, fix version, status, priority, due date, resolution, assignee) and turns them into evidence ("Moved from Sprint 14 to Sprint 15 by Dev Patel"). The person's name is looked up if Jira leaves it out.
3. `evaluateDevItems` loads every open promise that depends on `TD-11` (index `by-dev`), reads a fresh snapshot of the work item, and runs `applyAssessment`.
4. If the risk got worse and wasn't already alerted for this exact transition, Kept posts one internal note on each affected request, plus one heads-up on `TD-11`.
5. Entity properties are rewritten, so the badges, JQL and queue update.

## Storage

- `promise` custom entity, with indexes `by-request`, `by-dev`, `by-state` and `by-project-state`, each sorted by promised date.
- `settings:v1` key.
- Short-lived keys (with TTL) that guard alerts and the sample scenario against double runs.

## Tests

`npm run verify` runs type checking, ESLint and 121 Vitest tests:
- domain tests for every rule and its wording;
- end-to-end service tests against in-memory fakes of Jira REST and Forge KVS. The fake storage enforces Forge's real key rules.

Live checks on a real site are listed in [TEST-PLAN.md](TEST-PLAN.md), with the bugs they found.
