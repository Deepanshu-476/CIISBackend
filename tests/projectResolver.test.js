/**
 * tests/projectResolver.test.js
 *
 * Comprehensive integration tests for Project & Project Assignee Resolvers (Part 2):
 * - Uses mongodb-memory-server (with assertSafeTestDb check)
 * - Verifies strict tenant isolation between two companies
 * - Verifies role access (admin sees all company projects, employee sees member/creator only)
 * - Verifies fuzzy matching (partial, numeric suffixes, duplicate names)
 * - Verifies project disambiguation and forged ID rejection
 * - Verifies project assignee resolution (membership check, self-assignment, 2 names guard)
 * - Verifies taskAgentService integration (in-progress strictly requires assignee, intent migration)
 */

process.env.NODE_ENV = 'test';
require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { assertSafeTestDb } = require('./helpers/dbGuard');
const { Project } = require('../HR-CDS/models/Project');
const User = require('../models/User');

const {
  getAccessibleProjects,
  matchProjects,
  resolveProject,
  resolveProjectAssignee,
} = require('../services/ai/projectResolver');

const {
  parseTaskRequest,
} = require('../services/ai/taskAgentService');

const {
  detectIntent,
  migrateDraftBetweenIntents,
} = require('../services/ai/formRegistry');

const {
  addTask,
} = require('../HR-CDS/controllers/projectController');

describe('Project & Assignee Resolver Suite (Part 2 - mongodb-memory-server)', () => {
  let mongoServer;

  // Companies
  const companyAId = new mongoose.Types.ObjectId();
  const companyBId = new mongoose.Types.ObjectId();

  // Users in Company A
  let adminA;
  let employee1A; // Amit Kumar
  let employee2A; // Neha Verma

  // User in Company B
  let userB;

  // Projects
  let proj1A; // "Client Portal Mobile App" (member: employee1A)
  let proj2A; // "Client Portal Web Redesign" (member: employee2A)
  let proj3A; // "Internal CRM 102" (member: employee1A)
  let proj4B; // "Secret Project B" (Company B only)

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri() + 'ciis_test';

    // Verify URI with dbGuard before connecting
    assertSafeTestDb(uri);

    await mongoose.connect(uri);

    // 1. Create Users
    const deptId = new mongoose.Types.ObjectId();

    adminA = await User.create({
      name: 'Rohan Admin',
      email: 'rohan.admin@comp-a.com',
      password: 'Password123!',
      department: deptId,
      company: companyAId,
      companyCode: 'COMPA',
      role: 'admin',
      companyRole: 'admin',
    });

    employee1A = await User.create({
      name: 'Amit Kumar',
      email: 'amit.kumar@comp-a.com',
      password: 'Password123!',
      department: deptId,
      company: companyAId,
      companyCode: 'COMPA',
      role: 'user',
      companyRole: 'employee',
      jobRole: 'Android Dev',
    });

    employee2A = await User.create({
      name: 'Neha Verma',
      email: 'neha.verma@comp-a.com',
      password: 'Password123!',
      department: deptId,
      company: companyAId,
      companyCode: 'COMPA',
      role: 'user',
      companyRole: 'employee',
      jobRole: 'Web Dev',
    });

    userB = await User.create({
      name: 'External Raj',
      email: 'raj@comp-b.com',
      password: 'Password123!',
      department: new mongoose.Types.ObjectId(),
      company: companyBId,
      companyCode: 'COMPB',
      role: 'admin',
      companyRole: 'admin',
    });

    // 2. Create Projects
    proj1A = await Project.create({
      projectName: 'Client Portal Mobile App',
      description: 'Flutter and Native mobile application for clients',
      company: companyAId,
      companyCode: 'COMPA',
      users: [employee1A._id],
      createdBy: adminA._id,
      status: 'active',
      startDate: new Date('2026-01-01'),
    });

    proj2A = await Project.create({
      projectName: 'Client Portal Web Redesign',
      description: 'React client portal frontend redesign',
      company: companyAId,
      companyCode: 'COMPA',
      users: [employee2A._id],
      createdBy: adminA._id,
      status: 'active',
      startDate: new Date('2026-02-01'),
    });

    proj3A = await Project.create({
      projectName: 'Internal CRM 102',
      description: 'Internal operations dashboard',
      company: companyAId,
      companyCode: 'COMPA',
      users: [employee1A._id],
      createdBy: adminA._id,
      status: 'active',
      startDate: new Date('2026-03-01'),
    });

    proj4B = await Project.create({
      projectName: 'Secret Project B',
      description: 'Strictly Company B project',
      company: companyBId,
      companyCode: 'COMPB',
      users: [userB._id],
      createdBy: userB._id,
      status: 'active',
    });
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // --------------------------------------------------------------------------
  // 1. TENANT ISOLATION
  // --------------------------------------------------------------------------
  it('1. Strict Tenant Isolation: Company A user NEVER sees Company B projects', async () => {
    const accessibleA = await getAccessibleProjects({
      user: adminA,
    }, { ProjectModel: Project });

    const accessibleProjectIds = accessibleA.map((p) => String(p._id));
    assert.ok(accessibleProjectIds.includes(String(proj1A._id)));
    assert.ok(accessibleProjectIds.includes(String(proj2A._id)));
    assert.ok(accessibleProjectIds.includes(String(proj3A._id)));
    assert.equal(
      accessibleProjectIds.includes(String(proj4B._id)),
      false,
      'Company A must NEVER see Company B project!'
    );

    const accessibleB = await getAccessibleProjects({
      user: userB,
    }, { ProjectModel: Project });

    assert.equal(accessibleB.length, 1);
    assert.equal(String(accessibleB[0]._id), String(proj4B._id));
  });

  // --------------------------------------------------------------------------
  // 2. ROLE-BASED SCOPE ACCESS
  // --------------------------------------------------------------------------
  it('2. Role Access: Admin sees all company projects, employee sees only member or creator projects', async () => {
    // Admin A sees all 3
    const adminProjects = await getAccessibleProjects({
      user: adminA,
    }, { ProjectModel: Project });
    assert.equal(adminProjects.length, 3);

    // Employee 1 is member of proj1A and proj3A, NOT proj2A
    const emp1Projects = await getAccessibleProjects({
      user: employee1A,
    }, { ProjectModel: Project });
    const emp1Ids = emp1Projects.map((p) => String(p._id));
    assert.ok(emp1Ids.includes(String(proj1A._id)));
    assert.ok(emp1Ids.includes(String(proj3A._id)));
    assert.equal(emp1Ids.includes(String(proj2A._id)), false, 'Employee 1 must not see proj2A');

    // Employee 2 is member of proj2A only
    const emp2Projects = await getAccessibleProjects({
      user: employee2A,
    }, { ProjectModel: Project });
    const emp2Ids = emp2Projects.map((p) => String(p._id));
    assert.equal(emp2Ids.length, 1);
    assert.equal(emp2Ids[0], String(proj2A._id));
  });

  // --------------------------------------------------------------------------
  // 3. FUZZY MATCHING (PARTIAL & NUMERIC SUFFIX)
  // --------------------------------------------------------------------------
  it('3. matchProjects: matches partial names, ignores numeric IDs, and handles token matches', async () => {
    const accessible = await getAccessibleProjects({ user: adminA }, { ProjectModel: Project });

    // Partial match
    const matchMobile = matchProjects('mobile app', accessible);
    assert.equal(matchMobile.length, 1);
    assert.equal(String(matchMobile[0]._id), String(proj1A._id));

    // Numeric suffix matching: "Internal CRM" matches "Internal CRM 102"
    const matchCRM = matchProjects('Internal CRM', accessible);
    assert.equal(matchCRM.length, 1);
    assert.equal(String(matchCRM[0]._id), String(proj3A._id));

    // Case-insensitive & extra spaces
    const matchWeb = matchProjects('   web   redesign   ', accessible);
    assert.equal(matchWeb.length, 1);
    assert.equal(String(matchWeb[0]._id), String(proj2A._id));
  });

  // --------------------------------------------------------------------------
  // 4. DISAMBIGUATION & CANDIDATE CHIPS
  // --------------------------------------------------------------------------
  it('4. resolveProject: multiple matches return status multiple with candidate chips containing last6 ID', async () => {
    const res = await resolveProject({
      req: { user: adminA },
      message: 'Client Portal',
      projectNameText: 'Client Portal',
    }, { ProjectModel: Project });

    assert.equal(res.status, 'multiple');
    assert.equal(res.projects.length, 2);

    // Verify chips have required format
    assert.equal(res.chips.length, 2);
    for (const chip of res.chips) {
      assert.ok(chip.action?.type === 'pickProject');
      assert.ok(chip.action?.projectId);
      assert.ok(chip.label.includes('#'));
      assert.ok(chip.label.includes('members'));
    }
  });

  // --------------------------------------------------------------------------
  // 5. NO MATCH FALLBACK
  // --------------------------------------------------------------------------
  it('5. resolveProject: non-matching query returns status none and up to 5 accessible chips', async () => {
    const res = await resolveProject({
      req: { user: adminA },
      message: 'Non-existent Blockchain Project',
      projectNameText: 'Non-existent Blockchain Project',
    }, { ProjectModel: Project });

    assert.equal(res.status, 'none');
    assert.equal(res.reason, 'no_match');
    assert.ok(res.chips.length > 0 && res.chips.length <= 5);
  });

  // --------------------------------------------------------------------------
  // 6. FORGED OR INACCESSIBLE PROJECT PICK
  // --------------------------------------------------------------------------
  it('6. resolveProject: forged or cross-company projectId returns forbidden_or_not_found', async () => {
    // Admin A tries to pick Project 4 from Company B
    const res = await resolveProject({
      req: { user: adminA },
      pickedProjectId: String(proj4B._id),
    }, { ProjectModel: Project });

    assert.equal(res.status, 'none');
    assert.equal(res.reason, 'forbidden_or_not_found');
    assert.match(res.reply, /access nahi hai/i);
  });

  // --------------------------------------------------------------------------
  // 7. PROJECT ASSIGNEE RESOLUTION
  // --------------------------------------------------------------------------
  it('7. resolveProjectAssignee: enforces project membership and handles self/non-member mapping', async () => {
    // Populate proj1A users
    const proj1Populated = await Project.findById(proj1A._id).populate('users', '_id name email role jobRole');

    // Case 1: Member resolves cleanly
    const resMember = resolveProjectAssignee({
      text: 'Amit',
      project: proj1Populated,
      currentUser: adminA,
    });
    assert.equal(resMember.status, 'single');
    assert.equal(String(resMember.user._id), String(employee1A._id));

    // Case 2: Non-member returns member chips and unassigned option
    const resNonMember = resolveProjectAssignee({
      text: 'Neha', // Neha is NOT a member of proj1
      project: proj1Populated,
      currentUser: adminA,
      status: 'pending',
    });
    assert.equal(resNonMember.status, 'not_member');
    assert.match(resNonMember.reply, /project ke member nahi hain/i);
    const chipLabels = resNonMember.chips.map((c) => c.label);
    assert.ok(chipLabels.some((l) => l.includes('Amit Kumar')));
    assert.ok(chipLabels.some((l) => l.includes('Bina assignee ke')));

    // Case 3: Self-mapping when currentUser IS a member
    const resSelfMember = resolveProjectAssignee({
      text: 'mujhe assign karo',
      project: proj1Populated,
      currentUser: employee1A,
    });
    assert.equal(resSelfMember.status, 'single');
    assert.equal(String(resSelfMember.user._id), String(employee1A._id));

    // Case 4: Self-mapping when currentUser is NOT a member
    const resSelfNonMember = resolveProjectAssignee({
      text: 'mujhe assign kar do',
      project: proj1Populated,
      currentUser: employee2A, // Neha is not in proj1
    });
    assert.equal(resSelfNonMember.status, 'not_member');
    assert.match(resSelfNonMember.reply, /Aap is project ke member nahi hain/i);

    // Case 5: Two names in message when both are members
    const projWithBothMembers = {
      users: [employee1A, employee2A],
    };
    const resTwoNames = resolveProjectAssignee({
      text: 'Amit aur Neha ko assign karo',
      project: projWithBothMembers,
      currentUser: adminA,
    });
    assert.equal(resTwoNames.status, 'multiple_requested');
  });

  // --------------------------------------------------------------------------
  // 8. TASK AGENT SERVICE INTEGRATION: IN-PROGRESS STRICTLY REQUIRES ASSIGNEE
  // --------------------------------------------------------------------------
  it('8. parseTaskRequest: in-progress status on project task strictly requires an assignee', async () => {
    const accessibleProjects = await getAccessibleProjects({ user: adminA }, { ProjectModel: Project });

    const result = await parseTaskRequest({
      req: { user: adminA },
      message: 'Client Portal Mobile App mein task banao in progress status ke sath',
      draft: {
        intent: 'task_project',
        projectId: String(proj1A._id),
        projectName: proj1A.projectName,
        title: 'Push notifications feature',
        description: 'FCM push notifications integration',
        status: 'in progress',
        dueDate: '2026-11-20T10:00:00.000Z',
        assigneeId: null,
        asked: ['project', 'title', 'description', 'status', 'dueDate'],
      },
      language: 'hinglish',
    }, {
      ProjectModel: Project,
      accessibleProjects,
    });

    // In progress requires assignee: cannot be ready, asks for assignee
    assert.notEqual(result.status, 'ready');
    assert.equal(result.field, 'assignee');
    assert.match(result.reply, /Kiske liye task banana hai/i);
  });

  // --------------------------------------------------------------------------
  // 9. FIRST-TURN PROJECT ACKNOWLEDGEMENT & READY STATE
  // --------------------------------------------------------------------------
  it('9. parseTaskRequest: ready state acknowledges project in reply and speech', async () => {
    const accessibleProjects = await getAccessibleProjects({ user: adminA }, { ProjectModel: Project });

    const result = await parseTaskRequest({
      req: { user: adminA },
      message: 'theek hai',
      draft: {
        intent: 'task_project',
        projectId: String(proj1A._id),
        projectName: proj1A.projectName,
        title: 'Backend API migration',
        description: 'Migrate legacy routes to Express 5',
        dueDate: '2026-11-20T10:00:00.000Z',
        assigneeId: String(employee1A._id),
        assigneeLabel: 'Amit Kumar',
        status: 'pending',
        priority: 'High',
        checkpoints: [{ title: 'Route audit', completed: true }],
        reminder: false,
        file: null,
        attachmentsCount: 0,
        asked: ['project', 'title', 'description', 'dueDate', 'assignee', 'priority', 'status', 'checkpoints', 'file', 'reminder'],
      },
      language: 'hinglish',
    }, {
      ProjectModel: Project,
      accessibleProjects,
    });

    assert.equal(result.status, 'ready');
    assert.ok(result.payload);
    assert.equal(result.payload.endpoint, `/projects/${proj1A._id}/tasks`);
    assert.equal(result.payload.fileField, 'pdfFile');
    assert.equal(result.payload.maxFiles, 1);
    assert.match(result.reply, /Project "Client Portal Mobile App" ke andar/i);
    assert.match(result.speech, /प्रोजेक्ट "Client Portal Mobile App"/);
  });

  // --------------------------------------------------------------------------
  // 10. INTENT MIGRATION
  // --------------------------------------------------------------------------
  it('10. migrateDraftBetweenIntents: preserves title, description, dates, drops project and assignee when moving to self_task', () => {
    const projectDraft = {
      intent: 'task_project',
      projectId: '60d5ec49f1b2c8b1f8e4e1a1',
      projectName: 'Client Portal',
      title: 'Database Schema Audit',
      description: 'Audit MongoDB collections',
      dueDate: '2026-11-10T15:00:00.000Z',
      assigneeId: '60d5ec49f1b2c8b1f8e4e1a2',
      assigneeLabel: 'Amit Kumar',
      priority: 'High',
      status: 'pending',
      checkpoints: [{ title: 'Check indexes', completed: true }],
      reminder: true,
      reminderOption: 'hourly',
    };

    const migration = migrateDraftBetweenIntents('task_project', 'self_task', projectDraft);
    const { newDraft, carried, dropped } = migration;

    assert.equal(newDraft.intent, 'self_task');
    assert.equal(newDraft.title, 'Database Schema Audit');
    assert.equal(newDraft.description, 'Audit MongoDB collections');
    assert.equal(newDraft.dueDateTime, '2026-11-10T15:00:00.000Z');
    assert.equal(newDraft.projectId, null);
    assert.equal(newDraft.projectName, null);
    assert.equal(newDraft.assigneeId, null);

    assert.ok(carried.includes('title'));
    assert.ok(carried.includes('description'));
    assert.ok(carried.includes('dueDateTime'));
    assert.ok(dropped.includes('project'));
    assert.ok(dropped.includes('assignee'));
  });

  // --------------------------------------------------------------------------
  // 11. DUPLICATE PROJECT NAMES DISAMBIGUATION (BUG 2)
  // --------------------------------------------------------------------------
  it('11. resolveProject: duplicate project names return status multiple with distinguishing candidate chips', async () => {
    const dup1 = await Project.create({
      projectName: 'TechSoft Core Platform',
      description: 'First version of platform',
      company: companyAId,
      companyCode: 'COMPA',
      users: [employee1A._id],
      createdBy: adminA._id,
      status: 'active',
      startDate: new Date('2026-01-15T00:00:00.000Z'),
    });

    const dup2 = await Project.create({
      projectName: 'TechSoft Core Platform',
      description: 'Second version of platform',
      company: companyAId,
      companyCode: 'COMPA',
      users: [employee1A._id, employee2A._id],
      createdBy: adminA._id,
      status: 'planning',
      startDate: new Date('2026-04-20T00:00:00.000Z'),
    });

    const res = await resolveProject('TechSoft Core Platform', { user: adminA }, { ProjectModel: Project });
    assert.equal(res.status, 'multiple');
    assert.equal(res.candidates.length, 2);

    const c1 = res.candidates.find((c) => String(c._id) === String(dup1._id));
    const c2 = res.candidates.find((c) => String(c._id) === String(dup2._id));

    assert.ok(c1);
    assert.ok(c2);
    assert.deepEqual(c1.startDate, dup1.startDate);
    assert.deepEqual(c2.startDate, dup2.startDate);
    assert.ok(c1.memberCount >= 1);
    assert.ok(c2.memberCount >= 2);

    // Verify candidate chips contain last6 suffix
    assert.ok(res.chips.some((ch) => ch.label.includes(String(dup1._id).slice(-6))));
    assert.ok(res.chips.some((ch) => ch.label.includes(String(dup2._id).slice(-6))));
  });

  // --------------------------------------------------------------------------
  // 12. UNRECOGNIZED NOISE IN CONFIRMING STATE (BUG 4)
  // --------------------------------------------------------------------------
  it('12. parseTaskRequest: unrecognized noise in ready state preserves draft and asks for clarification', async () => {
    const accessibleProjects = await getAccessibleProjects({ user: adminA }, { ProjectModel: Project });

    const readyDraft = {
      status: 'ready',
      intent: 'task_project',
      projectId: String(proj1A._id),
      projectName: proj1A.projectName,
      title: 'API testing',
      description: 'testing',
      dueDate: '2026-11-20T18:00:00.000Z',
      assigneeId: String(employee1A._id),
      assigneeLabel: 'Amit Kumar',
      priority: 'High',
      asked: ['project', 'title', 'description', 'dueDate', 'assignee', 'priority', 'status', 'checkpoints', 'file', 'reminder'],
      skipped: ['reminder', 'checkpoints', 'file'],
    };

    const noiseResult = await parseTaskRequest({
      req: { user: adminA },
      message: 'kuch bhi random noise jo edit nahi hai',
      draft: readyDraft,
      language: 'hinglish',
    }, {
      ProjectModel: Project,
      accessibleProjects,
    });

    assert.equal(noiseResult.status, 'ready');
    assert.match(noiseResult.reply, /Samajh nahi aaya\. Create kar doon\? Haan ya nahi bolein/i);
    // Draft must not be mutated by noise
    assert.equal(noiseResult.draft.title, 'API testing');
    assert.equal(noiseResult.draft.description, 'testing');
    assert.equal(noiseResult.draft.dueDate, '2026-11-20T18:00:00.000Z');
  });

  // --------------------------------------------------------------------------
  // 13. AFFIRMATIVE "आजी बनादो" CONFIRMS WITHOUT RESETTING TIME (BUG 4)
  // --------------------------------------------------------------------------
  it('13. parseTaskRequest: affirmative "आजी बनादो" triggers confirm_yes without overriding due date to 6 PM', async () => {
    const accessibleProjects = await getAccessibleProjects({ user: adminA }, { ProjectModel: Project });

    const readyDraft = {
      status: 'ready',
      intent: 'task_project',
      projectId: String(proj1A._id),
      projectName: proj1A.projectName,
      title: 'API testing',
      description: 'testing',
      dueDate: '2026-11-20T10:00:00.000Z',
      assigneeId: String(employee1A._id),
      assigneeLabel: 'Amit Kumar',
      priority: 'High',
      asked: ['project', 'title', 'description', 'dueDate', 'assignee', 'priority', 'status', 'checkpoints', 'file', 'reminder'],
      skipped: ['reminder', 'checkpoints', 'file'],
    };

    const confirmResult = await parseTaskRequest({
      req: { user: adminA },
      message: 'आजी बनादो',
      draft: readyDraft,
      language: 'hinglish',
    }, {
      ProjectModel: Project,
      accessibleProjects,
    });

    // Confirms draft without resetting dueDate to today 6 PM
    assert.equal(confirmResult.draft.dueDate, '2026-11-20T10:00:00.000Z');
    assert.ok(confirmResult.intent?.type === 'confirm_yes' || confirmResult.intent?.type === 'create_now');
  });

  // --------------------------------------------------------------------------
  // 15. BUG 1 REPLAY: TechSoft Core Platform (With Vansh vs Without Vansh)
  // --------------------------------------------------------------------------
  it('15. Bug 1 Replay: non-member company user never becomes assignee, member does with id in payload, card matches payload', async () => {
    // 1. Create users
    const deptId = new mongoose.Types.ObjectId();
    const vanshTestUser = await User.create({
      name: 'Vansh Test',
      email: 'vansh.test@comp-a.com',
      password: 'Password123!',
      department: deptId,
      company: companyAId,
      companyCode: 'COMPA',
      role: 'user',
      companyRole: 'employee',
      jobRole: 'Full Stack Dev',
    });

    const otherEmpUser = await User.create({
      name: 'Karan Mehra',
      email: 'karan.mehra@comp-a.com',
      password: 'Password123!',
      department: deptId,
      company: companyAId,
      companyCode: 'COMPA',
      role: 'user',
      companyRole: 'employee',
      jobRole: 'QA Engineer',
    });

    // 2. Create two projects with exact duplicate name "TechSoft Core Platform"
    const projWithVansh = await Project.create({
      projectName: 'TechSoft Core Platform',
      description: 'Platform version containing Vansh Test as member',
      company: companyAId,
      companyCode: 'COMPA',
      users: [adminA._id, vanshTestUser._id],
      createdBy: adminA._id,
      status: 'active',
      startDate: new Date('2026-05-01T00:00:00.000Z'),
    });

    const projWithoutVansh = await Project.create({
      projectName: 'TechSoft Core Platform',
      description: 'Platform version without Vansh Test as member',
      company: companyAId,
      companyCode: 'COMPA',
      users: [adminA._id, otherEmpUser._id],
      createdBy: adminA._id,
      status: 'active',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
    });

    const accessibleProjects = await getAccessibleProjects({ user: adminA }, { ProjectModel: Project });

    // Mock LLM extractor that passes through deterministic slots
    const mockExtractor = async () => ({});

    // =========================================================================
    // SCENARIO A: User chooses Project WITHOUT Vansh (members: adminA, otherEmpUser)
    // =========================================================================
    const initialDraftProjWithoutVansh = {
      intent: 'task_project',
      projectId: String(projWithoutVansh._id),
      projectName: projWithoutVansh.projectName,
      title: 'Regression Testing',
      description: 'Run automated regression test suite',
      status: 'in progress', // In progress strictly requires assignee!
      dueDate: '2026-11-20T10:00:00.000Z',
      assigneeId: null,
      assigneeLabel: null,
      assigneeName: null,
      asked: ['project', 'title', 'description', 'status', 'dueDate'],
      skipped: [],
    };

    // Turn 1 (Scenario A): Prompt asks for assignee because status is in progress
    const turn1A = await parseTaskRequest({
      req: { user: adminA },
      message: 'theek hai',
      draft: initialDraftProjWithoutVansh,
      language: 'hinglish',
    }, {
      ProjectModel: Project,
      accessibleProjects,
      extractFn: mockExtractor,
    });

    assert.equal(turn1A.status, 'needs_input');
    assert.equal(turn1A.field, 'assignee');
    assert.match(turn1A.reply, /Kiske liye task banana hai/i);

    // Turn 2 (Scenario A): User gives voice input "vanch core"
    const turn2A = await parseTaskRequest({
      req: { user: adminA },
      message: 'vanch core',
      draft: turn1A.draft,
      language: 'hinglish',
    }, {
      ProjectModel: Project,
      accessibleProjects,
      extractFn: mockExtractor,
    });

    // Vansh is NOT a member of projWithoutVansh!
    assert.equal(turn2A.status, 'needs_input');
    assert.equal(turn2A.field, 'assignee');
    assert.match(turn2A.reply, /is project ke member nahi hain/i);
    assert.equal(turn2A.draft.assigneeId, null);
    assert.equal(turn2A.draft.assigneeLabel, null);
    // Chosen project id is projWithoutVansh
    assert.equal(turn2A.draft.projectId, String(projWithoutVansh._id));
    // Member ids do NOT include Vansh
    const memberIdsWithoutVansh = projWithoutVansh.users.map(u => String(u));
    assert.equal(memberIdsWithoutVansh.includes(String(vanshTestUser._id)), false);

    // Turn 3 (Scenario A): User gives voice input "Vansh Test"
    const turn3A = await parseTaskRequest({
      req: { user: adminA },
      message: 'Vansh Test',
      draft: turn2A.draft,
      language: 'hinglish',
    }, {
      ProjectModel: Project,
      accessibleProjects,
      extractFn: mockExtractor,
    });

    // PROVE: Company user "Vansh Test" who is not a member of chosen project NEVER becomes assignee!
    assert.equal(turn3A.status, 'needs_input');
    assert.equal(turn3A.field, 'assignee');
    assert.match(turn3A.reply, /is project ke member nahi hain/i);
    assert.equal(turn3A.draft.assigneeId, null);
    assert.equal(turn3A.draft.assigneeLabel, null);

    // =========================================================================
    // SCENARIO B: User chooses Project WITH Vansh (members: adminA, vanshTestUser)
    // =========================================================================
    const initialDraftProjWithVansh = {
      intent: 'task_project',
      projectId: String(projWithVansh._id),
      projectName: projWithVansh.projectName,
      title: 'Regression Testing',
      description: 'Run automated regression test suite',
      status: 'in progress',
      dueDate: '2026-11-20T10:00:00.000Z',
      assigneeId: null,
      assigneeLabel: null,
      assigneeName: null,
      asked: ['project', 'title', 'description', 'status', 'dueDate'],
      skipped: [],
    };

    // Turn 1 (Scenario B): Prompt asks for assignee
    const turn1B = await parseTaskRequest({
      req: { user: adminA },
      message: 'theek hai',
      draft: initialDraftProjWithVansh,
      language: 'hinglish',
    }, {
      ProjectModel: Project,
      accessibleProjects,
      extractFn: mockExtractor,
    });

    assert.equal(turn1B.status, 'needs_input');
    assert.equal(turn1B.field, 'assignee');

    // Turn 2 (Scenario B): User gives voice input "vanch core"
    const turn2B = await parseTaskRequest({
      req: { user: adminA },
      message: 'vanch core',
      draft: turn1B.draft,
      language: 'hinglish',
    }, {
      ProjectModel: Project,
      accessibleProjects,
      extractFn: mockExtractor,
    });

    // In projWithVansh, "vanch core" phonetically matches member "Vansh Test"
    assert.equal(turn2B.status, 'needs_input');
    assert.match(turn2B.reply, /Vansh Test/i);
    assert.ok(turn2B.chips.some(ch => ch.label.includes('Vansh Test')));

    // Turn 3 (Scenario B): User confirms with voice "Vansh Test"
    const turn3B = await parseTaskRequest({
      req: { user: adminA },
      message: 'Vansh Test',
      draft: { ...turn2B.draft, asked: [...turn2B.draft.asked, 'assignee'], skipped: ['priority', 'checkpoints', 'reminder', 'file'] },
      language: 'hinglish',
    }, {
      ProjectModel: Project,
      accessibleProjects,
      extractFn: mockExtractor,
    });

    // PROVE: A member does become the assignee with ID in draft and payload!
    assert.equal(turn3B.status, 'ready');
    assert.equal(turn3B.draft.assigneeId, String(vanshTestUser._id));
    assert.ok(turn3B.draft.assigneeLabel.includes('Vansh Test'));
    assert.equal(turn3B.draft.projectId, String(projWithVansh._id));

    // PROVE: payload.fields.assignedUsers contains the exact user ID
    assert.ok(turn3B.payload);
    assert.ok(Array.isArray(turn3B.payload.fields.assignedUsers));
    assert.deepEqual(turn3B.payload.fields.assignedUsers, [String(vanshTestUser._id)]);

    // PROVE: the preview card shows EXACTLY what the payload contains
    assert.ok(turn3B.preview);
    assert.ok(turn3B.preview.assignee);
    assert.equal(turn3B.preview.assignee.id, String(vanshTestUser._id));
    assert.ok(turn3B.preview.assignee.label.includes('Vansh Test'));
  });

  it('16. Bug Reproduction & Fix: Real 8-turn flow for In Progress project task with Aarav Sharma, ending in real addTask call', async () => {
    // 1. Setup project "Demo 1" and member "Aarav Sharma"
    const aaravUser = await User.create({
      name: 'Aarav Sharma',
      email: 'aarav.sharma.test@gmail.com',
      password: 'Password123!',
      department: adminA.department,
      company: companyAId,
      companyCode: 'COMPA',
      role: 'user',
      companyRole: 'employee',
      jobRole: 'Developer',
    });

    const demo1Project = await Project.create({
      projectName: 'Demo 1',
      company: companyAId,
      companyCode: 'COMPA',
      createdBy: aaravUser._id,
      users: [adminA._id, aaravUser._id],
      status: 'active',
    });

    const accessibleProjects = await getAccessibleProjects({ user: adminA }, { ProjectModel: Project });

    const turns = [
      { label: 'Turn 1 (Title)', message: 'Demo 1 mein task API testing' },
      { label: 'Turn 2 (Description)', message: 'doing testing' },
      { label: 'Turn 3 (Checkpoints)', message: 'koi checkpoint nahi' },
      { label: 'Turn 4 (Priority)', message: 'high' },
      { label: 'Turn 5 (Due)', message: 'kal subah 10 baje' },
      { label: 'Turn 6 (Status in progress)', message: 'in progress' },
      { label: 'Turn 7 (Assignee Aarav Sharma)', message: 'Aarav Sharma' },
      { label: 'Turn 8 (Reminder 1 hour before)', message: '1 hour before' },
    ];

    let draft = {
      intent: 'task_project',
      projectId: String(demo1Project._id),
      projectName: demo1Project.projectName,
      asked: ['project'],
      skipped: [],
    };

    let latestRes = null;

    console.log('\n--- Test 16: Turn-by-Turn Trace ---');
    for (const t of turns) {
      latestRes = await parseTaskRequest({
        req: { user: adminA },
        message: t.message,
        draft,
        language: 'hinglish',
      }, {
        ProjectModel: Project,
        accessibleProjects,
        extractFn: async () => ({}),
      });

      draft = latestRes.draft;
      console.log(`[${t.label}] status=${latestRes.status} field=${latestRes.field}`);
      console.log(`  draft.assigneeId=${draft?.assigneeId} draft.assigneeLabel=${draft?.assigneeLabel}`);
      console.log(`  preview.assignee=${JSON.stringify(latestRes.preview?.assignee)}`);
      console.log(`  payload.fields.assignedUsers=${latestRes.payload?.fields?.assignedUsers}`);

      if (t.label.includes('Turn 1') || t.label.includes('Turn 2') || t.label.includes('Turn 3') ||
          t.label.includes('Turn 4') || t.label.includes('Turn 5') || t.label.includes('Turn 6')) {
        assert.equal(draft.assigneeId, null, `${t.label} must have null assigneeId before assignee turn`);
      }
    }

    // PROVE Turn 7 & 8: Assignee resolved and preserved through reminder turn
    assert.equal(latestRes.status, 'ready');
    assert.equal(draft.assigneeId, String(aaravUser._id));
    assert.ok(draft.assigneeLabel.includes('Aarav Sharma'));

    // PROVE: Preview and payload read ONE single source of truth (assigneeId)
    assert.ok(latestRes.preview);
    assert.ok(latestRes.preview.assignee);
    assert.equal(latestRes.preview.assignee.id, String(aaravUser._id));
    assert.ok(latestRes.preview.assignee.label.includes('Aarav Sharma'));

    assert.ok(latestRes.payload);
    assert.ok(Array.isArray(latestRes.payload.fields.assignedUsers));
    assert.deepEqual(latestRes.payload.fields.assignedUsers, [String(aaravUser._id)]);

    // Call the REAL create handler (addTask) with the exact payload fields built from draft
    const reqMock = {
      params: { id: String(demo1Project._id) },
      body: { ...latestRes.payload.fields },
      user: {
        id: String(adminA._id),
        _id: adminA._id,
        name: adminA.name,
        role: adminA.role,
        company: companyAId,
        companyCode: 'COMPA',
      },
      headers: {},
    };

    let statusCode = null;
    let responseData = null;
    await new Promise((resolve) => {
      const resMock = {
        status(code) { statusCode = code; return this; },
        json(data) { responseData = data; resolve(); return this; },
      };
      addTask(reqMock, resMock);
    });

    // PROVE: Real addTask succeeds with 201 and creates task with status 'in progress'
    assert.equal(statusCode, 201);
    assert.equal(responseData?.success, true);
    assert.equal(responseData?.task?.status, 'in progress');
    assert.deepEqual(
      responseData?.task?.assignedUsers.map(String),
      [String(aaravUser._id)]
    );

    // PROVE COUNTERFACTUAL: Calling addTask with empty assignedUsers returns 400
    const counterfactualReq = {
      ...reqMock,
      body: {
        ...reqMock.body,
        assignedUsers: [],
      },
    };

    let counterStatusCode = null;
    let counterData = null;
    await new Promise((resolve) => {
      const counterRes = {
        status(code) { counterStatusCode = code; return this; },
        json(data) { counterData = data; resolve(); return this; },
      };
      addTask(counterfactualReq, counterRes);
    });

    assert.equal(counterStatusCode, 400);
    assert.equal(counterData?.success, false);
    assert.match(counterData?.message, /Assign at least one user before moving a task to In Progress/i);
  });
});

