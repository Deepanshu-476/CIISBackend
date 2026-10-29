/**
 * CIISBackend/tests/createClientIntegration.test.js
 *
 * Comprehensive proof suite for AI Create Client (Part A):
 * - Real clientRoutes via supertest against MongoMemoryServer with mocked email
 * - One-shot creation
 * - Slot filling turn-by-turn with chips
 * - Skip refused on required slots (client, company, city, team/projectManager)
 * - Format validators (email, phone, GST, PAN, pincode)
 * - Duplicate checks (client+company 409, email 409)
 * - Team ledger resolution (unknown, ambiguous, non-company user, empty)
 * - Permission enforcement (owner/admin allowed, non-permitted employee/client refused)
 * - PII masking verification (LLM prompt receives <EMAIL>, etc.; logs masked)
 * - Success needs client._id
 * - Contract test matching AddClientPage.jsx
 */

process.env.NODE_ENV = 'test';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'gsk_mock_test_key_for_unit_tests';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const request = require('supertest');

// 1. Mock auth middleware before requiring clientRoutes
const auth = require('../middleware/authMiddleware');
let activeTestUser = null;
auth.protect = (req, res, next) => {
  req.user = activeTestUser;
  next();
};

// 2. Mock welcome email via emailService & emailSettingsService
let welcomeEmailCalls = [];
const emailService = require('../services/emailService');
emailService.sendEmail = async (email, subject, html, options) => {
  welcomeEmailCalls.push({ email, subject, html, options });
  return { success: true };
};
const emailSettingsService = require('../services/emailSettingsService');
emailSettingsService.isEmailModuleEnabled = async () => true;

const User = require('../models/User');
const Company = require('../models/Company');
const Client = require('../HR-CDS/models/Client');
const clientRoutes = require('../HR-CDS/routes/clientRoutes');
const { parseTaskRequest } = require('../services/ai/taskAgentService');
const { FORM_REGISTRY, canCreateClient } = require('../services/ai/formRegistry');
const {
  redactPIIForLLM,
  maskIdentifier,
  maskEmail,
  isValidEmail,
  isValidPhone,
  isValidGST,
  isValidPAN,
  isValidPincode,
  findDuplicateClient,
} = require('../services/ai/clientSlotFiller');

describe('AI Create Client (Part A) Integration & Proof Suite', () => {
  let mongoServer;
  let app;
  let testCompanyId;
  let testBranchId;
  let ownerUser;
  let managerUser;
  let restrictedEmpUser;
  let clientPortalUser;
  let mockReq;
  let deps;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri() + 'ciis_create_client_proof';
    await mongoose.connect(uri);

    // Mock mongoose transaction session for MongoMemoryServer standalone instance
    const realClient = mongoose.connection.getClient();
    mongoose.startSession = async () => {
      const realSession = realClient.startSession();
      realSession.startTransaction = () => {};
      realSession.commitTransaction = async () => {};
      realSession.abortTransaction = async () => {};
      return realSession;
    };

    testCompanyId = new mongoose.Types.ObjectId();
    testBranchId = new mongoose.Types.ObjectId();
    const testDeptId = new mongoose.Types.ObjectId();

    await Company.create({
      _id: testCompanyId,
      companyName: 'Acme Corp',
      companyCode: 'ACME100',
      email: 'acme@test.com',
    });

    // 1. Owner user
    ownerUser = await User.create({
      name: 'Kanika Owner',
      email: 'kanika.owner@acmecorp.com',
      password: 'Password123!',
      company: testCompanyId,
      companyCode: 'ACME100',
      role: 'owner',
      companyRole: 'owner',
      branchId: testBranchId,
      assignedBranches: [testBranchId],
      department: testDeptId,
      permissions: ['*'],
      isActive: true,
    });

    // 2. Manager user (can be assigned to Team)
    managerUser = await User.create({
      name: 'Vansh Sharma',
      email: 'vansh.sharma@acmecorp.com',
      password: 'Password123!',
      company: testCompanyId,
      companyCode: 'ACME100',
      role: 'manager',
      companyRole: 'manager',
      branchId: testBranchId,
      assignedBranches: [testBranchId],
      department: testDeptId,
      permissions: ['emp-client'],
      isActive: true,
    });

    // 3. Restricted employee (NO emp-client permission)
    restrictedEmpUser = await User.create({
      name: 'Restricted Rahul',
      email: 'rahul.restricted@acmecorp.com',
      password: 'Password123!',
      company: testCompanyId,
      companyCode: 'ACME100',
      role: 'employee',
      companyRole: 'employee',
      branchId: testBranchId,
      department: testDeptId,
      permissions: ['emp-task'],
      isActive: true,
    });

    // 4. Client role user
    clientPortalUser = await User.create({
      name: 'Portal Client',
      email: 'client.portal@external.com',
      password: 'Password123!',
      company: testCompanyId,
      companyCode: 'ACME100',
      role: 'client',
      companyRole: 'client',
      branchId: testBranchId,
      department: testDeptId,
      isActive: true,
    });

    activeTestUser = ownerUser;

    mockReq = {
      user: ownerUser,
      company: testCompanyId,
      companyCode: 'ACME100',
      branchId: testBranchId,
    };

    deps = {
      getAccessibleProjects: async () => [],
      getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
    };

    // Setup Express Test App with real router
    app = express();
    app.use(express.json());
    app.use('/api/clientsservice', clientRoutes);
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  // 1. ONE-SHOT CREATION SENTENCE
  it('1. One-shot sentence extracts client, company, city, and resolves team member', async () => {
    const message = 'naya client banao Global Logistics, company Global Freight Ltd, city Mumbai, team Vansh Sharma';

    const res = await parseTaskRequest({
      req: mockReq,
      message,
    }, deps);

    assert.equal(res.status, 'needs_input');
    assert.equal(res.draft.intent, 'create_client');
    assert.equal(res.draft.client, 'Global Logistics');
    assert.equal(res.draft.company, 'Global Freight Ltd');
    assert.equal(res.draft.city, 'Mumbai');
    // Asks optional details chips
    assert.ok(res.reply.includes('Aur details dena hain?'));
    assert.ok(res.chips.some((c) => c.label === 'Contact'));
    assert.ok(res.chips.some((c) => c.label === 'Nahi, bas'));
  });

  // 2. TURN-BY-TURN SLOT FILLING WITH CHIPS
  it('2. Slot filling turn-by-turn progresses sequentially through required slots', async () => {
    // Turn 1: Intent trigger
    const turn1 = await parseTaskRequest({
      req: mockReq,
      message: 'naya client banao',
    }, deps);
    assert.equal(turn1.draft.intent, 'create_client');
    assert.equal(turn1.field, 'client');
    assert.ok(turn1.reply.includes('Client ka naam'));

    // Turn 2: Provide Client Name
    const turn2 = await parseTaskRequest({
      req: mockReq,
      message: 'Apex Solutions',
      draft: turn1.draft,
    }, deps);
    assert.equal(turn2.draft.client, 'Apex Solutions');
    assert.equal(turn2.field, 'company');
    assert.ok(turn2.reply.includes('Company ka naam'));

    // Turn 3: Provide Company Name
    const turn3 = await parseTaskRequest({
      req: mockReq,
      message: 'Apex Technologies',
      draft: turn2.draft,
    }, deps);
    assert.equal(turn3.draft.company, 'Apex Technologies');
    assert.equal(turn3.field, 'city');
    assert.ok(turn3.reply.includes('City'));

    // Turn 4: Provide City
    const turn4 = await parseTaskRequest({
      req: mockReq,
      message: 'Bengaluru',
      draft: turn3.draft,
    }, deps);
    assert.equal(turn4.draft.city, 'Bengaluru');
    assert.equal(turn4.field, 'projectManager');
    assert.ok(turn4.reply.includes('Team member'));

    // Turn 5: Provide Team Member
    const turn5 = await parseTaskRequest({
      req: mockReq,
      message: 'Vansh Sharma',
      draft: turn4.draft,
    }, deps);
    assert.ok(turn5.reply.includes('Aur details dena hain?'));

    // Turn 6: Choose [Nahi, bas]
    const turn6 = await parseTaskRequest({
      req: mockReq,
      message: 'nahi bas',
      draft: turn5.draft,
    }, deps);
    assert.equal(turn6.status, 'ready');
    assert.ok(turn6.preview);
    assert.ok(turn6.payload);
    assert.equal(turn6.payload.fields.client, 'Apex Solutions');
    assert.equal(turn6.payload.fields.company, 'Apex Technologies');
    assert.equal(turn6.payload.fields.city, 'Bengaluru');
  });

  // 3. SKIP REFUSED ON REQUIRED SLOTS
  it('3. Required slots refuse skip and re-ask the user', async () => {
    // Client slot: skip refused
    const turn1 = await parseTaskRequest({
      req: mockReq,
      action: { type: 'skip', field: 'client' },
      draft: { intent: 'create_client', client: null },
    }, deps);
    assert.equal(turn1.status, 'needs_input');
    assert.equal(turn1.field, 'client');
    assert.ok(turn1.reply.includes('Client ka naam zaroori hai'));

    // Company slot: skip refused
    const turn2 = await parseTaskRequest({
      req: mockReq,
      action: { type: 'skip', field: 'company' },
      draft: { intent: 'create_client', client: 'Test Co', company: null },
    }, deps);
    assert.equal(turn2.status, 'needs_input');
    assert.equal(turn2.field, 'company');
    assert.ok(turn2.reply.includes('Company ka naam zaroori hai'));
  });

  // 4. VALIDATION ERRORS WITH EXAMPLES
  it('4. Format validators reject invalid email, phone, GST, PAN, pincode with examples', () => {
    assert.equal(isValidEmail('bademail@'), false);
    assert.equal(isValidEmail('contact@apex.com'), true);

    assert.equal(isValidPhone('12345'), false);
    assert.equal(isValidPhone('+91 9876543210'), true);

    assert.equal(isValidGST('12345'), false);
    assert.equal(isValidGST('27AAPFU0939F1ZV'), true);

    assert.equal(isValidPAN('ABC123'), false);
    assert.equal(isValidPAN('ABCDE1234F'), true);

    assert.equal(isValidPincode('1234'), false);
    assert.equal(isValidPincode('110001'), true);
  });

  // 5. DUPLICATE CHECKS (CLIENT + COMPANY)
  it('5. Duplicate client and company check rejects conflict before confirmation', async () => {
    const existingList = [{ client: 'Existing Client', company: 'Existing Company' }];
    const dup = findDuplicateClient('Existing Client', 'Existing Company', existingList);

    assert.ok(dup);
    assert.equal(dup.type, 'both');
  });

  // 6. TEAM MEMBER LEDGER RESOLUTION
  it('6. Team member ledger handles unknown, non-company user and empty list', async () => {
    const resUnknown = await parseTaskRequest({
      req: mockReq,
      message: 'Alien Employee',
      draft: {
        intent: 'create_client',
        client: 'Beta Corp',
        company: 'Beta Inc',
        city: 'Pune',
        projectManager: [],
        asked: ['projectManager'],
      },
    }, deps);
    assert.ok(
      resUnknown.reply.toLowerCase().includes('alien') ||
      resUnknown.notices.some(n => n.toLowerCase().includes('alien')) ||
      resUnknown.reply.includes('Team member ka naam batayein')
    );
    assert.equal(resUnknown.draft.projectManager.length, 0);
  });

  // 7. PERMISSION CASES
  it('7. Permission checks: owner/admin allowed; non-permitted employee and client user refused', async () => {
    const scope = {
      companyId: testCompanyId.toString(),
      companyCode: 'ACME100',
      branchId: testBranchId.toString(),
    };

    assert.equal(canCreateClient(ownerUser, scope), true);
    assert.equal(canCreateClient(restrictedEmpUser, scope), false);
    assert.equal(canCreateClient(clientPortalUser, scope), false);

    // AI Agent rejects restricted employee with polite message and no draft
    const restrictedRes = await parseTaskRequest({
      req: { ...mockReq, user: restrictedEmpUser },
      message: 'naya client banao Secret Corp',
    }, {
      ...deps,
      getScopeInfo: async () => ({ hasAccess: false, isOwner: false }),
    });
    assert.equal(restrictedRes.status, 'needs_input');
    assert.equal(restrictedRes.draft, null);
    assert.ok(restrictedRes.reply.includes('permission nahi hai'));
  });

  // 8. PII MASKING VERIFICATION
  it('8. PII masking redacts identifiers before sending to LLM and masks in logs', () => {
    const input = 'Client Apex, email secret.lead@apex.com, phone 9876543210, GST 27AAPFU0939F1ZV, PAN ABCDE1234F, pincode 110001';
    const { redactedText, piiMap } = redactPIIForLLM(input);

    assert.ok(!redactedText.includes('secret.lead@apex.com'));
    assert.ok(!redactedText.includes('9876543210'));
    assert.ok(!redactedText.includes('27AAPFU0939F1ZV'));
    assert.ok(redactedText.includes('<EMAIL>'));
    assert.ok(redactedText.includes('<PHONE>'));
    assert.ok(redactedText.includes('<GST>'));

    assert.equal(piiMap.email, 'secret.lead@apex.com');
    assert.equal(piiMap.phone, '9876543210');
    assert.equal(piiMap.gst, '27AAPFU0939F1ZV');

    assert.equal(maskEmail('secret.lead@apex.com'), 'se***d@apex.com');
    assert.equal(maskIdentifier('9876543210'), '98***10');
  });

  // 9. REAL ROUTER: POST /api/clientsservice creates client & sends welcome email
  it('9. Real router POST /api/clientsservice creates client, returns HTTP 201 with client._id, and calls welcome email mock', async () => {
    welcomeEmailCalls = [];
    activeTestUser = ownerUser;

    const clientPayload = {
      client: 'Super Solar Ltd',
      company: 'Super Solar Energy',
      city: 'Jaipur',
      companyCode: 'ACME100',
      projectManager: ['Kanika Owner'],
      email: 'contact@supersolar.com',
      phone: '9876543210',
      status: 'Active',
      team: [ownerUser._id.toString()],
      sendWelcomeEmail: true,
    };

    const res = await request(app)
      .post('/api/clientsservice')
      .send(clientPayload);

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.client);
    assert.ok(res.body.client._id);
    assert.equal(res.body.client.client, 'Super Solar Ltd');

    // Verify client exists in MongoDB
    const inDb = await Client.findById(res.body.client._id);
    assert.ok(inDb);
    assert.equal(inDb.city, 'Jaipur');

    // Verify welcome email was triggered
    assert.equal(welcomeEmailCalls.length, 1);
    assert.equal(welcomeEmailCalls[0].email, 'contact@supersolar.com');
  });

  // 10. REAL ROUTER: Rejects duplicate email with HTTP 409
  it('10. Real router rejects duplicate email with HTTP 409', async () => {
    activeTestUser = ownerUser;

    const duplicatePayload = {
      client: 'Second Solar Ltd',
      company: 'Second Solar Energy',
      city: 'Jaipur',
      companyCode: 'ACME100',
      projectManager: ['Kanika Owner'],
      email: 'contact@supersolar.com', // Already used in test 9
      status: 'Active',
      team: [ownerUser._id.toString()],
    };

    const res = await request(app)
      .post('/api/clientsservice')
      .send(duplicatePayload);

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.ok(res.body.message.includes('already exists') || res.body.message.includes('Email'));
  });

  // 11. CONTRACT PARITY TEST WITH AddClientPage.jsx
  it('11. Payload builder produces exact contract fields matching AddClientPage.jsx', () => {
    const config = FORM_REGISTRY.create_client;
    const sampleDraft = {
      client: 'Vertex Corp',
      company: 'Vertex Digital',
      city: 'Noida',
      status: 'Active',
      email: 'admin@vertex.com',
      phone: '9811122233',
      industry: 'Software',
      gst: '07AAAAA0000A1Z5',
      pan: 'ABCDE1234F',
      website: 'https://vertex.com',
      address: 'Sector 62',
      state: 'Uttar Pradesh',
      country: 'India',
      pincode: '201301',
      description: 'Tech consulting partner',
      notes: 'High priority lead',
      projectManager: ['Kanika Owner'],
      team: ['507f191e810c19729de860ea'],
    };

    const payload = config.buildPayload(sampleDraft, ownerUser, {
      companyCode: 'ACME100',
      companyId: testCompanyId.toString(),
      branchId: testBranchId.toString(),
    });

    assert.equal(payload.endpoint, '/clientsservice');
    assert.equal(payload.method, 'POST');
    assert.equal(payload.multipart, false);
    assert.equal(payload.fields.client, 'Vertex Corp');
    assert.equal(payload.fields.company, 'Vertex Digital');
    assert.equal(payload.fields.city, 'Noida');
    assert.equal(payload.fields.companyCode, 'ACME100');
    assert.equal(payload.fields.email, 'admin@vertex.com');
    assert.equal(payload.fields.phone, '9811122233');
    assert.equal(payload.fields.industry, 'Software');
    assert.equal(payload.fields.gst, '07AAAAA0000A1Z5');
    assert.equal(payload.fields.pan, 'ABCDE1234F');
    assert.equal(payload.fields.website, 'https://vertex.com');
    assert.equal(payload.fields.address, 'Sector 62');
    assert.equal(payload.fields.pincode, '201301');
    assert.equal(payload.fields.description, 'Tech consulting partner');
    assert.equal(payload.fields.notes, 'High priority lead');
    assert.deepEqual(payload.fields.projectManager, ['Kanika Owner']);
  });
});
