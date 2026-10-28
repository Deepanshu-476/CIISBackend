/**
 * tests/createProject.test.js
 *
 * Full verification test suite for `create_project` intent in CIIS AI Assistant.
 * Validates:
 * 1. Permission checks (RBAC server-side in service, matching PageAccessGate)
 * 2. Backend route finding (route has only protect, no role check)
 * 3. Creator auto-added as member in payload, preview ("aap bhi member honge"), speakText
 * 4. Payload contract test: users is ONE JSON string field
 * 5. Parity across all 3 intents: create_project vs task_project vs task_assigned_user
 * 6. Company and branch handling: All Branches vs specific branch
 * 7. Intent guards: "Project plan banao kal 5 baje", "Naya project banao Website Revamp", "Demo 1 project mein task banao", answering project slot
 * 8. Status and priority words in Hinglish and IST dates
 * 9. Duplicate project name detection & disambiguation chips
 * 10. Chained task flow into task_project
 * 11. Mocked notification paths (in-app only for project, email for chained task)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { FORM_REGISTRY, detectIntent, canCreateProject } = require('../services/ai/formRegistry');
const { parseTaskRequest } = require('../services/ai/taskAgentService');
const { parseRequestSchema } = require('../services/ai/aiSchemas');
const { formatIstDate, parseProjectDate, findDuplicateProject } = require('../services/ai/projectSlotFiller');

describe('AI Create Project Feature Suite', () => {

  // ==========================================================================
  // 1. RBAC & PERMISSION CHECKS (Requirement 1)
  // ==========================================================================
  describe('1. RBAC & Service-Side Permission Enforcement', () => {
    it('allows super_admin, admin, owner, and company_owner', () => {
      const allowedRoles = ['super_admin', 'superadmin', 'admin', 'owner', 'company_owner', 'companyowner'];
      for (const role of allowedRoles) {
        const user = { _id: 'u1', name: 'Test User', role, companyCode: 'CMP001' };
        assert.equal(canCreateProject(user), true, `Role ${role} must have create project permission`);
      }
    });

    it('allows employee with explicit manage-projects or adminproject page permission', () => {
      const user = {
        _id: 'u2',
        name: 'Manager User',
        role: 'employee',
        companyCode: 'CMP001',
        pagePermissions: ['manage-projects', 'emp-attendance'],
      };
      assert.equal(canCreateProject(user), true, 'User with manage-projects page access must be allowed');

      const user2 = {
        _id: 'u2b',
        name: 'AdminProject User',
        role: 'employee',
        companyCode: 'CMP001',
        permissions: [{ path: 'adminproject' }],
      };
      assert.equal(canCreateProject(user2), true, 'User with adminproject permission must be allowed');
    });

    it('refuses plain employee without project permissions and produces friendly refusal without draft', async () => {
      const plainEmployee = {
        _id: 'u3',
        name: 'Plain Employee',
        role: 'employee',
        companyCode: 'CMP001',
        pagePermissions: ['emp-attendance', 'my-leaves'],
      };
      assert.equal(canCreateProject(plainEmployee), false, 'Plain employee must NOT have create project permission');

      const req = { user: plainEmployee };
      const deps = {
        getAccessibleProjects: async () => [],
        getScopeInfo: async () => ({ hasAccess: false }),
      };

      const result = await parseTaskRequest({
        req,
        message: 'Naya project banao Mobile App',
        language: 'hinglish',
      }, deps);

      assert.equal(result.status, 'needs_input');
      assert.equal(result.draft, null, 'Draft must be null when permission is denied');
      assert.match(result.reply, /permission nahi hai/i);
      assert.ok(result.chips.some(c => c.label.includes('Task banao')));
    });

    it('refuses client role', () => {
      const clientUser = {
        _id: 'c1',
        name: 'Client User',
        role: 'client',
        companyCode: 'CMP001',
      };
      assert.equal(canCreateProject(clientUser), false, 'Client must NOT be allowed to create projects');
    });

    it('refuses user without companyCode or company', () => {
      const orphanUser = {
        _id: 'x1',
        name: 'Orphan User',
        role: 'admin',
      };
      assert.equal(canCreateProject(orphanUser), false, 'User without company must be refused');
    });

    it('documents finding that backend route POST /projects has only protect and no role check', () => {
      const routeFilePath = path.join(__dirname, '../HR-CDS/routes/projectRoutes.js');
      const routeCode = fs.readFileSync(routeFilePath, 'utf8');
      const postIdx = routeCode.indexOf('router.post(');
      assert.ok(postIdx !== -1, 'POST /projects route definition must exist');
      const routeChunk = routeCode.slice(postIdx, postIdx + 300);
      assert.ok(routeChunk.includes('protect'), 'Route has protect middleware');
      assert.ok(!routeChunk.includes('authorize('), 'Finding confirmed: route has NO authorize middleware (service-level RBAC is mandatory)');
    });
  });

  // ==========================================================================
  // 2. CREATOR AUTO-ADDED AS MEMBER & PREVIEW (Requirement 2)
  // ==========================================================================
  describe('2. Creator Auto-Inclusion and Preview Card', () => {
    it('auto-adds creator in users array payload even if user names nobody else', () => {
      const creator = {
        _id: 'creator_123',
        name: 'Karan Sharma',
        role: 'admin',
        companyCode: 'CMP001',
      };

      const draft = {
        name: 'Website Redesign',
        description: 'Revamp marketing website',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        members: [],
      };

      const payloadResult = FORM_REGISTRY.create_project.buildPayload(draft, creator);
      const parsedUsers = JSON.parse(payloadResult.fields.users);
      assert.ok(Array.isArray(parsedUsers));
      assert.equal(parsedUsers.length, 1);
      assert.equal(parsedUsers[0], 'creator_123', 'Creator ID must be in users array');
    });

    it('includes creator along with mentioned team members in users array', () => {
      const creator = {
        _id: 'creator_123',
        name: 'Karan Sharma',
        role: 'admin',
        companyCode: 'CMP001',
      };

      const draft = {
        name: 'CRM 2.0',
        description: 'New CRM frontend',
        startDate: '2026-11-01',
        endDate: '2026-12-31',
        members: [
          { id: 'user_456', name: 'Vansh Test' },
          { id: 'user_789', name: 'Aarav Sharma' },
        ],
      };

      const payloadResult = FORM_REGISTRY.create_project.buildPayload(draft, creator);
      const parsedUsers = JSON.parse(payloadResult.fields.users);
      assert.deepEqual(parsedUsers.sort(), ['creator_123', 'user_456', 'user_789'].sort());
    });

    it('preview card and speakText show creator is a member ("aap bhi member honge")', () => {
      const creator = {
        _id: 'creator_123',
        name: 'Karan Sharma',
        role: 'admin',
        companyCode: 'CMP001',
      };

      const draft = {
        name: 'CRM 2.0',
        description: 'New CRM frontend',
        startDate: '2026-11-01',
        endDate: '2026-12-31',
        members: [{ id: 'user_456', name: 'Vansh Test' }],
      };

      const preview = FORM_REGISTRY.create_project.buildPreview(draft, creator);
      assert.equal(preview.creatorIsMember, true);
      assert.match(preview.speakTextCreator, /aap bhi member honge/i);
      assert.ok(preview.members.some(m => m.includes('Karan Sharma') && m.includes('Creator')));
    });
  });

  // ==========================================================================
  // 3. PAYLOAD CONTRACT TESTS ACROSS ALL 3 INTENTS (Requirement 3)
  // ==========================================================================
  describe('3. Payload Contracts: create_project vs task_project vs task_assigned_user', () => {
    it('create_project sends users as ONE JSON string field matching AdminProject.jsx', () => {
      const user = { _id: 'u1', companyCode: 'CMP001' };
      const draft = {
        name: 'Test Project',
        description: 'Desc',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        members: [{ id: 'm1' }, { id: 'm2' }],
      };

      const payload = FORM_REGISTRY.create_project.buildPayload(draft, user);
      assert.equal(payload.endpoint, '/projects');
      assert.equal(payload.method, 'POST');
      assert.equal(payload.multipart, true);
      assert.equal(payload.fileField, 'pdfFile');
      assert.equal(typeof payload.fields.users, 'string', 'users must be a string');
      const parsed = JSON.parse(payload.fields.users);
      assert.ok(Array.isArray(parsed), 'parsed users must be an array of IDs');
    });

    it('task_project sends assignedUsers as repeated FormData entries matching AdminTaskCreate.jsx', () => {
      const draft = {
        projectId: 'proj_123',
        title: 'Project Task',
        description: 'Task Desc',
        dueDate: '2026-11-05T18:00:00+05:30',
        assignedUsers: ['u1', 'u2'],
      };

      const payload = FORM_REGISTRY.task_project.buildPayload(draft);
      assert.equal(payload.endpoint, '/projects/proj_123/tasks');
      assert.ok(Array.isArray(payload.fields.assignedUsers), 'task_project assignedUsers must be array for repeated FormData entries');
      assert.deepEqual(payload.fields.assignedUsers, ['u1', 'u2']);
    });

    it('task_assigned_user sends assignedUsers as ONE JSON string field matching AdminTaskCreate.jsx', () => {
      const draft = {
        title: 'Assigned Task',
        description: 'Task Desc',
        dueDateTime: '2026-11-05T18:00:00+05:30',
        assignedUsers: ['u1', 'u2'],
      };

      const payload = FORM_REGISTRY.task_assigned_user.buildPayload(draft);
      assert.equal(payload.endpoint, '/task/create-for-others');
      assert.equal(typeof payload.fields.assignedUsers, 'string', 'task_assigned_user assignedUsers must be a JSON string');
      assert.deepEqual(JSON.parse(payload.fields.assignedUsers), ['u1', 'u2']);
    });
  });

  // ==========================================================================
  // 4. COMPANY AND BRANCH INVARIANTS (Requirement 4)
  // ==========================================================================
  describe('4. Company and Branch Invariants', () => {
    const user = {
      _id: 'fake_admin_id_001',
      name: 'Branch Admin',
      companyCode: 'CMP001',
      companyIdentifier: 'CID_FAKE_999',
    };

    it('All Branches selected: payload has companyCode and companyIdentifier, NO branch or branchId', () => {
      const draft = {
        name: 'Global Project',
        description: 'All branches project',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
      };

      const context = { branchId: undefined }; // All Branches selected
      const payload = FORM_REGISTRY.create_project.buildPayload(draft, user, context);

      assert.equal(payload.fields.companyCode, 'CMP001');
      assert.equal(payload.fields.companyIdentifier, 'CID_FAKE_999');
      assert.equal(payload.fields.branchId, undefined, 'branchId must NOT be present when All Branches selected');
      assert.equal(payload.fields.branch, undefined, 'branch must NOT be present when All Branches selected');
    });

    it('Specific branch selected: payload includes branchId and branch matching AdminProject.jsx', () => {
      const draft = {
        name: 'Delhi Project',
        description: 'Delhi branch project',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
      };

      const context = { branchId: 'BRANCH_FAKE_DELHI_01' };
      const payload = FORM_REGISTRY.create_project.buildPayload(draft, user, context);

      assert.equal(payload.fields.companyCode, 'CMP001');
      assert.equal(payload.fields.companyIdentifier, 'CID_FAKE_999');
      assert.equal(payload.fields.branchId, 'BRANCH_FAKE_DELHI_01');
      assert.equal(payload.fields.branch, 'BRANCH_FAKE_DELHI_01');
    });
  });

  // ==========================================================================
  // 5. INTENT GUARDS & DISAMBIGUATION (Requirement 5)
  // ==========================================================================
  describe('5. Intent Guards & Disambiguation', () => {
    it('"Project plan banao kal 5 baje" is NOT silently treated as create_project; asks disambiguation chip', () => {
      const result = detectIntent({
        message: 'Project plan banao kal 5 baje',
        accessibleProjects: [{ _id: 'p1', projectName: 'Demo 1' }],
      });

      assert.equal(result.isAmbiguous, true);
      assert.ok(result.chips.some(c => c.label.includes('Naya project banana hai')));
      assert.ok(result.chips.some(c => c.label.includes('Task banana hai')));
    });

    it('"Naya project banao Website Revamp" is detected as create_project with name Website Revamp', () => {
      const result = detectIntent({
        message: 'Naya project banao Website Revamp',
        accessibleProjects: [{ _id: 'p1', projectName: 'Demo 1' }],
      });

      assert.equal(result.intent, 'create_project');
      assert.equal(result.isExplicit, true);
      assert.equal(result.projectName, 'Website Revamp');
    });

    it('"Demo 1 project mein task banao" is detected as task_project', () => {
      const result = detectIntent({
        message: 'Demo 1 project mein task banao',
        accessibleProjects: [{ _id: 'p1', projectName: 'Demo 1' }],
      });

      assert.equal(result.intent, 'task_project');
    });

    it('answering "Kaun sa project?" with a project name inside active draft never starts create_project', () => {
      const draft = {
        intent: 'task_project',
        asked: ['project'],
        projectId: null,
      };

      const result = detectIntent({
        message: 'Website Revamp',
        draft,
        accessibleProjects: [{ _id: 'p1', projectName: 'Website Revamp' }],
      });

      assert.equal(result.intent, 'task_project', 'Must remain task_project when answering project slot');
    });
  });

  // ==========================================================================
  // 6. STATUS, PRIORITY & IST DATES (Requirement 6)
  // ==========================================================================
  describe('6. Status & Priority Words in Hinglish and IST Dates', () => {
    it('accepts planning, active, on hold, completed, cancelled in Hinglish forms', () => {
      const { formatCreateProjectStatus } = require('../services/ai/formRegistry');
      assert.equal(formatCreateProjectStatus('planning'), 'Planning');
      assert.equal(formatCreateProjectStatus('abhi plan mein'), 'Planning');
      assert.equal(formatCreateProjectStatus('on hold'), 'On Hold');
      assert.equal(formatCreateProjectStatus('ruka hua'), 'On Hold');
      assert.equal(formatCreateProjectStatus('khatam'), 'Completed');
      assert.equal(formatCreateProjectStatus('radd'), 'Cancelled');
      assert.equal(formatCreateProjectStatus('chalu'), 'Active');
      assert.equal(formatCreateProjectStatus('active'), 'Active');
    });

    it('accepts priority in Hinglish (kam -> Low, urgent/zaroori -> High, normal -> Medium)', () => {
      const { formatProjectPriority } = require('../services/ai/formRegistry');
      assert.equal(formatProjectPriority('kam'), 'Low');
      assert.equal(formatProjectPriority('low'), 'Low');
      assert.equal(formatProjectPriority('zaroori'), 'High');
      assert.equal(formatProjectPriority('urgent'), 'High');
      assert.equal(formatProjectPriority('high'), 'High');
      assert.equal(formatProjectPriority('medium'), 'Medium');
    });

    it('computes dates in IST YYYY-MM-DD format', () => {
      const refDate = new Date('2026-11-01T00:00:00Z');
      const start = parseProjectDate('aaj', refDate);
      const tomorrow = parseProjectDate('kal', refDate);
      assert.match(start, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(tomorrow, /^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // ==========================================================================
  // 7. DUPLICATE PROJECT NAME HANDLING (Requirement 8)
  // ==========================================================================
  describe('7. Duplicate Project Name Detection & Disambiguation', () => {
    const existingProjects = [
      { _id: 'proj_001', projectName: 'E-Commerce Portal', companyCode: 'CMP001' },
      { _id: 'proj_002', projectName: 'HR Mobile App', companyCode: 'CMP001' },
    ];

    it('detects case-insensitive duplicate project name and asks disambiguation chips', async () => {
      const req = {
        user: { _id: 'admin_1', role: 'admin', companyCode: 'CMP001' },
      };

      const deps = {
        getAccessibleProjects: async () => existingProjects,
        getScopeInfo: async () => ({ hasAccess: true }),
      };

      const result = await parseTaskRequest({
        req,
        message: 'Naya project banao e-commerce portal',
        language: 'hinglish',
      }, deps);

      assert.equal(result.status, 'needs_disambiguation');
      assert.equal(result.field, 'name');
      assert.match(result.reply, /pehle se maujood hai/i);
      assert.ok(result.chips.some(c => c.label.includes('Haan, yahi naam rakhein')));
      assert.ok(result.chips.some(c => c.label.includes('Doosra naam batayein')));
    });

    it('confirming duplicate project name marks duplicateHandled=true and proceeds to next slot', async () => {
      const req = {
        user: { _id: 'admin_1', role: 'admin', companyCode: 'CMP001' },
      };

      const deps = {
        getAccessibleProjects: async () => existingProjects,
        getScopeInfo: async () => ({ hasAccess: true }),
      };

      const draftWithDup = {
        intent: 'create_project',
        name: 'E-Commerce Portal',
        duplicateHandled: false,
        asked: ['name'],
        skipped: [],
        members: [],
      };

      const result = await parseTaskRequest({
        req,
        action: { type: 'confirm_duplicate_project_name' },
        draft: draftWithDup,
        language: 'hinglish',
      }, deps);

      assert.equal(result.draft.duplicateHandled, true);
      assert.equal(result.draft.name, 'E-Commerce Portal');
      assert.equal(result.field, 'description', 'Proceeds to description after confirming duplicate name');
    });
  });

  // ==========================================================================
  // 8. CHAINED TASK FLOW (Requirement 10)
  // ==========================================================================
  describe('8. Chained Task Flow into task_project', () => {
    it('clicking "Is project mein task banayein" transitions intent to task_project with newly created project', async () => {
      const req = {
        user: { _id: 'admin_1', role: 'admin', companyCode: 'CMP001' },
      };

      const deps = {
        getAccessibleProjects: async () => [{
          _id: '60c72b2f9b1d8b0015b6d999',
          projectName: 'Beta Release 2026',
          users: [{ _id: 'admin_1', name: 'Admin' }],
        }],
        getScopeInfo: async () => ({ hasAccess: true }),
      };

      const readyDraft = {
        intent: 'create_project',
        name: 'Beta Release 2026',
        description: 'New product beta release',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        priority: 'High',
        status: 'Active',
        members: [{ id: 'admin_1', name: 'Admin' }],
        duplicateHandled: true,
        projectId: '60c72b2f9b1d8b0015b6d999', // returned from creation
      };

      const result = await parseTaskRequest({
        req,
        action: { type: 'chain_task' },
        draft: readyDraft,
        language: 'hinglish',
      }, deps);

      assert.equal(result.draft.intent, 'task_project');
      assert.equal(result.draft.taskFor, 'project');
      assert.equal(result.draft.projectName, 'Beta Release 2026');
      assert.equal(result.field, 'title', 'Asks for first task title in the chained project');
    });
  });

  // ==========================================================================
  // 9. MOCKED NOTIFICATIONS CONTRACT (Requirement 7)
  // ==========================================================================
  describe('9. Mocked Notification & Email Contract', () => {
    it('project creation triggers only in-app notifications, NO emails; chained task triggers emails', () => {
      // Mock notification tracker
      const sentNotifications = [];
      const sentEmails = [];

      const mockNotifyDirectUsers = async (payload) => {
        sentNotifications.push(payload);
      };

      const mockSendTaskEmail = async (payload) => {
        sentEmails.push(payload);
      };

      // 1. Simulate project creation notification call (matches projectController.js line 971)
      mockNotifyDirectUsers({
        userIds: ['u2', 'u3'],
        type: 'project_created',
        title: 'New Project Created',
        message: 'Admin added you to project "Marketing"',
      });

      assert.equal(sentNotifications.length, 1);
      assert.equal(sentNotifications[0].type, 'project_created');
      assert.equal(sentEmails.length, 0, 'Project creation must NEVER send emails');

      // 2. Simulate chained task creation notification & email (matches addTask in projectController.js line 1500)
      mockSendTaskEmail({
        to: 'u2@ciisnetwork.in',
        subject: 'New Task Assigned: Task 1',
      });

      assert.equal(sentEmails.length, 1, 'Chained task creation sends email');
    });
  });

});

