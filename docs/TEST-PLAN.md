# Kept: test plan

## Automated (runs on every change)

```
npm run verify     # type check + lint + all tests
```

| Suite | File | What it proves |
|---|---|---|
| Dates | `test/domain/dates.test.ts` | Calendar maths, formatting, time-zone safety |
| Expected date | `test/domain/expected.test.ts` | Release > sprint > due date; overdue plans; done-but-unreleased |
| Risk engine | `test/domain/risk.test.ts` | Every risk level and boundary, exact wording of reasons |
| Detection | `test/domain/detect.test.ts` | 11 promise phrasings found, 8 non-promises ignored, quoting, ADF |
| Drafts, portal, changes | `test/domain/draft-portal-changes.test.ts` | Customer text never leaks internals; portal exposes 4 safe fields only; changelog wording |
| Transitions | `test/domain/evaluate.test.ts` | One alert per slip, quiet recovery, re-alert on a new slip, kept/kept-late, JQL summaries |
| Pipeline | `test/services/pipeline.test.ts` | Against fake Jira + storage: track → developer moves sprint → 1 internal note + 1 dev heads-up + JQL fields → quiet recovery; settings respected; unlink; hourly sweep; re-promise; detection; portal access; Rovo actions |

## On the demo site (after each deploy that touches them)

| # | Case | Expected | Last result |
|---|---|---|---|
| E1 | Install | Kept in Apps menu, queue sidebar, request panel, dev panel | |
| E2 | Load sample scenario | Progress bar, then 5 requests, 5 bugs, 2 sprints, 2 releases | |
| E3 | Track a promise by hand | Risk + reasons shown | |
| E4 | Move the dev item to a later sprint | Request at risk in < 60 s; 1 internal note; 1 dev heads-up; `keptRisk = "at-risk"` finds it | |
| E5 | Move it back | On track again; no new note | |
| E6 | Push the release date later | At risk via the release event | |
| E7 | Resolve + release | Kept | |
| E8 | Promise date in the past | Broken after the hourly sweep | |
| E9 | Public reply with a date | Suggested promise; Track and Dismiss work | |
| E10 | Draft update → send → re-promise | Public reply on the portal; old promise "replaced" | |
| E11 | Portal as the customer | Stage tracker; no internal names in the response | |
| E12 | Rovo: open from the panel | Agent answers with keys and reasons; track-promise asks to confirm | |
| E13 | Promises page | Counts match JQL; tabs and chart work; dark mode looks right | |
| E14 | Settings off/on | Notes, portal, detection respect the toggles | |
| E15 | Remove sample data | Everything created is gone, nothing else touched | |
| E16 | Unlink the dev item | Promise shows "No link" and stops alerting | |
