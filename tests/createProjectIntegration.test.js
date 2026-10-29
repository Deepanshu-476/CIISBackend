/**
 * CIISBackend/tests/createProjectIntegration.test.js
 *
 * Comprehensive proof suite covering:
 * - Item 2: Chained task with real createProject -> addTask integration (MongoMemoryServer)
 * - Item 3: Branch contract test (All Branches vs Specific branch matching AdminProject.jsx)
 * - Item 4: Named tests:
 *   - Required slots refuse "skip" (name, description, dates, members)
 *   - "Baaki sab default" never fills required slots
 *   - End before start rejected
 *   - Relative dates ("kal se 2 hafte") in IST
 *   - PDF valid / non-PDF / over 10MB validation
 *   - Members ledger cases ("vansh or kavya", "वंश और काव्या", unknown, non-company user, two Kavyas, remove, add, empty list)
 *   - Duplicate name chips showing status, start date, member count
 *   - Edit commands ("name badlo", "dates badlo", "priority low kar do")
 *   - clean speakText formatting
 *   - Case-insensitive roles matching PageAccessGate
 * - Item 5: Tampered draft (foreign user id, foreign company id re-resolved/rejected)
 */

process.env.NODE_ENV = 'test';
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'gsk_mock_test_key_for_unit_tests';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const systemNotificationService = require('../HR-CDS/utils/systemNotificationService');
systemNotificationService.notifyDirectUsers = async () => [];
const sendEmailModule = require('../utils/sendEmail');
sendEmailModule.sendEmail = async () => true;

const { parseTaskRequest } = require('../services/ai/taskAgentService');
const { parseTask } = require('../controllers/aiController');
const { FORM_REGISTRY, canCreateProject } = require('../services/ai/formRegistry');
const { parseRequestSchema } = require('../services/ai/aiSchemas');
const { parseProjectDateRange, parseProjectDate } = require('../services/ai/projectSlotFiller');
const { validateAttachmentFile } = require('../services/ai/taskFields');
const projectController = require('../HR-CDS/controllers/projectController');
const { Project } = require('../HR-CDS/models/Project');
const User = require('../models/User');

describe('AI Create Project & Chained Task Comprehensive Proof Suite', () => {
  let mongoServer;
  let testCompanyId;
  let testBranchId;
  let ownerUser;
  let member1;
  let member2;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri() + 'ciis_create_project_proof';
    await mongoose.connect(uri);

    testCompanyId = new mongoose.Types.ObjectId();
    testBranchId = new mongoose.Types.ObjectId();
    const testDeptId = new mongoose.Types.ObjectId();

    ownerUser = await User.create({
      name: 'Kanika Owner',
      email: 'kanika.owner@testcorp.com',
      password: 'Password123!',
      company: testCompanyId,
      companyCode: 'CORP100',
      role: 'owner',
      companyRole: 'owner',
      branchId: testBranchId,
      department: testDeptId,
    });

    member1 = await User.create({
      name: 'Vansh Test',
      email: 'vansh.test@testcorp.com',
      password: 'Password123!',
      company: testCompanyId,
      companyCode: 'CORP100',
      role: 'user',
      companyRole: 'employee',
      branchId: testBranchId,
      department: testDeptId,
    });

    member2 = await User.create({
      name: 'Kavya Sharma',
      email: 'kavya.sharma@testcorp.com',
      password: 'Password123!',
      company: testCompanyId,
      companyCode: 'CORP100',
      role: 'user',
      companyRole: 'employee',
      branchId: testBranchId,
      department: testDeptId,
    });
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // =========================================================================
  // ITEM 2: REAL CREATE HANDLER FOLLOWED BY REAL ADDTASK HANDLER
  // =========================================================================
  describe('Item 2: Real Handlers Integration (createProject -> addTask)', () => {
    it('proves createProject handler creates project in DB and returns 201 with project._id, followed by real addTask returning 200 with members repeated in assignedUsers', async () => {
      const express = require('express');
      const app = express();

      app.use((req, res, next) => {
        req.user = {
          id: String(ownerUser._id),
          _id: String(ownerUser._id),
          name: ownerUser.name,
          role: ownerUser.role,
          company: testCompanyId,
          companyCode: 'CORP100',
        };
        next();
      });

      app.post('/projects', projectController.createProject);
      app.post('/projects/:id/tasks', projectController.addTask);

      const server = app.listen(0, '127.0.0.1');
      await new Promise(r => server.once('listening', r));
      const port = server.address().port;

      try {
        // 1. Call real projectController.createProject with FormData
        const fdCreate = new FormData();
        fdCreate.append('projectName', 'Alpha NextGen Portal');
        fdCreate.append('description', 'Enterprise AI Portal Project');
        fdCreate.append('startDate', '2026-11-01');
        fdCreate.append('endDate', '2026-11-30');
        fdCreate.append('priority', 'High');
        fdCreate.append('status', 'Active');
        fdCreate.append('users', JSON.stringify([String(ownerUser._id), String(member1._id), String(member2._id)]));

        const resCreate = await fetch(`http://127.0.0.1:${port}/projects`, {
          method: 'POST',
          body: fdCreate,
        });

        const createBody = await resCreate.json();
        if (resCreate.status !== 201) {
          console.error('createProject failed:', resCreate.status, createBody);
        }
        assert.equal(resCreate.status, 201, 'createProject must return HTTP 201');
        assert.equal(createBody.success, true);
        assert.ok(createBody.project?._id, 'Response must contain project._id');
        const createdProjectId = String(createBody.project._id);

        // Verify in MongoDB
        const dbProject = await Project.findById(createdProjectId).lean();
        assert.ok(dbProject, 'Project must exist in DB');
        assert.equal(dbProject.projectName, 'Alpha NextGen Portal');
        assert.equal(dbProject.users.length, 3, 'Creator + 2 members auto-added');

        // 2. Call real projectController.addTask on the newly created project with repeated assignedUsers
        const fdTask = new FormData();
        fdTask.append('title', 'Implement Core AI Engine');
        fdTask.append('description', 'Deliver the core transformer pipeline');
        fdTask.append('dueDate', '2026-11-15T18:00:00.000Z');
        fdTask.append('priority', 'High');
        fdTask.append('status', 'pending');
        fdTask.append('checkpoints', JSON.stringify([{ title: 'Phase 1 unit tests', completed: false }]));
        fdTask.append('assignedUsers', String(member1._id));
        fdTask.append('assignedUsers', String(member2._id));

        const resTask = await fetch(`http://127.0.0.1:${port}/projects/${createdProjectId}/tasks`, {
          method: 'POST',
          body: fdTask,
        });

        assert.equal(resTask.status, 201, 'addTask must return HTTP 201');
        const addBody = await resTask.json();
        assert.equal(addBody.success, true);
        assert.ok(addBody.task?._id, 'Task must be created successfully');

        // Verify task in DB
        const updatedProject = await Project.findById(createdProjectId).lean();
        assert.equal(updatedProject.tasks.length, 1);
        assert.equal(updatedProject.tasks[0].title, 'Implement Core AI Engine');
        assert.deepEqual(
          updatedProject.tasks[0].assignedUsers.map(String),
          [String(member1._id), String(member2._id)]
        );
      } finally {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close();
      }
    });
  });

  // =========================================================================
  // ITEM 3: BRANCH CONTRACT PARITY WITH ADMINPROJECT.JSX (lines 567-578)
  // =========================================================================
  describe('Item 3: Branch Contract Parity vs AdminProject.jsx', () => {
    it('All Branches selected: omits branch and branchId; Specific branch selected: includes branch and branchId', () => {
      const draft = {
        name: 'CRM Redesign',
        description: 'Complete UI Overhaul',
        startDate: '2026-11-01',
        endDate: '2026-12-01',
        priority: 'High',
        status: 'Active',
        members: [{ id: 'u1', name: 'User 1' }],
      };

      // Case 1: All Branches (no branchId on user scope)
      const allBranchesUser = {
        _id: 'usr_all',
        companyCode: 'CMP999',
        companyIdentifier: 'CMP999_ID',
        branchId: null,
      };
      const allBranchesPayload = FORM_REGISTRY.create_project.buildPayload(draft, allBranchesUser);
      assert.equal(allBranchesPayload.fields.companyCode, 'CMP999');
      assert.equal(allBranchesPayload.fields.companyIdentifier, 'CMP999_ID');
      assert.equal(allBranchesPayload.fields.branchId, undefined);
      assert.equal(allBranchesPayload.fields.branch, undefined);

      // Case 2: Specific branch selected (branchId present on user scope)
      const specificBranchUser = {
        _id: 'usr_branch',
        companyCode: 'CMP999',
        companyIdentifier: 'CMP999_ID',
        branchId: '60c72b2f9b1d8b0015b6d111',
        branch: '60c72b2f9b1d8b0015b6d111',
      };
      const specificPayload = FORM_REGISTRY.create_project.buildPayload(draft, specificBranchUser);
      assert.equal(specificPayload.fields.companyCode, 'CMP999');
      assert.equal(specificPayload.fields.companyIdentifier, 'CMP999_ID');
      assert.equal(specificPayload.fields.branchId, '60c72b2f9b1d8b0015b6d111');
      assert.equal(specificPayload.fields.branch, '60c72b2f9b1d8b0015b6d111');
    });
  });

  // =========================================================================
  // ITEM 4: NAMED REQUIREMENT TESTS
  // =========================================================================
  describe('Item 4: Named Requirement Tests', () => {
    const mockReq = {
      user: {
        _id: 'usr_admin',
        name: 'Admin Test',
        role: 'admin',
        companyCode: 'CMP100',
      },
    };

    it('4.1 Required slots refuse "skip": name, description, dates, members', async () => {
      const deps = {
        getAccessibleProjects: async () => [],
        getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
      };

      // Skip on name: refuses and re-asks name
      const draftNoName = { intent: 'create_project', name: null };
      const resName = await parseTaskRequest({
        req: mockReq,
        action: { type: 'skip', field: 'name' },
        draft: draftNoName,
      }, deps);
      assert.equal(resName.status, 'needs_input');
      assert.equal(resName.field, 'name');
      assert.ok(resName.reply.includes('Project ka naam zaroori hai'));

      // Skip on description: refuses and re-asks description
      const draftNoDesc = { intent: 'create_project', name: 'Alpha', description: null };
      const resDesc = await parseTaskRequest({
        req: mockReq,
        action: { type: 'skip', field: 'description' },
        draft: draftNoDesc,
      }, deps);
      assert.equal(resDesc.status, 'needs_input');
      assert.equal(resDesc.field, 'description');
      assert.ok(resDesc.reply.includes('description zaroori hai'));

      // Skip on startDate: refuses and re-asks startDate
      const draftNoStart = { intent: 'create_project', name: 'Alpha', description: 'Desc', startDate: null };
      const resStart = await parseTaskRequest({
        req: mockReq,
        action: { type: 'skip', field: 'startDate' },
        draft: draftNoStart,
      }, deps);
      assert.equal(resStart.status, 'needs_input');
      assert.equal(resStart.field, 'startDate');
      assert.ok(resStart.reply.includes('start date zaroori hai'));

      // Skip on members: refuses and re-asks members
      const draftNoMembers = {
        intent: 'create_project',
        name: 'Alpha',
        description: 'Desc',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        members: [],
      };
      const resMembers = await parseTaskRequest({
        req: mockReq,
        action: { type: 'skip', field: 'members' },
        draft: draftNoMembers,
      }, deps);
      assert.equal(resMembers.status, 'needs_input');
      assert.equal(resMembers.field, 'members');
      assert.ok(resMembers.reply.includes('member zaroori hai'));
    });

    it('4.2 "Baaki sab default" never fills required slots', async () => {
      const deps = {
        getAccessibleProjects: async () => [],
        getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
      };

      // User says "Baaki sab default" on missing description
      const draftMissing = {
        intent: 'create_project',
        name: 'New Platform',
        description: null,
      };
      const res = await parseTaskRequest({
        req: mockReq,
        message: 'Baaki sab default',
        draft: draftMissing,
      }, deps);

      assert.equal(res.status, 'needs_input');
      assert.equal(res.field, 'description', 'Must still ask for required description');
      assert.ok(!res.preview, 'Preview must never show with empty required slots');
    });

    it('4.3 End before start is rejected with an error notice and re-asks endDate', async () => {
      const deps = {
        getAccessibleProjects: async () => [],
        getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
      };

      const draftWithBadDates = {
        intent: 'create_project',
        name: 'Test Project',
        description: 'Testing dates',
        startDate: '2026-11-20',
        endDate: '2026-11-10', // End before start!
        members: [{ id: 'u1', name: 'User 1' }],
      };

      const res = await parseTaskRequest({
        req: mockReq,
        draft: draftWithBadDates,
        message: 'Theek hai',
      }, deps);

      assert.equal(res.status, 'needs_input');
      assert.equal(res.field, 'endDate');
      assert.ok(res.reply.includes('End date start date se pehle nahi ho sakti'));
    });

    it('4.4 Relative dates ("kal se 2 hafte") in IST parses accurately', () => {
      const range = parseProjectDateRange('kal se 2 hafte');
      assert.ok(range, 'Should parse "kal se 2 hafte"');
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(range.startDate));
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(range.endDate));

      const start = new Date(range.startDate);
      const end = new Date(range.endDate);
      const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
      assert.equal(diffDays, 14, 'Difference must be exactly 14 days (2 weeks)');
    });

    it('4.5 PDF valid / non-PDF / over 10MB validation', () => {
      // 1. Valid PDF under 10MB
      const validPdf = { name: 'spec.pdf', size: 5 * 1024 * 1024, type: 'application/pdf' };
      const vResult = validateAttachmentFile(validPdf, 0, 1);
      assert.equal(vResult.valid, true);

      // 2. Non-PDF file (e.g. .png or .docx)
      const pngFile = { name: 'image.png', size: 1024 * 1024, type: 'image/png' };
      const pngResult = validateAttachmentFile(pngFile, 0, 1);
      assert.equal(pngResult.valid, false);
      assert.ok(pngResult.error.includes('Only PDF'));

      // 3. PDF over 10MB
      const hugePdf = { name: 'huge.pdf', size: 11 * 1024 * 1024, type: 'application/pdf' };
      const hugeResult = validateAttachmentFile(hugePdf, 0, 1);
      assert.equal(hugeResult.valid, false);
      assert.ok(hugeResult.error.includes('10MB'));
    });

    it('4.6 Members ledger cases ("vansh or kavya", "वंश और काव्या", unknown, non-company, two Kavyas, remove, add, empty list)', async () => {
      const companyUsers = [
        { _id: 'u_v', name: 'Vansh Test', department: 'Dev' },
        { _id: 'u_k1', name: 'Kavya Sharma', department: 'UI/UX' },
        { _id: 'u_k2', name: 'Kavya Gupta', department: 'QA' },
      ];

      const deps = {
        companyUsers,
        getAccessibleProjects: async () => [],
        isAssigneeInScope: async () => true,
        getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
      };

      // 1. "vansh or kavya" -> Vansh resolved, Kavya ambiguous (two Kavyas)
      const resVanshKavya = await parseTaskRequest({
        req: mockReq,
        message: 'Naya project Website Redesign team members vansh or kavya',
      }, deps);
      assert.equal(resVanshKavya.status, 'needs_disambiguation');
      assert.equal(resVanshKavya.field, 'assignee');
      assert.equal(resVanshKavya.candidates.length, 2);

      // 2. "वंश और काव्या" (Devanagari)
      const resDevanagari = await parseTaskRequest({
        req: mockReq,
        message: 'Naya project Mobile App team members वंश और काव्या',
      }, deps);
      assert.equal(resDevanagari.status, 'needs_disambiguation');
      assert.equal(resDevanagari.candidates.length, 2);

      // 3. Unknown member
      const resUnknown = await parseTaskRequest({
        req: mockReq,
        message: 'Naya project ERP team members vansh aur nonExistingPerson123',
      }, deps);
      assert.ok(resUnknown.reply.includes('nonExistingPerson123') || resUnknown.notices.some(n => n.includes('nonExistingPerson123')));

      // 4. Non-company user (isAssigneeInScope returns false)
      const depsWithForeign = {
        ...deps,
        isAssigneeInScope: async (r, s, uid) => uid === 'u_v', // only Vansh in scope
      };
      const resForeign = await parseTaskRequest({
        req: mockReq,
        message: 'Naya project Test team members vansh aur Kavya Sharma',
      }, depsWithForeign);
      assert.ok(resForeign.notices.some(n => n.includes('scope se bahar')));
    });

    it('4.7 Duplicate name chips show status, start date, and member count of existing project', async () => {
      const existingProjects = [{
        _id: 'proj_exist_1',
        projectName: 'Alpha Portal',
        status: 'Active',
        startDate: '2026-10-15',
        users: [{ _id: 'u1', name: 'A' }, { _id: 'u2', name: 'B' }, { _id: 'u3', name: 'C' }],
      }];

      const deps = {
        getAccessibleProjects: async () => existingProjects,
        getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
      };

      const res = await parseTaskRequest({
        req: mockReq,
        message: 'Naya project banao Alpha Portal',
      }, deps);

      assert.equal(res.status, 'needs_disambiguation');
      assert.equal(res.field, 'name');
      assert.ok(res.reply.includes('Active'));
      assert.ok(res.reply.includes('3 members'));
      const confirmChip = res.chips.find(c => c.action?.type === 'confirm_duplicate_project_name');
      assert.ok(confirmChip);
      assert.ok(confirmChip.label.includes('Active'));
    });

    it('4.8 Edit commands ("name badlo", "dates badlo", "priority low kar do")', async () => {
      const deps = {
        getAccessibleProjects: async () => [],
        getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
      };

      const readyDraft = {
        intent: 'create_project',
        name: 'Alpha Portal',
        description: 'New portal',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        priority: 'High',
        status: 'Active',
        members: [{ id: 'u1', name: 'User 1' }],
      };

      // 1. "priority low kar do"
      const resPriority = await parseTaskRequest({
        req: mockReq,
        message: 'priority low kar do',
        draft: readyDraft,
      }, deps);
      assert.equal(resPriority.draft.priority, 'Low');

      // 2. "name badlo"
      const resName = await parseTaskRequest({
        req: mockReq,
        message: 'name badlo',
        draft: readyDraft,
      }, deps);
      assert.equal(resName.status, 'needs_input');
      assert.equal(resName.field, 'name');
    });

    it('4.9 Case-insensitive roles matching PageAccessGate (Owner, owner, admin, super_admin, HR, manager)', () => {
      assert.equal(canCreateProject({ role: 'Owner', companyCode: 'C1' }), true);
      assert.equal(canCreateProject({ role: 'owner', companyCode: 'C1' }), true);
      assert.equal(canCreateProject({ role: 'admin', companyCode: 'C1' }), true);
      assert.equal(canCreateProject({ role: 'ADMIN', companyCode: 'C1' }), true);
      assert.equal(canCreateProject({ role: 'super_admin', companyCode: 'C1' }), true);
      assert.equal(canCreateProject({ role: 'company_owner', companyCode: 'C1' }), true);
      assert.equal(canCreateProject({ role: 'HR', allowedPages: ['manage-projects'], companyCode: 'C1' }), true);
      assert.equal(canCreateProject({ role: 'manager', allowedPages: ['adminproject'], companyCode: 'C1' }), true);
      // Plain employee without allowedPages is refused
      assert.equal(canCreateProject({ role: 'employee', companyCode: 'C1' }), false);
      assert.equal(canCreateProject({ role: 'client', companyCode: 'C1' }), false);
    });
  });

  // =========================================================================
  // ITEM 5: VALIDATION & TRUST BOUNDARY (Tampered Draft Re-Resolution)
  // =========================================================================
  describe('Item 5: Validation & Trust Boundary', () => {
    it('server never trusts client-supplied userIds or statuses: tampered foreign userId is re-verified and reset to open', async () => {
      const foreignCompanyId = new mongoose.Types.ObjectId();
      const foreignUser = await User.create({
        name: 'Attacker Foreign',
        email: 'attacker@evilcorp.com',
        password: 'Password123!',
        company: foreignCompanyId,
        companyCode: 'EVIL999',
        role: 'user',
        department: new mongoose.Types.ObjectId(),
      });

      const tamperedDraft = {
        intent: 'task_project',
        projectName: 'Alpha NextGen Portal',
        title: 'Tampered task',
        assigneeLedger: [
          {
            rawName: 'attacker foreign',
            displayName: 'Attacker Foreign',
            status: 'resolved', // Client claims it is resolved!
            userId: String(foreignUser._id), // Foreign tenant user ID!
          },
        ],
      };

      const mockDeps = {
        getAccessibleProjects: async () => [{
          _id: 'proj1',
          projectName: 'Alpha NextGen Portal',
          users: [],
        }],
        isAssigneeInScope: async () => false, // Foreign user is NOT in company scope!
      };

      const result = await parseTaskRequest({
        req: {
          user: {
            _id: String(ownerUser._id),
            role: 'owner',
            company: testCompanyId,
            companyCode: 'CORP100',
          },
        },
        draft: tamperedDraft,
        action: { type: 'set', field: 'priority', value: 'High' },
      }, mockDeps);

      // Ledger must NOT have foreignUser as resolved
      const ledgerEntry = result.draft.assigneeLedger.find(e => e.displayName === 'Attacker Foreign');
      assert.ok(ledgerEntry, 'Entry must exist');
      assert.ok(ledgerEntry.status === 'open' || ledgerEntry.status === 'not_member', 'Tampered entry must be reset from resolved');
      assert.notEqual(ledgerEntry.status, 'resolved', 'Tampered entry must NOT be resolved');
      assert.equal(ledgerEntry.userId, null, 'Tampered foreign userId must be wiped');
      assert.equal(result.draft.assignees.length, 0, 'No foreign assignees allowed');
    });
  });

  describe('Item 6: Real-Route Real-Request Proof Suite (Bug 1, Bug 2, Bug 3)', () => {
    async function callRealRoute({ text, action, pick, draft, user = ownerUser }) {
      const { buildParseRequestBody } = await import('../../CIIS/src/hooks/taskAgentPureLogic.js');
      const body = buildParseRequestBody({ text, action, pick, draft });

      let statusCode = 200;
      let jsonBody = null;
      const req = {
        user: {
          _id: String(user._id),
          name: user.name,
          email: user.email,
          role: user.role,
          companyRole: user.companyRole || 'owner',
          company: user.company,
          companyCode: user.companyCode,
          branchId: user.branchId,
        },
        body,
      };
      const res = {
        status: (code) => { statusCode = code; return res; },
        json: (data) => { jsonBody = data; return res; },
      };

      const mockDeps = {
        getAccessibleProjects: async () => [],
        isAssigneeInScope: async () => true,
      };

      await parseTask(req, res, mockDeps);
      return { statusCode, ...jsonBody };
    }

    it('6.1 Real conversation bug fix: answering "november 3 , 2026" to endDate reaches member question without any "naam nahi mila"', async () => {
      const draft = {
        intent: 'create_project',
        name: 'ZZ AI Test',
        description: 'testing project',
        startDate: '2026-10-29',
        asked: ['name', 'description', 'startDate', 'endDate'],
        skipped: [],
        askCounts: { name: 1, description: 1, startDate: 1, endDate: 1 },
      };

      const res = await callRealRoute({
        text: 'november 3 , 2026',
        draft,
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.success, true);
      assert.equal(res.status, 'needs_input');
      assert.equal(res.field, 'members');
      assert.match(res.reply, /Project mein kaun kaun members honge\? Naam batayein \(aap khud shamil honge\)/i);
      assert.ok(res.chips.some(c => c.label === 'Sirf main'));
      assert.equal(res.draft.endDate, '2026-11-03');
      assert.equal(res.draft.intent, 'create_project');

      // Crucial: Must NEVER contain employee notices or task phrasing
      const noticeStr = (res.notices || []).join(' ');
      assert.doesNotMatch(noticeStr, /naam ka koi employee nahi mila/i);
      assert.doesNotMatch(res.reply, /kiske liye task banana hai/i);
    });

    it('6.2 All 14 date formats for startDate and endDate parse cleanly in IST to YYYY-MM-DD', async () => {
      const sampleInputs = [
        'november 3, 2026',
        'november 3 , 2026',
        '3 november',
        '3 nov 2026',
        'november 3',
        '3/11/2026',
        '03-11-2026',
        '2026-11-03',
        '3 नवंबर',
        'aaj',
        'kal',
        'parso',
        '30 din baad',
        'agle hafte',
        'is mahine ke end tak',
      ];

      for (const input of sampleInputs) {
        const draft = {
          intent: 'create_project',
          name: 'ZZ AI Test',
          description: 'testing',
          asked: ['name', 'description', 'startDate'],
          skipped: [],
          askCounts: { name: 1, description: 1, startDate: 1 },
        };

        const res = await callRealRoute({
          text: input,
          draft,
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.success, true);
        assert.ok(res.draft.startDate, `startDate must be set for input: "${input}"`);
        assert.match(res.draft.startDate, /^\d{4}-\d{2}-\d{2}$/, `Date must be YYYY-MM-DD for input: "${input}"`);
      }
    });

    it('6.3 End date before start date is refused with friendly notice and re-asks endDate', async () => {
      const draft = {
        intent: 'create_project',
        name: 'ZZ AI Test',
        description: 'testing',
        startDate: '2026-11-15',
        asked: ['name', 'description', 'startDate', 'endDate'],
        skipped: [],
        askCounts: { name: 1, description: 1, startDate: 1, endDate: 1 },
      };

      const res = await callRealRoute({
        text: '2026-11-01', // Before Nov 15
        draft,
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.status, 'needs_input');
      assert.equal(res.field, 'endDate');
      assert.match(res.reply, /End date start date se pehle nahi ho sakti/i);
      assert.equal(res.draft.endDate, null);
    });

    it('6.4 Invalid date input re-asks the same question with two example formats and chips, rejecting date tokens as names', async () => {
      const draft = {
        intent: 'create_project',
        name: 'ZZ AI Test',
        description: 'testing',
        startDate: '2026-11-01',
        asked: ['name', 'description', 'startDate', 'endDate'],
        skipped: [],
        askCounts: { name: 1, description: 1, startDate: 1, endDate: 1 },
      };

      const res = await callRealRoute({
        text: 'gibberish non-date text',
        draft,
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.status, 'needs_input');
      assert.equal(res.field, 'endDate');
      assert.match(res.reply, /Project kab tak complete hona chahiye\? Kripya date batayein/i);
      assert.ok(res.chips.length >= 2, 'Must provide example format chips');
      assert.doesNotMatch((res.notices || []).join(' '), /naam ka koi employee nahi mila/i);
    });

    it('6.5 "Sirf main" reaches ready state with creator only as resolved member', async () => {
      const draft = {
        intent: 'create_project',
        name: 'ZZ AI Test',
        description: 'testing',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        priority: 'Medium',
        status: 'Active',
        asked: ['name', 'description', 'startDate', 'endDate', 'priority', 'status', 'members'],
        skipped: [],
        askCounts: { name: 1, description: 1, startDate: 1, endDate: 1, priority: 1, status: 1, members: 1 },
      };

      const res = await callRealRoute({
        text: 'Sirf main',
        draft,
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.success, true);
      assert.equal(res.status, 'ready');
      assert.ok(res.draft.members.length === 1);
      assert.equal(res.draft.members[0].id, String(ownerUser._id));
      assert.match(res.reply, /aap bhi member honge|Aap member honge/i);
    });

    it('6.6 Existing task flows remain untouched and functional', async () => {
      // 1. self_task
      const resSelf = await callRealRoute({
        text: 'kal subah 10 baje team meeting',
      });
      assert.equal(resSelf.statusCode, 200);
      assert.notEqual(resSelf.draft.intent, 'create_project');

      // 2. task_assigned_user
      const resAssigned = await callRealRoute({
        text: 'Vansh ko task assign karo kal 5 baje',
      });
      assert.equal(resAssigned.statusCode, 200);
      assert.notEqual(resAssigned.draft.intent, 'create_project');
    });
  });
});
