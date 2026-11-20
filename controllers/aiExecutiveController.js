const { z } = require('zod');
const aiExecutiveNarrativeService = require('../services/aiExecutiveNarrativeService');

const executiveQuerySchema = z.object({
  range: z.enum(['7d', '30d', '90d'], {
    errorMap: () => ({ message: 'Range must be one of: 7d, 30d, 90d' }),
  }).default('30d'),
  department: z.string().trim().min(1).default('all'),
  refresh: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default('false')
    .transform((val) => val === true || val === 'true'),
});

/**
 * GET /api/ai/executive-insights
 * Parameters: range (7d|30d|90d), department (string|'all'), refresh (boolean)
 * Access: Owner and Admin only.
 */
async function getExecutiveInsights(req, res) {
  // Validate query params with Zod without reassigning req.query (Express 5 safe)
  const parseResult = executiveQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    const errorMessages = parseResult.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    return res.status(400).json({
      success: false,
      error: `Invalid query parameters: ${errorMessages}`,
    });
  }

  const validatedQuery = parseResult.data;
  req.validatedQuery = validatedQuery;

  // Set Cache-Control header
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    const result = await aiExecutiveNarrativeService.getExecutiveRadar({
      user: req.user,
      range: validatedQuery.range,
      department: validatedQuery.department,
      refresh: validatedQuery.refresh,
    });

    return res.status(200).json({
      success: true,
      data: {
        metrics: result.metrics,
        narrative: result.narrative,
        meta: {
          range: result.meta.range,
          department: result.meta.department,
          generatedAt: result.meta.generatedAt,
          cached: result.meta.cached,
          narrativeAvailable: result.narrativeAvailable,
          ...(result.reason ? { narrativeReason: result.reason } : {}),
          refreshThrottled: result.meta.refreshThrottled || false,
          ...(result.meta.nextRefreshAt ? { nextRefreshAt: result.meta.nextRefreshAt } : {}),
          durationMs: result.meta.durationMs,
        },
      },
    });
  } catch (err) {
    // Log companyCode only, never employee names or emails
    const company = req.user?.companyCode || 'UNKNOWN';
    console.error(`[AI Executive Radar Error] [company: ${company}]`, err.message);

    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred while processing executive insights. Please try again later.',
    });
  }
}

module.exports = {
  getExecutiveInsights,
  executiveQuerySchema,
};
