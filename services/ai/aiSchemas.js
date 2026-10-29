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

const createProjectDraftSchema = z.object({
  name: z.string().nullable().default(null).describe('Name of the project (maximum 80 characters), or null if not mentioned'),
  description: z.string().nullable().default(null).describe('Description of the project, or null if not mentioned'),
  startDate: z.string().nullable().default(null).describe('Project start date in YYYY-MM-DD format, or null if not mentioned'),
  endDate: z.string().nullable().default(null).describe('Project end date in YYYY-MM-DD format, or null if not mentioned'),
  priority: z.enum(['low', 'medium', 'high', 'Low', 'Medium', 'High']).nullable().default(null).describe('Priority: low, medium, high, or null if not specified'),
  status: z.enum(['planning', 'active', 'on hold', 'completed', 'cancelled', 'Planning', 'Active', 'On Hold', 'Completed', 'Cancelled']).nullable().default(null).describe('Status of project, or null if not specified'),
  members: z.array(z.string()).default([]).describe('Names of team members mentioned to add to project'),
});

const getSchemaForIntent = (intent = 'self_task', canAssignOthers = false) => {
  if (intent === 'create_project') {
    return createProjectDraftSchema;
  }
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
  title: z.string().nullish(),
  description: z.string().nullish(),
  checkpoints: z.array(checkpointItemSchema).nullish(),
  priority: z.string().nullish(),
  status: z.string().nullish(),
  dueDateTime: z.string().nullish(),
  dueDate: z.string().nullish(),
  projectId: z.string().nullish(),
  projectName: z.string().nullish(),
  project: z.string().nullish(),
  projectStartDate: z.any().nullish(),
  projectIdSuffix: z.string().nullish(),
  showDistinguishing: z.boolean().nullish(),
  assigneeName: z.string().nullish(),
  assigneeId: z.string().nullish(),
  assigneeLabel: z.string().nullish(),
  branchId: z.string().nullish(),
  priorityDays: z.union([z.string(), z.number()]).nullish(),
  reminder: z.boolean().nullish(),
  reminderOption: z.string().nullish(),
  repeatIntervalMinutes: z.number().nullish(),
  minutesBeforeDue: z.number().nullish(),
  customTime: z.string().nullish(),
  reminderTime: z.string().nullish(),
  reminderSettings: z.record(z.any()).nullish(),
  repeatPattern: z.string().nullish(),
  repeatDays: z.array(z.string()).nullish(),
  recurrenceEndDate: z.string().nullish(),
  attachmentsCount: z.number().nullish(),
  file: z.any().nullish(),
  pdfFile: z.any().nullish(),
  intent: z.string().nullish(),
  taskFor: z.string().nullish(),
  wantsOthers: z.boolean().nullish(),
  askCounts: z.record(z.any()).nullish(),
  skipped: z.array(z.string()).nullish(),
  asked: z.array(z.string()).nullish(),
  assignees: z.array(z.any()).nullish(),
  assignedUsers: z.array(z.any()).nullish(),
  assigneeLedger: z.array(z.any()).nullish(),
  pendingAssigneeNames: z.array(z.any()).nullish(),
  suggestedAssignee: z.any().nullish(),
  allMentionedAssignees: z.array(z.any()).nullish(),
  removedAssignees: z.array(z.any()).nullish(),
  titlePersonCandidate: z.any().nullish(),
  titlePersonHandled: z.boolean().nullish(),
  // create_project extension fields
  name: z.string().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  members: z.array(z.any()).nullish(),
  documentPdf: z.any().nullish(),
  duplicateHandled: z.boolean().nullish(),
  chainedTaskId: z.string().nullish(),
}).passthrough();

const draftInputSchema = serverSideDraftSchema;

const typedActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set'),
    field: z.string().optional(),
    value: z.any().optional(),
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
    projectId: z.string().trim().optional(),
    value: z.string().optional(),
  }),
  z.object({
    type: z.literal('cancel'),
  }),
  z.object({
    type: z.literal('reset'),
  }),
  z.object({
    type: z.literal('remove_pending_assignee'),
    name: z.string().optional(),
    value: z.any().optional(),
    assigneeId: z.string().optional(),
  }),
  z.object({
    type: z.literal('remove_assignee'),
    name: z.string().optional(),
    value: z.any().optional(),
    assigneeId: z.string().optional(),
  }),
  z.object({
    type: z.literal('keep_title_person'),
    name: z.string().optional(),
  }),
  z.object({
    type: z.literal('ask'),
    field: z.string().optional(),
  }),
  z.object({
    type: z.literal('confirm_duplicate_project_name'),
  }),
  z.object({
    type: z.literal('change_project_name'),
  }),
  z.object({
    type: z.literal('chain_task'),
    projectId: z.string().optional(),
    projectName: z.string().optional(),
    members: z.array(z.any()).optional(),
  }),
  z.object({
    type: z.literal('skip_chain_task'),
  }),
  z.object({
    type: z.literal('finish_chain'),
  }),
  z.object({
    type: z.literal('set_project_member'),
    field: z.string().optional(),
    value: z.string().optional(),
    assigneeId: z.string().optional(),
    department: z.string().optional(),
  }),
  z.object({
    type: z.literal('set_team_member'),
    field: z.string().optional(),
    value: z.string().optional(),
    assigneeId: z.string().optional(),
    department: z.string().optional(),
  }),
]);

const objectActionSchema = z.object({
  pickProject: z.object({
    projectId: z.string().trim().optional(),
  }).optional(),
});

const actionSchema = z.union([typedActionSchema, objectActionSchema]);

const pickInputSchema = z.union([
  z.object({
    assigneeId: z.string().trim().optional(),
    projectId: z.string().trim().optional(),
    pickProject: z.object({
      projectId: z.string().trim().optional(),
    }).optional(),
  }),
  z.record(z.string(), z.any()),
  z.null(),
]).optional();

const parseRequestSchema = z.object({
  message: z.string().trim().max(1000, 'Message cannot exceed 1000 characters').nullish(),
  language: z.enum(['en', 'hinglish', 'hi']).default('hinglish').transform(val => (val === 'hi' ? 'hinglish' : val)),
  draft: draftInputSchema.nullish(),
  pick: pickInputSchema.nullish(),
  action: actionSchema.nullish(),
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
