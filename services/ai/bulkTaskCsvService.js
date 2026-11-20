const { parse } = require('csv-parse/sync');
const mongoose = require('mongoose');
const Task = require('../../HR-CDS/models/Task');
const User = require('../../models/User');
const { parseTaskCheckpoints, createActivityLog, getRequestCompanyCode } = require('../../HR-CDS/controllers/taskHelper');
const { normalizeTaskRecurrenceFields, validateRecurrenceSettings } = require('../../HR-CDS/utils/taskRecurrence');
const { generateRecurringOccurrences } = require('../../HR-CDS/cron/recurringTasks');

/**
 * Normalizes column header strings for resilient matching.
 */
function normalizeHeader(col) {
  return String(col || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-\/\\.]+/g, '');
}

/**
 * Fuzzy header matcher mapping common synonyms to canonical fields.
 */
function mapRowHeaders(rawRow) {
  const mapped = {
    title: '',
    description: '',
    assignee: '',
    dueDate: '',
    dueTime: '',
    priority: 'medium',
    repeatPattern: 'none',
    repeatDays: '',
    repeatEndDate: '',
    checkpoints: '',
    fileUrl: '',
  };

  for (const [key, val] of Object.entries(rawRow)) {
    const norm = normalizeHeader(key);
    const cleanVal = typeof val === 'string' ? val.trim() : (val !== null && val !== undefined ? String(val).trim() : '');

    if (norm.includes('title') || norm.includes('task') || norm.includes('naam') || norm.includes('heading')) {
      if (!mapped.title) mapped.title = cleanVal;
    } else if (norm.includes('desc') || norm.includes('detail') || norm.includes('vivran') || norm.includes('info')) {
      mapped.description = cleanVal;
    } else if (norm.includes('assign') || norm.includes('member') || norm === 'user' || norm === 'email') {
      mapped.assignee = cleanVal;
    } else if (norm.includes('repeat') || norm.includes('recur')) {
      if (norm.includes('day')) {
        mapped.repeatDays = cleanVal;
      } else if (norm.includes('end') || norm.includes('until')) {
        mapped.repeatEndDate = cleanVal;
      } else {
        mapped.repeatPattern = cleanVal.toLowerCase();
      }
    } else if (['days', 'recurringdays'].includes(norm)) {
      mapped.repeatDays = cleanVal;
    } else if (norm.includes('due') || norm.includes('date') || norm.includes('tarikh') || norm.includes('deadline')) {
      if (norm.includes('time') || norm.includes('samay')) {
        mapped.dueTime = cleanVal;
      } else {
        mapped.dueDate = cleanVal;
      }
    } else if (norm.includes('time') || norm.includes('samay')) {
      mapped.dueTime = cleanVal;
    } else if (norm.includes('prio') || norm.includes('prathmikta')) {
      mapped.priority = cleanVal.toLowerCase();
    } else if (norm.includes('check') || norm.includes('step') || norm.includes('subtask') || norm.includes('list')) {
      mapped.checkpoints = cleanVal;
    } else if (norm.includes('url') || norm.includes('link') || norm.includes('attach') || norm.includes('drive')) {
      mapped.fileUrl = cleanVal;
    }
  }

  return mapped;
}

/**
 * Parse date string into a valid JS Date.
 * Supports DD-MM-YYYY, YYYY-MM-DD, DD/MM/YYYY, etc.
 */
function parseFlexibleDate(dateStr, timeStr) {
  const now = new Date();
  if (!dateStr || dateStr.toLowerCase() === 'today' || dateStr.toLowerCase() === 'aaj') {
    dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  } else if (dateStr.toLowerCase() === 'tomorrow' || dateStr.toLowerCase() === 'kal') {
    const tm = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    dateStr = `${tm.getFullYear()}-${String(tm.getMonth() + 1).padStart(2, '0')}-${String(tm.getDate()).padStart(2, '0')}`;
  }

  // Check DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = dateStr.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  let year, month, day;
  if (dmyMatch) {
    day = parseInt(dmyMatch[1], 10);
    month = parseInt(dmyMatch[2], 10) - 1;
    year = parseInt(dmyMatch[3], 10);
  } else {
    // YYYY-MM-DD
    const ymdMatch = dateStr.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
    if (ymdMatch) {
      year = parseInt(ymdMatch[1], 10);
      month = parseInt(ymdMatch[2], 10) - 1;
      day = parseInt(ymdMatch[3], 10);
    } else {
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        year = parsed.getFullYear();
        month = parsed.getMonth();
        day = parsed.getDate();
      } else {
        // Fallback to today
        year = now.getFullYear();
        month = now.getMonth();
        day = now.getDate();
      }
    }
  }

  let hours = 18;
  let minutes = 0;
  if (timeStr) {
    const cleanTime = String(timeStr).trim().toLowerCase();
    const timeMatch = cleanTime.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|p\.m\.|a\.m\.)?$/i);
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const meridiem = (timeMatch[3] || '').replace(/\./g, '').toLowerCase();
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
      if (!meridiem && hours >= 1 && hours <= 7) hours += 12;
    }
  }

  return new Date(year, month, day, hours, minutes, 0, 0);
}

/**
 * Parses CSV text or Buffer, validates mandatory fields, resolves assignees,
 * and partitions rows into validTasks and invalidTasks.
 */
async function parseBulkTasksCsv(input, taskType = 'self', companyId = null, companyUsers = null, filename = '') {
  let records = [];

  const isBuffer = Buffer.isBuffer(input);
  const isZipMagic = isBuffer && input.length >= 4 && input[0] === 0x50 && input[1] === 0x4B && input[2] === 0x03 && input[3] === 0x04;
  const isExcelExt = typeof filename === 'string' && /\.(xlsx|xls)$/i.test(filename);
  const isExcel = isZipMagic || isExcelExt;

  if (isExcel && isBuffer) {
    try {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(input);
      const worksheet = workbook.worksheets[0];
      if (worksheet) {
        let headers = [];
        worksheet.eachRow((row, rowNumber) => {
          const values = Array.isArray(row.values) ? row.values.slice(1) : [];
          if (rowNumber === 1) {
            headers = values.map(v => (v !== null && v !== undefined ? String(v).trim() : ''));
          } else {
            const rowObj = {};
            let hasAnyVal = false;
            headers.forEach((h, colIdx) => {
              if (!h) return;
              const cellVal = values[colIdx];
              let strVal = '';
              if (cellVal !== null && cellVal !== undefined) {
                if (typeof cellVal === 'object') {
                  if (cellVal instanceof Date) {
                    strVal = cellVal.toISOString().split('T')[0];
                  } else if (cellVal.text) {
                    strVal = String(cellVal.text).trim();
                  } else if (cellVal.result !== undefined) {
                    strVal = String(cellVal.result).trim();
                  } else {
                    strVal = String(cellVal).trim();
                  }
                } else {
                  strVal = String(cellVal).trim();
                }
              }
              if (strVal) hasAnyVal = true;
              rowObj[h] = strVal;
            });
            if (hasAnyVal) {
              records.push(rowObj);
            }
          }
        });
      }
    } catch (excelErr) {
      throw new Error(`Excel format reading error: ${excelErr.message}`);
    }
  } else {
    let text = '';
    if (isBuffer) {
      text = input.toString('utf8');
    } else if (typeof input === 'string') {
      text = input;
    } else {
      throw new Error('Input must be a CSV text string, Excel buffer, or Buffer');
    }

    // Strip BOM if present
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }

    try {
      records = parse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (err) {
      throw new Error(`CSV format invalid: ${err.message}`);
    }
  }

  if (!records || records.length === 0) {
    return {
      totalRows: 0,
      taskType: 'self',
      validTasks: [],
      invalidTasks: [],
      summaryMessage: 'CSV file khali hai, koi rows nahi mili.',
    };
  }

  // Auto-detect taskType if not explicitly specified ('self' or 'assigned')
  let resolvedTaskType = (taskType === 'self' || taskType === 'assigned') ? taskType : 'auto';
  if (resolvedTaskType === 'auto') {
    const hasAnyAssignee = records.some((r) => {
      const mapped = mapRowHeaders(r);
      return Boolean(mapped.assignee && mapped.assignee.trim().length > 0);
    });
    resolvedTaskType = hasAnyAssignee ? 'assigned' : 'self';
  }

  // Load active company employees for assignee mapping if assigned tasks
  let employeePool = Array.isArray(companyUsers) ? companyUsers : [];
  if (resolvedTaskType === 'assigned' && employeePool.length === 0 && companyId) {
    try {
      employeePool = await User.find({
        company: companyId,
        isActive: true,
      }).select('_id name email employeeId jobRole companyRole').lean();
    } catch (_) {}
  }

  const validTasks = [];
  const invalidTasks = [];

  records.forEach((rawRow, index) => {
    const rowNum = index + 2; // 1-based index accounting for header row
    const mapped = mapRowHeaders(rawRow);
    const missingFields = [];

    // Mandatory Field 1: Title
    if (!mapped.title || mapped.title.trim().length === 0) {
      missingFields.push({ field: 'title', label: 'Task Title' });
    }

    // Mandatory Field 2: Description (as explicitly requested)
    if (!mapped.description || mapped.description.trim().length === 0) {
      missingFields.push({ field: 'description', label: 'Task Description' });
    }

    // Mandatory Field 3 (for assigned tasks): Assignee
    let matchedAssignee = null;
    if (resolvedTaskType === 'assigned') {
      if (!mapped.assignee || mapped.assignee.trim().length === 0) {
        missingFields.push({ field: 'assignee', label: 'Assignee Name/Email' });
      } else {
        const query = mapped.assignee.toLowerCase();
        // Exact email match
        matchedAssignee = employeePool.find(e => (e.email || '').toLowerCase() === query);
        // Exact name match
        if (!matchedAssignee) {
          matchedAssignee = employeePool.find(e => (e.name || '').toLowerCase() === query);
        }
        // Partial substring match
        if (!matchedAssignee) {
          matchedAssignee = employeePool.find(e => (e.name || '').toLowerCase().includes(query) || (e.email || '').toLowerCase().includes(query));
        }

        if (!matchedAssignee) {
          missingFields.push({
            field: 'assignee',
            label: 'Assignee',
            reason: `Assignee "${mapped.assignee}" company employees mein nahi mila`,
          });
        }
      }
    }

    if (missingFields.length > 0) {
      invalidTasks.push({
        rowNum,
        rawRow,
        mapped,
        missingFields,
      });
      return;
    }

    // Normalize Defaults
    const dueDateTime = parseFlexibleDate(mapped.dueDate, mapped.dueTime);
    const safePriority = ['low', 'medium', 'high'].includes(mapped.priority) ? mapped.priority : 'medium';
    const safeRepeatPattern = ['none', 'daily', 'weekly', 'monthly', 'custom'].includes(mapped.repeatPattern)
      ? mapped.repeatPattern
      : 'none';
    const isRecurring = safeRepeatPattern !== 'none';

    let repeatDays = [];
    if (mapped.repeatDays) {
      repeatDays = mapped.repeatDays.split(/[,;]+/).map(d => d.trim()).filter(Boolean);
    }

    let recurrenceEndDate = null;
    if (mapped.repeatEndDate) {
      recurrenceEndDate = parseFlexibleDate(mapped.repeatEndDate, '23:59');
    }

    let parsedCheckpoints = [];
    if (mapped.checkpoints) {
      parsedCheckpoints = mapped.checkpoints.split(/[,;]+/).map(cp => ({ title: cp.trim(), completed: false })).filter(cp => cp.title.length > 0);
    }

    validTasks.push({
      rowNum,
      title: mapped.title,
      description: mapped.description,
      dueDateTime,
      priority: safePriority,
      isRecurring,
      repeatPattern: safeRepeatPattern,
      repeatDays,
      recurrenceEndDate,
      checkpoints: parsedCheckpoints,
      fileUrl: mapped.fileUrl || null,
      assignee: matchedAssignee ? {
        id: matchedAssignee._id,
        name: matchedAssignee.name,
        email: matchedAssignee.email,
      } : null,
      taskFor: resolvedTaskType === 'assigned' ? 'others' : 'self',
    });
  });

  return {
    totalRows: records.length,
    taskType: resolvedTaskType,
    validTasks,
    invalidTasks,
    summaryMessage: `Total ${records.length} tasks mile: ${validTasks.length} valid hain (${resolvedTaskType === 'assigned' ? 'Assigned to Team' : 'Personal Tasks'}), ${invalidTasks.length} mein details missing hain.`,
  };
}

/**
 * Creates valid tasks in batch in MongoDB, applies recurring rules,
 * emits real-time socket events, and creates activity logs.
 */
async function createBulkTasks({ companyCode, companyId, createdBy, tasks, taskType = 'self', req = null }) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { success: true, count: 0, tasks: [] };
  }

  const createdDocs = [];

  for (const t of tasks) {
    const safeStatus = 'pending';
    const assignedUserIds = taskType === 'assigned' && t.assignee?.id
      ? [t.assignee.id]
      : [createdBy];

    const statusByUser = assignedUserIds.map(uid => ({
      user: uid,
      status: safeStatus,
      updatedAt: new Date(),
    }));

    const taskPayload = {
      title: String(t.title).trim(),
      description: String(t.description || '').trim(),
      startDateTime: new Date(),
      dueDateTime: t.dueDateTime || new Date(),
      priority: t.priority || 'medium',
      companyCode,
      assignedUsers: assignedUserIds,
      createdBy,
      taskFor: taskType === 'assigned' ? 'others' : 'self',
      isRecurring: Boolean(t.isRecurring || (t.repeatPattern && t.repeatPattern !== 'none') || (Array.isArray(t.repeatDays) && t.repeatDays.length > 0)),
      repeatPattern: ['daily', 'weekly', 'monthly', 'yearly'].includes(t.repeatPattern)
        ? t.repeatPattern
        : (Array.isArray(t.repeatDays) && t.repeatDays.length > 0 ? 'daily' : 'none'),
      repeatDays: Array.isArray(t.repeatDays) ? t.repeatDays : [],
      recurringPattern: ['daily', 'weekly', 'monthly', 'yearly'].includes(t.repeatPattern)
        ? t.repeatPattern
        : (Array.isArray(t.repeatDays) && t.repeatDays.length > 0 ? 'daily' : 'none'),
      recurrenceEndDate: t.recurrenceEndDate || null,
      checkpoints: Array.isArray(t.checkpoints) ? t.checkpoints : [],
      statusByUser,
      creatorStatus: { status: safeStatus, updatedAt: new Date() },
      overallStatus: safeStatus,
      statusHistory: [{
        status: safeStatus,
        changedBy: createdBy,
        remarks: `Bulk CSV import: created with status ${safeStatus}`,
      }],
    };

    if (t.fileUrl) {
      taskPayload.files = [{
        filename: 'external_link',
        originalName: t.fileUrl,
        path: t.fileUrl,
        uploadedBy: createdBy,
      }];
    }

    const doc = await Task.create(taskPayload);

    if (doc.isRecurring) {
      try {
        await generateRecurringOccurrences(doc);
      } catch (_) {}
    }

    if (global.io) {
      try {
        assignedUserIds.forEach(uid => {
          global.io.to('user:' + String(uid)).emit('task:new', doc);
        });
      } catch (_) {}
    }

    createdDocs.push(doc);
  }

  try {
    if (req && req.user) {
      await createActivityLog(
        req.user,
        taskType === 'assigned' ? 'assigned_tasks_bulk_created' : 'self_tasks_bulk_created',
        createdDocs[0]?._id,
        `Bulk CSV import created ${createdDocs.length} tasks`,
        null,
        { count: createdDocs.length },
        req
      );
    }
  } catch (_) {}

  return {
    success: true,
    count: createdDocs.length,
    tasks: createdDocs,
  };
}

module.exports = {
  mapRowHeaders,
  parseFlexibleDate,
  parseBulkTasksCsv,
  createBulkTasks,
};
