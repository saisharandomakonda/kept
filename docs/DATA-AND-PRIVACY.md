# Kept: data and privacy

**In short:** Kept runs entirely on Atlassian's Forge platform. It makes **no calls outside your Atlassian site**, uses **no AI service** other than your site's Rovo, and stores only what it needs to follow promises.

## What Kept stores (Forge storage, inside your Atlassian cloud)

For each promise:
- the request key and space;
- the linked developer work item key;
- the customer name, as written by the agent (an organization or a name);
- the promised date and the sentence that was promised (up to 500 characters);
- the current risk, its reasons, and the expected date;
- a short history (made, slipped, customer told, re-promised, closed), with the Atlassian account ID of the agent who acted.

Kept also stores:
- its settings;
- short-lived keys that stop duplicate alerts (they expire after 10 minutes);
- while a sample scenario exists, the list of items it created, so they can be removed.

Kept does **not** store request descriptions, comments, attachments, emails or customer contact details.

## What Kept writes to Jira

| What | Where | Who sees it |
|---|---|---|
| Internal note when a promise gets worse | The service request | Agents only (internal comment). Can be turned off |
| Heads-up naming the affected customer | The developer's work item | People who can see that work item. Can be turned off |
| A small summary property (`kept`): risk, earliest promise date, counts | Request and work item | Used for JQL and badges |
| A public reply to the customer | The service request | The customer, **only when an agent clicks Send**, posted as that agent |
| Sample scenario items (labelled `kept-sample`) | Spaces chosen by an admin | Removed with **Remove sample data** |

## Who sees what inside Jira

- The **Promises page** and the **Rovo agent** show only promises from spaces the person can browse.
- The **request panel** shows to people who can open that request.
- The **developer panel** and the heads-up note tell people who can see a developer work item which customers are waiting on it, and their promised dates. This is on purpose: developers should know who their change affects. Turn off the heads-up in settings if you don't want that.

## What customers see on the portal

Only a stage (Reported, Confirmed, In development, Fixed, Released) and one sentence, plus the planned date if an admin turns that on (it is off by default). No work item keys, sprint names, people or internal notes. Kept first checks, as the viewing customer, that they can see the request.

## Permissions (scopes) and why

| Scope | Why |
|---|---|
| `read:jira-work` | Read requests, linked work items, sprints, releases and comments |
| `write:jira-work` | Internal notes, heads-ups, summary properties, sample items |
| `read:jira-user` | Show who made a change; tell agent replies from customer replies |
| `manage:jira-project` | Sample scenario: create and remove releases |
| `read:servicedesk-request`, `write:servicedesk-request` | Portal access check; create sample requests |
| `read/write/delete:sprint:jira-software`, `read/write:board-scope:jira-software`, `read:project:jira` | Read sprint plans; create and remove the sample sprints |
| `storage:app` | Store promises and settings |

## AI

- The **Rovo agent** runs in your site's Rovo, under Atlassian's terms, and only acts through Kept's actions. Actions that change data (track a promise, post a reply) ask the user to confirm first.
- Risk is decided by rules, not AI. Promise detection in replies is rules-based (a date parser), so it uses no AI credits.

## Removing data

- **Remove sample data** deletes everything the sample created.
- Withdrawing a promise stops all alerts for it.
- If the app is uninstalled, its stored data is handled by Forge's standard data-retention rules. Comments and properties Kept added to work items stay in Jira, like any other comment.
