/**
 * tests/projectTaskContract.test.js
 *
 * Contract test verifying CIIS AI Form Registry for project tasks (Part 2).
 * Verifies exact parity against CIIS/src/hrCds/pages/ProjectDetailsPage.jsx lines 722-755:
 * - Endpoint: /projects/:id/tasks
 * - Method: POST (multipart)
 * - Single file attachment under 'pdfFile'
 * - Max files: 1
 * - Field serialization: assignedUsers (JSON string array), checkpoints (JSON string array), reminderSettings (JSON string object)
 * - Enum parity: priority Title Case ('Low' | 'Medium' | 'High'), status lowercase ('pending' | 'in progress' | 'completed' | 'on hold' | 'cancelled')
 */

process.env.NODE_ENV = 'test';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  FORM_REGISTRY,
  formatProjectPriority,
  formatProjectStatus,
  PROJECT_STATUS_LABELS,
} = require('../services/ai/formRegistry');

describe('Project Task Contract Suite (Part 2)', () => {
  const projectDetailsPagePath = path.resolve(
    __dirname,
    '../../CIIS/src/hrCds/pages/ProjectDetailsPage.jsx'
  );

  it('1. ProjectDetailsPage.jsx exists and contains exact contract lines for task creation', () => {
    assert.ok(fs.existsSync(projectDetailsPagePath), `File not found: ${projectDetailsPagePath}`);
    const source = fs.readFileSync(projectDetailsPagePath, 'utf8');

    // 1. Endpoint match
    assert.match(source, /\/projects\/\$\{projectId\}\/tasks/);

    // 2. Multipart form data construction
    assert.match(source, /const formData = new FormData\(\)/);

    // 3. assignedUsers field
    assert.match(source, /formData\.append\(\s*["']assignedUsers["']/);

    // 4. checkpoints serialized as JSON string
    assert.match(source, /formData\.append\(\s*["']checkpoints["'],\s*JSON\.stringify/);

    // 5. dueDate ISO string
    assert.match(source, /formData\.append\(\s*["']dueDate["']/);

    // 6. reminderSettings serialized as JSON string
    assert.match(source, /formData\.append\(\s*["']reminderSettings["'],\s*JSON\.stringify/);

    // 7. Single attachment under 'pdfFile' with custom name ${safeTaskTitle}_Document.${ext}
    assert.match(source, /formData\.append\(\s*["']pdfFile["'],\s*file,\s*customFileName\)/);
    assert.match(source, /_Document/);
  });

  it('2. FORM_REGISTRY.task_project definition matches exact endpoint, method, and file fields', () => {
    const config = FORM_REGISTRY.task_project;
    assert.ok(config, 'FORM_REGISTRY.task_project must be defined');
    assert.equal(config.intent, 'task_project');
    assert.equal(config.entity, 'project_task');
    assert.equal(config.endpoint, '/projects/:id/tasks');
    assert.equal(config.method, 'POST');
    assert.equal(config.multipart, true);
    assert.equal(config.fileField, 'pdfFile');
    assert.equal(config.maxFiles, 1);
    assert.deepEqual(config.accept, ['.pdf', 'image/*']);
  });

  it('3. buildPayload generates exact fields, serialized JSON strings, and URL interpolation', () => {
    const config = FORM_REGISTRY.task_project;
    const sampleDraft = {
      projectId: '60d5ec49f1b2c8b1f8e4e1a1',
      projectName: 'Website Redesign',
      title: 'Setup Landing Page',
      description: 'Build responsive hero and pricing sections',
      assigneeId: '60d5ec49f1b2c8b1f8e4e1a2',
      assigneeLabel: 'Rahul Sharma',
      dueDate: '2026-11-15T18:30:00.000Z',
      priority: 'high',
      status: 'in-progress',
      checkpoints: [
        { title: 'Hero section wireframe', completed: true },
        { title: 'Pricing table grid', completed: false },
      ],
      reminder: true,
      reminderOption: 'oneHourBefore',
    };

    const payload = config.buildPayload(sampleDraft);

    // Endpoint interpolates :id with projectId
    assert.equal(payload.endpoint, '/projects/60d5ec49f1b2c8b1f8e4e1a1/tasks');
    assert.equal(payload.method, 'POST');
    assert.equal(payload.multipart, true);
    assert.equal(payload.fileField, 'pdfFile');
    assert.equal(payload.maxFiles, 1);

    const { fields } = payload;
    assert.equal(fields.title, 'Setup Landing Page');
    assert.equal(fields.description, 'Build responsive hero and pricing sections');
    assert.equal(fields.dueDate, '2026-11-15T18:30:00.000Z');

    // Priority Title Case
    assert.equal(fields.priority, 'High');

    // Status lowercase with space
    assert.equal(fields.status, 'in progress');

    // assignedUsers matches ProjectDetailsPage and TaskManagement format (array of IDs)
    assert.ok(Array.isArray(fields.assignedUsers));
    assert.deepEqual(fields.assignedUsers, ['60d5ec49f1b2c8b1f8e4e1a2']);
    assert.equal(fields.assignedTo, '60d5ec49f1b2c8b1f8e4e1a2');

    // checkpoints is valid JSON array of clean checkpoints
    assert.equal(typeof fields.checkpoints, 'string');
    const parsedCp = JSON.parse(fields.checkpoints);
    assert.equal(parsedCp.length, 2);
    assert.equal(parsedCp[0].title, 'Hero section wireframe');
    assert.equal(parsedCp[0].completed, true);

    // reminderSettings is valid JSON object
    assert.equal(typeof fields.reminderSettings, 'string');
    const parsedReminder = JSON.parse(fields.reminderSettings);
    assert.equal(parsedReminder.enabled, true);
    assert.ok(parsedReminder.options.includes('oneHourBefore'));
  });

  it('4. buildPayload handles unassigned task and omits dueDate when null', () => {
    const config = FORM_REGISTRY.task_project;
    const sampleDraft = {
      projectId: '60d5ec49f1b2c8b1f8e4e1a1',
      title: 'Backlog Task',
      description: '',
      assigneeId: null,
      dueDate: null,
      priority: 'low',
      status: 'pending',
    };

    const payload = config.buildPayload(sampleDraft);
    const { fields } = payload;

    assert.equal(fields.title, 'Backlog Task');
    assert.equal(fields.priority, 'Low');
    assert.equal(fields.status, 'pending');
    assert.equal(fields.dueDate, undefined, 'dueDate must be omitted when empty');
    assert.deepEqual(fields.assignedUsers, []);
  });

  it('5. Priority and Status enum formatters enforce exact title-case and lowercase parity', () => {
    // Priority: Low, Medium, High
    assert.equal(formatProjectPriority('low'), 'Low');
    assert.equal(formatProjectPriority('LOW'), 'Low');
    assert.equal(formatProjectPriority('medium'), 'Medium');
    assert.equal(formatProjectPriority('high'), 'High');
    assert.equal(formatProjectPriority(null), 'Medium');
    assert.equal(formatProjectPriority(''), 'Medium');

    // Status: pending, in progress, completed, on hold, cancelled
    assert.equal(formatProjectStatus('pending'), 'pending');
    assert.equal(formatProjectStatus('in-progress'), 'in progress');
    assert.equal(formatProjectStatus('in progress'), 'in progress');
    assert.equal(formatProjectStatus('completed'), 'completed');
    assert.equal(formatProjectStatus('on-hold'), 'on hold');
    assert.equal(formatProjectStatus('onhold'), 'on hold');
    assert.equal(formatProjectStatus('cancelled'), 'cancelled');
    assert.equal(formatProjectStatus('canceled'), 'cancelled');
    assert.equal(formatProjectStatus(null), 'pending');

    // Labels map
    assert.equal(PROJECT_STATUS_LABELS['pending'], 'Pending');
    assert.equal(PROJECT_STATUS_LABELS['in progress'], 'In Progress');
    assert.equal(PROJECT_STATUS_LABELS['completed'], 'Completed');
    assert.equal(PROJECT_STATUS_LABELS['on hold'], 'On Hold');
    assert.equal(PROJECT_STATUS_LABELS['cancelled'], 'Cancelled');
  });

  it('6. buildPreview constructs preview card conforming to previewLayout', () => {
    const config = FORM_REGISTRY.task_project;
    const sampleDraft = {
      projectId: '60d5ec49f1b2c8b1f8e4e1a1',
      projectName: 'Mobile App V2',
      title: 'Push Notifications Setup',
      description: 'Integrate FCM',
      assigneeId: '60d5ec49f1b2c8b1f8e4e1a2',
      assigneeLabel: 'Kanika Sharma',
      dueDate: '2026-10-30T12:00:00.000Z',
      priority: 'high',
      status: 'in-progress',
      checkpoints: [{ title: 'APNs config' }],
      reminder: false,
    };

    const preview = config.buildPreview(sampleDraft);

    assert.equal(preview.project, 'Mobile App V2');
    assert.equal(preview.projectName, 'Mobile App V2');
    assert.equal(preview.projectId, '60d5ec49f1b2c8b1f8e4e1a1');
    assert.equal(preview.title, 'Push Notifications Setup');
    assert.equal(preview.description, 'Integrate FCM');
    assert.equal(preview.priority, 'High');
    assert.equal(preview.status, 'in progress');
    assert.equal(preview.statusLabel, 'In Progress');
    assert.equal(preview.taskFor, 'project');
    assert.deepEqual(preview.assignee, { id: '60d5ec49f1b2c8b1f8e4e1a2', label: 'Kanika Sharma' });
    assert.equal(preview.reminder, 'Nahi (No)');
    assert.deepEqual(preview.checkpoints, ['APNs config']);

    // Assert previewLayout order
    assert.deepEqual(config.previewLayout, [
      'project',
      'title',
      'description',
      'assignee',
      'dueDate',
      'priority',
      'status',
      'checkpoints',
      'reminder',
      'attachmentsCount',
    ]);
  });
});
