const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  mapRowHeaders,
  parseFlexibleDate,
  parseBulkTasksCsv,
} = require('../services/ai/bulkTaskCsvService');

describe('Bulk Task CSV Parsing Service Tests', () => {
  it('1. mapRowHeaders normalizes fuzzy headers accurately', () => {
    const raw = {
      'Task Name': 'File GST',
      'Detail / Description': 'Upload to portal',
      'Assigned To': 'Shivani',
      'Due Date': '25-11-2026',
      'Time': '5:30 pm',
      'Prio': 'High',
      'Repeat Pattern': 'Weekly',
      'Days': 'Mon, Fri',
      'Repeat End Date': '31-12-2026',
      'Checklist': 'Collect docs; Verify GST',
      'Drive Link': 'https://drive.google.com/test',
    };

    const mapped = mapRowHeaders(raw);
    assert.equal(mapped.title, 'File GST');
    assert.equal(mapped.description, 'Upload to portal');
    assert.equal(mapped.assignee, 'Shivani');
    assert.equal(mapped.dueDate, '25-11-2026');
    assert.equal(mapped.dueTime, '5:30 pm');
    assert.equal(mapped.priority, 'high');
    assert.equal(mapped.repeatPattern, 'weekly');
    assert.equal(mapped.repeatDays, 'Mon, Fri');
    assert.equal(mapped.repeatEndDate, '31-12-2026');
    assert.equal(mapped.checkpoints, 'Collect docs; Verify GST');
    assert.equal(mapped.fileUrl, 'https://drive.google.com/test');
  });

  it('2. parseFlexibleDate parses DD-MM-YYYY and times correctly', () => {
    const parsed = parseFlexibleDate('25-11-2026', '04:30 pm');
    assert.equal(parsed.getFullYear(), 2026);
    assert.equal(parsed.getMonth(), 10); // Nov is 10
    assert.equal(parsed.getDate(), 25);
    assert.equal(parsed.getHours(), 16);
    assert.equal(parsed.getMinutes(), 30);
  });

  it('3. Personal tasks CSV: rejects rows missing Title or Description (Mandatory)', async () => {
    const csvContent = `Task Title,Description,Due Date,Priority
GST Filing,Complete filing by evening,25-11-2026,High
,Missing title description here,26-11-2026,Medium
Missing Desc Task,,27-11-2026,Low
Valid Task 2,Full details provided,28-11-2026,Medium`;

    const res = await parseBulkTasksCsv(csvContent, 'self');
    assert.equal(res.totalRows, 4);
    assert.equal(res.validTasks.length, 2);
    assert.equal(res.invalidTasks.length, 2);

    // Row 3 (index 1) missing title
    assert.equal(res.invalidTasks[0].rowNum, 3);
    assert.equal(res.invalidTasks[0].missingFields[0].field, 'title');

    // Row 4 (index 2) missing description
    assert.equal(res.invalidTasks[1].rowNum, 4);
    assert.equal(res.invalidTasks[1].missingFields[0].field, 'description');
  });

  it('4. Assigned tasks CSV: requires Title, Description, and valid Assignee', async () => {
    const mockUsers = [
      { _id: 'u1', name: 'Shivani Chandel', email: 'ciisshivani@gmail.com' },
      { _id: 'u2', name: 'Pallavi Kanwar', email: 'ciispallavi@gmail.com' },
    ];

    const csvContent = `Task Title,Assignee,Description,Due Date,Priority
Review Code,Shivani Chandel,Check all PRs,25-11-2026,High
Audit Accounts,Unknown User,Review balance sheet,26-11-2026,Medium
Setup Server,,Configure Nginx,27-11-2026,Low
No Description Task,ciispallavi@gmail.com,,28-11-2026,High`;

    const res = await parseBulkTasksCsv(csvContent, 'assigned', null, mockUsers);
    assert.equal(res.totalRows, 4);
    assert.equal(res.validTasks.length, 1);
    assert.equal(res.invalidTasks.length, 3);

    // Row 2 (first task) is valid
    assert.equal(res.validTasks[0].title, 'Review Code');
    assert.equal(res.validTasks[0].assignee.name, 'Shivani Chandel');

    // Row 3 (unknown user)
    assert.equal(res.invalidTasks[0].rowNum, 3);
    assert.equal(res.invalidTasks[0].missingFields[0].field, 'assignee');

    // Row 4 (missing assignee)
    assert.equal(res.invalidTasks[1].rowNum, 4);
    assert.equal(res.invalidTasks[1].missingFields[0].field, 'assignee');

    // Row 5 (missing description)
    assert.equal(res.invalidTasks[2].rowNum, 5);
    assert.equal(res.invalidTasks[2].missingFields[0].field, 'description');
  });

  it('5. Repeat settings and checkpoints parse cleanly into structured fields', async () => {
    const csvContent = `Task Title,Description,Due Date,Repeat Pattern,Repeat Days,Repeat End Date,Checkpoints
Weekly Standup,Team sync,25-11-2026,Weekly,"Mon, Wed, Fri",31-12-2026,"Status update; Blockers; Next steps"`;

    const res = await parseBulkTasksCsv(csvContent, 'self');
    assert.equal(res.validTasks.length, 1);
    const task = res.validTasks[0];
    assert.equal(task.isRecurring, true);
    assert.equal(task.repeatPattern, 'weekly');
    assert.deepEqual(task.repeatDays, ['Mon', 'Wed', 'Fri']);
    assert.equal(task.checkpoints.length, 3);
    assert.equal(task.checkpoints[0].title, 'Status update');
    assert.equal(task.checkpoints[1].title, 'Blockers');
  });

  it('6. Excel (.xlsx) binary buffer parses accurately without quote/zip errors', async () => {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tasks');
    ws.addRow(['Task Name', 'Description', 'Due Date', 'Due Time', 'Priority']);
    ws.addRow(['Excel Task 1', 'Created via ExcelJS binary', '25-11-2026', '05:00 PM', 'High']);
    ws.addRow(['Excel Task 2', 'Second row in spreadsheet', '26-11-2026', '10:00 AM', 'Medium']);
    const buf = await wb.xlsx.writeBuffer();

    const res = await parseBulkTasksCsv(buf, 'self', null, null, 'my_tasks.xlsx');
    assert.equal(res.totalRows, 2);
    assert.equal(res.validTasks.length, 2);
    assert.equal(res.invalidTasks.length, 0);
    assert.equal(res.validTasks[0].title, 'Excel Task 1');
    assert.equal(res.validTasks[0].description, 'Created via ExcelJS binary');
    assert.equal(res.validTasks[1].title, 'Excel Task 2');
  });

  it('7. Auto-detects Personal tasks (self) when no Assignee column exists', async () => {
    const csvContent = `Task Title,Description,Due Date,Priority
Prepare Taxes,Collect all invoices and submit,25-11-2026,High
Audit Balance,Verify bank statement,26-11-2026,Medium`;

    const res = await parseBulkTasksCsv(csvContent, 'auto');
    assert.equal(res.taskType, 'self');
    assert.equal(res.totalRows, 2);
    assert.equal(res.validTasks.length, 2);
    assert.equal(res.validTasks[0].taskFor, 'self');
  });

  it('8. Auto-detects Assigned tasks when Assignee column exists with values', async () => {
    const mockUsers = [
      { _id: 'u1', name: 'Shivani Chandel', email: 'ciisshivani@gmail.com' },
    ];
    const csvContent = `Task Title,Description,Assigned To,Due Date,Priority
Deploy Site,Deploy frontend build to prod,Shivani Chandel,25-11-2026,High`;

    const res = await parseBulkTasksCsv(csvContent, 'auto', null, mockUsers);
    assert.equal(res.taskType, 'assigned');
    assert.equal(res.totalRows, 1);
    assert.equal(res.validTasks.length, 1);
    assert.equal(res.validTasks[0].taskFor, 'others');
    assert.equal(res.validTasks[0].assignee.name, 'Shivani Chandel');
  });
});
