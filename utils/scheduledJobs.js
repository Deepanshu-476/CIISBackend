// Several backend instances (web API, app API, ...) can share one database. Cron jobs must run in only one
// of them, otherwise reminders, overdue sweeps and emails run once per instance. Set
// DISABLE_SCHEDULED_JOBS=true on every instance except the one that should run them.
const scheduledJobsEnabled = () => String(process.env.DISABLE_SCHEDULED_JOBS || '').toLowerCase() !== 'true';

module.exports = { scheduledJobsEnabled };
