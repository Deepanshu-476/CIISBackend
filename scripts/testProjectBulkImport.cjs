const axios = require('axios');
const ExcelJS = require('exceljs');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const COMPANY_CODE = 'TECH334753';

async function runBulkImportTests() {
  console.log('=================================================================');
  console.log('     PROJECT & TASK EXCEL BULK IMPORT TEST SUITE');
  console.log('=================================================================\n');

  const results = [];
  const report = (name, passed, details = '') => {
    results.push({ name, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${mark} | ${name}`);
    if (details) console.log(`       Details: ${details}`);
  };

  // 1. Authenticate Admin User
  let adminToken = null;
  let adminUser = null;

  try {
    const adminLoginRes = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'vansh24810@gmail.com',
      password: '0987654321',
      companyCode: COMPANY_CODE,
    });
    if (adminLoginRes.data?.success && adminLoginRes.data?.token) {
      adminToken = adminLoginRes.data.token;
      adminUser = adminLoginRes.data.user;
      report('1. Admin Authentication', true, `Logged in as ${adminUser.email} (${adminUser.name})`);
    } else {
      report('1. Admin Authentication', false, 'No token in response');
      return;
    }
  } catch (err) {
    report('1. Admin Authentication', false, err.response?.data?.message || err.message);
    return;
  }

  const client = axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });

  // 2. Test Download Sample Excel Template
  try {
    const sampleRes = await client.get('/api/projects/sample-excel', {
      responseType: 'arraybuffer',
    });

    if (sampleRes.status === 200 && sampleRes.data) {
      const buffer = Buffer.from(sampleRes.data);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      const worksheet = workbook.worksheets[0];
      const headerRow = worksheet.getRow(1);
      const headers = [];
      headerRow.eachCell((cell) => headers.push(String(cell.value).trim()));

      const hasTitle = headers.some((h) => /task\s*title/i.test(h));
      const hasAssignee = headers.some((h) => /assigned|employee/i.test(h));
      const hasDueDate = headers.some((h) => /due\s*date/i.test(h));
      const hasProjectName = headers.some((h) => /project\s*name/i.test(h));

      if (hasTitle && hasAssignee && hasDueDate && hasProjectName) {
        report('2. Download Sample Excel Template', true, `Headers verified (${headers.length} columns), total sample rows: ${worksheet.rowCount - 1}`);
      } else {
        report('2. Download Sample Excel Template', false, `Missing expected headers. Found: ${headers.join(', ')}`);
      }
    } else {
      report('2. Download Sample Excel Template', false, `Unexpected status ${sampleRes.status}`);
    }
  } catch (err) {
    report('2. Download Sample Excel Template', false, err.response?.data?.message || err.message);
  }

  // Helper to build test excel buffer
  const buildExcelBuffer = async (rows) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.columns = [
      { header: 'Project Name', key: 'projectName' },
      { header: 'Project Description', key: 'projectDescription' },
      { header: 'Project Priority', key: 'projectPriority' },
      { header: 'Project End Date', key: 'projectEndDate' },
      { header: 'Task Title*', key: 'taskTitle' },
      { header: 'Task Description', key: 'taskDescription' },
      { header: 'Assigned Employee Email or Phone*', key: 'assignedTo' },
      { header: 'Task Priority', key: 'taskPriority' },
      { header: 'Task Due Date*', key: 'taskDueDate' },
      { header: 'Checkpoints', key: 'checkpoints' },
    ];
    rows.forEach((r) => ws.addRow(r));
    return await wb.xlsx.writeBuffer();
  };

  // 3. Test Validation Errors (Missing Title, Invalid Employee, Bad Date)
  try {
    const invalidBuffer = await buildExcelBuffer([
      {
        projectName: 'Test Validation Project',
        taskTitle: '', // Missing task title!
        assignedTo: adminUser.email,
        taskDueDate: '2026-12-01',
      },
      {
        projectName: 'Test Validation Project',
        taskTitle: 'Valid Title',
        assignedTo: 'nonexistent_user_9999@randomdomain.xyz', // Unregistered user!
        taskDueDate: '2026-12-01',
      },
      {
        projectName: 'Test Validation Project',
        taskTitle: 'Another Task',
        assignedTo: adminUser.email,
        taskDueDate: 'not-a-valid-date-string', // Bad date format!
      },
    ]);

    const form = new FormData();
    form.append('file', invalidBuffer, {
      filename: 'invalid_test.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    form.append('mode', 'new');

    let validationCaught = false;
    try {
      await client.post('/api/projects/bulk-import', form, {
        headers: form.getHeaders(),
      });
    } catch (valErr) {
      if (valErr.response?.status === 422) {
        const errorData = valErr.response.data;
        const errors = errorData.errors || [];
        if (errors.length >= 3) {
          validationCaught = true;
          report(
            '3. Validation & Error Handling (HTTP 422)',
            true,
            `Successfully caught ${errors.length} row error(s): ${errors.map((e) => `Row ${e.row} [${e.field}]: ${e.error}`).join('; ')}`
          );
        } else {
          report('3. Validation & Error Handling (HTTP 422)', false, `Expected >= 3 errors, got: ${JSON.stringify(errors)}`);
        }
      } else {
        report('3. Validation & Error Handling (HTTP 422)', false, `Expected HTTP 422, got ${valErr.response?.status}: ${valErr.message}`);
      }
    }

    if (!validationCaught && !results.some((r) => r.name.includes('Validation & Error Handling'))) {
      report('3. Validation & Error Handling (HTTP 422)', false, 'Invalid data was accepted without 422 error');
    }
  } catch (err) {
    report('3. Validation & Error Handling (HTTP 422)', false, err.message);
  }

  // 4. Test Mode "new": Create New Project and Tasks Automatically
  let createdProjectId = null;
  const testProjectName = `Auto Import Project ${Date.now()}`;

  try {
    const validNewBuffer = await buildExcelBuffer([
      {
        projectName: testProjectName,
        projectDescription: 'Automated bulk project test description',
        projectPriority: 'High',
        projectEndDate: '2026-12-31',
        taskTitle: 'Auto Task 1 - Architecture',
        taskDescription: 'Setup base infrastructure',
        assignedTo: adminUser.email,
        taskPriority: 'High',
        taskDueDate: '2026-11-20',
        checkpoints: 'Step A, Step B, Step C',
      },
      {
        projectName: testProjectName,
        projectDescription: 'Automated bulk project test description',
        projectPriority: 'High',
        projectEndDate: '2026-12-31',
        taskTitle: 'Auto Task 2 - Implementation',
        taskDescription: 'Write code logic',
        assignedTo: adminUser.email,
        taskPriority: 'Medium',
        taskDueDate: '2026-11-25',
        checkpoints: 'Frontend, Backend, Tests',
      },
    ]);

    const form = new FormData();
    form.append('file', validNewBuffer, {
      filename: 'valid_new_project.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    form.append('mode', 'new');

    const res = await client.post('/api/projects/bulk-import', form, {
      headers: form.getHeaders(),
    });

    if (res.status === 201 && res.data?.success) {
      const created = res.data.createdProjects || [];
      if (created.length > 0 && created[0].taskCount === 2) {
        createdProjectId = created[0]._id;
        report(
          '4. Create New Project & Bulk Tasks (Mode: new)',
          true,
          `Project "${created[0].projectName}" created with ${created[0].taskCount} tasks (ID: ${createdProjectId})`
        );
      } else {
        report('4. Create New Project & Bulk Tasks (Mode: new)', false, `Unexpected response: ${JSON.stringify(res.data)}`);
      }
    } else {
      report('4. Create New Project & Bulk Tasks (Mode: new)', false, `Status ${res.status}: ${res.data?.message}`);
    }
  } catch (err) {
    report('4. Create New Project & Bulk Tasks (Mode: new)', false, err.response?.data?.message || err.message);
  }

  // 5. Test Mode "existing": Append Tasks to an Existing Project
  if (createdProjectId) {
    try {
      const existingBuffer = await buildExcelBuffer([
        {
          projectName: '', // Blank is fine in existing mode
          taskTitle: 'Auto Task 3 - QA Verification',
          taskDescription: 'Test endpoints and modal behavior',
          assignedTo: adminUser.email,
          taskPriority: 'Low',
          taskDueDate: '2026-12-05',
          checkpoints: 'Manual check, automated check',
        },
        {
          projectName: '',
          taskTitle: 'Auto Task 4 - Documentation',
          taskDescription: 'Document instructions and sample format',
          assignedTo: adminUser.email,
          taskPriority: 'Medium',
          taskDueDate: '2026-12-10',
          checkpoints: 'Write docs, Review docs',
        },
      ]);

      const form = new FormData();
      form.append('file', existingBuffer, {
        filename: 'append_tasks.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      form.append('mode', 'existing');
      form.append('projectId', createdProjectId);

      const res = await client.post('/api/projects/bulk-import', form, {
        headers: form.getHeaders(),
      });

      if (res.status === 200 && res.data?.success) {
        if (res.data.importedTasksCount === 2 && res.data.totalProjectTasks === 4) {
          report(
            '5. Add Tasks to Existing Project (Mode: existing)',
            true,
            `Successfully appended ${res.data.importedTasksCount} tasks into project "${res.data.projectName}". Total tasks now: ${res.data.totalProjectTasks}`
          );
        } else {
          report('5. Add Tasks to Existing Project (Mode: existing)', false, `Unexpected counts: ${JSON.stringify(res.data)}`);
        }
      } else {
        report('5. Add Tasks to Existing Project (Mode: existing)', false, `Status ${res.status}: ${res.data?.message}`);
      }
    } catch (err) {
      report('5. Add Tasks to Existing Project (Mode: existing)', false, err.response?.data?.message || err.message);
    }
  } else {
    report('5. Add Tasks to Existing Project (Mode: existing)', false, 'Skipped because step 4 project was not created');
  }

  console.log('\n=================================================================');
  const allPassed = results.every((r) => r.passed);
  console.log(`SUMMARY: ${results.filter((r) => r.passed).length}/${results.length} Tests Passed`);
  console.log('=================================================================');
  process.exit(allPassed ? 0 : 1);
}

runBulkImportTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
