# Company plan lifecycle verification

Verified locally on 17 November 2026. Production data and deployments were not changed.

## Resulting behavior

- Platform administrators create plans with a price, whole-number duration, features, employee pages and optional admin pages.
- Registration copies the selected active plan into the company. Submitted client-side price/access overrides cannot replace it.
- Login, OTP completion, company details and the subscription dialog receive the company's real plan metadata. The company screen no longer invents a 90-day expiry or treats every free plan as a 90-day trial.
- An assigned plan with no optional admin pages does not grant every admin page. Company details and session/settings navigation remain available. The platform account retains platform controls.
- A subscription remains valid until the end of its expiry date in Asia/Kolkata. Expiry is checked on requests and socket packets; no cron or re-login is needed to enforce it.
- Expiry preserves login, navigation, existing page entitlements, viewing and passive read receipts. Mutations are rejected with `SUBSCRIPTION_EXPIRED`. Web and app action guards display the active plan catalog.
- Upgrade/Renew for company accounts displays available plans. Actual assignment/renewal remains a platform operation.
- Renewal copies the selected plan's price, duration, features and pages, clears menu caches, and unlocks the existing session. Subscription polling refreshes open-session company metadata and menu access. Renewal does not reactivate deliberately disabled employees.
- Existing subscriptions use their assigned company snapshot; changing a plan definition does not silently replace an existing company's contract. Assign/renew to apply the new definition.

## Automated verification

| Check | Result |
| --- | --- |
| Backend: `node --test --test-concurrency=1 tests/*.test.js` | 60 passed, 5 skipped, 0 failed |
| Web: `node --test tests/*.test.mjs` | 24 passed, 0 failed |
| App: `node --test tests/*.test.cjs` | 183 passed, 0 failed |
| Web: `npm run build` | Passed |
| iOS production JavaScript bundle | Passed |
| Android production JavaScript bundle | Passed |
| Git whitespace checks in all three repositories | Passed |

The seven backend lifecycle tests use a temporary local MongoDB replica set, a localhost HTTP server, and mocked registration emails. They exercise plan creation, public company registration, entitlement copying, platform-only plan operations, expired logins, all HTTP mutation methods, socket mutations, preserved viewing/sidebar pages, renewal, immediate updated menu access and inactive-plan exclusion.

The web/app dialog tests render the real guard components in a DOM harness; native primitives and API responses are mocked. They verify action blocking, continued viewing, display of created plans and renewal refresh. Native tests also exercise the production Babel action transform, shared expiry/access policy, plan duration and empty-admin-page behavior.

Existing app test fixtures were updated for current screen dependencies and the already-established Promotions/Employee Activity defaults. The generated app menu access aliases were synchronized with the web source. Temporary database tests use ports outside the OS ephemeral range to avoid local port collisions.

## Verification limits and release

The five skipped backend tests require separately running local MongoDB/Redis services for call, break, telecaller and weekly-off scenarios. They are not plan lifecycle tests.

Production JavaScript bundles validate compilation, not signed APK/IPA installation or native device interactions. Final browser and real Android/iPhone walkthroughs remain to be performed against a staging backend. In particular, check an already-open session across expiry and renewal, navigation with the company's actual role/sidebar configuration, and the plan dialog on a small screen.

Release the backend changes, web build and rebuilt mobile apps together. Existing installed app binaries will not acquire the new client guards until updated. No deployment was performed as part of this work.
