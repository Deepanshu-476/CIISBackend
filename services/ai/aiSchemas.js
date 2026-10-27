const { z } = require('zod');

const checkpointItemSchema = z.union([
  z.string(),
  z.object({
    title: z.string(),
    completed: z.boolean().optional().default(false),
  }),
]);

const taskDraftSchema = z.object({
  title: z.string().nullable().default(null).describe('Concise title for the task (maximum 80 characters), or null if not mentioned'),
  description: z.string().nullable().default(null).describe('Detailed description of the task, or null if not mentioned'),
  checkpoints: z.array(checkpointItemSchema).default([]).describe('Short list of checkpoint items, empty if none'),
  priority: z.enum(['low', 'medium', 'high']).nullable().default(null).describe('Priority of the task: low, medium, high, or null if not explicitly mentioned'),
  status: z.enum(['pending', 'in-progress', 'completed', 'approved', 'rejected', 'onhold', 'reopen', 'cancelled', 'overdue']).nullable().default(null).describe('Status of the task (pending, in-progress, completed, onhold, rejected, cancelled, overdue, reopen), or null if not specified'),
  dueDateTime: z.string().nullable().default(null).describe('Target completion timestamp in ISO-8601 format with +05:30 timezone offset, or null if missing or date-only without specific time'),
  assigneeName: z.string().nullable().default(null).describe('Name of person this task is assigned to if mentioned, or null if self-task or unassigned'),
  priorityDays: z.union([z.string(), z.number()]).nullable().default(null),
  reminder: z.boolean().nullable().default(null),
  reminderOption: z.enum(['hourly', 'halfHourly', 'oneHourBefore', 'interval', 'beforeDue', 'custom']).nullable().default(null),
  repeatIntervalMinutes: z.number().nullable().default(null).describe('Repeat reminder interval in minutes (e.g. 10 for every 10 min, 15, 30, 60)'),
  minutesBeforeDue: z.number().nullable().default(null).describe('Minutes before due time to remind (e.g. 15, 30, 45, 60)'),
  customTime: z.string().nullable().default(null).describe('Specific one-time reminder ISO datetime if requested'),
  reminderTime: z.string().nullable().default(null),
  repeatPattern: z.enum(['none', 'daily']).nullable().default(null),
  repeatDays: z.array(z.string()).default([]),
  recurrenceEndDate: z.string().nullable().default(null),
});

const selfTaskDraftSchema = taskDraftSchema.omit({ assigneeName: true });

const projectTaskDraftSchema = z.object({
  projectName: z.string().nullable().default(null).describe('Name of the project if this task is inside a project, or null if not mentioned'),
  title: z.string().nullable().default(null).describe('Concise title for the task (maximum 80 characters), or null if not mentioned'),
  description: z.string().nullable().default(null).describe('Detailed description of the task, or null if not mentioned'),
  checkpoints: z.array(checkpointItemSchema).default([]).describe('Short list of checkpoint items, empty if none'),
  priority: z.enum(['low', 'medium', 'high', 'Low', 'Medium', 'High']).nullable().default(null).describe('Priority of the task: Low, Medium, High, or null if not specified'),
  status: z.enum(['pending', 'in progress', 'completed', 'on hold', 'cancelled', 'in-progress', 'onhold']).nullable().default(null).describe('Status of the task (pending, in progress, completed, on hold, cancelled), or null if not specified'),
  dueDate: z.string().nullable().default(null).describe('Target completion date/time in ISO-8601 format with +05:30 timezone offset, or null if not mentioned'),
  dueDateTime: z.string().nullable().default(null).describe('Target completion timestamp in ISO-8601 format with +05:30 timezone offset, or null if missing'),
  assigneeName: z.string().nullable().default(null).describe('Name of project member this task is assigned to if mentioned, or null if unassigned'),
  reminder: z.boolean().nullable().default(null),
  reminderOption: z.enum(['hourly', 'halfHourly', 'oneHourBefore', 'interval', 'beforeDue', 'custom']).nullable().default(null),
  repeatIntervalMinutes: z.number().nullable().default(null).describe('Repeat reminder interval in minutes'),
  minutesBeforeDue: z.number().nullable().default(null).describe('Minutes before due time to remind'),
  customTime: z.string().nullable().default(null).describe('Specific one-time reminder ISO datetime'),
  reminderTime: z.string().nullable().default(null),
});

const getSchemaForIntent = (intent = 'self_task', canAssignOthers = false) => {
  if (intent === 'task_project') {
    return projectTaskDraftSchema;
  }
  if (intent === 'self_task' && !canAssignOthers) {
    return selfTaskDraftSchema;
  }
  return taskDraftSchema;
};

// -------------------------------------------------------------
// SERVER-SIDE DRAFT SCHEMA (NEVER SENT TO LLM)
// Contains state tracking fields: askCounts, asked, skipped, attachmentsCount, etc.
// -------------------------------------------------------------
const serverSideDraftSchema = z.object({
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  checkpoints: z.array(checkpointItemSchema).optional(),
  priority: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  dueDateTime: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  projectName: z.string().nullable().optional(),
  assigneeName: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  assigneeLabel: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  priorityDays: z.union([z.string(), z.number()]).nullable().optional(),
  reminder: z.boolean().nullable().optional(),
  reminderOption: z.string().nullable().optional(),
  repeatIntervalMinutes: z.number().nullable().optional(),
  minutesBeforeDue: z.number().nullable().optional(),
  customTime: z.string().nullable().optional(),
  reminderTime: z.string().nullable().optional(),
  reminderSettings: z.record(z.any()).nullable().optional(),
  repeatPattern: z.string().nullable().optional(),
  repeatDays: z.array(z.string()).optional(),
  recurrenceEndDate: z.string().nullable().optional(),
  attachmentsCount: z.number().optional(),
  file: z.any().optional(),
  pdfFile: z.any().optional(),
  intent: z.string().optional(),
  taskFor: z.string().optional(),
  wantsOthers: z.boolean().optional(),
  askCounts: z.record(z.number()).optional(),
  skipped: z.array(z.string()).optional(),
  asked: z.array(z.string()).optional(),
});

const draftInputSchema = serverSideDraftSchema;

const typedActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set'),
    field: z.string(),
    value: z.any(),
    assigneeId: z.string().optional(),
  }),
  z.object({
    type: z.literal('skip'),
    field: z.string().optional(),
  }),
  z.object({
    type: z.literal('skip_all'),
  }),
  z.object({
    type: z.literal('attachments'),
    count: z.number().int().min(0).default(0),
  }),
  z.object({
    type: z.literal('confirm'),
  }),
  z.object({
    type: z.literal('edit'),
    field: z.string().optional(),
  }),
  z.object({
    type: z.literal('pickProject'),
    projectId: z.string().trim().min(1, 'Project ID is required').optional(),
    value: z.string().optional(),
  }),
  z.object({
    type: z.literal('cancel'),
  }),
  z.object({
    type: z.literal('reset'),
  }),
]);

const objectActionSchema = z.object({
  pickProject: z.object({
    projectId: z.string().trim().min(1, 'Project ID is required'),
  }),
});

const actionSchema = z.union([typedActionSchema, objectActionSchema]);

const pickInputSchema = z.object({
  assigneeId: z.string().trim().min(1, 'Assignee ID is required').optional(),
  projectId: z.string().trim().min(1, 'Project ID is required').optional(),
  pickProject: z.object({
    projectId: z.string().trim().min(1, 'Project ID is required'),
  }).optional(),
}).refine(data => data.assigneeId || data.projectId || data.pickProject, {
  message: 'Either assigneeId or projectId must be provided in pick',
});

const parseRequestSchema = z.object({
  message: z.string().trim().max(1000, 'Message cannot exceed 1000 characters').optional(),
  language: z.enum(['en', 'hinglish', 'hi']).default('hinglish').transform(val => (val === 'hi' ? 'hinglish' : val)),
  draft: draftInputSchema.optional(),
  pick: pickInputSchema.optional(),
  action: actionSchema.optional(),
}).refine(data => data.message || data.action || data.pick, {
  message: 'Either message, action or pick must be provided',
});

// -------------------------------------------------------------
// EXECUTIVE RADAR NARRATIVE SCHEMA (Phase 5 CEO Insights)
// Strict schema: McKinsey-style advisory report
// -------------------------------------------------------------
const executiveNarrativeSchema = z.object({
  headline: z.string().describe('One crisp, high-impact executive headline summarizing workforce velocity and operational health'),
  keyFindings: z.array(z.object({
    title: z.string().describe('Concise title for this finding'),
    insight: z.string().describe('Analytical interpretation of the pattern'),
    evidenceRef: z.string().describe('Exact raw numbers cited as proof from the input metrics, e.g. "Overdue tasks: 34", "On-time: 93.6%"'),
  })).max(5).describe('Top 3 to 5 critical operational findings with quantitative proof'),
  criticalAlerts: z.array(z.object({
    bottleneckId: z.string().describe('Exact ID matching a bottleneck from input bottlenecks list, e.g. "dept_sla_...", "company_overdue_high"'),
    severity: z.enum(['critical', 'warning', 'info']).describe('Urgency level'),
    title: z.string().describe('Alert title'),
    action: z.string().describe('Immediate leadership intervention or corrective action required'),
  })).max(5).describe('Urgent bottlenecks requiring executive intervention'),
  workshopProposals: z.array(z.object({
    title: z.string().describe('Targeted workshop or training program title'),
    targetTeam: z.string().describe('Target department or team'),
    reason: z.string().describe('Quantitative justification based on bottlenecks or SLA lag'),
    durationHours: z.number().default(2).describe('Proposed duration in hours'),
    suggestedTopics: z.array(z.string()).default([]).describe('Concrete curriculum bullet points'),
  })).max(3).describe('1 to 3 targeted capability-building workshops'),
  next30DaysPlan: z.array(z.string()).max(5).describe('3 to 5 clear tactical milestones for leadership to track over the next 30 days'),
});

module.exports = {
  taskDraftSchema,
  selfTaskDraftSchema,
  getSchemaForIntent,
  serverSideDraftSchema,
  draftInputSchema,
  actionSchema,
  pickInputSchema,
  parseRequestSchema,
  executiveNarrativeSchema,
};
