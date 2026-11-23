# CRM Marketing Ads

Open **CRM → Lead Sources → Marketing Ads Integrations**. A company owner or admin needs view access to Lead Sources to open the dashboard and edit access to manage accounts, settings, and retries. The web dashboard supports desktop and mobile browsers. Existing web and native lead detail screens display the captured marketing data.

## Server setup

Run the backend on Node 22 or later and deploy the backend and web build together. Both the CRM and the provider callback and webhook URLs need to be reachable at their configured public HTTPS origins. The public API origin also needs to be reachable from the backend for the Google webhook smoke test. Set the following on the backend using the deployment's secret store. The app credentials are shared across companies. Each company authorizes its own assets through OAuth.

| Variable | Value |
| --- | --- |
| `ADS_INTEGRATION_ENCRYPTION_KEY` | Generate a 32-byte Base64 key with `openssl rand -base64 32`. Keep the same key on every backend using the CRM database and back it up in the secret store. Changing it without re-encrypting stored connection data invalidates existing credentials and queued payloads. |
| `ADS_CRM_ORIGIN` | The web origin users sign in to, for example `https://crm.example.com`. OAuth returns to the Marketing Ads page on this origin. |
| `ADS_PUBLIC_API_ORIGIN` | The public backend origin, for example `https://api.example.com`. |
| `META_APP_ID`, `META_APP_SECRET` | Meta app credentials. |
| `META_REDIRECT_URI` | Exact callback URL, for example `https://api.example.com/api/crm/marketing-ads/oauth/meta/callback`. |
| `META_WEBHOOK_VERIFY_TOKEN` | A high-entropy value shared with the Meta Webhooks configuration. |
| `META_GRAPH_API_VERSION` | Defaults to `v26.0`. |
| `META_LOGIN_CONFIG_ID` | Optional Facebook Login for Business configuration ID. |
| `META_ADDITIONAL_SCOPES` | Optional approved scopes for extra business and linked Instagram details. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Credentials from a Google Cloud Web application OAuth client. |
| `GOOGLE_REDIRECT_URI` | Exact callback URL, for example `https://api.example.com/api/crm/marketing-ads/oauth/google/callback`. |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API developer token with access to the intended Ads accounts. |
| `GOOGLE_ADS_API_VERSION` | Defaults to `v26`. |

The backend creates the ads indexes before serving traffic when the encryption key is configured. Give the backend database user index creation privileges. Existing Lead documents work directly with the optional marketing fields. Reverse proxies should pass Meta's `X-Hub-Signature-256` header and the original request body through unchanged. Exclude OAuth callback query strings and webhook bodies from proxy access logging. Verify both public endpoints after deployment.

## Meta Developer setup

1. Configure Facebook Login or Facebook Login for Business in your Meta app. Register `META_REDIRECT_URI` as a valid OAuth redirect URL.
2. Configure a **Page** webhook with callback `https://api.example.com/api/integrations/meta/webhook` and the configured verification token. Subscribe the app to the `leadgen` field.
3. Obtain the access required for `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `pages_manage_metadata`, and `leads_retrieval`. Complete App Review, Advanced Access and Business Verification as required for Pages outside app roles. If you use a Login for Business configuration, grant the relevant scopes in that configuration. Include any approved additional scopes needed to retrieve Business or linked Instagram details.
4. Give the authorizing user access to the Facebook Page and its leads. In the business's Leads Access settings, grant the app or CRM access where custom lead access is enabled.
5. In CRM, sign in, select a Page and its forms, then save. CRM subscribes that Page to the app. Use **Test Connection** and send a sample lead from the Lead Ads Testing Tool. Check **Webhook Deliveries** and **All Leads**.
6. Instagram placement uses the lead form on the selected Facebook Page. Linked Instagram account details and lead placement appear when Meta returns them. To move to a different Page, connect the new Page and then disconnect the old Page. A Page can route to one CRM company at a time.

[Meta Lead Ads guide](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/) · [Meta Lead Ads webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/)

## Google Cloud and Google Ads setup

1. Enable the Google Ads API in Google Cloud and configure the app's OAuth consent screen. Create a Web application OAuth client and register `GOOGLE_REDIRECT_URI`. Grant the app access to request `https://www.googleapis.com/auth/adwords`. For a testing consent screen, add the relevant test users. Complete the appropriate Google Cloud verification and use the required Ads developer token or project access for production accounts.
2. In CRM, connect the Google account that has access to the advertiser. Select the Google Ads customer account. Advertisers accessible through a supported manager account appear alongside directly accessible advertisers.
3. Select **Webhook Setup** on that account. Copy the account-specific URL and secret key to the Google Ads lead form asset under **Export leads from Google Ads → Other data integration options → Webhook integration**.
4. Send test data from Google Ads and check for a `test` record. CRM's **Test Webhook** also probes the public endpoint using the saved credentials. Both tests are recorded in Webhook Deliveries. Send an actual form submission to verify CRM lead creation.
5. Reconnect to replace an expired OAuth authorization while keeping the existing webhook key. After an explicit disconnect followed by reconnect, update Google Ads with the newly generated key.

[Google Ads OAuth setup](https://developers.google.com/google-ads/api/docs/oauth/overview) · [Webhook setup in Google Ads](https://support.google.com/google-ads/answer/16729613) · [Lead form webhook payloads](https://developers.google.com/google-ads/webhook/docs/implementation)

## Lead mapping and operations

- The existing Lead model stores recognized contact fields and a marketing source snapshot. Missing or unusable values stay empty. The submitting person's company goes into the Marketing Source section. The CRM company comes from the connection.
- The open **All Leads** and **My Assigned Calls** web pages refresh every 30 seconds while visible. Date filters use the CRM receipt date for an ad lead whose source form omitted the lead date. Call Workspace disables dialling for leads with a blank phone number.
- **Edit Settings** supports up to four label and question-key pairs per form, with an account-wide fallback. For Google use the webhook `column_id` and the Form ID from **Webhook Deliveries** or the form payload. For Meta select a form and use its question keys. With no matching configuration, the CRM captures the first four extra answers. Each lead keeps the display labels from import time.
- Assignment uses the configured active employee, then the least-loaded eligible employee in the selected department and/or branch. With no eligible assignment, the lead stays unassigned. The default status is `new`. Assigned leads use CRM assignment history and notifications. Company admins receive notifications for unassigned ads leads.
- The tenant, provider and external lead ID identify a delivery. Contact deduplication also checks submitted email and phone within the same company. Indian ten-digit mobile numbers can match their `+91` equivalents. Contact matches point to the existing lead and are recorded without overwriting it. Delivery tests and repeats remain visible in the log.
- Review **Webhook Deliveries** for errors. Transient failures retry up to five processing attempts. For an expired token, reconnect and use **Retry** on the failed delivery. Terminal delivery logs and encrypted payloads are retained for 30 days. Successful deliveries remain deduplicated by external lead ID as long as the corresponding CRM lead exists.
- Disconnect removes local credentials. Meta also attempts to unsubscribe the Page. Multiple connections can share the same provider-level OAuth grant, so local disconnect leaves that grant available for other connections.

## Database and APIs

| Collection or model | Change |
| --- | --- |
| `AdIntegration` | Company-scoped account settings, encrypted credentials and Google webhook keys, form mappings, routing and sync status. |
| `AdOAuthSession` | Single-use OAuth state, short-lived encrypted credentials, user and company binding, TTL cleanup. |
| `AdLeadWebhookLog` | Durable queue and tenant-scoped deliveries, duplicate counters, encrypted payloads, retry state and TTL cleanup. |
| `Lead` | Optional marketing metadata and custom answer snapshot, unique partial indexes for ads external IDs and normalized ads contact values. Existing lead fields are reused for names, contact details, source, campaign name, status and assignee. |

Management APIs under `/api/crm/marketing-ads`

- `GET /accounts` and `GET /assignment-options`
- `POST /oauth/:platform/start` and `GET /oauth/:platform/callback`
- `GET /oauth/sessions/:session`, `GET /oauth/sessions/:session/forms/:pageId` and `POST /oauth/sessions/:session/save`
- `GET /accounts/:id/forms`, `PATCH /accounts/:id`, `POST /accounts/:id/test` and `DELETE /accounts/:id`
- `GET /accounts/:id/webhook` and `POST /accounts/:id/test-webhook`
- `GET /logs` and `POST /logs/:id/retry`

Public provider callbacks

- `GET /api/integrations/meta/webhook` verifies the subscription challenge.
- `POST /api/integrations/meta/webhook` validates the signature and queues selected-form leads.
- `POST /api/integrations/google-ads/webhook/:id` checks the connection's secret key and queues submissions.

## Implementation and verification

Backend routes live in `routes/marketingAdsRoutes.js` and `routes/adWebhookRoutes.js`. Models and provider, normalization, encryption and queue services are in `models` and `services/marketingAds`. The web dashboard is in `CIIS/src/crm/admin/MarketingAds.jsx`. The **All Leads** and telecaller detail screens display marketing metadata on the web and in the native CRM.

Run `node --test tests/marketingAds.test.js` from `CIISBackend` for the integration tests. The tests use a temporary MongoDB instance and a loopback HTTP listener. They simulate provider authorization and deliveries, including five connections per provider, tenant isolation, missing fields, duplicate delivery and contacts, token expiry, refresh, retry, reconnect and disconnect. The test also checks lead filtering and assignment, call-log start and end times, callback creation, and conversion through the web CRM APIs. Real provider sign-in, permissions and account delivery need the deployment credentials and the provider checks above.
