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
| Boards | `test/jira/projects.test.ts` | Sample finds sprint boards in company-managed and team-managed spaces, skips Kanban |
| Pipeline | `test/services/pipeline.test.ts` | Against fake Jira + storage: track → developer moves sprint → 1 internal note + 1 dev heads-up + JQL fields → quiet recovery; settings respected; unlink; hourly sweep; re-promise; detection; portal access; Rovo actions |

## On the demo site (after each deploy that touches them)

| # | Case | Expected | Last result |
|---|---|---|---|
| E1 | Install | Kept in Apps menu, queue sidebar, request panel, dev panel | ✅ 2026-11-20: Apps menu page, request panel (live badge), dev panel (live badge). ✅ 2026-11-21: queue sidebar page (scoped to the space), app icon in the Apps menu |
| E2 | Load sample scenario | Progress bar, then 5 requests, 5 bugs, 2 sprints, 2 releases | ✅ 2026-11-20 after 3 fixes (request type without description; cleanup permissions; board scope) |
| E3 | Track a promise by hand | Risk + reasons shown | ✅ 2026-11-21 after fix (typed text was dropped; customer defaulted to the reporter) |
| E4 | Move the dev item to a later sprint | Request at risk in < 60 s; 1 internal note; 1 dev heads-up; `keptRisk = "at-risk"` finds it | ✅ 2026-11-20: at risk + internal note + dev heads-up + `keptRisk` JQL in ~10 s |
| E5 | Move it back | On track again; no new note | ✅ 2026-11-20: back to On track, no extra notes |
| E6 | Push the release date later | At risk via the release event | ✅ 2026-11-20 after 2 fixes (alert guard silenced 2nd slip; invalid KVS key) |
| E7 | Resolve + release | Kept | ⬜ not run live (covered by unit tests) |
| E8 | Promise date in the past | Broken after the hourly sweep | ⬜ not run live (covered by pipeline test) |
| E9 | Public reply with a date | Suggested promise; Track and Dismiss work | ✅ 2026-11-20 after fix (reporter = agent in sample; now uses account type) |
| E10 | Draft update → send → re-promise | Public reply on the portal; old promise "replaced" | ✅ 2026-11-20: draft, send, re-promise, old promise replaced |
| E11 | Portal as the customer | Stage tracker; no internal names in the response | ✅ 2026-11-21 as the requester: 5-stage tracker, no keys/sprints/names, internal notes hidden. A separate customer-only account not tried |
| E12 | Rovo: open from the panel | Agent answers with keys and reasons; track-promise asks to confirm | ✅ 2026-11-23: after a fresh sample + Acme slip, listed 2 at risk + 1 tight with correct keys, reasons and honest drafts. ✅ 2026-11-21: listed 2 at risk + 2 tight with keys, reasons and honest drafts; track-promise asked first, Rovo showed its own review card, then tracked |
| E13 | Promises page | Counts match JQL; tabs and chart work; dark mode looks right | 🟡 2026-11-20: page, tiles, tabs, chart render. Dark mode: code uses design tokens only (checked); not viewed live |
| E14 | Settings off/on | Notes, portal, detection respect the toggles | ✅ 2026-11-21: portal date toggle shows/hides the date on the portal; values survive reload. Other toggles covered by pipeline tests |
| E15 | Remove sample data | Everything created is gone, nothing else touched | ✅ 2026-11-20: removes exactly the sample items; leftovers banner works |
| E16 | Unlink the dev item | Promise shows "No link" and stops alerting | ⬜ not run live (covered by pipeline test) |
| E17 | Install on a plain site (Jira only, no service space) | Installs; explains what's missing | ✅ 2026-11-21: installs cleanly; sample card says a service space is needed; Ask Rovo hidden without Rovo |
| E18 | Judge path: install link on a second site with JSM Free, a team-managed service space and a team-managed Scrum space (the defaults a judge gets) | Install page shows vendor, privacy, permissions; sample loads with sprints and releases; the README script works | ✅ 2026-11-23 (production 2.1.0+): install link ✅; sample with Sprint 14/15 + v2.3/v2.4 ✅ (bug 14 fixed); README steps 3–5: On track → move DEV-6 to Sprint 15 → At risk in ~20 s with reason and "moved by", internal note, dev heads-up ✅; Draft update → sent, re-promised for the suggested date, old promise replaced ✅; portal Fix progress on the new "Modern" help center ✅. No Rovo on this site, so Ask Rovo is hidden (correct) |

## Bugs found by live testing (2026-11-20), all fixed with a regression test or guard
1. "Report a bug" request type has no description field → sample failed. Now only sends fields the type has.
2. Site admins may lack "delete work items" in a space → cleanup failed. Now deletes as the app, sweeps leftovers by label, shows a "Remove leftovers" button.
3. Board lookup needed `read:project:jira` → sample had no sprints. Scope added; errors now logged.
4. Panel content overflowed Jira's narrow right column → buttons now wrap.
5. Second slip within 10 minutes was not alerted (guard keyed on risk level). Now keyed on the exact transition. Test added.
6. The new guard key used a character Forge storage rejects → alert silently skipped. Keys are sanitised; the fake storage now enforces Forge's key rules. Test added.
7. Detection skipped replies by the reporter; in the sample the reporter is the agent. Now skips customer accounts (account type). Fake Jira returns account types.
8. "Moved from Sprint 14 to Sprint 15" lacked the person's name when Jira omits it. Name is now looked up.

## Bugs found by live testing (2026-11-21)
9. Text fields in forms dropped fast typing (UI Kit round-trips each keystroke; a controlled `value` overwrote it). All text fields are now uncontrolled.
10. New promises defaulted the customer to the reporter, even when the request already had a promise naming the customer. Kept now reuses that name. Tests added.
11. The date picker showed a confusing example date ("2/18/1993"). Now says "Select the date you gave".
12. Titles were shown twice on the queue page and settings page. Removed the extra heading.
13. On a site without a service space, the sample card was a dead end (empty lists, disabled button). It now explains what to add.
14. Team-managed Scrum spaces got no sample sprints. Jira reports their board as type "simple", not "scrum", and Kept only looked for "scrum". Kept now asks each "simple" board for its sprints (Kanban boards answer "does not support sprints"). The sample card tip now says what to try when there are no sprints (move release v2.4). Tests added (`test/jira/projects.test.ts`).

## Fixed after judge review #1 (2026-11-21)
- The Promises page and Rovo now show only promises from spaces the person can browse. Rovo checks that the person can open a developer work item before describing it. Tests added.
- The customer draft no longer greets the agent as the customer (sample or self-raised requests).
- Rovo "find promises in replies" skipped every reply written by the reporter. It now skips only customer accounts, like the comment trigger. Test added.
- Rovo refuses to send customer messages containing internal details (work item keys, sprint, backlog). Test added.
- Customer wording: drafts no longer claim "the date has moved" when there was never a plan; the portal no longer says "planned a fix" for unplanned work.
- Portal: shows nothing when turned off or not allowed, says "No engineering work is linked" only when that's true, and shows a real error when it fails to load.
- Promises page: "Due in 7 days" includes day 7 (same as Rovo); a "Spotted in replies" tile; the kept-rate hint never says "none closed" next to 0%; Status sorts by severity; queue page empty state points to Apps → Kept.
- Request panel: readable labels for closed promises, Withdraw asks first, a new date no longer wipes the agent's edits, and no "None" badge on requests without promises.
- Sample card links say which customer each request is for.
