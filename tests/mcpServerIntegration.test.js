const { test } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const ApiKey = require('../models/ApiKey');
const User = require('../models/User');
const Task = require('../HR-CDS/models/Task');
const Client = require('../HR-CDS/models/Client');
const ClientPlan = require('../HR-CDS/models/ClientPlan');
const { authenticateMcpKey } = require('../mcp/auth');
const { getAvailableTools, executeTool } = require('../mcp/tools');

test('CIIS MCP Server Architecture, Security & Tool Gating Tests', async (t) => {
  await mongoose.connect(process.env.MONGO_URI);

  // 1. ApiKey model tests
  await t.test('ApiKey.generateKey creates valid ciis_live_ prefix and matching hash', () => {
    const { fullKey, keyPrefix, keyHash } = ApiKey.generateKey();
    assert.ok(fullKey.startsWith('ciis_live_'));
    assert.strictEqual(keyPrefix, fullKey.slice(0, 14));
    assert.strictEqual(ApiKey.hashKey(fullKey), keyHash);
  });

  // Fetch or setup a test company and users
  const adminUser = await User.findOne({
    $or: [
      { companyRole: /owner/i },
      { isOwner: true },
      { role: /owner|admin/i }
    ]
  }).lean();

  const regularEmployee = await User.findOne({
    companyCode: adminUser?.companyCode || 'TECH334753',
    $or: [
      { companyRole: /employee/i },
      { role: /employee/i },
      { companyRole: { $exists: false } }
    ],
    _id: { $ne: adminUser?._id }
  }).lean();

  assert.ok(adminUser, 'Admin/Owner user should exist in DB');
  assert.ok(regularEmployee, 'Regular employee user should exist in DB');

  // 2. Auth context for Admin/Owner
  const adminKeyGen = ApiKey.generateKey();
  const adminKeyDoc = await ApiKey.create({
    name: 'Admin Test Key',
    keyPrefix: adminKeyGen.keyPrefix,
    keyHash: adminKeyGen.keyHash,
    user: adminUser._id,
    company: adminUser.company,
    companyCode: adminUser.companyCode,
    role: 'owner',
    isActive: true
  });

  const adminAuth = await authenticateMcpKey(adminKeyGen.fullKey);
  assert.strictEqual(adminAuth.companyCode, adminUser.companyCode);
  assert.strictEqual(adminAuth.permissions.isOwner, true);
  assert.strictEqual(adminAuth.permissions.canCreateClientPlans, true);
  assert.strictEqual(adminAuth.permissions.canViewAllAttendance, true);

  // 3. Auth context for Regular Employee
  const empKeyGen = ApiKey.generateKey();
  const empKeyDoc = await ApiKey.create({
    name: 'Employee Test Key',
    keyPrefix: empKeyGen.keyPrefix,
    keyHash: empKeyGen.keyHash,
    user: regularEmployee._id,
    company: regularEmployee.company,
    companyCode: regularEmployee.companyCode,
    role: 'employee',
    isActive: true
  });

  const empAuth = await authenticateMcpKey(empKeyGen.fullKey);
  assert.strictEqual(empAuth.companyCode, regularEmployee.companyCode);
  assert.strictEqual(empAuth.permissions.isOwner, false);
  assert.strictEqual(empAuth.permissions.isAdmin, false);
  assert.strictEqual(empAuth.permissions.canCreateClientPlans, false);
  assert.strictEqual(empAuth.permissions.canViewAllAttendance, false);

  // 4. Dynamic Tool Gating (What ChatGPT sees)
  await t.test('Dynamic Tool Gating: Regular employee only sees permitted tools', () => {
    const empTools = getAvailableTools(empAuth);
    const empToolNames = empTools.map(t => t.name);

    // Employee tools must be present
    assert.ok(empToolNames.includes('create_personal_task'));
    assert.ok(empToolNames.includes('list_tasks'));
    assert.ok(empToolNames.includes('update_task_status'));
    assert.ok(empToolNames.includes('get_my_attendance'));

    // Admin-only tools must be COMPLETELY HIDDEN
    assert.strictEqual(empToolNames.includes('create_client_plan'), false, 'create_client_plan should be hidden from employee');
    assert.strictEqual(empToolNames.includes('get_attendance_summary'), false, 'get_attendance_summary should be hidden from employee');
    assert.strictEqual(empToolNames.includes('get_employee_attendance'), false, 'get_employee_attendance should be hidden from employee');
  });

  await t.test('Dynamic Tool Gating: Admin/Owner sees full toolset', () => {
    const adminTools = getAvailableTools(adminAuth);
    const adminToolNames = adminTools.map(t => t.name);

    assert.ok(adminToolNames.includes('create_personal_task'));
    assert.ok(adminToolNames.includes('assign_task'));
    assert.ok(adminToolNames.includes('create_client_plan'));
    assert.ok(adminToolNames.includes('get_attendance_summary'));
    assert.ok(adminToolNames.includes('get_employee_performance'));
    assert.ok(adminToolNames.includes('export_portal_report'));
  });

  // 5. Security Guard: Employee attempting to call admin tool throws Permission Denied
  await t.test('Security Guard: Employee calling create_client_plan is blocked with 403', async () => {
    await assert.rejects(
      async () => {
        await executeTool('create_client_plan', { name: 'Hack Plan', price: 999 }, empAuth);
      },
      (err) => {
        assert.ok(err.message.includes('Permission Denied'));
        return true;
      }
    );
  });

  await t.test('Security Guard: Employee calling get_attendance_summary is blocked with 403', async () => {
    await assert.rejects(
      async () => {
        await executeTool('get_attendance_summary', { date: 'today' }, empAuth);
      },
      (err) => {
        assert.ok(err.message.includes('Permission Denied'));
        return true;
      }
    );
  });

  // 6. Tool Execution: Preview Card Workflow & Task Creation
  await t.test('Execution: Calling create_personal_task without confirmed returns Preview Card with 3 options', async () => {
    const previewRes = await executeTool('create_personal_task', {
      title: 'MCP Unit Test Personal Task Preview',
      description: 'Testing preview card confirmation flow',
      priority: 'High'
    }, empAuth);

    assert.strictEqual(previewRes.requiresConfirmation, true);
    assert.ok(previewRes.previewCard.includes('CIIS TASK PREVIEW CARD (Confirmation Required)'));
    assert.ok(previewRes.previewCard.includes('1️⃣ Create / Confirm'));
    assert.ok(previewRes.previewCard.includes('2️⃣ Edit'));
    assert.ok(previewRes.previewCard.includes('3️⃣ Cancel'));
    assert.deepStrictEqual(previewRes.options, ['Create / Confirm', 'Edit', 'Cancel']);

    // Ensure no task was inserted in DB
    const count = await Task.countDocuments({ title: 'MCP Unit Test Personal Task Preview' });
    assert.strictEqual(count, 0, 'Task should NOT be saved in DB before confirmation');
  });

  await t.test('Execution: Calling create_personal_task with confirmed: true creates task in DB', async () => {
    const res = await executeTool('create_personal_task', {
      title: 'MCP Unit Test Personal Task Confirmed',
      description: 'Testing confirmed task creation',
      priority: 'High',
      confirmed: true
    }, empAuth);

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.task.title, 'MCP Unit Test Personal Task Confirmed');
    assert.strictEqual(res.task.priority.toLowerCase(), 'high');

    // Clean up
    await Task.deleteOne({ _id: res.task.id });
  });

  await t.test('Execution: Calling assign_task without confirmed returns Preview Card with 3 options', async () => {
    const assignPreview = await executeTool('assign_task', {
      title: 'MCP Unit Test Assigned Task Preview',
      assigneeNameOrEmail: regularEmployee.email,
      description: 'Review document before 6 PM',
      priority: 'High'
    }, adminAuth);

    assert.strictEqual(assignPreview.requiresConfirmation, true);
    assert.ok(assignPreview.previewCard.includes('CIIS TASK PREVIEW CARD (Confirmation Required)'));
    assert.ok(assignPreview.previewCard.includes('Assigned Task'));
    assert.ok(assignPreview.previewCard.includes(regularEmployee.name));
    assert.deepStrictEqual(assignPreview.options, ['Create / Confirm', 'Edit', 'Cancel']);

    // Ensure no task was inserted in DB
    const count = await Task.countDocuments({ title: 'MCP Unit Test Assigned Task Preview' });
    assert.strictEqual(count, 0, 'Assigned task should NOT be saved in DB before confirmation');
  });

  // 7. Tool Execution: Admin views attendance summary
  await t.test('Execution: Admin can fetch attendance summary', async () => {
    const res = await executeTool('get_attendance_summary', { date: 'today' }, adminAuth);
    assert.ok(res.summary);
    assert.strictEqual(typeof res.summary.total, 'number');
    assert.strictEqual(typeof res.summary.present, 'number');
    assert.strictEqual(typeof res.summary.absent, 'number');
  });

  // 8. Tool Execution: Admin generates export link
  await t.test('Execution: Admin can generate export download links', async () => {
    const res = await executeTool('export_portal_report', {
      reportType: 'attendance',
      format: 'pdf',
      timeframe: 'today'
    }, adminAuth);

    assert.strictEqual(res.success, true);
    assert.ok(res.downloadUrl.includes('/api/export-reports/attendance'));
    assert.ok(res.downloadUrl.includes('format=pdf'));
  });

  // Cleanup test API keys
  await ApiKey.deleteMany({ _id: { $in: [adminKeyDoc._id, empKeyDoc._id] } });
  await mongoose.disconnect();
});
