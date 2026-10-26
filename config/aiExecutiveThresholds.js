/**
 * AI Executive Radar Metric & Bottleneck Thresholds
 * Exports a frozen object with safe default values overridable via process.env.
 */

function numFromEnv(key, defaultVal) {
  const val = process.env[key];
  if (val !== undefined && val !== null && String(val).trim() !== '') {
    const parsed = Number(val);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return defaultVal;
}

const thresholds = {
  // SLA & Task thresholds
  DEPT_ON_TIME_MIN_PCT: numFromEnv('AI_THRESH_DEPT_ON_TIME_MIN_PCT', 70), // minimum acceptable on-time % per department
  COMPANY_OVERDUE_MAX_PCT: numFromEnv('AI_THRESH_COMPANY_OVERDUE_MAX_PCT', 10), // maximum tolerable live overdue tasks % (live overdue / cohort size * 100)
  REOPEN_RATE_MAX_PCT: numFromEnv('AI_THRESH_REOPEN_RATE_MAX_PCT', 15),   // maximum acceptable task reopen rate %
  MODULE_DELAY_RATIO_MAX: numFromEnv('AI_THRESH_MODULE_DELAY_RATIO_MAX', 1.5), // multiplier above average delay for module alerts

  // Minimum sample guards for ratio-based bottleneck rules
  MIN_COHORT_FOR_DEPT_RULES: numFromEnv('AI_THRESH_MIN_COHORT_FOR_DEPT_RULES', 10), // minimum cohort tasks to evaluate department rules
  MIN_LEADS_FOR_FUNNEL_RULES: numFromEnv('AI_THRESH_MIN_LEADS_FOR_FUNNEL_RULES', 20), // minimum leads to evaluate funnel conversion rules
  MIN_ATTENDANCE_RECORDS_FOR_RULES: numFromEnv('AI_THRESH_MIN_ATTENDANCE_RECORDS_FOR_RULES', 20), // minimum attendance records to evaluate late arrival rules

  // Attendance thresholds
  LATE_ARRIVAL_MAX_PCT: numFromEnv('AI_THRESH_LATE_ARRIVAL_MAX_PCT', 20), // maximum acceptable late-arrival rate %

  // CRM / Telecaller thresholds
  TELECALLER_CONVERSION_MIN_PCT: numFromEnv('AI_THRESH_TELECALLER_CONVERSION_MIN_PCT', 5), // minimum conversion %
  MIN_LEADS_FOR_PERFORMER: numFromEnv('AI_THRESH_MIN_LEADS_FOR_PERFORMER', 10), // minimum leads to rank top/bottom telecaller

  // Team load imbalance
  WORKLOAD_IMBALANCE_RATIO: numFromEnv('AI_THRESH_WORKLOAD_IMBALANCE_RATIO', 3), // top assignee has >= 3x average assigned

  // Caching configuration
  CACHE_TTL_MS: numFromEnv('AI_EXECUTIVE_CACHE_TTL_MS', 10 * 60 * 1000), // 10 minutes TTL
  MAX_CACHE_ENTRIES: numFromEnv('AI_EXECUTIVE_MAX_CACHE_ENTRIES', 200),  // max cache size before oldest eviction
};

module.exports = Object.freeze(thresholds);
