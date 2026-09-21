# Telecaller flow

Entry: `/ciisUser/telecaller/assigned-calls`. Assign an imported or manually created lead to the logged-in user in Lead Management first.

`GET /api/crm/telecaller` returns company-scoped leads assigned to the authenticated user. `POST /api/crm/telecaller/:id/calls` saves a call with a stable client-generated ID, outcome, direction, notes and optional ISO follow-up timestamp. Authenticated agent and call time are supplied by the server.

Call history, current status and follow-up are updated atomically on the Lead document. Repeating a call ID is idempotent. Version checks reject concurrent updates rather than silently overwriting them. Notes do not alter status/follow-up or count as calls. Converted/closed leads leave active queues and reject further calls, while allowing notes.

The frontend uses these APIs instead of session-storage demo leads. Daily calculations use local dates; callback inputs are converted to ISO timestamps before saving. The dial button opens a `tel:` link; it does not verify whether a phone call connected. Today's Calls includes due callbacks/new assignments and a separate completed-call log.

Company Telecaller page enablement and authenticated assignee isolation are enforced by the API. Action-level Page Management checks remain postponed under the existing CRM testing policy; the frontend still uses page permissions to show/enable actions.

Validation: `node --test tests/telecaller.test.js` in the backend; `node --test tests/telecallerData.test.mjs` and `npm run build` in the frontend. Tests use model adapters, not real MongoDB. Authenticated browser interaction, real database persistence and deployment require separate verification. Restart the backend to load the new routes/schema.

History is embedded on each Lead, so MongoDB's document-size limit applies. Prior legacy CallLog records are not migrated into this new history.
