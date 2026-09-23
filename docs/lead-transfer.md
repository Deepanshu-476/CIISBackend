# Lead import / export

UI: `/ciisUser/crm/admin/import-export-leads`.
API prefix: `/api/crm/leads/transfer`.

## Behaviour

- Download a blank `Leads` worksheet plus a separate Instructions worksheet. The template has the same 14 headers used by export. Phone columns are Text; examples exist only in Instructions.
- Upload `.xlsx` or UTF-8 `.csv` (5 MB, 1,000 data rows). XLSX must have a `Leads` sheet. Headers can be reordered but cannot be missing, duplicated or unknown. Formula cells are rejected, never executed. XLSX archive expansion is bounded to 25 MB / 500 entries.
- Preview performs server-side Add Lead validation, active company Source/Type name resolution, and normalized phone/email duplicate checks. No leads are created by preview. Previews expire after 24 hours; a partial TTL index removes only unused previews.
- Confirm sends only the saved preview ID. The server revalidates the saved rows, serializes imports within each company, skips duplicates, and creates New, Unassigned leads with authenticated ownership. The client cannot supply tenant, creator or lead status.
- Every row has a stable generated lead ID. Retry the same batch after an interrupted request to reconcile uncertain writes. A company lease prevents concurrent imports from this feature. If the process crashes, the lease expires after five minutes; the original importing user can resume from History. Do not upload a second copy to resume.
- Reports identify invalid/skipped rows. History is persisted in `LeadImportBatch`; `LeadImportLock` holds company leases. Successful/interrupted history does not expire with its original preview. History is paginated in groups of 20. Detailed results and resume are restricted to the importing user.
- Export applies current assignment/user and inclusive Lead Date filters. Weeks run Monday-Sunday. Date-only values are compared as `YYYY-MM-DD`. Excel/CSV exports stream all matching records and neutralize formula-like cell text.

## API

`GET /options`, `GET /template`, `POST /preview` (multipart `file`),
`POST /imports/:id/confirm`, `GET /imports/:id`, `GET /imports/:id/errors`,
`GET /history?page=1`, `GET /export/count`, `GET /export`.

Export query: `assignment=all|assigned|unassigned`, optional `userId`,
`dateMode=all|date|week|month|range`, `date`, `month`, `from`, `to`, `format=xlsx|csv`.

All routes inherit the CRM authentication and company page-access policy. Existing CRM action-level permission checks are deliberately postponed in the surrounding application; this feature does not change that policy. Duplicate protection serializes imports from this feature; other legacy lead-creation endpoints retain their existing behaviour.

## Verification

Run `node --test tests/leadTransfer.test.js tests/leadTransferRoutes.test.js` and the frontend `npm run build`.
Run `node --test tests/leadTransferUI.test.mjs` from the frontend directory for upload-in-progress protection, stale export-count responses, failed count refreshes, incomplete date filters, and history/upload state isolation.
Tests use in-memory model adapters and ephemeral local HTTP servers, without MongoDB/customer data. They cover template round trips, malformed inputs, CSV and Excel parsing, dates, validation, duplicates, retry reconciliation, tenant/owner checks, endpoint authentication/page access, all-record exports, reports, history queries, and existing Add Lead/assignment behaviour.

Baseline before implementation: 37 of 40 existing tests passed. Three existing `crmLead.test.js` failures use an international formatted phone while the current validator requires exactly ten digits. Those tests and validation were preserved.

Actual MongoDB persistence/index creation, multi-process crash recovery, and authenticated browser/mobile layout still require staging verification. No production import or outbound email is part of this verification.

## Audit fixes (17 September 2026)

- File selection and drag/drop cannot replace an upload while preview or confirm is running.
- Export count requests ignore superseded results and errors, clear previous counts on refresh, and run independently of file actions.
- Skipped duplicate rows do not reserve otherwise unused phone/email values and incorrectly exclude later valid rows.
- Opening a saved result clears the previously selected upload; partial/completed results and empty-file errors have accurate labels.
- Optional field values may be blank, but all template column headers must remain present.
