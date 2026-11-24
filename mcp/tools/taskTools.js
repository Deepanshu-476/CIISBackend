const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const Task = require('../../HR-CDS/models/Task');
const User = require('../../models/User');
const ProjectModel = require('../../HR-CDS/models/Project');
const Project = ProjectModel.Project || ProjectModel;

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'];
const DOC_EXTS = ['.pdf', '.xlsx', '.xls', '.csv', '.docx', '.doc', '.txt'];

function parseUpdatedDueDateTime(inputStr, existingDate) {
  if (!inputStr) return null;
  const str = String(inputStr).trim();

  // If full date-time or date
  if (/\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(str)) {
    const parsed = new Date(str);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  // If time only (e.g. "7:20 pm", "19:20", "7:20pm")
  const timeMatch = str.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const meridiem = (timeMatch[3] || '').toLowerCase();

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    const base = existingDate ? new Date(existingDate) : new Date();
    base.setHours(hours, minutes, 0, 0);
    return base;
  }

  const direct = new Date(str);
  return Number.isNaN(direct.getTime()) ? null : direct;
}

/**
 * Extracts any active image from the Windows Clipboard and saves it to uploads/tasks/
 */
function extractClipboardImage(targetDir) {
  try {
    const filename = `clipboard-${Date.now()}.png`;
    const destination = path.join(targetDir, filename);
    const escapedDest = destination.replace(/\\/g, '\\\\');
    const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $img.Save('${escapedDest}', [System.Drawing.Imaging.ImageFormat]::Png); 'SAVED' } else { 'NONE' }"`;
    const res = execSync(psCmd, { timeout: 3500, encoding: 'utf8' }).trim();
    if (res.includes('SAVED') && fs.existsSync(destination) && fs.statSync(destination).size > 2000) {
      return destination;
    }
  } catch (err) {
    // If clipboard extraction fails or is empty, proceed to file discovery
  }
  return null;
}

/**
 * Searches user's system directories (Screenshots, Pictures, Desktop)
 * to automatically find the user's uploaded/pasted screenshot or image.
 * Never picks PDFs or unrelated documents for image/screenshot requests!
 */
function findRecentAttachment(query, targetDir) {
  const qStr = (query && typeof query === 'string') ? query.trim() : '';
  const lower = qStr.toLowerCase();

  // If explicit existing path was provided
  if (qStr && fs.existsSync(qStr) && fs.statSync(qStr).isFile()) {
    return path.resolve(qStr);
  }

  const isGenericScreenshot = !qStr || [
    'latest_screenshot', 'recent', 'latest', 'screenshot', 'image', 'attachment',
    'this image', 'this attachment', 'chat attachment', 'uploaded file'
  ].includes(lower);

  // 1. If looking for screenshot/image pasted in chat, try the Windows Clipboard first
  if (isGenericScreenshot && targetDir) {
    const fromClipboard = extractClipboardImage(targetDir);
    if (fromClipboard) return fromClipboard;
  }

  // 2. Screenshots directory has top priority for Windows Snipping Tool (Win+Shift+S)
  const screenshotsDir = 'C:/Users/ranak/OneDrive/Desktop/Pictures/Screenshots';
  const otherImageDirs = [
    'C:/Users/ranak/OneDrive/Desktop/Pictures',
    'C:/Users/ranak/Pictures',
    'C:/Users/ranak/OneDrive/Desktop',
    path.resolve(__dirname, '../../uploads/tasks')
  ].filter(d => fs.existsSync(d));

  // If user asked for an image or screenshot, check Screenshots folder FIRST!
  if (fs.existsSync(screenshotsDir)) {
    try {
      const files = fs.readdirSync(screenshotsDir);
      let newest = null;
      let newestTime = 0;
      for (const f of files) {
        if (IMAGE_EXTS.includes(path.extname(f).toLowerCase())) {
          const full = path.join(screenshotsDir, f);
          const stat = fs.statSync(full);
          if (stat.isFile() && stat.mtimeMs > newestTime) {
            newestTime = stat.mtimeMs;
            newest = full;
          }
        }
      }
      if (newest) return newest;
    } catch {}
  }

  // 3. If explicit filename or document requested
  if (!isGenericScreenshot) {
    const ext = path.extname(lower);
    let allowedExts = IMAGE_EXTS;
    if (DOC_EXTS.includes(ext)) {
      allowedExts = [ext];
    } else if (ext) {
      allowedExts = [ext, ...IMAGE_EXTS];
    } else {
      allowedExts = [...IMAGE_EXTS, ...DOC_EXTS];
    }

    const candidateDirs = [
      screenshotsDir,
      ...otherImageDirs,
      'C:/Users/ranak/Downloads'
    ].filter(d => fs.existsSync(d));

    const qName = path.basename(lower);
    for (const dir of candidateDirs) {
      try {
        const files = fs.readdirSync(dir);
        const match = files.find(f => f.toLowerCase() === qName || f.toLowerCase().includes(qName));
        if (match) return path.join(dir, match);
      } catch {}
    }
  }

  // 4. Fallback search across pictures/desktop (STRICTLY image files only!)
  let newestFile = null;
  let newestMtime = 0;
  for (const dir of otherImageDirs) {
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const full = path.join(dir, f);
        try {
          const stat = fs.statSync(full);
          if (stat.isFile() && IMAGE_EXTS.includes(path.extname(f).toLowerCase())) {
            if (stat.mtimeMs > newestMtime) {
              newestMtime = stat.mtimeMs;
              newestFile = full;
            }
          }
        } catch {}
      }
    } catch {}
  }

  return newestFile;
}

/**
 * Safely processes local file paths or auto-discovers recent screenshots,
 * copies them into uploads/tasks/, and returns Task.files metadata.
 */
function processAttachments(filePaths, userId) {
  if (!filePaths) return [];
  const list = Array.isArray(filePaths) ? filePaths : [filePaths];
  const processed = [];
  const targetDir = path.resolve(__dirname, '../../uploads/tasks');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  for (const rawPath of list) {
    if (!rawPath) continue;
    const resolvedPath = findRecentAttachment(rawPath, targetDir);
    if (resolvedPath && fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      // If the file is already inside targetDir (e.g. from clipboard), don't duplicate
      if (path.resolve(path.dirname(resolvedPath)) === targetDir) {
        const origName = path.basename(resolvedPath);
        processed.push({
          filename: origName,
          originalName: origName,
          path: `uploads/tasks/${origName}`,
          uploadedBy: userId,
          uploadedAt: new Date()
        });
        continue;
      }

      const origName = path.basename(resolvedPath);
      const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${origName}`;
      const destination = path.join(targetDir, uniqueName);
      try {
        fs.copyFileSync(resolvedPath, destination);
        processed.push({
          filename: uniqueName,
          originalName: origName,
          path: `uploads/tasks/${uniqueName}`,
          uploadedBy: userId,
          uploadedAt: new Date()
        });
      } catch (err) {
        console.error(`Failed to copy attachment '${resolvedPath}':`, err.message);
      }
    }
  }
  return processed;
}

/**
 * Shared helper to construct complete Task schema payload
 */
function buildTaskFields(args, targetUser, ctx, extraOverrides = {}) {
  const {
    title,
    description = '',
    dueDateTime,
    priority = 'Medium',
    status = 'pending',
    repeatPattern = 'none',
    repeatDays = [],
    repeatEndDate,
    reminder,
    checkpoints = [],
    attachmentPaths = [],
    attachments = [],
    hasAttachment = false
  } = args;

  const finalStatus = String(status || 'pending').toLowerCase();
  const isRecurring = Boolean(repeatPattern && repeatPattern !== 'none');
  const recurrenceEndDate = repeatEndDate ? new Date(repeatEndDate) : null;

  const formattedCheckpoints = Array.isArray(checkpoints)
    ? checkpoints.map(c => ({
        title: typeof c === 'string' ? c.trim() : (c.title || '').trim(),
        completed: false
      })).filter(c => c.title)
    : [];

  let reminderSettings = { enabled: false, options: [] };
  if (reminder) {
    const remLower = String(reminder).toLowerCase();
    const options = [];
    let repeatIntervalMinutes = null;

    if (remLower.includes('30') || remLower.includes('half')) {
      options.push('halfHourly', 'interval');
      repeatIntervalMinutes = 30;
    } else if (remLower.includes('hour') || remLower.includes('60')) {
      options.push('hourly', 'interval');
      repeatIntervalMinutes = 60;
    } else {
      options.push('beforeDue');
    }

    reminderSettings = {
      enabled: true,
      options,
      repeatIntervalMinutes,
      reminderTime: dueDateTime ? new Date(dueDateTime) : null
    };
  }

  const assignedUser = targetUser || ctx.user;
  const assignedName = assignedUser.name || assignedUser.email || 'User';

  let fileInputs = (Array.isArray(attachmentPaths) && attachmentPaths.length > 0) ? attachmentPaths : attachments;
  if ((!fileInputs || fileInputs.length === 0) && hasAttachment) {
    fileInputs = ['latest_screenshot'];
  }
  const files = processAttachments(fileInputs, ctx.user._id);

  return {
    companyCode: ctx.companyCode,
    company: ctx.companyId,
    title: title.trim(),
    description: description.trim(),
    assignedUsers: [assignedUser._id],
    createdBy: ctx.user._id,
    dueDateTime: dueDateTime ? new Date(dueDateTime) : new Date(Date.now() + 86400000),
    priority: String(priority || 'medium').toLowerCase(),
    overallStatus: finalStatus,
    isActive: true,
    isRecurring,
    repeatPattern: isRecurring ? repeatPattern : 'none',
    repeatDays: Array.isArray(repeatDays) ? repeatDays : [],
    recurrenceEndDate,
    reminderSettings,
    checkpoints: formattedCheckpoints,
    files,
    statusByUser: [{
      user: assignedUser._id,
      userName: assignedName,
      status: finalStatus,
      statusHistory: [{
        status: finalStatus,
        changedBy: ctx.user._id,
        changedAt: new Date()
      }]
    }],
    ...extraOverrides
  };
}

/**
 * Task Tools with RBAC enforcement, preview confirmation, and full field/attachment support
 */
const taskTools = [
  {
    name: 'preview_task',
    description: 'Generates a structured CIIS Task Preview Card with all details (Title, Assignee, Priority, Due Date/Time, Status, Repeat, Reminders, Checkpoints, Attachments) and prompts the user to Confirm / Create, Edit, or Cancel. ALWAYS call this tool first before calling create_personal_task or assign_task, unless the user explicitly requested immediate creation.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the task' },
        description: { type: 'string', description: 'Description or details' },
        taskType: { type: 'string', enum: ['self', 'assigned', 'project'], default: 'self', description: 'Type of task: self for personal, assigned for employee, project for project task' },
        assigneeNameOrEmail: { type: 'string', description: 'Target assignee if taskType is assigned' },
        dueDateTime: { type: 'string', description: 'Due date and time (e.g. "2026-11-26 19:20" or "7:20 pm")' },
        priority: { type: 'string', enum: ['Low', 'Medium', 'High'], default: 'Medium' },
        status: { type: 'string', enum: ['pending', 'in-progress', 'completed'], default: 'pending' },
        repeatPattern: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'], default: 'none' },
        repeatDays: { type: 'array', items: { type: 'string' }, description: 'Repeat days (e.g. ["Monday", "Tuesday"])' },
        repeatEndDate: { type: 'string', description: 'End date for recurring task in YYYY-MM-DD format' },
        reminder: { type: 'string', description: 'Reminder frequency (e.g. "halfHourly", "hourly", "every 30 mins")' },
        checkpoints: { type: 'array', items: { type: 'string' }, description: 'List of checkpoints or checklist items' },
        attachmentPaths: { type: 'array', items: { type: 'string' }, description: 'Local file/image paths or ["latest_screenshot"] if user pasted an image in chat' },
        hasAttachment: { type: 'boolean', description: 'Set to true if user uploaded or pasted an image in chat' }
      },
      required: ['title']
    },
    permissionCheck: () => true,
    handler: async (args, ctx) => {
      const {
        title,
        description = '—',
        taskType = 'self',
        assigneeNameOrEmail,
        dueDateTime,
        priority = 'Medium',
        status = 'pending',
        repeatPattern = 'none',
        repeatDays = [],
        repeatEndDate,
        reminder,
        checkpoints = [],
        attachmentPaths = [],
        hasAttachment = false
      } = args;

      let assigneeLabel = 'Khud ke liye (self)';
      if (taskType === 'assigned') {
        assigneeLabel = assigneeNameOrEmail || 'Unassigned';
        if (assigneeNameOrEmail) {
          const user = await User.findOne({
            companyCode: ctx.companyCode,
            $or: [
              { email: { $regex: new RegExp(`^${assigneeNameOrEmail.trim()}$`, 'i') } },
              { name: { $regex: new RegExp(assigneeNameOrEmail.trim(), 'i') } }
            ]
          }).select('name email');
          if (user) {
            assigneeLabel = `${user.name} (${user.email})`;
          }
        }
      }

      const repeatText = (repeatPattern && repeatPattern !== 'none')
        ? `${repeatPattern}${repeatDays.length > 0 ? ` on ${repeatDays.join(', ')}` : ''}${repeatEndDate ? ` until ${repeatEndDate}` : ''}`
        : 'None';

      const reminderText = reminder ? String(reminder) : 'None';
      let attachmentsText = 'None';
      if ((Array.isArray(attachmentPaths) && attachmentPaths.length > 0) || hasAttachment) {
        attachmentsText = 'Attached Image / Screenshot (Auto-attached)';
      }

      const card = [
        '┌────────────────────────────────────────────────────────┐',
        '│ 📋 CIIS TASK PREVIEW CARD                              │',
        '├────────────────────────────────────────────────────────┤',
        `│ • Title:       ${title}`,
        `│ • Type:        ${taskType === 'self' ? 'Personal Task' : 'Assigned Task'}`,
        `│ • Assignee:    ${assigneeLabel}`,
        `│ • Priority:    ${priority}`,
        `│ • Status:      ${status}`,
        `│ • Due:         ${dueDateTime || 'Not specified (will default to 24 hours)'}`,
        `│ • Repeat:      ${repeatText}`,
        `│ • Reminder:    ${reminderText}`,
        `│ • Checkpoints: ${Array.isArray(checkpoints) && checkpoints.length > 0 ? `${checkpoints.length} item(s)` : 'None'}`,
        `│ • Attachment:  ${attachmentsText}`,
        `│ • Description: ${description}`,
        '└────────────────────────────────────────────────────────┘',
        '',
        'Aapke paas 3 vikalp hain:',
        '1️⃣ Confirm / Create (Task database me create karne ke liye bolein "Confirm" ya "Haan")',
        '2️⃣ Edit (Koi bhi detail badalni ho jaise due time, priority, repeat, checkpoints)',
        '3️⃣ Cancel (Cancel karne ke liye bolein "Cancel")'
      ].join('\n');

      return {
        previewReady: true,
        previewCard: card,
        options: ['Confirm / Create', 'Edit', 'Cancel'],
        payload: {
          title,
          description,
          taskType,
          assigneeNameOrEmail,
          dueDateTime,
          priority,
          status,
          repeatPattern,
          repeatDays,
          repeatEndDate,
          reminder,
          checkpoints,
          attachmentPaths: hasAttachment ? ['latest_screenshot'] : attachmentPaths
        }
      };
    }
  },

  {
    name: 'create_personal_task',
    description: 'Creates a personal task in the database for the authenticated user. If the user attached or pasted an image in chat, set hasAttachment: true or pass attachmentPaths: ["latest_screenshot"] to auto-attach it. IMPORTANT: You should first show the preview card to the user and obtain their confirmation before calling this tool, unless they explicitly asked to create it immediately.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the task' },
        description: { type: 'string', description: 'Detailed description' },
        dueDateTime: { type: 'string', description: 'Due date and time in YYYY-MM-DD HH:mm or ISO format' },
        priority: { type: 'string', enum: ['Low', 'Medium', 'High'], default: 'Medium' },
        status: { type: 'string', enum: ['pending', 'in-progress', 'completed'], default: 'pending', description: 'Initial status of the task' },
        repeatPattern: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'], default: 'none', description: 'Recurrence frequency' },
        repeatDays: { type: 'array', items: { type: 'string' }, description: 'Days of week to repeat (e.g. ["Monday", "Tuesday"])' },
        repeatEndDate: { type: 'string', description: 'End date for recurring task in YYYY-MM-DD format' },
        reminder: { type: 'string', description: 'Reminder frequency (e.g. "halfHourly", "hourly", "every 30 mins", "beforeDue")' },
        checkpoints: { type: 'array', items: { type: 'string' }, description: 'Checkpoints or checklist items (e.g. ["demo 1", "demo 2"])' },
        attachmentPaths: { type: 'array', items: { type: 'string' }, description: 'Local file/image paths or ["latest_screenshot"]' },
        hasAttachment: { type: 'boolean', description: 'Set to true if user attached or pasted an image in chat' }
      },
      required: ['title']
    },
    permissionCheck: () => true,
    handler: async (args, ctx) => {
      const payload = buildTaskFields(args, ctx.user, ctx, {
        taskType: 'self',
        taskFor: 'self',
        creatorStatus: { status: 'pending', updatedAt: new Date() }
      });
      const task = await Task.create(payload);

      const activeStatus = task.overallStatus || args.status || 'pending';

      return {
        success: true,
        message: `Personal task '${task.title}' created successfully with status '${activeStatus}' and ${task.files?.length || 0} attachment(s)`,
        task: {
          id: task._id,
          title: task.title,
          priority: task.priority,
          status: activeStatus,
          overallStatus: activeStatus,
          dueDateTime: task.dueDateTime,
          repeatPattern: task.repeatPattern,
          repeatDays: task.repeatDays,
          repeatEndDate: task.recurrenceEndDate,
          checkpointsCount: task.checkpoints?.length || 0,
          reminderEnabled: task.reminderSettings?.enabled || false,
          attachmentsCount: task.files?.length || 0,
          attachments: (task.files || []).map(f => f.originalName)
        }
      };
    }
  },

  {
    name: 'assign_task',
    description: 'Assigns a task to another team member or employee in the database. If the user attached or pasted an image in chat, set hasAttachment: true or pass attachmentPaths: ["latest_screenshot"] to auto-attach it. IMPORTANT: You should first show the preview card to the user and obtain their confirmation before calling this tool, unless they explicitly asked to assign it immediately.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the task' },
        description: { type: 'string', description: 'Detailed description of what needs to be done' },
        assigneeNameOrEmail: { type: 'string', description: 'Name or email of the employee to assign' },
        dueDateTime: { type: 'string', description: 'Due date/time in YYYY-MM-DD HH:mm or ISO format' },
        priority: { type: 'string', enum: ['Low', 'Medium', 'High'], default: 'Medium' },
        status: { type: 'string', enum: ['pending', 'in-progress', 'completed'], default: 'pending', description: 'Initial status of the task (e.g. in-progress or pending)' },
        repeatPattern: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'], default: 'none', description: 'Recurrence frequency' },
        repeatDays: { type: 'array', items: { type: 'string' }, description: 'Days of week to repeat (e.g. ["Monday", "Tuesday"])' },
        repeatEndDate: { type: 'string', description: 'End date for recurring task in YYYY-MM-DD format' },
        reminder: { type: 'string', description: 'Reminder frequency (e.g. "halfHourly", "hourly", "every 30 mins", "beforeDue")' },
        checkpoints: { type: 'array', items: { type: 'string' }, description: 'Checkpoints or checklist items (e.g. ["demo 1", "demo 2"])' },
        projectId: { type: 'string', description: 'Optional Project ID if associated with a project' },
        attachmentPaths: { type: 'array', items: { type: 'string' }, description: 'Local file/image paths or ["latest_screenshot"]' },
        hasAttachment: { type: 'boolean', description: 'Set to true if user attached or pasted an image in chat' }
      },
      required: ['title', 'assigneeNameOrEmail']
    },
    permissionCheck: (ctx) => ctx.permissions.canAssignTeamTasks,
    handler: async (args, ctx) => {
      const { assigneeNameOrEmail, projectId } = args;
      
      const targetUser = await User.findOne({
        companyCode: ctx.companyCode,
        $or: [
          { email: { $regex: new RegExp(`^${assigneeNameOrEmail.trim()}$`, 'i') } },
          { name: { $regex: new RegExp(assigneeNameOrEmail.trim(), 'i') } }
        ]
      }).select('_id name email role');

      if (!targetUser) {
        throw new Error(`Employee matching '${assigneeNameOrEmail}' was not found in company ${ctx.companyCode}.`);
      }

      let projectRef = null;
      if (projectId) {
        projectRef = await Project.findOne({ _id: projectId, companyCode: ctx.companyCode });
      }

      const payload = buildTaskFields(args, targetUser, ctx, {
        taskType: projectRef ? 'project' : 'assigned',
        taskFor: 'others',
        project: projectRef ? projectRef._id : null,
        creatorStatus: { status: 'pending', updatedAt: new Date() }
      });

      const task = await Task.create(payload);
      const activeStatus = task.overallStatus || args.status || 'pending';

      return {
        success: true,
        message: `Task '${task.title}' assigned successfully to ${targetUser.name} (${targetUser.email}) with status '${activeStatus}' and ${task.files?.length || 0} attachment(s)`,
        task: {
          id: task._id,
          title: task.title,
          assignedTo: targetUser.name,
          priority: task.priority,
          status: activeStatus,
          overallStatus: activeStatus,
          dueDateTime: task.dueDateTime,
          repeatPattern: task.repeatPattern,
          repeatDays: task.repeatDays,
          repeatEndDate: task.recurrenceEndDate,
          checkpointsCount: task.checkpoints?.length || 0,
          reminderEnabled: task.reminderSettings?.enabled || false,
          attachmentsCount: task.files?.length || 0,
          attachments: (task.files || []).map(f => f.originalName)
        }
      };
    }
  },

  {
    name: 'create_project_task',
    description: 'Creates a task within an existing project in the database. Supports preview, repeat schedule, checkpoints, reminders, and file attachments.',
    parameters: {
      type: 'object',
      properties: {
        projectNameOrId: { type: 'string', description: 'Project Name or MongoDB ID' },
        title: { type: 'string', description: 'Title of the project task' },
        description: { type: 'string', description: 'Task description' },
        assigneeNameOrEmail: { type: 'string', description: 'Optional member to assign' },
        dueDateTime: { type: 'string', description: 'Due date/time in YYYY-MM-DD HH:mm or ISO format' },
        priority: { type: 'string', enum: ['Low', 'Medium', 'High'], default: 'Medium' },
        status: { type: 'string', enum: ['pending', 'in-progress', 'completed'], default: 'pending', description: 'Initial status of the task' },
        repeatPattern: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'], default: 'none', description: 'Recurrence frequency' },
        repeatDays: { type: 'array', items: { type: 'string' }, description: 'Days of week to repeat' },
        repeatEndDate: { type: 'string', description: 'End date for recurring task in YYYY-MM-DD format' },
        reminder: { type: 'string', description: 'Reminder frequency (e.g. "halfHourly", "hourly")' },
        checkpoints: { type: 'array', items: { type: 'string' }, description: 'Checkpoints list (e.g. ["Phase 1", "Phase 2"])' },
        attachmentPaths: { type: 'array', items: { type: 'string' }, description: 'Local file/image paths or ["latest_screenshot"]' },
        hasAttachment: { type: 'boolean', description: 'Set to true if user attached or pasted an image in chat' }
      },
      required: ['projectNameOrId', 'title']
    },
    permissionCheck: (ctx) => ctx.permissions.canAssignTeamTasks,
    handler: async (args, ctx) => {
      const { projectNameOrId, assigneeNameOrEmail } = args;
      
      const project = await Project.findOne({
        companyCode: ctx.companyCode,
        $or: [
          { _id: projectNameOrId.match(/^[0-9a-fA-F]{24}$/) ? projectNameOrId : null },
          { projectName: { $regex: new RegExp(projectNameOrId.trim(), 'i') } }
        ].filter(Boolean)
      });

      if (!project) {
        throw new Error(`Project matching '${projectNameOrId}' was not found in company ${ctx.companyCode}.`);
      }

      let assignedUser = ctx.user;
      if (assigneeNameOrEmail) {
        const found = await User.findOne({
          companyCode: ctx.companyCode,
          $or: [
            { email: { $regex: new RegExp(`^${assigneeNameOrEmail.trim()}$`, 'i') } },
            { name: { $regex: new RegExp(assigneeNameOrEmail.trim(), 'i') } }
          ]
        });
        if (found) assignedUser = found;
      }

      const isSelf = assignedUser._id.equals ? assignedUser._id.equals(ctx.user._id) : String(assignedUser._id) === String(ctx.user._id);

      const payload = buildTaskFields(args, assignedUser, ctx, {
        taskType: 'project',
        taskFor: isSelf ? 'self' : 'others',
        project: project._id,
        creatorStatus: { status: 'pending', updatedAt: new Date() }
      });

      const task = await Task.create(payload);
      const activeStatus = task.overallStatus || args.status || 'pending';

      return {
        success: true,
        message: `Task '${task.title}' created in project '${project.projectName}' with status '${activeStatus}' and ${task.files?.length || 0} attachment(s)`,
        task: {
          id: task._id,
          project: project.projectName,
          title: task.title,
          assignedTo: assignedUser.name,
          priority: task.priority,
          status: activeStatus,
          overallStatus: activeStatus,
          repeatPattern: task.repeatPattern,
          repeatDays: task.repeatDays,
          repeatEndDate: task.recurrenceEndDate,
          checkpointsCount: task.checkpoints?.length || 0,
          attachmentsCount: task.files?.length || 0,
          attachments: (task.files || []).map(f => f.originalName)
        }
      };
    }
  },

  {
    name: 'list_tasks',
    description: 'Lists tasks based on filters. Regular employees see only their tasks; Admins/Managers can view team tasks.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['my', 'all', 'completed', 'pending', 'overdue'], default: 'my' },
        limit: { type: 'number', default: 20 }
      }
    },
    permissionCheck: () => true,
    handler: async (args, ctx) => {
      const { filter = 'my', limit = 20 } = args;
      const query = { companyCode: ctx.companyCode };

      if (!ctx.permissions.isAdmin && !ctx.permissions.isManager) {
        query.assignedUsers = ctx.user._id;
      } else if (filter === 'my') {
        query.assignedUsers = ctx.user._id;
      }

      if (filter === 'completed') {
        query.status = 'completed';
      } else if (filter === 'pending') {
        query.status = { $in: ['pending', 'in-progress', 'reopen'] };
      } else if (filter === 'overdue') {
        query.status = 'overdue';
      }

      const tasks = await Task.find(query)
        .populate('assignedUsers', 'name email')
        .populate('project', 'projectName')
        .sort({ dueDateTime: 1, createdAt: -1 })
        .limit(Math.min(limit, 50))
        .lean();

      return {
        total: tasks.length,
        tasks: tasks.map(t => ({
          id: t._id,
          title: t.title,
          status: t.overallStatus || t.status || 'pending',
          overallStatus: t.overallStatus || 'pending',
          priority: t.priority,
          dueDateTime: t.dueDateTime,
          project: t.project?.projectName || 'None',
          assignedTo: t.assignedUsers?.[0]?.name || 'Self',
          isRecurring: t.isRecurring || false,
          repeatPattern: t.repeatPattern || 'none',
          repeatDays: t.repeatDays || [],
          checkpoints: (t.checkpoints || []).map(c => c.title),
          attachmentsCount: (t.files || []).length,
          attachments: (t.files || []).map(f => f.originalName)
        }))
      };
    }
  },

  {
    name: 'update_task_status',
    description: 'Updates the status of a task (e.g. to in-progress, completed, onhold).',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'MongoDB Task ID' },
        status: {
          type: 'string',
          enum: ['pending', 'in-progress', 'completed', 'onhold', 'cancelled'],
          description: 'New status for the task'
        },
        remarks: { type: 'string', description: 'Optional remarks or update notes' }
      },
      required: ['taskId', 'status']
    },
    permissionCheck: () => true,
    handler: async (args, ctx) => {
      const { taskId, status, remarks = '' } = args;
      
      const task = await Task.findOne({
        _id: taskId,
        companyCode: ctx.companyCode
      });

      if (!task) {
        throw new Error(`Task '${taskId}' not found in company ${ctx.companyCode}.`);
      }

      const isAssigned = (task.assignedUsers || []).some(u => String(u._id || u) === String(ctx.user._id));
      if (!isAssigned && !ctx.permissions.isAdmin && !ctx.permissions.isManager) {
        throw new Error('Permission Denied: You can only update tasks assigned to you.');
      }

      task.overallStatus = status;
      if (typeof task.updateUserStatus === 'function') {
        task.updateUserStatus(ctx.user._id, status, remarks);
      } else {
        task.statusByUser = task.statusByUser || [];
        const existing = task.statusByUser.find(s => String(s.user) === String(ctx.user._id));
        if (existing) {
          existing.status = status;
        } else {
          task.statusByUser.push({ user: ctx.user._id, status });
        }
      }

      await task.save();

      return {
        success: true,
        message: `Task '${task.title}' status updated to '${status}'.`,
        task: {
          id: task._id,
          title: task.title,
          status: task.overallStatus,
          overallStatus: task.overallStatus
        }
      };
    }
  },

  {
    name: 'update_task',
    description: 'Updates an existing task: due date/time, status, priority, title, description, checkpoints, or attaches files. Use this when the user asks to change or set due time (e.g. "time - 7:20 pm"), due date, priority, details, or attach files to an existing task.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'MongoDB Task ID (optional if updating recent task)' },
        taskTitle: { type: 'string', description: 'Task title to search if taskId is not known' },
        dueDateTime: { type: 'string', description: 'New due date or time (e.g. "7:20 pm", "2026-11-26 19:20")' },
        status: {
          type: 'string',
          enum: ['pending', 'in-progress', 'completed', 'onhold', 'cancelled'],
          description: 'New status for the task'
        },
        priority: {
          type: 'string',
          enum: ['Low', 'Medium', 'High'],
          description: 'New priority'
        },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        attachmentPaths: { type: 'array', items: { type: 'string' }, description: 'Local file/image paths or ["latest_screenshot"]' },
        filePath: { type: 'string', description: 'Single local file path or "latest_screenshot"' },
        hasAttachment: { type: 'boolean', description: 'Set to true if user attached or pasted an image in chat' },
        remarks: { type: 'string', description: 'Optional remarks' }
      }
    },
    permissionCheck: () => true,
    handler: async (args, ctx) => {
      const { taskId, taskTitle, dueDateTime, status, priority, title, description, attachmentPaths, filePath, hasAttachment, remarks = '' } = args;

      let task = null;
      if (taskId && taskId.match(/^[0-9a-fA-F]{24}$/)) {
        task = await Task.findOne({ _id: taskId, companyCode: ctx.companyCode });
      }

      if (!task && taskTitle) {
        task = await Task.findOne({
          companyCode: ctx.companyCode,
          title: { $regex: new RegExp(taskTitle.trim(), 'i') }
        }).sort({ createdAt: -1 });
      }

      if (!task) {
        task = await Task.findOne({ companyCode: ctx.companyCode }).sort({ createdAt: -1 });
      }

      if (!task) {
        throw new Error(`No task found to update in company ${ctx.companyCode}.`);
      }

      const isAssigned = (task.assignedUsers || []).some(u => String(u._id || u) === String(ctx.user._id));
      const isCreator = String(task.createdBy) === String(ctx.user._id);
      if (!isAssigned && !isCreator && !ctx.permissions.isAdmin && !ctx.permissions.isManager) {
        throw new Error('Permission Denied: You do not have permission to update this task.');
      }

      if (dueDateTime) {
        const parsedDate = parseUpdatedDueDateTime(dueDateTime, task.dueDateTime);
        if (parsedDate) {
          task.dueDateTime = parsedDate;
        }
      }

      if (priority) {
        task.priority = String(priority).toLowerCase();
      }

      if (title) {
        task.title = title.trim();
      }

      if (description) {
        task.description = description.trim();
      }

      if (attachmentPaths || filePath || hasAttachment) {
        let toAttach = (Array.isArray(attachmentPaths) && attachmentPaths.length > 0) ? attachmentPaths : [filePath].filter(Boolean);
        if (toAttach.length === 0 && hasAttachment) {
          toAttach = ['latest_screenshot'];
        }
        const attached = processAttachments(toAttach, ctx.user._id);
        if (attached.length > 0) {
          task.files = task.files || [];
          task.files.push(...attached);
        }
      }

      if (status) {
        task.overallStatus = status;
        if (typeof task.updateUserStatus === 'function') {
          task.updateUserStatus(ctx.user._id, status, remarks);
        } else {
          task.statusByUser = task.statusByUser || [];
          const existing = task.statusByUser.find(s => String(s.user) === String(ctx.user._id));
          if (existing) {
            existing.status = status;
          } else {
            task.statusByUser.push({ user: ctx.user._id, status });
          }
        }
      }

      await task.save();

      const activeStatus = task.overallStatus || 'pending';

      return {
        success: true,
        message: `Task '${task.title}' updated successfully. Status: ${activeStatus}, Due Date/Time: ${task.dueDateTime ? task.dueDateTime.toISOString() : 'N/A'}, Total Attachments: ${task.files?.length || 0}`,
        task: {
          id: task._id,
          title: task.title,
          status: activeStatus,
          overallStatus: activeStatus,
          priority: task.priority,
          dueDateTime: task.dueDateTime,
          attachmentsCount: task.files?.length || 0,
          attachments: (task.files || []).map(f => f.originalName)
        }
      };
    }
  },

  {
    name: 'attach_file_to_task',
    description: 'Attaches an image, screenshot, or document to an existing task. If the user attached or pasted an image in the chat without giving a file path, DO NOT ASK THE USER FOR A PATH—simply call this tool with filePath: "latest_screenshot" (or leave empty) and it will automatically find and attach the user\'s screenshot or recent image from their system.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'MongoDB Task ID (optional if taskTitle is provided)' },
        taskTitle: { type: 'string', description: 'Task title to search if taskId is not known' },
        filePath: { type: 'string', description: 'Local file path or "latest_screenshot" to automatically grab the user\'s screenshot/image', default: 'latest_screenshot' }
      }
    },
    permissionCheck: () => true,
    handler: async (args, ctx) => {
      const { taskId, taskTitle, filePath = 'latest_screenshot' } = args;
      let task = null;
      if (taskId && taskId.match(/^[0-9a-fA-F]{24}$/)) {
        task = await Task.findOne({ _id: taskId, companyCode: ctx.companyCode });
      }

      if (!task && taskTitle) {
        task = await Task.findOne({
          companyCode: ctx.companyCode,
          title: { $regex: new RegExp(taskTitle.trim(), 'i') }
        }).sort({ createdAt: -1 });
      }

      if (!task) {
        task = await Task.findOne({ companyCode: ctx.companyCode }).sort({ createdAt: -1 });
      }

      if (!task) {
        throw new Error(`Task '${taskId || taskTitle}' not found in company ${ctx.companyCode}.`);
      }

      const attached = processAttachments([filePath || 'latest_screenshot'], ctx.user._id);
      if (attached.length === 0) {
        throw new Error(`Could not find a file or recent screenshot to attach.`);
      }

      task.files = task.files || [];
      task.files.push(...attached);
      await task.save();

      return {
        success: true,
        message: `Successfully attached '${attached[0].originalName}' to task '${task.title}'.`,
        task: {
          id: task._id,
          title: task.title,
          status: task.overallStatus || 'pending',
          overallStatus: task.overallStatus || 'pending',
          totalAttachments: task.files.length,
          files: task.files.map(f => f.originalName)
        }
      };
    }
  }
];

module.exports = taskTools;
