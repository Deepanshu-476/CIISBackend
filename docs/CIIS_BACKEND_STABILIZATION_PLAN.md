# CIIS Backend — Stabilization Plan

This document defines the backend work required before expanding CIIS Network further.

## P0 — Security

- Remove fixed/bypass OTP acceptance from production authentication.
- Rotate any exposed credentials/secrets and invalidate affected sessions.
- Remove sensitive employee/client files from public static serving paths.
- Enforce authorization on every document download/view endpoint.
- Add explicit tenant/company scoping to every business-data query.
- Add auditable privileged-access logs for SuperAdmin access to sensitive data.
- Add rate limits and abuse protection to auth, OTP, password reset, file upload, chat/call and high-cost endpoints.
- Add security headers and production-safe CORS/origin policy verification tests.

## P1 — Tenant and authorization core

Create one reusable authorization layer that can answer:

- current company/tenant
- branch scope
- department scope
- job role/company role
- page/module entitlement
- owner/super-admin privilege
- client/employee relationship

Controllers should not re-implement tenant/role checks independently.

## P2 — Event engine

Introduce a normalized event bus/service for product events. Initial events:

- company.created
- company.setup.step_completed
- employee.invited
- employee.joined
- task.assigned
- task.started
- task.completed
- task.reopened
- project.updated
- leave.requested
- leave.approved
- attendance.late
- meeting.created
- client.feedback_received
- payment.received
- support.ticket_created

Consumers may create notifications, push, email, chat system messages, activity timeline entries, SuperAdmin metrics and performance inputs.

Existing `systemNotificationService` should become a consumer/output layer rather than being called ad hoc by every module.

## P3 — Company setup state

Persist onboarding as a durable setup profile with:

- step key
- status
- completion percentage
- started/completed timestamps
- actor
- validation errors
- skipped reason
- last activity

SuperAdmin needs an API returning setup progress, blockers and next recommended action for every company.

## P4 — Company 360 read model

Build a server-side Company 360 summary/read model that can return safely aggregated metrics without loading entire operational collections on every request.

Recommended sections:

- company identity and subscription
- setup progress
- employee/user adoption
- attendance health
- tasks/projects health
- clients/projects activity
- support status
- feature adoption
- notification/push health
- risk flags
- opportunity/recommendation flags

## P5 — Employee performance facts

Store factual performance signals separately from final scores. Example signals:

- task assigned/start/submit/complete timestamps
- due date adherence
- reopen count
- blocked dependency duration
- attendance punctuality
- approved/unapproved absences
- manager/client feedback
- collaboration/activity signals

Scoring must be versioned, role-aware and explainable. Do not persist an opaque percentage without its score components and source period.

## P6 — Data access and privacy

- Default SuperAdmin views to aggregated operational data.
- Sensitive personal data requires explicit privileged access and audit logging.
- Record who viewed/exported sensitive data, when, reason and company.
- Add retention/deletion policy hooks for employee documents and account closure.
- Terms acceptance should be versioned and timestamped, but must not replace access control.

## P7 — Reliability

- Standard API error envelope.
- Request IDs/correlation IDs.
- Structured logs without secrets/PII.
- Health/readiness endpoints for DB, Redis/queues, push and background workers.
- Idempotency for retryable write actions where duplicate creation is harmful.
- Background jobs for slow notification/email/report work.
- Retry with backoff and dead-letter visibility for failed jobs.

## P8 — Test gate

Minimum required automated suites:

- auth and OTP
- tenant isolation
- permissions
- employee document access
- company setup progression
- task lifecycle
- attendance and leave
- payroll calculations
- notifications and push dispatch rules
- chat/group system events
- client portal isolation
- SuperAdmin privileged access audit

Production deployment should be blocked when these suites fail.
