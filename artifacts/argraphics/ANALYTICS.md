# Photo-review outcome analytics

## Collector connection

These events use **Replit-hosted Project Analytics**, not an application-owned
Umami installation. Replit's publishing proxy injects the tracker into published
website HTML when analytics is enabled. There should therefore be **no analytics
script, collector URL, website ID, or analytics environment variable in ARGraphics**.

The project analytics access check returned `authorized` during implementation.
That authorizes instrumentation; it does not establish that the publishing
toggle is enabled or prove production delivery.

Authoritative setup instructions:

- `.local/skills/project-analytics/SKILL.md`, “How Project Analytics Works”:
  Replit injects Umami through the deployment proxy; app code must not configure
  or load it.
- [Replit Project Analytics](https://docs.replit.com/features/publishing/project-analytics):
  enable analytics in Publishing before publishing or republishing.

This fork does not publish. After merging, enable analytics in Publishing settings
and publish or republish the main app to collect these events. Development and
deployments without enabled analytics intentionally do not collect them.

## Event contract

| Description | Event name | `cutout_source` |
| --- | --- | --- |
| Cleanup response confirms a saved ready cutout | `photo_cleanup_saved` | `new` |
| Ready cutout first restored during a studio opening | `photo_cutout_resumed` | `resumed` |
| Approved cutout accepted by the generation endpoint | `photo_cutout_sent_to_generation` | `new` or `resumed` |
| Explicit retake/reset action | `photo_retake` | `new`, `resumed`, or `not_ready` |

`new` means the cleanup returned successfully in this studio opening. `resumed`
means the cutout came from saved state instead. A draft first observed processing
and later ready through polling does not produce a resume event. Repeated data
refreshes do not produce additional resume events; reopening the studio is a new
review visit.

Only fixed labels are sent. Draft IDs are used for in-memory deduplication only.
No owner identifiers, drink names, images, or photo paths are sent as event data.
The wrapper handles missing trackers, synchronous failures, and rejected promises
without blocking the cleanup or generation flows. Approval guards and request
payloads are unchanged.

## Verification and limits

The photo-review unit tests cover deduplication, source labels, privacy, failed
cleanup responses, and unchanged cleanup requests/results under tracker failures.
These deliberately use a controlled tracker and do not assert production delivery.
Live delivery requires a merged, analytics-enabled published deployment; verify
the four events in its Growth pane using controlled cleanup/generation responses
to avoid paid provider calls.

Browser counts are not billing totals. Closing the browser before a successful
cleanup response, blocking analytics, or disabling tracking can omit events.
Use resumed-generation activity to understand reuse, not to claim exact dollars
saved or owner-level conversion rates.
